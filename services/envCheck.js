const REQUIRED_VARS = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GEMINI_API_KEY', // used for answer-generation LLM (Gemini)
    'GROQ_API_KEY',   // used for voice question transcription (Whisper)
];

// Fails fast with a clear message instead of letting the process crash
// deep inside a third-party SDK constructor with a confusing stack trace.
function assertRequiredEnv() {
    const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
    if (missing.length) {
        console.error(`Missing required environment variable(s): ${missing.join(', ')}`);
        console.error('Copy .env.example to .env and fill in the missing values.');
        process.exit(1);
    }
}

module.exports = { assertRequiredEnv };
