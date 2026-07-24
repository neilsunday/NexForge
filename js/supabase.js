/* NexaKS - Supabase Client (loop-proof) */

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

async function signInWithDiscord() {
    const { error } = await sb.auth.signInWithOAuth({
        provider: 'discord',
        options: {
            redirectTo: window.location.origin + '/dashboard',
            scopes: 'identify email'
        }
    });
    if (error) {
        console.error('OAuth error:', error);
        alert('Sign-in failed: ' + error.message);
    }
}

async function signOut() {
    await sb.auth.signOut();
    window.location.href = '/';
}

/**
 * Waits for session if URL has OAuth callback hash.
 * Also cleans up the URL hash after processing.
 * NEVER redirects â€” just returns session or null.
 */
async function getSessionSafely() {
    const hasAuthHash = window.location.hash &&
                       (window.location.hash.includes('access_token') ||
                        window.location.hash.includes('error'));

    // Try existing session first
    let { data: { session } } = await sb.auth.getSession();
    if (session) {
        // Clean up hash if present
        if (hasAuthHash && window.history?.replaceState) {
            window.history.replaceState({}, '', window.location.pathname);
        }
        return session;
    }

    // If no auth hash, no session, we're done
    if (!hasAuthHash) return null;

    // Wait for auth state change (OAuth callback processing)
    return new Promise((resolve) => {
        let resolved = false;
        const timeout = setTimeout(() => {
            if (resolved) return;
            resolved = true;
            try { subscription?.unsubscribe(); } catch (e) {}
            resolve(null);
        }, 5000);

        const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
            if (session && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                try { subscription?.unsubscribe(); } catch (e) {}
                // Clean the URL hash to prevent re-processing
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

window.NexaKS = {
    supabase: sb,
    signInWithDiscord,
    signOut,
    getCurrentUser,
    getUserProfile,
    getSessionSafely
};
