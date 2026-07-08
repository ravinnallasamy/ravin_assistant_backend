# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies
npm run dev        # start server (node server.js, no watch/reload)
npm start          # same as dev, production entry point
node test-db.js     # ad-hoc script to sanity-check Supabase connectivity
node scripts/hash-password.js <password>   # generate a bcrypt hash for the admin table
```

There is no test framework, lint config, or build step configured — `test-db.js` is a manual connectivity script, not a test suite. There is no watch mode; restart the process manually after edits.

The server listens on `PORT` (default 5000) and requires a `.env` file (see `.env.example`). Required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` (answer-generation LLM), `GROQ_API_KEY` (voice transcription only). Optional: `SUPABASE_ANON_KEY`, `CORS_ORIGIN` (comma-separated allowed origins; requests from any other origin are rejected), Google Cloud TTS credentials. Missing required vars now cause a clear fail-fast error at startup ([services/envCheck.js](services/envCheck.js)) instead of an unhandled crash deep in an SDK constructor.

## Architecture

This is an Express 5 REST API with two route groups mounted in [app.js](app.js): `/api/public` (unauthenticated) and `/api/admin` (protected by `adminAuth` middleware). There's no ORM — all persistence goes through a single shared Supabase client ([services/supabaseClient.js](services/supabaseClient.js)) instantiated with the **service role key**, so it bypasses Postgres RLS everywhere in this codebase. The frontend never talks to Supabase directly (confirmed: no `@supabase/supabase-js` anywhere in `frontend/`), so RLS in `setup-schema.sql` is deliberately **default-deny for anon** — no public read policies exist on any table.

Both `app.js` and every route now sit behind: `helmet()` (security headers), a strict CORS allowlist driven by `CORS_ORIGIN`, `express-rate-limit` on both route groups, and an `express.json({ limit: '2mb' })` body cap. A central error handler in `app.js` catches oversized bodies/files and unhandled errors without leaking stack traces to clients.

### Retrieval-augmented Q&A pipeline (the core feature)

The public `/api/public/ask` endpoint ([controllers/publicController.js](controllers/publicController.js)), gated by `validateAskQuestion` ([middlewares/validate.js](middlewares/validate.js)), is a small RAG loop:

1. Input is either typed `question` or `voiceBase64` (capped at 5MB base64) — voice is transcribed first via Groq Whisper (`speechToText` in [services/audioService.js](services/audioService.js)). Temp STT files use randomized names and are always unlinked in a `finally` block, and are additionally swept after 30 minutes by [services/tmpCleanup.js](services/tmpCleanup.js) as a backstop.
2. The question is embedded locally (no external embedding API) via Xenova Transformers (`all-MiniLM-L6-v2`, 384-dim) in [services/embeddingService.js](services/embeddingService.js). The pipeline is lazily initialized once per process; the in-flight load promise is cached so concurrent requests can't trigger duplicate model loads.
3. `similaritySearch` calls the Postgres RPC function `match_embeddings` (defined in [setup-schema.sql](setup-schema.sql)) which does cosine similarity over the `embeddings` table (pgvector, `vector(384)`). A failure here now throws and returns a 503 to the caller instead of silently returning an empty result set (previously indistinguishable from "no data exists").
4. If the question matches "about yourself" style keywords, bio/resume/portfolio text is force-injected into context regardless of vector search results (see the `bioKeywords` check) — this is a deliberate override, not a bug.
5. Context + question are assembled into a first-person prompt and sent to **Gemini** (`gemini-1.5-flash`, via `@google/generative-ai`, `GEMINI_API_KEY`). All untrusted text (scraped web content, question, bio) is run through `sanitizeForPrompt` (strips control chars and fake `<DATA>`/`<QUESTION>` delimiter tags) and wrapped in explicit XML-style tags with instructions to treat their contents as inert data, never as commands — this is defense-in-depth against prompt injection from malicious scraped pages or adversarial questions, not a complete guarantee. The system also enforces scope by prompt instructions (no separate classifier) — refuse off-topic questions, answer in first person.
6. Every Q&A pair is persisted to the `qna` table regardless of outcome, including error fallback answers.
7. TTS response generation is present in code (`textToSpeechMale`, Google Cloud / node-gtts) but is currently disabled in `askQuestion` — audio is always returned as `null` in favor of client-side TTS. Check this before assuming server-generated audio works end-to-end.

Groq (`groq-sdk`, same `GROQ_API_KEY`) is retained **only** for `speechToText` (Whisper transcription) — it is no longer used for answer generation.

### Content ingestion pipeline (admin side)

