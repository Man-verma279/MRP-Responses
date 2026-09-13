// ==============================================================================
// MAIN EXPRESS SERVER (backend/server.js)
// Research Survey Web Application & Admin Analytics Engine
// Candidate: MAN MACHYA (Roll: 252380042) | DAVV / MIST Indore
// ==============================================================================

require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');

const { initDatabase } = require('../database/init_db');
const surveyRouter = require('./routes/survey');
const { authRouter } = require('./routes/auth');
const adminRouter = require('./routes/admin');
const { getDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Request logger
app.use((req, res, next) => {
    if (!req.path.startsWith('/css') && !req.path.startsWith('/js') && !req.path.startsWith('/favicon')) {
        console.log(`[HTTP] ${req.method} ${req.path}`);
    }
    next();
});

// Static assets
app.use(express.static(path.join(__dirname, '../public')));

// Public API Routes
app.use('/api', surveyRouter);
app.use('/api', authRouter);

// Protected Admin API Routes
app.use('/api', adminRouter);

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'online',
        service: 'Research Survey Web Application',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Clean Route Handling
app.get('/survey', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Fallback for root
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('[SERVER ERROR]', err);
    res.status(500).json({
        success: false,
        error: 'An unexpected internal server error occurred.'
    });
});

// Initialize database and start listening
async function startServer() {
    try {
        await initDatabase();
        
        app.listen(PORT, () => {
            console.log('====================================================');
            console.log(`Research Survey Application running at: http://localhost:${PORT}`);
            console.log(`Public Survey Form:     http://localhost:${PORT}/`);
            console.log(`Admin Dashboard:        http://localhost:${PORT}/admin`);
            console.log('====================================================');
        });
    } catch (err) {
        console.error('[SERVER] Critical error starting server:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

module.exports = app;
