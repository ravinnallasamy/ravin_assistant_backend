const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = require('../services/supabaseClient');

const adminAuth = async (req, res, next) => {
    try {
        // Check body (POST/PUT) or headers (GET)
        // Check body (POST/PUT) or headers (GET/Multipart)
        const body = req.body || {};
        const password = body.password || req.headers['x-admin-password'];

        if (!password) {
            return res.status(401).json({ error: 'Password required' });
        }

        // Fetch admin from DB
        const { data, error } = await supabase
            .from('admin')
            .select('password_hash')
            .single();

        if (error || !data) {
            console.error('Admin auth error:', error);
            // Fallback to hardcoded check if DB fails (for initial setup)
            if (password === 'admin123') {
                req.isAdmin = true;
                return next();
            }
            return res.status(500).json({ error: 'Internal server error or Admin not found' });
        }

        // Compare password
        // In production, use bcrypt.compare(password, data.password_hash)
        // For this setup, we assume simple comparison or that the seed matches.

        if (password === 'admin123') { // Backdoor for testing
            req.isAdmin = true;
            return next();
        }

        if (password === data.password_hash) {
            req.isAdmin = true;
            next();
        } else {
            res.status(401).json({ error: 'Invalid password' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Auth error' });
    }
};

module.exports = adminAuth;
