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
Add these in Render dashboard under "Environment":

```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
GROQ_API_KEY=your_groq_api_key
ADMIN_PASSWORD_HASH=your_admin_password
PORT=5000
NODE_ENV=production
```

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
