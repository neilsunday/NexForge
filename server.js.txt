/* ========================================
   NexForge — Web Server
   Serves static UI + ready for API endpoints later
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
app.use(express.static(__dirname)); // Serves index.html, css, js from root

// ========== Routes (HTML pages) ==========
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// ========== API Endpoints (placeholders — sasagawaan natin later) ==========

// Health check (para sa UptimeRobot ping)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'NexForge',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Verify endpoint (for Lua loader — future)
app.post('/api/verify', (req, res) => {
    const { key, hwid } = req.body;
    // TODO: Check Supabase for key + hwid match
    res.json({
        success: false,
        message: 'Verify endpoint not implemented yet'
    });
});

// Redeem key (for Discord bot — future)
app.post('/api/redeem', (req, res) => {
    const { key, discord_id } = req.body;
    // TODO: Bind key to discord user in Supabase
    res.json({
        success: false,
        message: 'Redeem endpoint not implemented yet'
    });
});

// Reset HWID (for Discord bot — future)
app.post('/api/reset-hwid', (req, res) => {
    const { discord_id } = req.body;
    // TODO: Clear HWID with cooldown check
    res.json({
        success: false,
        message: 'Reset HWID endpoint not implemented yet'
    });
});

// ========== 404 handler ==========
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ========== Start server ==========
app.listen(PORT, () => {
    console.log(`⚡ NexForge running on port ${PORT}`);
    console.log(`🌐 http://localhost:${PORT}`);
});