`updateProfile`, `uploadFile`, and `scrapeUrl` in [controllers/adminController.js](controllers/adminController.js), all gated by validation middleware and `adminAuth`, funnel into the same pattern: fetch/scrape source text → `chunkText` (naive fixed-size 1000-char slicing, not sentence-aware — still a known quality limitation, not yet fixed) → `generateBatchEmbeddings` → `replaceEmbeddingsForSource` (delete+insert atomically via the `replace_embeddings_for_source` Postgres function, so a concurrent `similaritySearch` can never observe a source mid-replace with zero rows). Sources are always one of `resume`, `github`, `portfolio`, `bio`. There is no incremental update — every re-ingestion is a full delete+replace per source.

- **Scraping** ([services/linkScraper.js](services/linkScraper.js)): GitHub uses direct HTML scraping via axios/cheerio (profile page + repos page + best-effort README fetch for the first 5 repos), not the GitHub API. Generic portfolio sites use Puppeteer (headless, blocks images/css/fonts, autoscrolls for SPA hydration) + Mozilla Readability for article extraction, falling back to a plain axios+regex scrape (`fastFallback`) if Puppeteer fails. **LinkedIn scraping is intentionally fully disabled** (returns empty string) due to anti-bot blocking — don't re-enable without checking with the user, and note `linkedin_url` is still stored/displayed even though it's never scraped.
  - Every fetch (axios `safeGet` and Puppeteer navigation, including redirects) is validated by [services/urlGuard.js](services/urlGuard.js) before the request is made: rejects non-http(s) protocols, embedded credentials, and any hostname that resolves to a non-unicast IP (loopback, private ranges, link-local — this specifically blocks cloud metadata SSRF via `169.254.169.254`). GitHub usernames/repo names extracted from the URL are validated against GitHub's allowed character set before being interpolated into follow-up request URLs.
- **Resume extraction** ([services/resumeExtractService.js](services/resumeExtractService.js)): PDFs via `pdf-parse`, images via Tesseract OCR. Other mime types are silently skipped (returns `''`). Upload mime type is restricted to `application/pdf`, `image/png`, `image/jpeg`, `image/webp` by multer's `fileFilter`; file size capped at 10MB.
- File uploads use in-memory multer storage and go straight to Supabase Storage bucket `assets`, with `resume.<ext>` / `photo.<ext>` fixed filenames (upsert overwrite, so there's only ever one resume/photo at a time). Photo URLs get a cache-busting `?t=timestamp` query param since the filename never changes.

### Auth

`adminAuth` ([middlewares/adminAuth.js](middlewares/adminAuth.js)) checks a password from either the request body or the `x-admin-password` header against the `admin` table's `password_hash` column using `bcrypt.compare`. **The hardcoded `admin123` backdoor has been removed.** Auth now fails closed: any Supabase lookup error, missing admin row, or missing hash returns a 500 rather than falling back to a bypass. A simple in-memory per-IP lockout (5 failed attempts → 15 minute lockout) throttles brute-force attempts; this is process-local and resets on restart, so it's a speed bump, not a durable defense — combined with `adminLimiter` rate limiting at the route level for the primary defense.

To (re)seed the admin password: `node scripts/hash-password.js <password>`, then `insert into public.admin (password_hash) values ('<generated-hash>');` in Supabase. The `admin` table did not previously exist in `setup-schema.sql` at all — it's now defined there (was undocumented schema drift; the code always referenced a table with no corresponding `create table`).

### Database

Four tables, no migrations framework — schema lives entirely in [setup-schema.sql](setup-schema.sql), applied manually against Supabase. `profile` is effectively a singleton row (`id = '00000000-0000-0000-0000-000000000000'`) fetched with `.maybeSingle()` (not `.single()`, which throws on zero rows); there's no multi-user/multi-profile support anywhere in this codebase. `embeddings.source` is the only thing distinguishing chunks by origin. `qna` is an append-only log of all questions asked, both successful and error-fallback answers. `admin` holds exactly one row with a bcrypt `password_hash`. RLS is enabled on all four tables with **no anon policies** — only the backend's service-role key can read/write anything.

### Known quirks worth knowing before editing

- Static file serving for `tmp/` (generated TTS audio, temp STT uploads) is mounted once in `app.js` at `/public/audio` — the previous duplicate mount in `server.js` at `/tmp` was removed. This directory is created on demand and is not checked into git; files are swept after 30 minutes by `tmpCleanup.js`.
- There's a nested `.git` directory inside `backend/` — check `git status` scope carefully before assuming commands operate on the repo root the user expects.
- `test-db.js` and `gemini_test_log.txt` were ad-hoc debug scratch files at the repo root; `gemini_test_log.txt` contained a leaked Gemini API key and was deleted from the working tree (not yet purged from git history — that's a separate, deliberately-deferred destructive operation). Any new scratch/debug scripts like this should never be committed, since API keys tend to end up in their output.
