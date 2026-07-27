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

// Cloudflare Turnstile secret (used to verify tokens from the login modal)
const TURNSTILE_SECRET_KEY = process.env.TURNSTILE_SECRET_KEY || '0x4AAAAAAD9t05jnYUKselbqxd0Rz2QKun0';

// ========== Middleware ==========
// Security headers on every response
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ========== Rate Limiter ==========
// In-memory sliding-window limiter: 30 requests per IP per 60 seconds on load endpoints
const rateBuckets = new Map();
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

function rateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const now = Date.now();
    const bucket = rateBuckets.get(ip) || [];
    // Drop timestamps outside window
    const recent = bucket.filter(t => now - t < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
        return res.status(429).type('text/plain').send('error("NexaKS: Too many requests - slow down")');
    }
    recent.push(now);
    rateBuckets.set(ip, recent);
    // Occasional cleanup to prevent memory growth
    if (rateBuckets.size > 5000) {
        for (const [k, v] of rateBuckets) {
            if (v.every(t => now - t >= RATE_WINDOW_MS)) rateBuckets.delete(k);
        }
    }
    next();
}

// Separate stricter limiter for login (5 attempts per minute per IP)
const loginBuckets = new Map();
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 60_000;

function loginRateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
    const now = Date.now();
    const bucket = loginBuckets.get(ip) || [];
    const recent = bucket.filter(t => now - t < LOGIN_WINDOW_MS);
    if (recent.length >= LOGIN_LIMIT) {
        return res.status(429).json({ success: false, error: 'Too many login attempts. Try again in 1 minute.' });
    }
    recent.push(now);
    loginBuckets.set(ip, recent);
    next();
}

// ========== HTML Routes ==========
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/projects', (req, res) => res.sendFile(path.join(__dirname, 'projects.html')));
app.get('/help', (req, res) => res.sendFile(path.join(__dirname, 'help.html')));
app.get('/admin', (req, res) => {
    // Basic gate: require a Supabase auth cookie to even load the admin page.
    // Full authorization (is_admin check) happens client-side + is enforced by RLS.
    const cookies = req.headers.cookie || '';
    const hasAuth = /sb-[a-z0-9-]+-auth-token/i.test(cookies);
    if (!hasAuth) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'admin.html'));
});

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
// /api/verify-turnstile - Cloudflare Turnstile token verification
// Called by admin key login before revealing the key to the DB.
// Returns { success: true } if the token is valid.
// ========================================
app.post('/api/verify-turnstile', loginRateLimit, async (req, res) => {
    try {
        const token = (req.body && req.body.token) ? String(req.body.token) : '';
        if (!token) {
            return res.status(400).json({ success: false, error: 'Missing captcha token' });
        }
        if (!TURNSTILE_SECRET_KEY) {
            return res.status(500).json({ success: false, error: 'Captcha not configured on server' });
        }

        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

        const params = new URLSearchParams();
        params.append('secret', TURNSTILE_SECRET_KEY);
        params.append('response', token);
        if (clientIp && clientIp !== 'unknown') params.append('remoteip', clientIp);

        const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: params
        });
        const data = await cfRes.json();

        if (data.success) {
            return res.json({ success: true });
        }
        return res.status(400).json({
            success: false,
            error: 'Captcha verification failed',
            codes: data['error-codes'] || []
        });
    } catch (err) {
        console.error('Turnstile verify error:', err);
        return res.status(500).json({ success: false, error: 'Server error verifying captcha' });
    }
});

