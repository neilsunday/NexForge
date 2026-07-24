/* ========================================
   NexaKS â€” Supabase Client
   Shared config for all pages
   ======================================== */

// Load Supabase from CDN (walang npm needed sa frontend)
const SUPABASE_URL = 'https://miscyjgmvxbshvtiecuu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1pc2N5amdtdnhic2h2dGllY3V1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ5MDgzMzAsImV4cCI6MjEwMDQ4NDMzMH0.yHDyDrOzRmQ2aDACRztb6roG45TUkAqLSxRslJoysgA';

// Initialize Supabase client (assumes @supabase/supabase-js loaded via CDN in HTML)
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true
    }
});

// ========== Auth helpers ==========

/**
 * Sign in with Discord OAuth
 * Redirects user to Discord for authorization, then back to /dashboard
 */
async function signInWithDiscord() {
    const { data, error } = await supabase.auth.signInWithOAuth({
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

/**
 * Sign out current user, redirect to landing page
 */
async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error('Sign-out error:', error);
        return;
    }
    window.location.href = '/';
}

/**
 * Get current logged-in user, or null if not authenticated
 */
async function getCurrentUser() {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return user;
}

/**
 * Get user profile from `users` table (custom data)
 */
async function getUserProfile(userId) {
    const { data, error } = await supabase
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

/**
 * Redirect to login (index.html) if not authenticated
 * Use sa protected pages tulad ng dashboard.html at admin.html
 */
async function requireAuth() {
    const user = await getCurrentUser();
    if (!user) {
        window.location.href = '/';
        return null;
    }
    return user;
}

/**
 * Redirect to dashboard if already logged in
 * Use sa index.html para hindi na lumabas ang landing kung logged in na
 */
async function redirectIfAuthed() {
    const user = await getCurrentUser();
    if (user) {
        window.location.href = '/dashboard';
    }
}

// Expose helpers globally
window.NexaKS = {
    supabase,
    signInWithDiscord,
    signOut,
    getCurrentUser,
    getUserProfile,
    requireAuth,
    redirectIfAuthed
};
