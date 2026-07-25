/* ========================================
   NexaKS - Web Server + Bot + Lua Verify API
   v2.1 — with Projects Management System
   ======================================== */

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase admin client (bypasses RLS for server-side operations)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://miscyjgmvxbshvtiecuu.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let sb = null;   // service-role client (server actions, verify endpoint)
if (SUPABASE_SERVICE_KEY) {
    sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
    });
}

// ========== Middleware ==========
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(__dirname));

// ========== Simple in-memory rate limiter ==========
// Keyed by ip+license. Not distributed — good enough for single-instance;
// Phase 11 can swap to a shared store. Prevents brute force / enumeration.
const _rl = new Map();
function rateLimit(bucketKey, max, windowMs) {
    const now = Date.now();
    let e = _rl.get(bucketKey);
    if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; _rl.set(bucketKey, e); }
    e.count++;
    return e.count <= max;
}
// periodic cleanup
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of _rl) if (now > v.reset) _rl.delete(k);
}, 60000).unref?.();

// ---- Lua-safe string literal encoder (prevents loader injection) ----
function luaStr(s) {
    // JSON.stringify produces a valid double-quoted literal with all
    // control chars, quotes and backslashes escaped. Lua accepts the
    // same escapes (\", \\, \n, \r, \t, \uXXXX). No hand-managed slashes.
    return JSON.stringify(String(s == null ? '' : s));
}
function luaError(msg) { return 'error(' + luaStr('NexaKS: ' + msg) + ')'; }

// ---- Verify status codes (machine-readable, logged internally) ----
const VC = {
    PROJECT_NOT_FOUND: 'Invalid project key',
    PROJECT_DISABLED: 'Project is disabled',
    SCRIPT_NOT_FOUND: 'Script not found',
    SCRIPT_DISABLED: 'This script is currently disabled',
    KEY_REQUIRED: 'License key required',
    KEY_INCORRECT: 'Invalid license key',
    KEY_UNASSIGNED: 'License not activated',
    KEY_HWID_LOCKED: 'Hardware ID mismatch. Reset your HWID to use this device.',
    KEY_EXPIRED: 'License expired',
    KEY_REVOKED: 'License revoked',
    KEY_BANNED: 'Access denied',
    EXECUTION_LIMIT_REACHED: 'Execution limit reached',
    INVALID_REQUEST: 'Invalid request',
    RATE_LIMITED: 'Too many requests — slow down',
    INTERNAL_ERROR: 'Server error — try again later'
};

// ========== HTML Routes ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/projects', (req, res) => res.sendFile(path.join(__dirname, 'projects.html')));

// ========================================
// AUTH MIDDLEWARE
// Frontend sends Supabase user access token in Authorization: Bearer <jwt>
// We validate it and put user info on req.user
// ========================================
async function requireAuth(req, res, next) {
    if (!sb) return res.status(500).json({ error: 'Server not configured' });

    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });

    try {
        const { data, error } = await sb.auth.getUser(token);
        if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });
        req.user = data.user;   // { id, email, ... }
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Auth check failed' });
    }
}

// Require the caller to be an admin (server-side, DB-backed check).
// Never trust a client-supplied is_admin flag.
async function requireAdmin(req, res, next) {
    if (!sb) return res.status(500).json({ error: 'Server not configured' });
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing auth token' });
    try {
        const { data, error } = await sb.auth.getUser(token);
        if (error || !data?.user) return res.status(401).json({ error: 'Invalid token' });
        req.user = data.user;
        const { data: prof } = await sb.from('users')
            .select('is_admin').eq('id', data.user.id).maybeSingle();
        if (!prof?.is_admin) return res.status(403).json({ error: 'Admin only' });
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Auth check failed' });
    }
}

// Ensure the project belongs to req.user — reusable guard
async function ownedProject(req, res) {
    const { id } = req.params;
    if (!id) { res.status(400).json({ error: 'Missing project id' }); return null; }

    const { data, error } = await sb.from('projects')
        .select('*').eq('id', id).maybeSingle();

    if (error || !data) { res.status(404).json({ error: 'Project not found' }); return null; }
    if (data.owner_id !== req.user.id) { res.status(403).json({ error: 'Forbidden' }); return null; }
    return data;
}

// ========== API: Health ==========
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'NexaKS',
        version: '2.1.0',
        bot: global.botStatus || 'unknown',
        db: sb ? 'connected' : 'disabled',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ================================================================
// ============  PROJECTS MANAGEMENT SYSTEM  ======================
// ================================================================

/* ---------- LIST projects (pagination + search) ---------- */
app.get('/api/projects', requireAuth, async (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(50, Math.max(1, parseInt(req.query.per_page) || 12));
    const search = (req.query.search || '').trim();
    const includeArchived = req.query.archived === 'true';

    let q = sb.from('projects')
        .select('*', { count: 'exact' })
        .eq('owner_id', req.user.id);

    if (!includeArchived) q = q.eq('archived', false);
    if (search) q = q.or(`name.ilike.%${search}%,description.ilike.%${search}%`);

    q = q.order('created_at', { ascending: false })
         .range((page - 1) * perPage, page * perPage - 1);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });

    res.json({
        projects: data || [],
        pagination: {
            page, per_page: perPage,
            total: count || 0,
            total_pages: Math.ceil((count || 0) / perPage)
        }
    });
});

