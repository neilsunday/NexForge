/* ========================================
   NexaKS - Web Server + Discord Bot launcher
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
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ========== API Endpoints ==========

// Health check (UptimeRobot pings this)
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'NexaKS',
        bot: global.botStatus || 'unknown',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Verify endpoint (Lua loader) - placeholder for now
app.get('/api/verify', async (req, res) => {
    const { license, hwid } = req.query;
    if (!license || !hwid) {
        return res.status(400).json({ error: 'Missing license or hwid' });
    }
    res.status(501).json({
        error: 'Verify endpoint not implemented yet',
        received: { license, hwid }
    });
});

// 404 handler
app.use((req, res) => {
    if (req.accepts('html')) return res.redirect('/');
    res.status(404).json({ error: 'Not found' });
});

// ========== Start server ==========
app.listen(PORT, () => {
    console.log('NexaKS web server running on port ' + PORT);
});

// ========== Start Discord bot (if token available) ==========
if (process.env.DISCORD_BOT_TOKEN) {
    console.log('Starting Discord bot...');
    try {
        require('./bot.js');
    } catch (err) {
        console.error('Bot startup failed:', err.message);
        global.botStatus = 'error: ' + err.message;
    }
} else {
    console.log('DISCORD_BOT_TOKEN not set - skipping bot startup');
    global.botStatus = 'disabled (no token)';
}
