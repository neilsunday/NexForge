/* Keyora - Supabase Client (with role detection) */

const SUPABASE_URL = '[miscyjgmvxbshvtiecuu.supabase.co](https://miscyjgmvxbshvtiecuu.supabase.co)';
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

    // Wait up to 5s for OAuth callback to settle
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

// ==================== ROLE DETECTION ====================
// Three tiers:
//   'owner' - is_admin=true in DB (only the first user gets this via SQL trigger)
//   'admin' - regular Discord user + has valid admin-key session in localStorage
//   'user'  - regular Discord user, no admin key
//   null    - not logged in

async function getUserRole() {
    const user = await getCurrentUser();
    if (!user) return null;

    const profile = await getUserProfile(user.id);

    // Owner check - is_admin flag in DB (set by SQL trigger for first user only)
    if (profile?.is_admin === true) return 'owner';

    // Admin-client check - has a valid admin-key session in localStorage
    try {
        const raw = localStorage.getItem('keyora_session');
        if (raw) {
            const s = JSON.parse(raw);
            if (s?.admin_key && s?.expires_at && Date.now() < s.expires_at) {
                return 'admin';
            }
        }
    } catch (_) {}

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
        const res = await fetch('[ipapi.co](https://ipapi.co/json/)', { cache: 'no-store' });
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
        try {
            const raw = localStorage.getItem('keyora_session');
            if (raw) {
                const s = JSON.parse(raw);
                if (s?.login_method) loginMethod = s.login_method;
            }
        } catch (_) {}
        await trackLoginSession(user, loginMethod);
        startSessionHeartbeat();
    } catch (_) {}
})();

// ==================== EXPORT ====================

// ==================== EXPORT ====================

window.Keyora = {
    supabase: sb,
    signInWithDiscord,
    signOut,
    getCurrentUser,
    getUserProfile,
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