/* ---------- CREATE project ---------- */
app.post('/api/projects', requireAuth, async (req, res) => {
    const { name, description, version, script_content, settings } = req.body || {};
    if (!name || typeof name !== 'string' || name.trim().length < 1)
        return res.status(400).json({ error: 'Project name is required' });

    const insert = {
        owner_id: req.user.id,
        name: name.trim().slice(0, 80),
        description: (description || '').slice(0, 500),
        version: (version || '1.0.0').slice(0, 20),
        script_content: script_content || '',
        settings: settings && typeof settings === 'object' ? settings : {}
        // api_key auto-generated by DB default
    };

    const { data, error } = await sb.from('projects')
        .insert(insert).select().single();

    if (error) return res.status(500).json({ error: error.message });
    res.status(201).json({ project: data });
});

/* ---------- GET single project ---------- */
app.get('/api/projects/:id', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    res.json({ project });
});

/* ---------- UPDATE project ---------- */
app.patch('/api/projects/:id', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;

    const allowed = ['name', 'description', 'version', 'script_content',
                     'status', 'archived', 'settings'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

    if (patch.name !== undefined) patch.name = String(patch.name).trim().slice(0, 80);
    if (patch.status && !['active', 'disabled'].includes(patch.status))
        return res.status(400).json({ error: 'Invalid status' });

    const { data, error } = await sb.from('projects')
        .update(patch).eq('id', project.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ project: data });
});

/* ---------- ARCHIVE / UNARCHIVE ---------- */
app.post('/api/projects/:id/archive', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const archived = req.body?.archived !== false;    // default true

    const { data, error } = await sb.from('projects')
        .update({ archived }).eq('id', project.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ project: data });
});

/* ---------- DELETE project (cascades to all children) ---------- */
app.delete('/api/projects/:id', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { error } = await sb.from('projects').delete().eq('id', project.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

/* ---------- REGENERATE api_key ---------- */
app.post('/api/projects/:id/regenerate-key', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const newKey = crypto.randomBytes(18).toString('base64');
    const { data, error } = await sb.from('projects')
        .update({ api_key: newKey }).eq('id', project.id)
        .select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ project: data });
});

// ============  PROJECT SCRIPTS (Luarmor-style script hub)  ==============

/* ---------- LIST scripts of a project ---------- */
app.get('/api/projects/:id/scripts', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { data, error } = await sb.from('project_scripts')
        .select('*').eq('project_id', project.id)
        .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ scripts: data || [] });
});

/* ---------- GET one script ---------- */
app.get('/api/projects/:id/scripts/:scriptId', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { data, error } = await sb.from('project_scripts')
        .select('*').eq('id', req.params.scriptId)
        .eq('project_id', project.id).maybeSingle();
    if (error || !data) return res.status(404).json({ error: 'Script not found' });
    res.json({ script: data });
});

/* ---------- ADD script ---------- */
app.post('/api/projects/:id/scripts', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { name, script_content, version, status, obfuscated } = req.body || {};
    if (!name || String(name).trim().length < 1)
        return res.status(400).json({ error: 'Script name is required' });
    if (status && !['active', 'free', 'disabled'].includes(status))
        return res.status(400).json({ error: 'Invalid status' });

    const insert = {
        project_id: project.id,
        name: String(name).trim().slice(0, 100),
        script_content: script_content || '',
        version: (version || '0.0.0.0').slice(0, 20),
        status: status || 'free',
        obfuscated: !!obfuscated
    };
    const { data, error } = await sb.from('project_scripts')
        .insert(insert).select().single();
    if (error) return res.status(500).json({ error: error.message });

    await writeProjectLog(project.id, null, 'script_created', 'info',
        `Script "${insert.name}" created`, null, null);
    res.status(201).json({ script: data });
});

/* ---------- UPDATE script ---------- */
app.patch('/api/projects/:id/scripts/:scriptId', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;

    const allowed = ['name', 'script_content', 'version', 'status', 'enabled', 'obfuscated'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    if (patch.name !== undefined) patch.name = String(patch.name).trim().slice(0, 100);
    if (patch.status && !['active', 'free', 'disabled'].includes(patch.status))
        return res.status(400).json({ error: 'Invalid status' });

    const { data, error } = await sb.from('project_scripts')
        .update(patch).eq('id', req.params.scriptId)
        .eq('project_id', project.id).select().single();
    if (error || !data) return res.status(404).json({ error: 'Script not found' });
    res.json({ script: data });
});

/* ---------- TOGGLE script on/off ---------- */
app.post('/api/projects/:id/scripts/:scriptId/toggle', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { data: cur } = await sb.from('project_scripts')
        .select('enabled').eq('id', req.params.scriptId)
        .eq('project_id', project.id).maybeSingle();
    if (!cur) return res.status(404).json({ error: 'Script not found' });

    const enabled = req.body?.enabled !== undefined ? !!req.body.enabled : !cur.enabled;
    const { data, error } = await sb.from('project_scripts')
        .update({ enabled }).eq('id', req.params.scriptId)
        .eq('project_id', project.id).select().single();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ script: data });
});

