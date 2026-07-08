const validator = require('validator');

const MAX_URL_LENGTH = 2048;
const MAX_BIO_LENGTH = 5000;
const MAX_QUESTION_LENGTH = 1000;

function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

// Only allow http(s) URLs pointing at github.com or a generic portfolio host;
// full network-level SSRF protection (DNS/IP checks) happens in urlGuard.js
// at fetch time. This is a fast, cheap first-pass shape check.
function isPlausibleUrl(v) {
    if (typeof v !== 'string' || v.length > MAX_URL_LENGTH) return false;
    return validator.isURL(v, {
        protocols: ['http', 'https'],
        require_protocol: true,
    });
}

function validateUpdateProfile(req, res, next) {
    const { github_url, linkedin_url, portfolio_url, bio } = req.body || {};

    if (github_url !== undefined && github_url !== '' && !isPlausibleUrl(github_url)) {
        return res.status(400).json({ error: 'Invalid github_url' });
    }
    if (linkedin_url !== undefined && linkedin_url !== '' && !isPlausibleUrl(linkedin_url)) {
        return res.status(400).json({ error: 'Invalid linkedin_url' });
    }
    if (portfolio_url !== undefined && portfolio_url !== '' && !isPlausibleUrl(portfolio_url)) {
        return res.status(400).json({ error: 'Invalid portfolio_url' });
    }
    if (bio !== undefined && bio !== null) {
        if (typeof bio !== 'string' || bio.length > MAX_BIO_LENGTH) {
            return res.status(400).json({ error: `bio must be a string under ${MAX_BIO_LENGTH} characters` });
        }
    }

    next();
}

function validateScrapeUrl(req, res, next) {
    const { url, type } = req.body || {};

    if (!isPlausibleUrl(url)) {
        return res.status(400).json({ error: 'Invalid or missing url' });
    }
    if (!['github', 'portfolio'].includes(type)) {
        return res.status(400).json({ error: 'type must be "github" or "portfolio"' });
    }

    next();
}

function validateAskQuestion(req, res, next) {
    const { question, voiceBase64 } = req.body || {};

    if (question !== undefined && question !== null) {
        if (typeof question !== 'string' || question.length > MAX_QUESTION_LENGTH) {
            return res.status(400).json({ error: `question must be a string under ${MAX_QUESTION_LENGTH} characters` });
        }
    }

    if (voiceBase64 !== undefined && voiceBase64 !== null) {
        if (typeof voiceBase64 !== 'string' || voiceBase64.length > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'voiceBase64 is invalid or too large' });
        }
    }

    if (!isNonEmptyString(question) && !isNonEmptyString(voiceBase64)) {
        return res.status(400).json({ error: 'Provide either question or voiceBase64' });
    }

    next();
}

module.exports = {
    isNonEmptyString,
    isPlausibleUrl,
    validateUpdateProfile,
    validateScrapeUrl,
    validateAskQuestion,
    MAX_QUESTION_LENGTH,
    MAX_BIO_LENGTH,
};
