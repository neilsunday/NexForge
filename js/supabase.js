/* ========================================
   NexaKS - Supabase Client
   Shared config for all pages
   ======================================== */

// Load Supabase from CDN (walang npm needed sa frontend)
const SUPABASE_URL = 'https://miscyjgmvxbshvtiecuu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pc2N5amdtdnhic2h2dGllY3V1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDgzMzAsImV4cCI6MjEwMDQ4NDMzMH0.yHDyDrOzRmQ2aDACRztb6roG45TUkAqLSxRslJoysgA';

// FIX: use `sb` instead of `supabase` to avoid collision with window.supabase from CDN
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
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

async function getCurrentUser() {
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user) return null;
    return user;
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

// Expose helpers globally â€” `supabase` key here refers to our client (sb)
window.NexaKS = {
    supabase: sb,
    signInWithDiscord,
    signOut,
    getCurrentUser,
    getUserProfile,
    requireAuth,
    redirectIfAuthed
};