/* ---------- DELETE script ---------- */
app.delete('/api/projects/:id/scripts/:scriptId', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { data, error } = await sb.from('project_scripts')
        .delete().eq('id', req.params.scriptId)
        .eq('project_id', project.id).select().maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Script not found' });

    await writeProjectLog(project.id, null, 'script_deleted', 'warning',
        `Script "${data.name}" deleted`, null, null);
    res.json({ ok: true });
});

// ============  PROJECT KEYS  ==============

/* ---------- LIST keys of a project ---------- */
app.get('/api/projects/:id/keys', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(100, parseInt(req.query.per_page) || 25);
    const search = (req.query.search || '').trim();

    let q = sb.from('keys')
        .select('*', { count: 'exact' })
        .eq('project_id', project.id);
    if (search) q = q.ilike('key', `%${search}%`);
    q = q.order('created_at', { ascending: false })
         .range((page - 1) * perPage, page * perPage - 1);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ keys: data || [], total: count || 0, page, per_page: perPage });
});

/* ---------- GENERATE key ---------- */
app.post('/api/projects/:id/keys', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { note, expires_days, plan } = req.body || {};

    // Generate NXKS-XXXX-XXXX-XXXX style key
    const rand = () => crypto.randomBytes(2).toString('hex').toUpperCase();
    const keyValue = `NXKS-${rand()}-${rand()}-${rand()}-${rand()}`;

    let expiresAt = null;
    if (expires_days && !isNaN(expires_days)) {
        expiresAt = new Date(Date.now() + Number(expires_days) * 86400e3).toISOString();
    }

    const insert = {
        project_id: project.id,
        key: keyValue,
        status: 'active',
        plan: plan || 'free',
        expires_at: expiresAt,
        metadata: { note: note || '' }
    };

    const { data, error } = await sb.from('keys').insert(insert).select().single();
    if (error) return res.status(500).json({ error: error.message });

    await writeProjectLog(project.id, null, 'key_created', 'info',
        `Key ${keyValue} created`, null, null);

    res.status(201).json({ key: data });
});

/* ---------- REVOKE key ---------- */
app.delete('/api/projects/:id/keys/:keyId', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { keyId } = req.params;

    const { data, error } = await sb.from('keys')
        .update({ status: 'revoked' })
        .eq('id', keyId).eq('project_id', project.id)
        .select().single();
    if (error || !data) return res.status(404).json({ error: 'Key not found' });

    await writeProjectLog(project.id, keyId, 'key_revoked', 'warning',
        `Key ${data.key} revoked`, null, null);
    res.json({ key: data });
});

/* ---------- RESET HWID of a key ---------- */
app.post('/api/projects/:id/keys/:keyId/reset-hwid', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { keyId } = req.params;

    const { data, error } = await sb.from('keys')
        .update({ hwid: null })
        .eq('id', keyId).eq('project_id', project.id)
        .select().single();
    if (error || !data) return res.status(404).json({ error: 'Key not found' });

    await writeProjectLog(project.id, keyId, 'hwid_reset', 'info',
        `HWID reset for ${data.key}`, null, null);
    res.json({ key: data });
});

// ============  WHITELIST  ==============

app.get('/api/projects/:id/whitelist', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { data, error } = await sb.from('project_whitelist')
        .select('*').eq('project_id', project.id)
        .order('created_at', { ascending: false }).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ whitelist: data || [] });
});

app.post('/api/projects/:id/whitelist', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { identifier, type, note } = req.body || {};
    if (!identifier || !type)
        return res.status(400).json({ error: 'identifier and type required' });
    if (!['discord_id', 'hwid', 'key', 'user_id'].includes(type))
        return res.status(400).json({ error: 'Invalid type' });

    const { data, error } = await sb.from('project_whitelist')
        .insert({
            project_id: project.id,
            identifier: String(identifier).trim(),
            type, note: note || '',
            added_by: req.user.id
        }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ entry: data });
});

app.delete('/api/projects/:id/whitelist/:wlId', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { error } = await sb.from('project_whitelist')
        .delete().eq('id', req.params.wlId).eq('project_id', project.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============  BLACKLIST  ==============

app.get('/api/projects/:id/blacklist', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { data, error } = await sb.from('project_blacklist')
        .select('*').eq('project_id', project.id)
        .order('created_at', { ascending: false }).limit(500);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ blacklist: data || [] });
});

app.post('/api/projects/:id/blacklist', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { identifier, type, reason, ban_days } = req.body || {};
    if (!identifier || !type)
        return res.status(400).json({ error: 'identifier and type required' });
    if (!['discord_id', 'hwid', 'key', 'ip', 'user_id'].includes(type))
        return res.status(400).json({ error: 'Invalid type' });

    let banExpire = null;
    if (ban_days && !isNaN(ban_days)) {
        banExpire = new Date(Date.now() + Number(ban_days) * 86400e3).toISOString();
    }

    const { data, error } = await sb.from('project_blacklist')
        .insert({
            project_id: project.id,
            identifier: String(identifier).trim(),
            type, reason: reason || '',
            ban_expire: banExpire,
            added_by: req.user.id
        }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.status(201).json({ entry: data });
});

