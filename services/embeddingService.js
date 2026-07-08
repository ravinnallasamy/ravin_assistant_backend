const { pipeline } = require('@xenova/transformers');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const supabase = require('./supabaseClient');

const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_EMBEDDING_DIMS = 768;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiEmbedder = genAI.getGenerativeModel({ model: GEMINI_EMBEDDING_MODEL });

let minilmEmbedder = null;
let minilmLoadPromise = null;

// Lazily loads the MiniLM embedder exactly once, even under concurrent
// callers: the in-flight promise is cached so parallel requests await the
// same load instead of each triggering a separate model download/init.
// Only ever invoked as a fallback when the Gemini embedding API call fails
// (rate limit, network error, bad key) — Gemini is the primary embedder.
async function initMinilmEmbedder() {
    if (minilmEmbedder) return minilmEmbedder;
    if (!minilmLoadPromise) {
        console.log("Loading MiniLM fallback embedder...");
        minilmLoadPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
            .then((pipe) => {
                minilmEmbedder = pipe;
                console.log("MiniLM fallback embedder ready.");
                return minilmEmbedder;
            })
            .catch((err) => {
                minilmLoadPromise = null; // allow retry on next call
                throw err;
            });
    }
    return minilmLoadPromise;
}

// Chunk text
function chunkText(text, size = 1000) {
    if (!text) return [];
    const chunks = [];
    for (let i = 0; i < text.length; i += size) {
        chunks.push(text.slice(i, i + size));
    }
    return chunks;
}

async function embedWithGemini(text, taskType) {
    const result = await geminiEmbedder.embedContent({
        content: { parts: [{ text: String(text).substring(0, 2000) }] },
        taskType,
        outputDimensionality: GEMINI_EMBEDDING_DIMS,
    });
    return result.embedding.values;
}

async function embedWithMinilm(text) {
    const pipe = await initMinilmEmbedder();
    const output = await pipe(String(text).substring(0, 2000), {
        pooling: "mean",
        normalize: true
    });
    return Array.from(output.data);
}

// Embeds a document chunk for storage. Tries Gemini first; on any failure
// (API error, rate limit, missing key) falls back to the local MiniLM model
// so ingestion never hard-fails just because an external API is unavailable.
// Returns { vector, model } so callers/DB layer know which column to write to.
async function generateEmbedding(text) {
    try {
        const vector = await embedWithGemini(text, "RETRIEVAL_DOCUMENT");
        return { vector, model: "gemini" };
    } catch (error) {
        console.error("Gemini embedding failed, falling back to MiniLM:", error.message);
        const vector = await embedWithMinilm(text);
        return { vector, model: "minilm" };
    }
}

// Embeds a user question for querying. Same Gemini-first/MiniLM-fallback
// behavior as generateEmbedding, but tagged as a query embedding (Gemini
// distinguishes query vs. document embeddings via taskType for better
// retrieval quality).
async function generateQueryEmbedding(text) {
    try {
        const vector = await embedWithGemini(text, "RETRIEVAL_QUERY");
        return { vector, model: "gemini" };
    } catch (error) {
        console.error("Gemini query embedding failed, falling back to MiniLM:", error.message);
        const vector = await embedWithMinilm(text);
        return { vector, model: "minilm" };
    }
}

// Batch embed. Each chunk independently tries Gemini then falls back to
// MiniLM, so a transient Gemini failure partway through a batch doesn't
// force the whole batch onto the fallback model.
async function generateBatchEmbeddings(chunks) {
    const results = [];
    for (const chunk of chunks) {
        try {
            const { vector, model } = await generateEmbedding(chunk);
            results.push({ chunk, embedding: vector, model });
        } catch (error) {
            console.error("Embedding error:", error.message);
        }
    }
    return results;
}

// Atomically replace all embeddings for a source (delete+insert in one
// transaction via the replace_embeddings_for_source RPC), so a concurrent
// similarity search never observes the source with zero rows mid-ingestion.
//
// A source's embeddings are expected to be uniformly one model or the
// other — in practice a batch either fully succeeds against Gemini or, if
// Gemini is down, every chunk falls back to MiniLM together (see
// generateBatchEmbeddings). If a batch ends up mixed (e.g. Gemini flaked on
// one chunk mid-run), the Gemini-embedded rows win and any MiniLM rows in
// that same call are dropped, to avoid splitting one source across both
// vector spaces where similarity search could only ever see half of it.
async function replaceEmbeddingsForSource(source, embeddings) {
    if (!embeddings.length) {
        const { error } = await supabase.from("embeddings").delete().eq("source", source);
        if (error) throw error;
        return;
    }

    const geminiRows = embeddings.filter((e) => e.model === "gemini");
    const minilmRows = geminiRows.length ? [] : embeddings.filter((e) => e.model === "minilm");
    const rows = geminiRows.length ? geminiRows : minilmRows;

    const { error } = await supabase.rpc("replace_embeddings_for_source", {
        p_source: source,
        p_chunks: rows.map((e) => e.chunk),
        // Sent as vector-literal strings ("[0.1,0.2,...]"), not raw number
        // arrays — PostgREST casts each array element to the SQL param's
        // element type individually, and a bare JSON number can't cast to
        // vector directly (see replace_embeddings_for_source in setup-schema.sql).
        p_embeddings_gemini: geminiRows.length ? rows.map((e) => `[${e.embedding.join(",")}]`) : [],
        p_embeddings_minilm: geminiRows.length ? [] : rows.map((e) => `[${e.embedding.join(",")}]`),
    });

    if (error) throw error;
}

// Vector search. Searches whichever embedding space(s) the query was
// embedded into — match_embeddings only compares a query against rows from
// the same model, since Gemini and MiniLM vectors are not comparable.
async function similaritySearch(query, k = 5) {
    let vector, model;

    if (Array.isArray(query)) {
        vector = query;
        model = vector.length === GEMINI_EMBEDDING_DIMS ? "gemini" : "minilm";
    } else {
        ({ vector, model } = await generateQueryEmbedding(query));
    }

    const { data, error } = await supabase.rpc("match_embeddings", {
        query_embedding_gemini: model === "gemini" ? vector : null,
        query_embedding_minilm: model === "minilm" ? vector : null,
        match_threshold: 0.2,
        match_count: k
    });

    if (error) {
        console.error("Similarity search error:", error);
        throw error;
    }

    return data || [];
}

module.exports = {
    chunkText,
    generateEmbedding,
    generateQueryEmbedding,
    generateBatchEmbeddings,
    replaceEmbeddingsForSource,
    similaritySearch
};
