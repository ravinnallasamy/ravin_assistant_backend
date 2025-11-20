# Ravin-Assistant - Backend API

RESTful API backend for the Ravin-Assistant AI-powered personal assistant application.

## 🚀 Features

- **AI-Powered Q&A**: Uses Groq (Llama 3.1) for intelligent responses
- **Vector Search**: Local embeddings with Xenova transformers for semantic search
- **Text-to-Speech**: Google Cloud TTS for audio responses
- **Resume Processing**: Extract text from PDF resumes
- **Web Scraping**: Scrape GitHub and portfolio websites
- **File Storage**: Supabase storage for resume and profile photos
- **Database**: Supabase PostgreSQL with pgvector for embeddings

## 🛠️ Tech Stack

- **Node.js** - Runtime environment
- **Express 5** - Web framework
- **Supabase** - Database and storage
- **Groq SDK** - AI language model
- **Xenova Transformers** - Local embeddings
- **Google Cloud TTS** - Text-to-speech
- **Playwright** - Web scraping
- **Multer** - File uploads
- **PDF Parse** - Resume text extraction

## 📦 Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Start production server
npm start
```

## 🔧 Configuration

### Environment Variables

Create a `.env` file in the backend directory:

```env
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key

# Groq API (for AI responses)
GROQ_API_KEY=your_groq_api_key

# Admin Authentication
ADMIN_PASSWORD_HASH=your_admin_password

# Server Configuration
PORT=5000
NODE_ENV=development
```

### Get API Keys

- **Supabase**: [supabase.com](https://supabase.com) - Free tier available
- **Groq**: [console.groq.com](https://console.groq.com) - Free tier with generous limits

## 📁 Project Structure

```
backend/
├── controllers/
│   ├── adminController.js    # Admin endpoints
│   └── publicController.js   # Public endpoints
├── services/
│   ├── supabaseClient.js     # Supabase connection
│   ├── embeddingService.js   # Vector embeddings
│   ├── audioService.js       # Text-to-speech
│   ├── resumeExtractService.js # PDF processing
│   └── linkScraper.js        # Web scraping
├── routes/
│   ├── adminRoutes.js        # Admin API routes
│   └── publicRoutes.js       # Public API routes
├── middlewares/
│   └── adminAuth.js          # Authentication middleware
├── app.js                    # Express app setup
├── server.js                 # Server entry point
└── package.json              # Dependencies
```

## 🌐 API Endpoints

### Public Routes

- `GET /api/public/getData` - Get profile data
- `POST /api/public/ask` - Ask a question (text or voice)

### Admin Routes (Protected)

- `POST /api/admin/login` - Admin login
- `GET /api/admin/profile` - Get admin profile
- `POST /api/admin/update-profile` - Update profile info
- `POST /api/admin/upload` - Upload resume/photo
- `GET /api/admin/qna` - Get Q&A history
- `POST /api/admin/scrape-url` - Manual URL scraping

## 🗄️ Database Schema

### Tables

**profile**
- `id` - UUID
- `github_url` - Text
- `linkedin_url` - Text
- `portfolio_url` - Text
- `bio` - Text
- `resume_url` - Text
- `photo_url` - Text
- `scraped_github` - Text
- `scraped_portfolio` - Text
- `scraped_resume` - Text

**embeddings**
- `id` - UUID
- `chunk` - Text
- `embedding` - Vector(384)
- `source` - Text (resume, github, portfolio, bio)
- `created_at` - Timestamp

**qna**
- `id` - UUID
- `question` - Text
- `answer` - Text
- `created_at` - Timestamp

## 🚀 Deployment

### Deploy to Render

1. Create a new Web Service on [Render](https://render.com)
2. Connect your GitHub repository
3. Configure:
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Environment**: Node
4. Add all environment variables from `.env`
5. Deploy!

See [DEPLOY.md](./DEPLOY.md) for detailed instructions.

## 🔒 Security

- Admin routes protected by password middleware
- CORS enabled for frontend origin
- Environment variables for sensitive data
- Supabase Row Level Security (RLS) recommended

## 🎯 Key Features

### AI Response System
- Uses Groq's Llama 3.1 model for fast, accurate responses
- Responds in first-person as your personal assistant
- Stays on-topic (professional background only)
- Graceful error handling for API failures

### Vector Search
- Local embeddings using Xenova's all-MiniLM-L6-v2
- Semantic search across all data sources
- Efficient chunking and batch processing
- PostgreSQL pgvector for similarity search

### Text-to-Speech
- Google Cloud TTS with male voice
- Fast audio generation
- Cached audio files in `/tmp` directory

### Web Scraping
- Playwright for dynamic content
- Cheerio for static HTML
- GitHub-specific scraping logic
- Automatic retry on failures

## 📝 Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# The server will start on http://localhost:5000
```

## 🐛 Troubleshooting

### Common Issues

**Embeddings dimension mismatch**
- Ensure Supabase vector column is 384 dimensions
- Run migration to update if needed

**Playwright installation**
```bash
npx playwright install
```

**Port already in use**
- Change PORT in `.env` file
- Or kill the process using port 5000

## 📄 License

MIT

## 👤 Author

Ravin

---

For frontend setup, see [../frontend/README.md](../frontend/README.md)