app.delete('/api/projects/:id/blacklist/:blId', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { error } = await sb.from('project_blacklist')
        .delete().eq('id', req.params.blId).eq('project_id', project.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
});

// ============  LOGS  ==============

app.get('/api/projects/:id/logs', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(200, parseInt(req.query.per_page) || 50);
    const eventType = (req.query.event || '').trim();

    let q = sb.from('project_logs')
        .select('*', { count: 'exact' })
        .eq('project_id', project.id);
    if (eventType) q = q.eq('event_type', eventType);
    q = q.order('created_at', { ascending: false })
         .range((page - 1) * perPage, page * perPage - 1);

    const { data, error, count } = await q;
    if (error) return res.status(500).json({ error: error.message });
    res.json({ logs: data || [], total: count || 0, page, per_page: perPage });
});

// ============  ANALYTICS  ==============

app.get('/api/projects/:id/analytics', requireAuth, async (req, res) => {
    const project = await ownedProject(req, res); if (!project) return;
    const { data, error } = await sb.rpc('get_project_analytics',
        { p_project_id: project.id });
    if (error) return res.status(500).json({ error: error.message });
    res.json({ analytics: data || {} });
});

// ================================================================
// ============  LEGACY ENDPOINTS (Phase 1)  ======================
// These replace direct anon-key writes previously done in
// dashboard.js / admin.js. After the RLS lockdown, clients can no
// longer write to keys/users/scripts/logs directly — they call here.
// ================================================================

/* ---------- ME: current user's profile (self) ---------- */
app.get('/api/me', requireAuth, async (req, res) => {
    const { data, error } = await sb.from('users')
        .select('*').eq('id', req.user.id).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ profile: data });
});

/* ---------- MY KEY: current user's active key ---------- */
app.get('/api/me/key', requireAuth, async (req, res) => {
    const { data, error } = await sb.from('keys').select('*')
        .eq('user_id', req.user.id).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) return res.status(500).json({ error: error.message });
    res.json({ key: data });
});

/* ---------- MY ACTIVITY: current user's logs ---------- */
app.get('/api/me/activity', requireAuth, async (req, res) => {
    const { data, error } = await sb.from('logs').select('*')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false }).limit(20);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ logs: data || [] });
});

/* ---------- REDEEM a key (self-service) ---------- */
app.post('/api/me/redeem', requireAuth, async (req, res) => {
    const key = String(req.body?.key || '').trim().toUpperCase();
    if (!key.startsWith('NXKS-')) return res.status(400).json({ error: 'Invalid key format' });

    const { data: existing } = await sb.from('keys').select('*').eq('key', key).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Key not found' });
    if (existing.status === 'revoked') return res.status(403).json({ error: 'Key revoked' });
    if (existing.user_id && existing.user_id !== req.user.id)
        return res.status(403).json({ error: 'Key already claimed' });

    const updates = { user_id: req.user.id, status: 'active', redeemed_via: 'dashboard' };
    if (existing.duration_days && !existing.expires_at) {
        const exp = new Date(); exp.setDate(exp.getDate() + existing.duration_days);
        updates.expires_at = exp.toISOString();
    }
    const { data, error } = await sb.from('keys').update(updates).eq('key', key).select().single();
    if (error) return res.status(500).json({ error: error.message });

    await logAttempt(req.user.id, key, 'redeem', 'success', 'Redeemed via dashboard', null);
    res.json({ key: data });
});

/* ---------- RESET OWN HWID (self-service, cooldown enforced) ---------- */
app.post('/api/me/reset-hwid', requireAuth, async (req, res) => {
    const { data: k } = await sb.from('keys').select('*')
        .eq('user_id', req.user.id).eq('status', 'active')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (!k) return res.status(404).json({ error: 'No active key' });

    const limit = k.hwid_reset_limit ?? 5;
    if ((k.hwid_reset_count || 0) >= limit)
        return res.status(429).json({ error: 'Reset limit reached' });

    const { data, error } = await sb.from('keys').update({
        hwid: null,
        hwid_reset_count: (k.hwid_reset_count || 0) + 1,
        last_hwid_reset: new Date().toISOString()
    }).eq('key', k.key).select().single();
    if (error) return res.status(500).json({ error: error.message });

    await logAttempt(req.user.id, k.key, 'reset_hwid', 'success', 'HWID reset via dashboard', null);
    res.json({ key: data });
});

// ============  ADMIN ENDPOINTS (Phase 1)  ==============

/* ---------- ADMIN: stats ---------- */
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
    const [tk, ak, rk, tu] = await Promise.all([
        sb.from('keys').select('*', { count: 'exact', head: true }),
        sb.from('keys').select('*', { count: 'exact', head: true }).eq('status', 'active'),
        sb.from('keys').select('*', { count: 'exact', head: true }).eq('status', 'revoked'),
        sb.from('users').select('*', { count: 'exact', head: true })
    ]);
    res.json({ total_keys: tk.count||0, active_keys: ak.count||0,
               revoked_keys: rk.count||0, total_users: tu.count||0 });
});