// ========================================
// /api/verify-admin-key - Admin key login verification
// Called by the Admin Access modal on index.html / any admin page.
// Uses the service key so it can bypass RLS on the `keys` table.
// Flow: verify Turnstile -> look up key -> validate -> return session payload.
// ========================================
app.post('/api/verify-admin-key', loginRateLimit, async (req, res) => {
    try {
        const key = (req.body && req.body.key) ? String(req.body.key).trim().toUpperCase() : '';
        const token = (req.body && req.body.token) ? String(req.body.token) : '';

        if (!key) {
            return res.status(400).json({ success: false, error: 'Missing admin key' });
        }
        if (!/^NXKS-[A-Z0-9-]{19}$/.test(key)) {
            return res.status(400).json({ success: false, error: 'Invalid key format' });
        }
        if (!token) {
            return res.status(400).json({ success: false, error: 'Missing captcha token' });
        }
        if (!sb) {
            return res.status(500).json({ success: false, error: 'Server not configured' });
        }

        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

        // 1. Verify the Turnstile token first
        if (!TURNSTILE_SECRET_KEY) {
            return res.status(500).json({ success: false, error: 'Captcha not configured on server' });
        }
        const params = new URLSearchParams();
        params.append('secret', TURNSTILE_SECRET_KEY);
        params.append('response', token);
        if (clientIp && clientIp !== 'unknown') params.append('remoteip', clientIp);

        const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST', body: params
        });
        const cfData = await cfRes.json();
        if (!cfData.success) {
            return res.status(400).json({ success: false, error: 'Captcha verification failed' });
        }

        // 2. Look up the key (service role bypasses RLS)
        const { data: keyRow, error } = await sb
            .from('keys')
            .select('key, plan, status, expires_at, user_id, users:user_id(id, username, is_banned)')
            .eq('key', key)
            .maybeSingle();

        if (error) {
            console.error('Admin key lookup error:', error);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        // 3. Validate (generic message for lookup failures to avoid key enumeration)
        if (!keyRow)                     return res.status(401).json({ success: false, error: 'Key not found or invalid.' });
        if (keyRow.plan !== 'admin')     return res.status(401).json({ success: false, error: 'Key not found or invalid.' });
        if (keyRow.status === 'revoked') return res.status(401).json({ success: false, error: 'This admin key has been revoked.' });
        if (keyRow.status === 'expired') return res.status(401).json({ success: false, error: 'This admin key has expired.' });
        // 'active' and 'unclaimed' are both allowed here.
        // Unclaimed admin keys become active + get bound to the redeemer on first login.
        if (keyRow.status !== 'active' && keyRow.status !== 'unclaimed') {
            return res.status(401).json({ success: false, error: 'This admin key is not usable.' });
        }
        if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
            await sb.from('keys').update({ status: 'expired' }).eq('key', key);
            return res.status(401).json({ success: false, error: 'This admin key has expired.' });
        }
        if (keyRow.users?.is_banned) {
            return res.status(401).json({ success: false, error: 'The account tied to this key is banned.' });
        }

        // ---- First-use activation for unclaimed admin keys ----
        // The web modal can't bind to a specific user (there's no OAuth session yet),
        // so we leave user_id as-is but flip status -> active and set expires_at.
        // The Discord bot's /redeem flow is the way to bind an admin key to a Discord user.
        if (keyRow.status === 'unclaimed') {
            const update = { status: 'active' };
            // Compute expires_at from duration_days if not already set
            if (!keyRow.expires_at) {
                // Fetch duration_days to compute expiry (we didn't select it above)
                const { data: durRow } = await sb.from('keys')
                    .select('duration_days').eq('key', key).maybeSingle();
                const d = durRow?.duration_days;
                if (d && Number.isFinite(+d)) {
                    const exp = new Date();
                    exp.setDate(exp.getDate() + parseInt(d, 10));
                    update.expires_at = exp.toISOString();
                    keyRow.expires_at = update.expires_at;
                }
            }
            await sb.from('keys').update(update).eq('key', key);
            keyRow.status = 'active';
        }

        // 4. Audit log (fire-and-forget)
        sb.from('logs').insert({
            user_id: keyRow.user_id,
            key: keyRow.key,
            action: 'admin_login',
            status: 'success',
            metadata: { message: 'Admin key login via web modal', ip: clientIp }
        }).then(() => {}, () => {});

        // 5. Return session payload (only the fields the client needs)
        return res.json({
            success: true,
            session: {
                key: keyRow.key,
                plan: keyRow.plan,
                user_id: keyRow.user_id,
                username: keyRow.users?.username || 'Admin',
                expires_at: keyRow.expires_at || null
            }
        });
    } catch (err) {
        console.error('Admin key verify error:', err);
        return res.status(500).json({ success: false, error: 'Server error verifying key' });
    }
});

