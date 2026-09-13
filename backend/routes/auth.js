// ==============================================================================
// ADMIN AUTHENTICATION & ACCESS CONTROL (backend/routes/auth.js)
// ==============================================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query } = require('../db');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'mrp-research-survey-super-secret-key-2026';
const DEFAULT_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Helper to generate simple token
function generateToken(username) {
    const payload = `${username}:${Date.now()}:${ADMIN_SECRET}`;
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    return Buffer.from(`${username}:${Date.now()}:${hash}`).toString('base64');
}

// Authentication Middleware for /api/admin/* endpoints
function requireAdminAuth(req, res, next) {
    const authHeader = req.headers['authorization'] || req.headers['x-admin-token'] || req.query.token;
    
    if (!authHeader) {
        return res.status(401).json({
            success: false,
            error: 'Authentication required. Missing admin authorization token.'
        });
    }

    try {
        let token = authHeader;
        if (token.startsWith('Bearer ')) {
            token = token.slice(7).trim();
        }

        const decoded = Buffer.from(token, 'base64').toString('utf8');
        const parts = decoded.split(':');
        
        if (parts.length < 3) {
            return res.status(401).json({ success: false, error: 'Invalid token structure.' });
        }

        const [username, timestamp, hash] = parts;
        const timeDiff = Date.now() - parseInt(timestamp, 10);

        // Token valid for 7 days
        if (timeDiff > 7 * 86400000) {
            return res.status(401).json({ success: false, error: 'Admin session expired. Please log in again.' });
        }

        req.adminUser = { username };
        next();
    } catch (err) {
        return res.status(401).json({ success: false, error: 'Failed to verify admin credentials.' });
    }
}

// POST /api/admin/login
router.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body || {};

        if (!password) {
            return res.status(400).json({ success: false, error: 'Password is required.' });
        }

        // Check against database or env
        const inputUser = username || 'admin';
        const expectedPass = process.env.ADMIN_PASSWORD || DEFAULT_PASSWORD;

        // Check credentials against database or default fallback
        let isValid = false;
        let displayName = 'MBA Research Controller (Man Machya)';

        try {
            const userRows = await query(
                "SELECT id, username, password_hash, display_name FROM admin_users WHERE username = ?;",
                [inputUser]
            );

            if (userRows.length > 0) {
                if (userRows[0].password_hash === password || password === expectedPass) {
                    isValid = true;
                    displayName = userRows[0].display_name || displayName;
                }
            } else if (password === expectedPass) {
                isValid = true;
            }
        } catch (dbErr) {
            console.warn('[AUTH] Database query warning, falling back to direct credential check:', dbErr.message);
            if (password === expectedPass) {
                isValid = true;
            }
        }

        if (!isValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid administrator username or password.'
            });
        }

        const token = generateToken(inputUser);

        return res.json({
            success: true,
            message: 'Admin authentication successful.',
            token,
            user: {
                username: inputUser,
                displayName: displayName
            }
        });

    } catch (err) {
        console.error('[AUTH] Login error:', err);
        return res.status(500).json({ success: false, error: 'Server error during authentication.' });
    }
});

module.exports = {
    authRouter: router,
    requireAdminAuth
};
