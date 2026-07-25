/* ========================================
   NexaKS - Web Server + Bot + Lua Verify API
   ======================================== */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase admin client (bypasses RLS for the verify endpoint)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://miscyjgmvxbshvtiecuu.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
let sb = null;
if (SUPABASE_SERVICE_KEY) {
    sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
}

// ========== Middleware ==========
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ========== HTML Routes ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ========== API Endpoints ==========

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'NexaKS',
        bot: global.botStatus || 'unknown',
        db: sb ? 'connected' : 'disabled',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ========================================
// /api/verify - MAIN LUA LOADER ENDPOINT
// Called by Lua script with: ?license=NXKS-...&hwid=abc123
// Returns: script payload (plain text) if authorized, error message if not
// ========================================
app.get('/api/verify', async (req, res) => {
    const { license, hwid } = req.query;
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

    // Basic validation
    if (!license || !hwid) {
        return res.status(400).type('text/plain').send(
            'error("NexaKS: Missing license or hwid parameter")'
        );
    }

    if (!sb) {
        return res.status(500).type('text/plain').send(
            'error("NexaKS: Server not configured - contact admin")'
        );
    }

    const licenseUpper = license.trim().toUpperCase();
    const hwidClean = hwid.trim().substring(0, 128); // Prevent abuse

    try {
        // Fetch key
        const { data: key, error } = await sb
            .from('keys').select('*, users(username, is_banned)')
            .eq('key', licenseUpper).maybeSingle();

        if (error || !key) {
            await logAttempt(null, licenseUpper, 'verify_fail', 'failed',
                'Key not found', clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: Invalid license key")'
            );
        }

        // Check user banned
        if (key.users?.is_banned) {
            await logAttempt(key.user_id, licenseUpper, 'verify_fail', 'failed',
                'User banned', clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: Account suspended")'
            );
        }

        // Check status
        if (key.status !== 'active') {
            await logAttempt(key.user_id, licenseUpper, 'verify_fail', 'failed',
                'Key status: ' + key.status, clientIp);
            const msg = key.status === 'revoked' ? 'License revoked'
                : key.status === 'expired' ? 'License expired'
                : key.status === 'unclaimed' ? 'License not activated - use /redeem first'
                : 'License inactive';
            return res.status(200).type('text/plain').send(
                'error("NexaKS: ' + msg + '")'
            );
        }

        // Check expiration
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            // Auto-mark as expired
            await sb.from('keys').update({ status: 'expired' }).eq('key', licenseUpper);
            await logAttempt(key.user_id, licenseUpper, 'verify_fail', 'failed',
                'Key expired', clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: License expired on ' +
                new Date(key.expires_at).toLocaleDateString() + '")'
            );
        }

        // HWID handling
        if (!key.hwid) {
            // First execution - bind HWID
            await sb.from('keys').update({
                hwid: hwidClean,
                execution_count: (key.execution_count || 0) + 1,
                last_used: new Date().toISOString()
            }).eq('key', licenseUpper);

            await logAttempt(key.user_id, licenseUpper, 'verify_bind', 'success',
                'HWID bound: ' + hwidClean.substring(0, 12), clientIp);
        } else if (key.hwid !== hwidClean) {
            // HWID mismatch - different device
            await logAttempt(key.user_id, licenseUpper, 'verify_fail', 'warning',
                'HWID mismatch: got ' + hwidClean.substring(0, 12) +
                ', expected ' + key.hwid.substring(0, 12), clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: Hardware ID mismatch. Use /resethwid on Discord to migrate to this device.")'
            );
        } else {
            // Same HWID - normal execution
            await sb.from('keys').update({
                execution_count: (key.execution_count || 0) + 1,
                last_used: new Date().toISOString()
            }).eq('key', licenseUpper);

            await logAttempt(key.user_id, licenseUpper, 'verify', 'success',
                'Script executed', clientIp);
        }

        // AUTHORIZED - return the actual script payload
        // In production, mag-return ka ng loadstring URL sa protected script mo
        // Halimbawa: return script from private GitHub gist, or generated code

        // Fetch script from DB based on plan
        const scriptContent = await fetchScriptForKey(key);
        const finalPayload = scriptContent || fallbackPayload(key);
        return res.status(200).type('text/plain').send(finalPayload);

    } catch (err) {
        console.error('Verify error:', err);
        await logAttempt(null, licenseUpper, 'verify_error', 'failed',
            'Server error: ' + err.message, clientIp);
        return res.status(500).type('text/plain').send(
            'error("NexaKS: Server error - try again later")'
        );
    }
});

/**
 * Fetch the actual Lua script from the scripts table
 * based on the user's plan.
 * Plan hierarchy: enterprise > pro > free
 */
async function fetchScriptForKey(key) {
    try {
        // Use the SQL helper function we created
        const { data, error } = await sb.rpc('get_script_for_plan', {
            user_plan: key.plan
        });

        if (error) {
            console.error('Script fetch RPC error:', error);
            return null;
        }

        if (!data || data.length === 0) {
            return null;
        }

        const script = data[0];

        // Increment script execution counter (fire and forget)
        sb.from('scripts').update({
            execution_count: (script.execution_count || 0) + 1
        }).eq('id', script.id).then(() => {}, () => {});

        return script.script_content;
    } catch (err) {
        console.error('fetchScriptForKey:', err);
        return null;
    }
}

/**
 * Fallback payload when no script is configured yet
 */
function fallbackPayload(key) {
    return `-- NexaKS: No script configured yet
-- License: ${key.key} (${key.plan.toUpperCase()})
print("[NexaKS] Verified but no script configured yet")
print("[NexaKS] Admin: please add a script for '${key.plan}' plan sa /admin")
`;
}

async function logAttempt(userId, key, action, status, message, ip) {
    if (!sb) return;
    try {
        await sb.from('logs').insert({
            user_id: userId, key: key,
            action: action, status: status,
            metadata: { message: message, source: 'lua_loader' },
            ip_address: ip
        });
    } catch (e) {
        console.warn('Log insert failed:', e.message);
    }
}

// 404 handler
app.use((req, res) => {
    if (req.accepts('html')) return res.redirect('/');
    res.status(404).json({ error: 'Not found' });
});

// ========== Start server ==========
app.listen(PORT, () => {
    console.log('NexaKS web server running on port ' + PORT);
});

// ========== Start Discord bot ==========
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
