const bcrypt = require('bcrypt');
const supabase = require('../services/supabaseClient');

// Simple in-memory rate limiter for failed login attempts, keyed by IP.
// Prevents brute-forcing the admin password via repeated requests.
const failedAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function isLockedOut(key) {
    const entry = failedAttempts.get(key);
    if (!entry) return false;
    if (entry.count < MAX_ATTEMPTS) return false;
    if (Date.now() - entry.lastAttempt > LOCKOUT_MS) {
        failedAttempts.delete(key);
        return false;
    }
    return true;
}

function recordFailure(key) {
    const entry = failedAttempts.get(key) || { count: 0, lastAttempt: 0 };
    entry.count += 1;
    entry.lastAttempt = Date.now();
    failedAttempts.set(key, entry);
}

function recordSuccess(key) {
    failedAttempts.delete(key);
}

const adminAuth = async (req, res, next) => {
    const ip = req.ip;

    try {
        if (isLockedOut(ip)) {
            return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });
        }

        const body = req.body || {};
        const password = body.password || req.headers['x-admin-password'];

        if (!password || typeof password !== 'string') {
            return res.status(401).json({ error: 'Password required' });
        }

        const { data, error } = await supabase
            .from('admin')
            .select('password_hash')
            .single();

        // Fail closed: any DB error or missing admin row denies access.
        if (error || !data || !data.password_hash) {
            console.error('Admin auth lookup failed:', error);
            recordFailure(ip);
            return res.status(500).json({ error: 'Internal server error' });
        }

        const isValid = await bcrypt.compare(password, data.password_hash);

        if (!isValid) {
            recordFailure(ip);
            return res.status(401).json({ error: 'Invalid password' });
        }

        recordSuccess(ip);
        req.isAdmin = true;
        next();
    } catch (err) {
        console.error('Admin auth error:', err);
        res.status(500).json({ error: 'Auth error' });
    }
};

module.exports = adminAuth;
