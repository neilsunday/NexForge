/* Keyora - Supabase Client (v5 - DB-only, no localStorage sessions) */

const SUPABASE_URL = 'https://miscyjgmvxbshvtiecuu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pc2N5amdtdnhic2h2dGllY3V1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDgzMzAsImV4cCI6MjEwMDQ4NDMzMH0.yHDyDrOzRmQ2aDACRztb6roG45TUkAqLSxRslJoysgA';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'implicit'
    }
});

// ==================== AUTH ====================

async function signInWithDiscord() {
    // Nuke any stale admin-key session before OAuth (prevents role confusion after account switch)
    try {
        localStorage.removeItem('keyora_session');
        localStorage.removeItem('nexaks_session');
        localStorage.removeItem('nexaks_pending_discord');
    } catch (_) {}

    const { error } = await sb.auth.signInWithOAuth({
        provider: 'discord',
        options: {
            redirectTo: window.location.origin + '/dashboard.html',
            scopes: 'identify email'
        }
    });
    if (error) {
        console.error('OAuth error:', error);
        alert('Sign-in failed: ' + error.message);
    }
}

async function signOut() {
    try { await expireCurrentSession(); } catch (_) {}
    try {
        localStorage.removeItem('keyora_session');
        localStorage.removeItem('nexaks_session');
        localStorage.removeItem('nexaks_pending_discord');
        localStorage.removeItem('keyora_session_row_id');
        sessionStorage.removeItem('nexaks_redirected');
    } catch (_) {}
    await sb.auth.signOut();
    window.location.href = '/';
}

async function getSessionSafely() {
    const hasAuthHash = window.location.hash &&
        (window.location.hash.includes('access_token') ||
         window.location.hash.includes('error'));

    let { data: { session } } = await sb.auth.getSession();
    if (session) {
        if (hasAuthHash && window.history?.replaceState) {
            window.history.replaceState({}, '', window.location.pathname);
        }
        return session;
    }
    if (!hasAuthHash) return null;

    return new Promise((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            try { subscription?.unsubscribe(); } catch (_) {}
            resolve(null);
        }, 5000);

        const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
            if (session && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                try { subscription?.unsubscribe(); } catch (_) {}
                if (window.history?.replaceState) {
                    window.history.replaceState({}, '', window.location.pathname);
                }
                resolve(session);
            }
        });
    });
}

async function getCurrentUser() {
    const session = await getSessionSafely();
    return session?.user || null;
}

async function getUserProfile(userId) {
    try {
        const { data } = await sb
            .from('users')
            .select('*')
            .eq('id', userId)
            .maybeSingle();
        return data || null;
    } catch (e) {
        console.error('Profile fetch:', e);
        return null;
    }
}

// Retry-enabled profile fetch â€” critical for role detection on slow mobile networks
async function getUserProfileResilient(userId, maxAttempts = 5) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const profile = await getUserProfile(userId);
            if (profile) return profile;
        } catch (e) {
            console.warn('[Keyora] profile lookup attempt ' + (attempt + 1) + ' failed:', e);
        }
        if (attempt < maxAttempts - 1) {
            const delay = 300 + (attempt * 250);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    return null;
}

// Check if user has an active admin key in the DB (no localStorage involved)
async function hasActiveAdminKey(userId) {
    if (!userId) return false;
    try {
        const { data } = await sb
            .from('keys')
            .select('key, plan, status, expires_at')
            .eq('user_id', userId)
            .eq('plan', 'admin')
            .eq('status', 'active')
            .maybeSingle();
        if (!data) return false;
        // Check expiry
        if (data.expires_at && new Date(data.expires_at) < new Date()) return false;
        return true;
    } catch (e) {
        console.warn('[Keyora] admin key check failed:', e);
        return false;
    }
}

// ==================== ROLE DETECTION (DB-only) ====================
// Three tiers, all resolved via DB queries:
//   'owner' - is_admin=true in users table
//   'admin' - has active admin-plan key bound to their user_id in keys table
//   'user'  - Discord user with no admin key
//   null    - not logged in

