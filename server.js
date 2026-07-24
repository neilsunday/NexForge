/* ========================================
   NexaKS â€” Web Server
   Serves static UI + placeholder API endpoints
   ======================================== */

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ========== Middleware ==========
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ========== HTML Routes ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Support both /dashboard and /dashboard.html
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ========== API Endpoints ==========

// Health check (for UptimeRobot ping to prevent Render sleep)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'NexaKS',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Verify endpoint (for Lua loader â€” future implementation with Supabase)
app.get('/api/verify', async (req, res) => {
    const { license, hwid } = req.query;
    if (!license || !hwid) {
        return res.status(400).json({ error: 'Missing license or hwid' });
    }
    // TODO: Query Supabase, check HWID binding, log the attempt
    res.status(501).json({
        error: 'Verify endpoint not implemented yet',
        received: { license, hwid }
    });
});

// ========== 404 handler ==========
app.use((req, res) => {
    // For unknown routes, redirect to landing page
    if (req.accepts('html')) {
        return res.redirect('/');
    }
    res.status(404).json({ error: 'Not found' });
});

// ========== Start server ==========
app.listen(PORT, () => {
    console.log(`âš¡ NexaKS running on port ${PORT}`);
});