/* ---------- ADMIN: list keys ---------- */
app.get('/api/admin/keys', requireAdmin, async (req, res) => {
    const { data, error } = await sb.from('keys')
        .select('*, users!keys_user_id_fkey(username, avatar_url)')
        .order('created_at', { ascending: false }).limit(100);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ keys: data || [] });
});

/* ---------- ADMIN: generate keys ---------- */
app.post('/api/admin/keys/generate', requireAdmin, async (req, res) => {
    const { plan, duration, quantity } = req.body || {};
    const qty = Math.min(50, Math.max(1, parseInt(quantity) || 1));
    const rand = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let out = ''; const bytes = crypto.randomBytes(16);
        for (let i = 0; i < 16; i++) out += chars[bytes[i] % chars.length];
        return out.match(/.{1,4}/g).join('-');
    };
    const durationDays = duration === 'lifetime' ? null : (parseInt(duration) || null);
    const rows = Array.from({ length: qty }, () => ({
        key: 'NXKS-' + rand(),
        plan: plan || 'free',
        status: 'active',
        duration_days: durationDays,
        created_by: req.user.id
    }));
    const { data, error } = await sb.from('keys').insert(rows).select();
    if (error) return res.status(500).json({ error: error.message });
    await logAttempt(req.user.id, null, 'admin_generate', 'success',
        `Generated ${qty} ${plan} keys`, null);
    res.status(201).json({ keys: data });
});

/* ---------- ADMIN: revoke key ---------- */
app.post('/api/admin/keys/revoke', requireAdmin, async (req, res) => {
    const key = String(req.body?.key || '').trim();
    if (!key) return res.status(400).json({ error: 'key required' });
    const { error } = await sb.from('keys').update({ status: 'revoked' }).eq('key', key);
    if (error) return res.status(500).json({ error: error.message });
    await logAttempt(req.user.id, key, 'admin_revoke', 'success', 'Key revoked', null);
    res.json({ ok: true });
});

/* ---------- ADMIN: list users ---------- */
app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const { data, error } = await sb.from('users')
        .select('*').order('created_at', { ascending: false }).limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ users: data || [] });
});

/* ---------- ADMIN: ban / unban user ---------- */
app.post('/api/admin/users/ban', requireAdmin, async (req, res) => {
    const { user_id, banned } = req.body || {};
    if (!user_id) return res.status(400).json({ error: 'user_id required' });
    const { error } = await sb.from('users').update({ is_banned: !!banned }).eq('id', user_id);
    if (error) return res.status(500).json({ error: error.message });
    await logAttempt(req.user.id, null, banned ? 'admin_ban' : 'admin_unban', 'success',
        `${banned ? 'Banned' : 'Unbanned'} user ${user_id}`, null);
    res.json({ ok: true });
});

/* ---------- ADMIN: recent logs ---------- */
app.get('/api/admin/logs', requireAdmin, async (req, res) => {
    const { data, error } = await sb.from('logs')
        .select('*, users!logs_user_id_fkey(username)')
        .order('created_at', { ascending: false }).limit(50);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ logs: data || [] });
});