async function getUserRole() {
    const user = await getCurrentUser();
    if (!user) {
        console.log('[Keyora] role: null (not logged in)');
        return null;
    }

    // Step 1: Check owner status via users table (retries for slow networks)
    const profile = await getUserProfileResilient(user.id);
    if (profile?.is_admin === true) {
        console.log('[Keyora] role: owner');
        return 'owner';
    }

    // Step 2: Check for active admin key bound to this user
    const isAdmin = await hasActiveAdminKey(user.id);
    if (isAdmin) {
        console.log('[Keyora] role: admin');
        return 'admin';
    }

    // Step 3: Regular Discord user
    console.log('[Keyora] role: user');
    return 'user';
}

async function isOwner() {
    return (await getUserRole()) === 'owner';
}

async function isAdminOrOwner() {
    const role = await getUserRole();
    return role === 'owner' || role === 'admin';
}

// ==================== SESSION TRACKING ====================

const SESSION_ROW_KEY = 'keyora_session_row_id';
const HEARTBEAT_INTERVAL_MS = 60_000;

async function fetchGeoInfo() {
    try {
        const res = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
        if (!res.ok) return {};
        const data = await res.json();
        return {
            country: data.country_name || null,
            city: data.city || null,
            ip: data.ip || null,
        };
    } catch (_) { return {}; }
}

async function trackLoginSession(user, loginMethod) {
    if (!user?.id) return;
    try {
        const existing = localStorage.getItem(SESSION_ROW_KEY);
        if (existing) return;

        const geo = await fetchGeoInfo();
        const profile = await getUserProfile(user.id);
        const username =
            profile?.username ||
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.user_metadata?.user_name ||
            'User';

        const { data, error } = await sb.from('user_sessions').insert({
            user_id: user.id,
            username: username,
            login_method: loginMethod || 'discord',
            ip_address: geo.ip || null,
            user_agent: navigator.userAgent || null,
            country: geo.country || null,
            city: geo.city || null,
        }).select('id').maybeSingle();

        if (error) {
            console.warn('Session log insert failed:', error.message);
            return;
        }
        if (data?.id) localStorage.setItem(SESSION_ROW_KEY, data.id);
    } catch (e) {
        console.warn('trackLoginSession:', e);
    }
}

let _heartbeatTimer = null;
function startSessionHeartbeat() {
    if (_heartbeatTimer) return;
    _heartbeatTimer = setInterval(async () => {
        const id = localStorage.getItem(SESSION_ROW_KEY);
        if (!id) return;
        try {
            await sb.from('user_sessions')
                .update({ last_active_at: new Date().toISOString() })
                .eq('id', id).eq('status', 'active');
        } catch (_) {}
    }, HEARTBEAT_INTERVAL_MS);
}

async function expireCurrentSession() {
    const id = localStorage.getItem(SESSION_ROW_KEY);
    if (!id) return;
    try {
        await sb.from('user_sessions')
            .update({ status: 'expired', last_active_at: new Date().toISOString() })
            .eq('id', id);
    } catch (_) {}
    localStorage.removeItem(SESSION_ROW_KEY);
}

// Auto-run on client load â€” track login + start heartbeat
// Also nuke any stale admin-key session (v4 legacy) since we're now DB-only
(async function autoTrackSession() {
    try {
        // Nuke legacy admin-key sessions â€” role is DB-driven now
        try {
            localStorage.removeItem('keyora_session');
            localStorage.removeItem('nexaks_session');
            localStorage.removeItem('nexaks_pending_discord');
        } catch (_) {}

        const user = await getCurrentUser();
        if (!user) return;
        await trackLoginSession(user, 'discord');
        startSessionHeartbeat();
    } catch (_) {}
})();

// ==================== EXPORT ====================

window.Keyora = {
    supabase: sb,
    signInWithDiscord,
    signOut,
    getCurrentUser,
    getUserProfile,
    getUserProfileResilient,
    hasActiveAdminKey,
    getSessionSafely,
    getUserRole,
    isOwner,
    isAdminOrOwner,
    trackLoginSession,
    expireCurrentSession,
};

// Backwards compat: expose as NexaKS AND as bare globals
window.NexaKS = window.Keyora;
window.signInWithDiscord = signInWithDiscord;
window.signOut = signOut;
window.handleLogin = signInWithDiscord;
