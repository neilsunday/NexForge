/* Keyora - Supabase Client (with role detection, v4 - Option C support) */

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
        localStorage.removeItem('nexaks_session'); // legacy cleanup
        localStorage.removeItem('nexaks_pending_discord');
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

// ==================== ADMIN KEY SESSION HELPER ====================
// Checks localStorage for a valid admin-key session (either new keyora_session or legacy nexaks_session format).
// Returns the session object if valid, null otherwise. Works WITHOUT a Discord OAuth session.
function getValidAdminKeySession() {
    try {
        // Try new format first
        const raw = localStorage.getItem('keyora_session');
        if (raw) {
            const s = JSON.parse(raw);
            const key = s?.admin_key || s?.key;
            if (key && s?.is_admin === true && s?.expires_at && Date.now() < s.expires_at) {
                return s;
            }
        }
    } catch (_) {}

    try {
        // Fallback: legacy format
        const raw = localStorage.getItem('nexaks_session');
        if (raw) {
            const s = JSON.parse(raw);
            if (s?.key && s?.is_admin === true && 
                s?.login_method && String(s.login_method).includes('admin_key') &&
                s?.expires_at && Date.now() < s.expires_at) {
                return s;
            }
        }
    } catch (_) {}

    return null;
}

// ==================== ROLE DETECTION ====================
// Three tiers:
//   'owner' - is_admin=true in DB (only the first user gets this via SQL trigger)
//   'admin' - valid admin-key session in localStorage (works with or without Discord)
//   'user'  - regular Discord user, no admin key
//   null    - not logged in at all (no Discord AND no admin key)
//
// PRIORITY:
//   1. Owner check FIRST â€” DB is authoritative for owner status
//   2. Admin-key session â€” works even WITHOUT Discord OAuth (Option C support)
//   3. Regular user â€” has Discord OAuth but no admin key

async function getUserRole() {
    // Step 1: Try to detect Discord user (may be null if only admin-key session)
    const user = await getCurrentUser();

    // Step 2: If we have a Discord user, check if they're an OWNER via DB
    if (user) {
        const profile = await getUserProfileResilient(user.id);
        if (profile?.is_admin === true) {
            console.log('[Keyora] role: owner (DB is_admin=true, Discord+' + (user.email || user.id) + ')');
            return 'owner';
        }
    }

    // Step 3: Check for admin-key session (works with OR without Discord)
    // This is critical for Option C flow: user enters admin key, then does Discord OAuth,
    // and on the OAuth callback we detect the admin_key session and elevate to 'admin' role.
    const adminSession = getValidAdminKeySession();
    if (adminSession) {
        console.log('[Keyora] role: admin (admin_key session' + (user ? ' + Discord' : ' only') + ')');
        return 'admin';
    }

    // Step 4: If we have Discord but no admin key and not owner, they're a regular user
    if (user) {
        console.log('[Keyora] role: user (Discord only)');
        return 'user';
    }

    // Step 5: Nothing â€” not logged in
    console.log('[Keyora] role: null (not logged in)');
    return null;
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

// Auto-run on client load
(async function autoTrackSession() {
    try {
        const user = await getCurrentUser();
        if (!user) return;
        let loginMethod = 'discord';
        // Detect if this is a Discord+admin_key session
        const adminSession = getValidAdminKeySession();
        if (adminSession) {
            loginMethod = 'discord+admin_key';
        }
        await trackLoginSession(user, loginMethod);
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
    getValidAdminKeySession,
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