// ================================================================
// ============  /api/verify — LUA LOADER ENDPOINT ================
// Enhanced to route by project (backward compatible)
// ================================================================
app.get('/api/verify', async (req, res) => {
    const { license, hwid, project } = req.query;
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const scriptId = (req.query.script || '').trim();

    // ---- helper: uniform failure response + logging ----
    const fail = async (code, projectId, keyId) => {
        if (projectId) await writeProjectLog(projectId, keyId || null,
            'verify_fail', 'warning', code, clientIp, (hwid || '').toString().slice(0, 128));
        return res.status(200).type('text/plain').send(luaError(VC[code] || 'Access denied'));
    };

    if (!sb) return res.status(200).type('text/plain').send(luaError(VC.INTERNAL_ERROR));

    // ---- 5. validate request inputs ----
    if (typeof hwid !== 'string' || !hwid.trim())
        return res.status(200).type('text/plain').send(luaError(VC.INVALID_REQUEST));
    const hwidClean = hwid.trim().substring(0, 128);
    const licenseUpper = typeof license === 'string' ? license.trim().toUpperCase().substring(0, 64) : '';
    // reject obviously malformed identifiers (defends the blacklist filter)
    const safeId = (v) => /^[A-Za-z0-9._:\-]{1,128}$/.test(v);

    // ---- 6. rate limit (per ip+license) ----
    if (!rateLimit('v:' + clientIp + ':' + licenseUpper, 30, 60000))
        return res.status(200).type('text/plain').send(luaError(VC.RATE_LIMITED));

    try {
        // ---- 1. resolve project (by api_key, or later from the key) ----
        let projectRow = null;
        if (project) {
            if (!safeId(project)) return fail('PROJECT_NOT_FOUND');
            const { data } = await sb.from('projects').select('*').eq('api_key', project).maybeSingle();
            if (!data) return fail('PROJECT_NOT_FOUND');
            // ---- 3. project status / archive ----
            if (data.status !== 'active' || data.archived) return fail('PROJECT_DISABLED', data.id);
            projectRow = data;
        }

        // ---- 8. determine access mode (ffa vs key_required) ----
        const settings = (projectRow && projectRow.settings) || {};
        const ffa = settings?.access?.mode === 'ffa' || settings?.ffa === true;

        // ---- 2 + 4. resolve script early when project is known ----
        let scriptRow = null;
        if (projectRow) {
            if (scriptId) {
                if (!safeId(scriptId)) return fail('SCRIPT_NOT_FOUND', projectRow.id);
                const { data } = await sb.from('project_scripts').select('*')
                    .eq('id', scriptId).eq('project_id', projectRow.id).maybeSingle();
                if (!data) return fail('SCRIPT_NOT_FOUND', projectRow.id);
                if (!data.enabled || data.status === 'disabled') return fail('SCRIPT_DISABLED', projectRow.id);
                scriptRow = data;
            } else {
                const { data } = await sb.from('project_scripts').select('*')
                    .eq('project_id', projectRow.id).eq('enabled', true).neq('status', 'disabled')
                    .order('created_at', { ascending: true }).limit(1).maybeSingle();
                scriptRow = data;
            }
        }

        // ---- FFA short-circuit: no key needed, still respect blacklist by hwid/ip ----
        if (ffa && projectRow) {
            const now = new Date().toISOString();
            const { data: bl } = await sb.from('project_blacklist')
                .select('type, identifier, reason, ban_expire')
                .eq('project_id', projectRow.id).eq('type', 'hwid').eq('identifier', hwidClean).limit(1);
            if ((bl || []).some(b => !b.ban_expire || b.ban_expire > now)) return fail('KEY_BANNED', projectRow.id);
            const payload = buildPayload(projectRow, scriptRow, null);
            await writeProjectLog(projectRow.id, scriptRow?.id || null, 'verify_success', 'success', 'FFA execution', clientIp, hwidClean);
            return res.status(200).type('text/plain').send(payload);
        }

        // ---- key required from here ----
        if (!licenseUpper) return fail('KEY_REQUIRED', projectRow?.id);

        // ---- 9. find key inside this project only (or global for legacy) ----
        let keyQuery = sb.from('keys')
            .select('*, users!keys_user_id_fkey(username, is_banned)')
            .eq('key', licenseUpper);
        if (projectRow) keyQuery = keyQuery.eq('project_id', projectRow.id);
        const { data: key } = await keyQuery.maybeSingle();
        if (!key) return fail('KEY_INCORRECT', projectRow?.id);

        // auto-load project from key (legacy path)
        if (!projectRow && key.project_id) {
            const { data } = await sb.from('projects').select('*').eq('id', key.project_id).maybeSingle();
            if (data) {
                if (data.status !== 'active' || data.archived) return fail('PROJECT_DISABLED', data.id, key.id);
                projectRow = data;
            }
        }

        // ---- 7. blacklist (key / hwid / ip) — parameterized, no interpolation ----
        if (projectRow) {
            const now = new Date().toISOString();
            const wanted = [['key', licenseUpper], ['hwid', hwidClean], ['ip', clientIp]];
            const { data: bl } = await sb.from('project_blacklist')
                .select('type, identifier, reason, ban_expire')
                .eq('project_id', projectRow.id).limit(500);
            const hit = (bl || []).find(b =>
                wanted.some(([t, v]) => b.type === t && b.identifier === v) &&
                (!b.ban_expire || b.ban_expire > now));
            if (hit) return fail('KEY_BANNED', projectRow.id, key.id);
        }

        // ---- banned user ----
        if (key.users?.is_banned) return fail('KEY_BANNED', projectRow?.id, key.id);

        // ---- 10. key state ----
        if (key.status === 'revoked') return fail('KEY_REVOKED', projectRow?.id, key.id);
        if (key.status === 'banned') return fail('KEY_BANNED', projectRow?.id, key.id);
        if (key.status === 'unclaimed' || key.status === 'unassigned') return fail('KEY_UNASSIGNED', projectRow?.id, key.id);

        // ---- 11. expiration ----
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            await sb.from('keys').update({ status: 'expired' }).eq('key', licenseUpper);
            return fail('KEY_EXPIRED', projectRow?.id, key.id);
        }
        if (key.status === 'expired') return fail('KEY_EXPIRED', projectRow?.id, key.id);

        // ---- 12. execution cap ----
        const maxExec = settings?.access?.max_executions ?? settings?.max_executions ?? 0;
        if (maxExec > 0 && (key.execution_count || 0) >= maxExec)
            return fail('EXECUTION_LIMIT_REACHED', projectRow?.id, key.id);

        // ---- strict whitelist enforcement ----
        const strict = settings?.access?.mode === 'strict' || settings?.whitelist_mode === 'strict';
        if (strict && projectRow) {
            const wl = [['key', licenseUpper], ['hwid', hwidClean],
                        key.user_id ? ['user_id', key.user_id] : null].filter(Boolean);
            const { data: wlRows } = await sb.from('project_whitelist')
                .select('type, identifier').eq('project_id', projectRow.id).limit(500);
            const allowed = (wlRows || []).some(r => wl.some(([t, v]) => r.type === t && r.identifier === v));
            if (!allowed) return fail('KEY_BANNED', projectRow.id, key.id);
        }

        // ---- 13. HWID bind or compare ----
        if (!key.hwid) {
            await sb.from('keys').update({
                hwid: hwidClean, execution_count: (key.execution_count || 0) + 1, last_used: new Date().toISOString()
            }).eq('key', licenseUpper);
            if (projectRow) await writeProjectLog(projectRow.id, key.id, 'hwid_bind', 'success', 'HWID bound', clientIp, hwidClean);
        } else if (key.hwid !== hwidClean) {
            return fail('KEY_HWID_LOCKED', projectRow?.id, key.id);
        } else {
            await sb.from('keys').update({
                execution_count: (key.execution_count || 0) + 1, last_used: new Date().toISOString()
            }).eq('key', licenseUpper);
        }

        // ---- 14. record execution ----
        await logAttempt(key.user_id, licenseUpper, 'verify_success', 'success', 'Script executed', clientIp);
        if (projectRow) await writeProjectLog(projectRow.id, scriptRow?.id || null, 'verify_success', 'success', 'Script executed', clientIp, hwidClean);

        // ---- 15. return published payload ----
        if (scriptRow) {
            sb.from('project_scripts').update({ execution_count: (scriptRow.execution_count || 0) + 1 })
                .eq('id', scriptRow.id).then(() => {}, () => {});
            sb.from('keys').update({ last_script_id: scriptRow.id }).eq('key', licenseUpper).then(() => {}, () => {});
        }
        return res.status(200).type('text/plain').send(buildPayload(projectRow, scriptRow, key));

    } catch (err) {
        console.error('Verify error:', err);
        await logAttempt(null, licenseUpper, 'verify_error', 'failed', 'Server error', clientIp);
        return res.status(200).type('text/plain').send(luaError(VC.INTERNAL_ERROR));
    }
});

