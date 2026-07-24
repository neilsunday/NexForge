/* ========================================
   NexaKS - Supabase Client (with session wait)
   ======================================== */

const SUPABASE_URL = 'https://miscyjgmvxbshvtiecuu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pc2N5amdtdnhic2h2dGllY3V1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDgzMzAsImV4cCI6MjEwMDQ4NDMzMH0.yHDyDrOzRmQ2aDACRztb6roG45TUkAqLSxRslJoysgA';

// Use `sb` to avoid collision with window.supabase from CDN
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'implicit'
    }
});

// ========== Auth helpers ==========

async function signInWithDiscord() {
    const { data, error } = await sb.auth.signInWithOAuth({
        provider: 'discord',
        options: {
            redirectTo: window.location.origin + '/dashboard',
            scopes: 'identify email'
        }
    });

    if (error) {
        console.error('Discord sign-in error:', error);
        alert('Sign-in failed: ' + error.message);
    }
    return { data, error };
}

async function signOut() {
    const { error } = await sb.auth.signOut();
    if (error) {
        console.error('Sign-out error:', error);
        return;
    }
    window.location.href = '/';
}

/**
 * Wait for session to be established (handles OAuth callback delay)
 * Returns session or null after timeout
 */
async function waitForSession(maxWaitMs = 3000) {
    // If URL has OAuth callback hash, wait for Supabase to process it
    const hasAuthHash = window.location.hash.includes('access_token') ||
                       window.location.hash.includes('error');

    // Try immediately first
    let { data: { session } } = await sb.auth.getSession();
    if (session) return session;

    // If we have auth hash but no session yet, wait for auth state change
    if (hasAuthHash) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                subscription?.unsubscribe();
                resolve(null);
            }, maxWaitMs);

            const { data: { subscription } } = sb.auth.onAuthStateChange((event, session) => {
                if (session) {
                    clearTimeout(timeout);
                    subscription?.unsubscribe();
                    resolve(session);
                }
            });
        });
    }

    return null;
}

async function getCurrentUser() {
    const session = await waitForSession();
    return session?.user || null;
}

async function getUserProfile(userId) {
    const { data, error } = await sb
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

    if (error) {
        console.error('Profile fetch error:', error);
        return null;
    }
    return data;
}

async function requireAuth() {
    const user = await getCurrentUser();
    if (!user) {
        // Only redirect if we're truly not authenticated (not just waiting)
        window.location.href = '/';
        return null;
    }
    return user;
}

async function redirectIfAuthed() {
    const user = await getCurrentUser();
    if (user) {
        window.location.href = '/dashboard';
    }
}

// Expose helpers globally
window.NexaKS = {
    supabase: sb,
    signInWithDiscord,
    signOut,
    getCurrentUser,
    getUserProfile,
    requireAuth,
    redirectIfAuthed,
    waitForSession
};
