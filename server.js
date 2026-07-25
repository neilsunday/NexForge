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
app.get('/projects', (req, res) => res.sendFile(path.join(__dirname, 'projects.html')));
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
        // Fetch key (with linked project)
        const { data: key, error } = await sb
            .from('keys').select('*, users!keys_user_id_fkey(username, is_banned)')
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

        // ========== PROJECT CHECKS ==========
        // If the key is bound to a project, enforce project status +
        // blacklist / whitelist before serving anything.
        let project = null;
        if (key.project_id) {
            const { data: proj } = await sb.from('projects')
                .select('*').eq('id', key.project_id).maybeSingle();
            project = proj;

            if (project && project.status !== 'active') {
                await logProject(project.id, key.user_id, licenseUpper, 'verify_fail', 'warning',
                    'Project ' + project.status, clientIp);
                return res.status(200).type('text/plain').send(
                    'error("NexaKS: This project is currently ' + project.status + '")'
                );
            }

            if (project) {
                // Blacklist check (hwid / ip / user)
                const { data: bans } = await sb.from('project_blacklist')
                    .select('type,value').eq('project_id', project.id);
                const blocked = (bans || []).some(b =>
                    (b.type === 'hwid' && b.value === hwidClean) ||
                    (b.type === 'ip'   && b.value === clientIp) ||
                    (b.type === 'user' && b.value === key.user_id)
                );
                if (blocked) {
                    await logProject(project.id, key.user_id, licenseUpper, 'verify_fail', 'failed',
                        'Blacklisted', clientIp);
                    return res.status(200).type('text/plain').send(
                        'error("NexaKS: Access denied - blacklisted")'
                    );
                }

                // Whitelist-only mode
                if (project.whitelist_only) {
                    const { data: allow } = await sb.from('project_whitelist')
                        .select('type,value').eq('project_id', project.id);
                    const permitted = (allow || []).some(w =>
                        (w.type === 'hwid' && w.value === hwidClean) ||
                        (w.type === 'user' && w.value === key.user_id)
                    );
                    if (!permitted) {
                        await logProject(project.id, key.user_id, licenseUpper, 'verify_fail', 'failed',
                            'Not whitelisted', clientIp);
                        return res.status(200).type('text/plain').send(
                            'error("NexaKS: Access denied - not whitelisted")'
                        );
                    }
                }
            }
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
        // Prefer the project's published script; fall back to the plan-level script.
        let scriptContent = null;
        if (project) {
            scriptContent = await fetchProjectScript(project.id, key.plan);
            await logProject(project.id, key.user_id, licenseUpper, 'verify', 'success',
                'Script served', clientIp);
        }
        if (!scriptContent) {
            scriptContent = await fetchScriptForKey(key);
        }
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
 * Fetch the published script for a project + plan via SQL helper.
 * Falls back to the project's 'free' script if the exact plan has none.
 */
async function fetchProjectScript(projectId, plan) {
    try {
        const { data, error } = await sb.rpc('get_project_script', {
            p_project_id: projectId,
            p_plan: plan || 'free'
        });
        if (error) { console.error('Project script RPC error:', error); return null; }
        if (!data || data.length === 0) return null;

        const script = data[0];
        // Increment execution counter (fire and forget)
        sb.from('project_scripts').update({
            execution_count: (script.execution_count || 0) + 1
        }).eq('id', script.id).then(() => {}, () => {});

        return script.script_content;
    } catch (err) {
        console.error('fetchProjectScript:', err);
        return null;
    }
}

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

async function logProject(projectId, userId, key, action, status, message, ip) {
    if (!sb || !projectId) return;
    try {
        await sb.from('project_logs').insert({
            project_id: projectId, user_id: userId, key: key,
            action: action, status: status,
            metadata: { message: message, source: 'lua_loader' },
            ip_address: ip
        });
    } catch (e) {
        console.warn('Project log insert failed:', e.message);
    }
}

// ========================================
// /api/load/:slug - PUBLIC KEYLESS / KEY LOADER
// Keyless scripts run without a key. Key-based scripts require ?key=NXKS-...
// Usage: loadstring(game:HttpGet(".../api/load/myproject?script=abcd1234"))()
// ========================================
app.get('/api/load/:slug', async (req, res) => {
    const slug = (req.params.slug || '').trim().toLowerCase();
    const loadId = req.query.script ? String(req.query.script).trim() : null;
    const key = req.query.key ? String(req.query.key).trim().toUpperCase() : null;
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

    if (!sb) {
        return res.status(500).type('text/plain').send('error("NexaKS: Server not configured")');
    }

    try {
        // Fetch the published script for this project slug
        const { data, error } = await sb.rpc('get_public_script', {
            p_slug: slug, p_load_id: loadId
        });
        if (error || !data || data.length === 0) {
            return res.status(200).type('text/plain').send('error("NexaKS: Script not found or not published")');
        }
        const script = data[0];

        // Project must be active
        if (script.project_status !== 'active') {
            return res.status(200).type('text/plain').send('error("NexaKS: This project is currently ' + script.project_status + '")');
        }

        // Keyless -> serve immediately
        if (script.keyless) {
            sb.from('project_scripts').update({
                execution_count: (script.execution_count || 0) + 1
            }).eq('id', script.id).then(() => {}, () => {});
            await logProject(script.project_id, null, key || 'keyless', 'load', 'success', 'Keyless load', clientIp);
            return res.status(200).type('text/plain').send(script.script_content);
        }

        // Key-based -> require a valid, active key bound to this project
        if (!key) {
            return res.status(200).type('text/plain').send('error("NexaKS: This script requires a license key")');
        }
        const { data: keyRow } = await sb.from('keys')
            .select('*, users!keys_user_id_fkey(is_banned)')
            .eq('key', key).maybeSingle();

        if (!keyRow || keyRow.status !== 'active') {
            await logProject(script.project_id, keyRow?.user_id || null, key, 'load_fail', 'failed', 'Invalid/inactive key', clientIp);
            return res.status(200).type('text/plain').send('error("NexaKS: Invalid or inactive license key")');
        }
        if (keyRow.users?.is_banned) {
            return res.status(200).type('text/plain').send('error("NexaKS: Account suspended")');
        }
        if (keyRow.project_id && keyRow.project_id !== script.project_id) {
            return res.status(200).type('text/plain').send('error("NexaKS: Key not valid for this project")');
        }

        // Blacklist check
        const { data: bans } = await sb.from('project_blacklist')
            .select('type,value').eq('project_id', script.project_id);
        const blocked = (bans || []).some(b =>
            (b.type === 'ip' && b.value === clientIp) ||
            (b.type === 'user' && b.value === keyRow.user_id)
        );
        if (blocked) {
            await logProject(script.project_id, keyRow.user_id, key, 'load_fail', 'failed', 'Blacklisted', clientIp);
            return res.status(200).type('text/plain').send('error("NexaKS: Access denied - blacklisted")');
        }

        sb.from('project_scripts').update({
            execution_count: (script.execution_count || 0) + 1
        }).eq('id', script.id).then(() => {}, () => {});
        await logProject(script.project_id, keyRow.user_id, key, 'load', 'success', 'Key load', clientIp);
        return res.status(200).type('text/plain').send(script.script_content);

    } catch (err) {
        console.error('Load error:', err);
        return res.status(500).type('text/plain').send('error("NexaKS: Server error")');
    }
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