// Build the Lua payload for a resolved script (project script > legacy > plan > fallback)
function buildPayload(projectRow, scriptRow, key) {
    if (scriptRow && scriptRow.script_content) return scriptRow.script_content;
    if (projectRow && projectRow.script_content) return projectRow.script_content;
    if (key) { /* legacy plan-based handled by caller via fetchScriptForKey */ }
    return fallbackPayload(key || { key: '', plan: 'free' });
}

// ---- Helpers (existing) ----
async function fetchScriptForKey(key) {
    try {
        const { data, error } = await sb.rpc('get_script_for_plan',
            { user_plan: key.plan });
        if (error || !data || data.length === 0) return null;
        const script = data[0];
        sb.from('scripts').update({
            execution_count: (script.execution_count || 0) + 1
        }).eq('id', script.id).then(() => {}, () => {});
        return script.script_content;
    } catch (err) {
        console.error('fetchScriptForKey:', err);
        return null;
    }
    if (!sb) {
        return res.status(500).type('text/plain').send(
            'error("NexaKS: Server not configured - contact admin")'
        );
    }

    const licenseUpper = license.trim().toUpperCase();
    const hwidClean = hwid.trim().substring(0, 128);

    try {
        // If project api_key is provided, resolve the project first
        let projectRow = null;
        if (project) {
            const { data } = await sb.from('projects').select('*')
                .eq('api_key', project).maybeSingle();
            if (!data) {
                return res.status(200).type('text/plain').send(
                    'error("NexaKS: Invalid project key")'
                );
            }
            if (data.status !== 'active' || data.archived) {
                return res.status(200).type('text/plain').send(
                    'error("NexaKS: Project is disabled")'
                );
            }
            projectRow = data;
        }

        // Fetch key (scoped to project if given)
        let keyQuery = sb.from('keys')
            .select('*, users!keys_user_id_fkey(username, is_banned)')
            .eq('key', licenseUpper);
        if (projectRow) keyQuery = keyQuery.eq('project_id', projectRow.id);
        const { data: key, error } = await keyQuery.maybeSingle();

        if (error || !key) {
            await logAttempt(null, licenseUpper, 'verify_fail', 'failed',
                'Key not found', clientIp);
            if (projectRow) await writeProjectLog(projectRow.id, null,
                'verify_fail', 'failed', 'Key not found', clientIp, hwidClean);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: Invalid license key")'
            );
        }

        // Auto-load project from key if not passed
        if (!projectRow && key.project_id) {
            const { data } = await sb.from('projects').select('*')
                .eq('id', key.project_id).maybeSingle();
            projectRow = data;
        }

        // ---- Blacklist check (per project) ----
        if (projectRow) {
            const now = new Date().toISOString();
            const { data: bl } = await sb.from('project_blacklist')
                .select('identifier, type, reason, ban_expire')
                .eq('project_id', projectRow.id)
                .or(`and(type.eq.key,identifier.eq.${licenseUpper}),and(type.eq.hwid,identifier.eq.${hwidClean}),and(type.eq.ip,identifier.eq.${clientIp})`)
                .limit(1);
            const active = (bl || []).find(b => !b.ban_expire || b.ban_expire > now);
            if (active) {
                await writeProjectLog(projectRow.id, key.id, 'blocked_blacklist',
                    'warning', `Blocked (${active.type}): ${active.reason || 'no reason'}`,
                    clientIp, hwidClean);
                return res.status(200).type('text/plain').send(
                    `error("NexaKS: Access denied — ${active.reason || 'blacklisted'}")`
                );
            }
        }

        // ---- Banned user ----
        if (key.users?.is_banned) {
            await logAttempt(key.user_id, licenseUpper, 'verify_fail', 'failed',
                'User banned', clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: Account suspended")'
            );
        }

        // ---- Key status ----
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

        // ---- Expiry ----
        if (key.expires_at && new Date(key.expires_at) < new Date()) {
            await sb.from('keys').update({ status: 'expired' }).eq('key', licenseUpper);
            await logAttempt(key.user_id, licenseUpper, 'verify_fail', 'failed',
                'Key expired', clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: License expired on ' +
                new Date(key.expires_at).toLocaleDateString() + '")'
            );
        }

        // ---- HWID handling ----
        if (!key.hwid) {
            await sb.from('keys').update({
                hwid: hwidClean,
                execution_count: (key.execution_count || 0) + 1,
                last_used: new Date().toISOString()
            }).eq('key', licenseUpper);
            await logAttempt(key.user_id, licenseUpper, 'verify_bind', 'success',
                'HWID bound: ' + hwidClean.substring(0, 12), clientIp);
            if (projectRow) await writeProjectLog(projectRow.id, key.id,
                'hwid_bind', 'success', 'HWID bound', clientIp, hwidClean);
        } else if (key.hwid !== hwidClean) {
            await logAttempt(key.user_id, licenseUpper, 'verify_fail', 'warning',
                'HWID mismatch: got ' + hwidClean.substring(0, 12) +
                ', expected ' + key.hwid.substring(0, 12), clientIp);
            if (projectRow) await writeProjectLog(projectRow.id, key.id,
                'verify_fail', 'warning', 'HWID mismatch', clientIp, hwidClean);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: Hardware ID mismatch. Use /resethwid on Discord to migrate to this device.")'
            );
        } else {
            await sb.from('keys').update({
                execution_count: (key.execution_count || 0) + 1,
                last_used: new Date().toISOString()
            }).eq('key', licenseUpper);
            await logAttempt(key.user_id, licenseUpper, 'verify', 'success',
                'Script executed', clientIp);
            if (projectRow) await writeProjectLog(projectRow.id, key.id,
                'verify_success', 'success', 'Script executed', clientIp, hwidClean);
        }

        // ---- Serve script ----
        // Priority: specific script (?script=<id>, must be enabled)
        //   > project's first enabled script > legacy project.script_content
        //   > plan-based script > fallback
        let scriptContent = null;
        const scriptId = (req.query.script || '').trim();

        if (projectRow) {
            let scriptRow = null;

            if (scriptId) {
                const { data } = await sb.from('project_scripts').select('*')
                    .eq('id', scriptId).eq('project_id', projectRow.id).maybeSingle();
                if (!data) {
                    return res.status(200).type('text/plain').send(
                        'error("NexaKS: Script not found")'
                    );
                }
                if (!data.enabled || data.status === 'disabled') {
                    return res.status(200).type('text/plain').send(
                        'error("NexaKS: This script is currently disabled")'
                    );
                }
                scriptRow = data;
            } else {
                // No script specified — serve the first enabled script in the project
                const { data } = await sb.from('project_scripts').select('*')
                    .eq('project_id', projectRow.id).eq('enabled', true)
                    .neq('status', 'disabled')
                    .order('created_at', { ascending: true }).limit(1).maybeSingle();
                scriptRow = data;
            }

            if (scriptRow) {
                scriptContent = scriptRow.script_content;
                // bump per-script + key counters (fire and forget)
                sb.from('project_scripts').update({
                    execution_count: (scriptRow.execution_count || 0) + 1
                }).eq('id', scriptRow.id).then(() => {}, () => {});
                sb.from('keys').update({ last_script_id: scriptRow.id })
                    .eq('key', licenseUpper).then(() => {}, () => {});
            } else if (projectRow.script_content) {
                // legacy single-script fallback
                scriptContent = projectRow.script_content;
            }
        } else {
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

// ---- Helpers (existing) ----
async function fetchScriptForKey(key) {
    try {
        const { data, error } = await sb.rpc('get_script_for_plan',
            { user_plan: key.plan });
        if (error || !data || data.length === 0) return null;
        const script = data[0];
        sb.from('scripts').update({
            execution_count: (script.execution_count || 0) + 1
        }).eq('id', script.id).then(() => {}, () => {});
        return script.script_content;
    } catch (err) {
        console.error('fetchScriptForKey:', err);
        return null;
    }
}

function fallbackPayload(key) {
    return `-- NexaKS: No script configured yet
-- License: ${key.key} (${(key.plan || 'free').toUpperCase()})
print("[NexaKS] Verified but no script configured yet")
print("[NexaKS] Owner: please add a script sa /projects or /admin")
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

async function writeProjectLog(projectId, keyId, eventType, status, message, ip, hwid) {
    if (!sb || !projectId) return;
    try {
        await sb.from('project_logs').insert({
            project_id: projectId,
            key_id: keyId,
            event_type: eventType,
            status: status || 'info',
            message: message || '',
            ip, hwid,
            metadata: {}
        });
    } catch (e) {
        console.warn('Project log insert failed:', e.message);
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