// ========================================
// /api/verify-admin-key-refresh - Silent re-verify (no captcha)
// Called by gate.js on every admin page load to catch revoked/expired sessions.
// Same validation as /api/verify-admin-key minus Turnstile.
// ========================================
app.post('/api/verify-admin-key-refresh', loginRateLimit, async (req, res) => {
    try {
        const key = (req.body && req.body.key) ? String(req.body.key).trim().toUpperCase() : '';
        if (!key || !/^NXKS-[A-Z0-9-]{19}$/.test(key)) {
            return res.status(400).json({ success: false, error: 'Invalid key' });
        }
        if (!sb) return res.status(500).json({ success: false, error: 'Server not configured' });

        const { data: keyRow, error } = await sb
            .from('keys')
            .select('key, plan, status, expires_at, users:user_id(is_banned)')
            .eq('key', key)
            .maybeSingle();

        if (error || !keyRow) return res.status(401).json({ success: false });
        if (keyRow.plan !== 'admin') return res.status(401).json({ success: false });
        if (keyRow.status !== 'active') return res.status(401).json({ success: false });
        if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) return res.status(401).json({ success: false });
        if (keyRow.users?.is_banned) return res.status(401).json({ success: false });

        return res.json({ success: true });
    } catch (err) {
        console.error('Admin key refresh error:', err);
        return res.status(500).json({ success: false });
    }
});

