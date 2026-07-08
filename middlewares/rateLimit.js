const rateLimit = require('express-rate-limit');

// Public endpoints hit the embedding model + Groq API on every request,
// so they need a tighter cap to control cost and prevent resource exhaustion.
const publicLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});

// Admin endpoints are behind a password, but still rate-limited to slow
// brute-force attempts and to bound scraping/upload resource usage.
const adminLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' },
});

module.exports = { publicLimiter, adminLimiter };
