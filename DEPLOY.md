# Ravin-Assistant Backend Deployment Guide

## Deploy to Render

### Step 1: Prepare Your Repository
1. Push your backend code to GitHub
2. Make sure `.env` is in `.gitignore`

### Step 2: Create Web Service on Render
1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Click "New +" → "Web Service"
3. Connect your GitHub repository
4. Select the backend folder (if monorepo)

### Step 3: Configure Build Settings
- **Name**: `ravin-assistant-api`
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Instance Type**: `Free`

### Step 4: Add Environment Variables
Add these in Render dashboard under "Environment" (see `.env.example` for the authoritative list):

```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
GEMINI_API_KEY=your_gemini_api_key
GROQ_API_KEY=your_groq_api_key
CORS_ORIGIN=https://your-portfolio-domain.com
PORT=5000
NODE_ENV=production
```

Do NOT set `ADMIN_PASSWORD_HASH` here — the admin password is not read from env anymore. It's a bcrypt hash stored in Supabase's `admin.password_hash` column; generate it with `node scripts/hash-password.js <password>` and insert via SQL (see `setup-schema.sql`).

`CORS_ORIGIN` must list every origin allowed to call this API — comma-separated if more than one (e.g. your portfolio's production domain plus a staging URL). Requests from any other origin are rejected; there is no wildcard fallback.

### Step 5: Deploy
- Click "Create Web Service"
- Render will automatically deploy
- Copy the deployment URL (e.g., `https://ravin-assistant-api.onrender.com`)

### Step 6: Update Frontend
Update your frontend `.env` with the Render URL:
```
VITE_API_URL=https://ravin-assistant-api.onrender.com
```

## Important Notes
- Free tier may sleep after inactivity (cold starts ~30s)
- First request after sleep will be slow
- Consider upgrading for production use
- Puppeteer (used for portfolio-site scraping) needs Chromium's system dependencies present in the container. Render's Node environment usually has these, but if `scrapeUrl`/`updateProfile` fail in production with a browser-launch error, you'll need a buildpack or Dockerfile that installs Chromium's shared libraries — this only affects admin-side scraping, not the public `/api/public/ask` chatbot endpoint.
- The `/api/public/ask` endpoint (the chatbot) has no dependency on Puppeteer/Chromium at request time — it only needs Supabase, the local embedding model, and the Gemini API, so it's the lightest and most reliable endpoint to depend on for the portfolio widget.