// ========================================
// /api/bind-admin-key - Bind an unclaimed admin key to a Discord user
// Called by dashboard.js after Discord OAuth completes when there's a
// pending admin key in localStorage (Fix A flow).
// Uses service role to bypass RLS on the keys table.
// Safety: only binds if the key is admin plan, active/unclaimed, and unbound.
// ========================================
app.post('/api/bind-admin-key', loginRateLimit, async (req, res) => {
    try {
        if (!sb) return res.status(500).json({ success: false, error: 'Server not configured' });

        const key = (req.body && req.body.key) ? String(req.body.key).trim().toUpperCase() : '';
        const userId = (req.body && req.body.user_id) ? String(req.body.user_id).trim() : '';

        if (!key || !/^NXKS-[A-Z0-9-]{19}$/.test(key)) {
            return res.status(400).json({ success: false, error: 'Invalid key format' });
        }
        if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }

        // Look up the key with service role (bypasses RLS)
        const { data: keyRow, error: lookupError } = await sb
            .from('keys')
            .select('key, plan, status, user_id, expires_at, duration_days')
            .eq('key', key)
            .maybeSingle();

        if (lookupError) {
            console.error('Bind admin key lookup error:', lookupError);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (!keyRow) return res.status(404).json({ success: false, error: 'Key not found' });
        if (keyRow.plan !== 'admin') return res.status(400).json({ success: false, error: 'Not an admin key' });
        if (keyRow.status === 'revoked') return res.status(400).json({ success: false, error: 'Key revoked' });
        if (keyRow.status === 'expired') return res.status(400).json({ success: false, error: 'Key expired' });

        // Already bound to this same user â€” treat as success (idempotent)
        if (keyRow.user_id && keyRow.user_id === userId) {
            return res.json({ success: true, already_bound: true });
        }
        // Already bound to a different user â€” reject
        if (keyRow.user_id && keyRow.user_id !== userId) {
            return res.status(409).json({ success: false, error: 'Key already claimed by another user' });
        }

        // Verify the Discord user exists in auth.users (via users table)
        const { data: userRow, error: userError } = await sb
            .from('users')
            .select('id, is_banned')
            .eq('id', userId)
            .maybeSingle();

        if (userError) {
            console.error('Bind admin key user lookup error:', userError);
            return res.status(500).json({ success: false, error: 'Database error' });
        }
        if (!userRow) return res.status(404).json({ success: false, error: 'User not found â€” please complete Discord login first' });
        if (userRow.is_banned) return res.status(403).json({ success: false, error: 'User is banned' });

        // Compute expires_at if not set and duration_days is set
        const update = { user_id: userId, status: 'active' };
        if (!keyRow.expires_at && keyRow.duration_days && Number.isFinite(+keyRow.duration_days)) {
            const exp = new Date();
            exp.setDate(exp.getDate() + parseInt(keyRow.duration_days, 10));
            update.expires_at = exp.toISOString();
        }

        // Bind the key
        const { error: bindError } = await sb
            .from('keys')
            .update(update)
            .eq('key', key);

        if (bindError) {
            console.error('Bind admin key update error:', bindError);
            return res.status(500).json({ success: false, error: 'Failed to bind key' });
        }

        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

        // Audit log (fire-and-forget)
        sb.from('logs').insert({
            user_id: userId,
            key: key,
            action: 'admin_key_bind',
            status: 'success',
            metadata: { message: 'Admin key bound via Discord OAuth callback', ip: clientIp }
        }).then(() => {}, () => {});

        return res.json({ success: true });
    } catch (err) {
        console.error('Bind admin key error:', err);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// ========================================
// /api/admin/generate-keys - Admin key generation (bypasses RLS)
// Requires an active admin key in the request body.
// Server-side validation:
//   - Rate-limited via loginRateLimit
//   - Admin key must be valid, active, admin plan, not expired, not banned
//   - Rejects plan="admin" (admin keys cannot mint other admin keys)
//   - Ensures the creator's users row exists (upsert via service role)
//   - Bulk-inserts with collision-safe unique key strings
// ========================================
const KEY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateKeyString() {
    let out = 'NXKS-';
    for (let s = 0; s < 4; s++) {
        if (s > 0) out += '-';
        for (let i = 0; i < 4; i++) {
            out += KEY_CHARS.charAt(Math.floor(Math.random() * KEY_CHARS.length));
        }
    }
    return out;
}

app.post('/api/admin/generate-keys', loginRateLimit, async (req, res) => {
    try {
        if (!sb) return res.status(500).json({ success: false, error: 'Server not configured' });

        const body = req.body || {};
        const adminKey  = body.admin_key ? String(body.admin_key).trim().toUpperCase() : '';
        const plan      = body.plan ? String(body.plan).toLowerCase() : '';
        const duration  = body.duration ? String(body.duration) : '';
        const quantity  = Number.isFinite(+body.quantity) ? Math.floor(+body.quantity) : 0;
        const resets    = Number.isFinite(+body.hwid_reset_limit) ? Math.floor(+body.hwid_reset_limit) : 5;
        const projectId = body.project_id ? String(body.project_id) : null;

        // ---- Input validation ----
        if (!adminKey || !/^NXKS-[A-Z0-9-]{19}$/.test(adminKey)) {
            return res.status(400).json({ success: false, error: 'Missing or invalid admin key' });
        }
        const allowedPlans = ['free', 'pro', 'enterprise'];
        if (!allowedPlans.includes(plan)) {
            // Admin-plan generation is explicitly forbidden through this endpoint.
            return res.status(400).json({ success: false, error: 'Invalid plan. Admin keys can only mint free/pro/enterprise keys.' });
        }
        const allowedDurations = ['1', '7', '30', '90', '365', 'lifetime'];
        if (!allowedDurations.includes(duration)) {
            return res.status(400).json({ success: false, error: 'Invalid duration' });
        }
        if (quantity < 1 || quantity > 500) {
            return res.status(400).json({ success: false, error: 'Quantity must be 1-500' });
        }
        if (resets < 0 || resets > 99) {
            return res.status(400).json({ success: false, error: 'HWID reset limit must be 0-99' });
        }

        // ---- Verify the admin key ----
        const { data: adminRow, error: adminErr } = await sb
            .from('keys')
            .select('key, plan, status, expires_at, user_id, users:user_id(id, username, is_banned)')
            .eq('key', adminKey)
            .maybeSingle();
        if (adminErr || !adminRow) {
            return res.status(401).json({ success: false, error: 'Admin key not found' });
        }
        if (adminRow.plan !== 'admin')      return res.status(401).json({ success: false, error: 'Not an admin key' });
        if (adminRow.status !== 'active')   return res.status(401).json({ success: false, error: 'Admin key is not active' });
        if (adminRow.expires_at && new Date(adminRow.expires_at) < new Date()) {
            return res.status(401).json({ success: false, error: 'Admin key has expired' });
        }
        if (adminRow.users?.is_banned)      return res.status(401).json({ success: false, error: 'Account tied to key is banned' });

        const creatorId = adminRow.user_id;
        if (!creatorId) {
            return res.status(500).json({ success: false, error: 'Admin key has no bound user' });
        }

        // ---- Optional: project match validation (warn only, we don't fail) ----
        if (projectId) {
            const { data: projMatch } = await sb.from('project_scripts')
                .select('id').eq('project_id', projectId).eq('plan', plan)
                .eq('status', 'published').limit(1);
            // No hard fail; the client already confirms this warning.
            // (The published-script check exists for UX only, not authorization.)
            void projMatch;
        }

        // ---- Generate unique key strings ----
        const durationDays = duration === 'lifetime' ? null : parseInt(duration, 10);
        const keySet = new Set();
        let attempts = 0;
        while (keySet.size < quantity && attempts < quantity * 10) {
            keySet.add(generateKeyString());
            attempts++;
        }
        if (keySet.size < quantity) {
            return res.status(500).json({ success: false, error: 'Could not generate enough unique keys' });
        }
        const keys = Array.from(keySet);

        // Non-admin keys stay "unclaimed" until redeemed via Discord bot
        const rows = keys.map(k => ({
            key: k,
            plan: plan,
            duration_days: durationDays,
            hwid_reset_limit: resets,
            status: 'unclaimed',
            created_by: creatorId,
            project_id: projectId || null,
        }));

        const { error: insErr } = await sb.from('keys').insert(rows);
        if (insErr) {
            console.error('Admin generate insert error:', insErr);
            return res.status(500).json({ success: false, error: insErr.message || 'Insert failed' });
        }

        // Audit log (fire-and-forget)
        sb.from('logs').insert({
            user_id: creatorId,
            action: 'admin_generate',
            status: 'success',
            metadata: {
                message: 'Generated ' + quantity + ' ' + plan + ' keys (' + duration + ')' +
                         (projectId ? ' for project ' + projectId : ''),
                source: 'admin_panel_web'
            }
        }).then(() => {}, () => {});

        return res.json({
            success: true,
            count: keys.length,
            keys: keys,
            plan: plan,
            duration: duration
        });
    } catch (err) {
        console.error('Admin generate error:', err);
        return res.status(500).json({ success: false, error: 'Server error generating keys' });
    }
});

// ========================================
// /api/admin/list-keys - Scoped keys listing
// Owner (is_admin=true in DB) sees ALL keys.
// Admin-key session sees only keys they created (created_by = their user_id).
// ========================================
app.post('/api/admin/list-keys', loginRateLimit, async (req, res) => {
    try {
        if (!sb) return res.status(500).json({ success: false, error: 'Server not configured' });
        const body = req.body || {};
        const adminKey = body.admin_key ? String(body.admin_key).trim().toUpperCase() : '';
        const ownerId = body.owner_id ? String(body.owner_id) : '';
        const limit = Math.min(500, Math.max(1, Number.isFinite(+body.limit) ? Math.floor(+body.limit) : 50));

        // Determine scope: owner (all) or admin_key (created_by scoped)
        let scopeCreatorId = null;      // null = see all (owner)
        let requesterId = null;

        if (adminKey && /^NXKS-[A-Z0-9-]{19}$/.test(adminKey)) {
            // Admin-key path: validate key + resolve creator
            const { data: keyRow } = await sb.from('keys')
                .select('user_id, plan, status, expires_at, users:user_id(is_admin, is_banned)')
                .eq('key', adminKey).maybeSingle();
            if (!keyRow || keyRow.plan !== 'admin' || keyRow.status !== 'active') {
                return res.status(401).json({ success: false, error: 'Invalid admin key' });
            }
            if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
                return res.status(401).json({ success: false, error: 'Admin key expired' });
            }
            if (keyRow.users?.is_banned) return res.status(401).json({ success: false, error: 'Account banned' });

            requesterId = keyRow.user_id;
            // Owner (is_admin=true on user profile) sees all; regular admin_key user is scoped
            scopeCreatorId = keyRow.users?.is_admin ? null : keyRow.user_id;
        } else if (ownerId) {
            // Discord OAuth owner path: verify is_admin flag
            const { data: userRow } = await sb.from('users')
                .select('id, is_admin, is_banned').eq('id', ownerId).maybeSingle();
            if (!userRow || !userRow.is_admin || userRow.is_banned) {
                return res.status(401).json({ success: false, error: 'Not authorized' });
            }
            requesterId = userRow.id;
            scopeCreatorId = null; // owner sees all
        } else {
            return res.status(400).json({ success: false, error: 'Missing admin_key or owner_id' });
        }

        // Fetch keys with optional scoping
        let query = sb.from('keys')
            .select('*, users!keys_user_id_fkey(username, avatar_url)')
            .order('created_at', { ascending: false })
            .limit(limit);
        if (scopeCreatorId) query = query.eq('created_by', scopeCreatorId);

        const { data, error } = await query;
        if (error) {
            console.error('list-keys error:', error);
            return res.status(500).json({ success: false, error: error.message });
        }

        return res.json({
            success: true,
            keys: data || [],
            scope: scopeCreatorId ? 'own' : 'all',
            requester_id: requesterId
        });
    } catch (err) {
        console.error('list-keys handler error:', err);
        return res.status(500).json({ success: false, error: 'Server error' });
    }
});

// ========================================
// /api/verify - MAIN LUA LOADER ENDPOINT
// Called by Lua script with: ?license=NXKS-...&hwid=abc123
// Returns: script payload (plain text) if authorized, error message if not
// ========================================
app.get('/api/verify', rateLimit, async (req, res) => {
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

    // Length + format validation (prevents DoS via giant strings)
    if (license.length > 32 || hwid.length > 256) {
        return res.status(400).type('text/plain').send('error("NexaKS: Invalid parameter length")');
    }
    const licenseUpper = license.trim().toUpperCase();
    const hwidClean = hwid.trim().substring(0, 128); // Prevent abuse
    // Only allow key-safe characters (letters, numbers, dashes)
    if (!/^[A-Z0-9-]+$/.test(licenseUpper)) {
        return res.status(400).type('text/plain').send('error("NexaKS: Invalid license format")');
    }

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

        // AUTHORIZED - return the actual script payload.
        // Strict plan match: if the key is tied to a project, only serve a script
        // whose plan exactly matches key.plan. No cross-plan fallback.
        let scriptContent = null;
        if (project) {
            // Direct query, exact plan, published only - safer than the RPC's fallback logic.
            const { data: projScripts } = await sb.from('project_scripts')
                .select('script_content, id, execution_count')
                .eq('project_id', project.id)
                .eq('plan', key.plan)
                .eq('status', 'published')
                .order('updated_at', { ascending: false })
                .limit(1);
            const projScript = (projScripts && projScripts[0]) || null;

            if (!projScript) {
                await logProject(project.id, key.user_id, licenseUpper, 'verify_fail', 'warning',
                    'No published ' + key.plan + ' script for project', clientIp);
                return res.status(200).type('text/plain').send(
                    'error("NexaKS: No published ' + key.plan.toUpperCase() +
                    ' script for project ' + project.name + '. Contact the owner.")'
                );
            }

            scriptContent = projScript.script_content;
            // Increment counter (fire and forget)
            sb.from('project_scripts').update({
                execution_count: (projScript.execution_count || 0) + 1
            }).eq('id', projScript.id).then(() => {}, () => {});

            await logProject(project.id, key.user_id, licenseUpper, 'verify', 'success',
                'Script served (' + key.plan + ')', clientIp);
        } else {
            // No project bound - fall back to plan-level global script.
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
print("[NexaKS] Admin: please add a script for the '${key.plan}' plan in the admin panel")
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
// Usage: loadstring(game:HttpGet(".../api/load/myproject?script=abcd1234&key=NXKS-...&hwid=..."))()
// ========================================
app.get('/api/load/:slug', rateLimit, async (req, res) => {
    const slug = (req.params.slug || '').trim().toLowerCase();
    const loadId = req.query.script ? String(req.query.script).trim() : null;
    const key = req.query.key ? String(req.query.key).trim().toUpperCase() : null;
    const rawHwid = req.query.hwid ? String(req.query.hwid).trim().substring(0, 128) : null;
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
        // Strict plan match: the requested script's plan must equal the key's plan.
        // Admin keys bypass this (they carry site-wide access, not a specific script tier).
        if (keyRow.plan !== 'admin' && script.plan && script.plan !== keyRow.plan) {
            await logProject(script.project_id, keyRow.user_id, key, 'load_fail', 'warning',
                'Plan mismatch: key=' + keyRow.plan + ', script=' + script.plan, clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: This is a ' + keyRow.plan.toUpperCase() +
                ' key but this script is for ' + String(script.plan).toUpperCase() +
                '. Use the correct loader for your plan.")'
            );
        }

        // Check expiration (auto-mark expired if past deadline)
        if (keyRow.expires_at && new Date(keyRow.expires_at) < new Date()) {
            await sb.from('keys').update({ status: 'expired' }).eq('key', key);
            await logProject(script.project_id, keyRow.user_id, key, 'load_fail', 'failed', 'Key expired', clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: License expired on ' +
                new Date(keyRow.expires_at).toLocaleDateString() + '")'
            );
        }

        // Blacklist check (hwid / ip / user)
        const { data: bans } = await sb.from('project_blacklist')
            .select('type,value').eq('project_id', script.project_id);
        const blocked = (bans || []).some(b =>
            (b.type === 'hwid' && rawHwid && b.value === rawHwid) ||
            (b.type === 'ip' && b.value === clientIp) ||
            (b.type === 'user' && b.value === keyRow.user_id)
        );
        if (blocked) {
            await logProject(script.project_id, keyRow.user_id, key, 'load_fail', 'failed', 'Blacklisted', clientIp);
            return res.status(200).type('text/plain').send('error("NexaKS: Access denied - blacklisted")');
        }

        // ========== HWID BINDING + TRACKING (REQUIRED) ==========
        // Reject any key-based load that doesn't send a hwid - prevents
        // bypass by simply stripping the parameter from the loader.
        if (!rawHwid) {
            await logProject(script.project_id, keyRow.user_id, key, 'load_fail', 'failed',
                'Missing HWID', clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: Missing hardware ID - use the official loader from the dashboard or Discord")'
            );
        }

        if (!keyRow.hwid) {
            // First execution - bind HWID
            await sb.from('keys').update({
                hwid: rawHwid,
                execution_count: (keyRow.execution_count || 0) + 1,
                last_used: new Date().toISOString()
            }).eq('key', key);
            await logProject(script.project_id, keyRow.user_id, key, 'load_bind', 'success',
                'HWID bound: ' + rawHwid.substring(0, 12), clientIp);
        } else if (keyRow.hwid !== rawHwid) {
            // HWID mismatch - different device
            await logProject(script.project_id, keyRow.user_id, key, 'load_fail', 'warning',
                'HWID mismatch: got ' + rawHwid.substring(0, 12) +
                ', expected ' + keyRow.hwid.substring(0, 12), clientIp);
            return res.status(200).type('text/plain').send(
                'error("NexaKS: Hardware ID mismatch. Use /resethwid on Discord to migrate to this device.")'
            );
        } else {
            // Same HWID - normal execution
            await sb.from('keys').update({
                execution_count: (keyRow.execution_count || 0) + 1,
                last_used: new Date().toISOString()
            }).eq('key', key);
        }

        // Increment project script executions + log success
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
