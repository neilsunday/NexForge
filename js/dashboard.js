/* ========================================
   NexaKS - Dashboard JS (safe version)
   ======================================== */

let currentUser = null;
let currentProfile = null;
let currentKey = null;

// ========== Init on page load ==========
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Require authentication - redirects to / if not logged in
        currentUser = await NexaKS.requireAuth();
        if (!currentUser) return;

        // Load user profile - if missing, create it manually (trigger may have failed)
        currentProfile = await NexaKS.getUserProfile(currentUser.id);
        if (!currentProfile) {
            console.warn('Profile missing, creating manually...');
            const meta = currentUser.user_metadata || {};
            const { data, error } = await NexaKS.supabase.from('users').insert({
                id: currentUser.id,
                discord_id: meta.provider_id || meta.sub || null,
                username: meta.full_name || meta.name || meta.user_name || 'User',
                avatar_url: meta.avatar_url || null
            }).select().single();
            if (!error) {
                currentProfile = data;
            } else {
                console.error('Manual profile create failed:', error);
                currentProfile = {
                    username: meta.full_name || meta.name || 'User',
                    avatar_url: meta.avatar_url
                };
            }
        }

        // Load key + activity (don't block on errors)
        try { await loadUserKey(); } catch(e) { console.error('Key load:', e); }
        try { await loadActivity(); } catch(e) { console.error('Activity load:', e); }

        renderUserInfo();
    } catch (err) {
        console.error('Dashboard init error:', err);
        alert('Dashboard error: ' + (err.message || err));
    } finally {
        // ALWAYS hide loader
        const loader = document.getElementById('authLoader');
        const main = document.getElementById('dashboardMain');
        if (loader) loader.style.display = 'none';
        if (main) main.style.display = 'grid';

        // Fade-in cards
        document.querySelectorAll('.card, .stat-card').forEach((el, i) => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px)';
            el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            setTimeout(() => {
                el.style.opacity = '1';
                el.style.transform = 'translateY(0)';
            }, i * 60);
        });
    }
});

// ========== Render user info in header ==========
function renderUserInfo() {
    const meta = currentUser.user_metadata || {};
    const username = currentProfile?.username || meta.full_name || meta.name || meta.user_name || 'User';
    const avatarUrl = currentProfile?.avatar_url || meta.avatar_url;

    const el = (id) => document.getElementById(id);
    if (el('userName')) el('userName').textContent = username;
    if (el('userNameSmall')) el('userNameSmall').textContent = username;

    if (avatarUrl && el('userAvatarImg')) {
        el('userAvatarImg').src = avatarUrl;
        el('userAvatarImg').style.display = 'block';
        if (el('userAvatar')) el('userAvatar').style.display = 'none';
    } else if (el('userAvatar')) {
        el('userAvatar').textContent = username.charAt(0).toUpperCase();
    }

    if (currentProfile?.is_admin && el('adminLink')) {
        el('adminLink').style.display = 'flex';
        el('adminLink').href = 'admin.html';
    }

    const plan = currentKey?.plan || 'free';
    if (el('userRole')) el('userRole').textContent = plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan';
}

// ========== Load user's active key ==========
async function loadUserKey() {
    const { data, error } = await NexaKS.supabase
        .from('keys')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('Load key error:', error);
        return;
    }

    if (!data) {
        const noKey = document.getElementById('noKeyState');
        const active = document.getElementById('activeKeyState');
        if (noKey) noKey.style.display = 'block';
        if (active) active.style.display = 'none';
        return;
    }

    currentKey = data;
    const noKey = document.getElementById('noKeyState');
    const active = document.getElementById('activeKeyState');
    if (noKey) noKey.style.display = 'none';
    if (active) active.style.display = 'block';

    renderKey();
}

// ========== Render key details ==========
function renderKey() {
    if (!currentKey) return;
    const el = (id) => document.getElementById(id);

    if (el('keyValue')) el('keyValue').textContent = currentKey.key;

    const hwid = currentKey.hwid;
    if (el('hwidValue')) {
        el('hwidValue').textContent = hwid
            ? hwid.substring(0, 8) + '...' + hwid.substring(hwid.length - 4)
            : 'Not bound yet';
    }

    if (el('activatedDate')) {
        el('activatedDate').textContent = currentKey.created_at
            ? new Date(currentKey.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : '-';
    }

    if (currentKey.expires_at) {
        const expires = new Date(currentKey.expires_at);
        const now = new Date();
        const daysLeft = Math.max(0, Math.ceil((expires - now) / (1000 * 60 * 60 * 24)));

        if (el('expiresIn')) el('expiresIn').innerHTML = daysLeft + '<span style="font-size:14px; color:var(--text-muted);"> days</span>';
        if (el('expiresDate')) el('expiresDate').textContent = 'Renews ' + expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        if (el('expiresValue')) el('expiresValue').textContent = expires.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } else {
        if (el('expiresIn')) el('expiresIn').innerHTML = 'Lifetime<span style="font-size:14px; color:var(--text-muted);"></span>';
        if (el('expiresDate')) el('expiresDate').textContent = 'Never expires';
        if (el('expiresValue')) el('expiresValue').textContent = 'Lifetime';
    }

    const resetsUsed = currentKey.hwid_reset_count || 0;
    const resetsLimit = currentKey.hwid_reset_limit || 5;
    const resetsLeft = Math.max(0, resetsLimit - resetsUsed);
    if (el('hwidResets')) el('hwidResets').innerHTML = resetsUsed + '<span style="font-size:14px; color:var(--text-muted);">/' + resetsLimit + '</span>';
    if (el('hwidResetsSub')) el('hwidResetsSub').textContent = resetsLeft + ' resets remaining';

    if (el('execCount')) el('execCount').textContent = currentKey.execution_count || 0;

    const plan = currentKey.plan || 'free';
    const planBadge = el('planBadge');
    if (planBadge) {
        planBadge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
        planBadge.className = 'badge ' + (plan === 'enterprise' ? 'badge-warning' : plan === 'pro' ? 'badge-info' : 'badge');
    }

    const loader = '-- NexaKS Authentication Loader\nlocal license = "' + currentKey.key + '"\nlocal hwid = game:GetService("RbxAnalyticsService"):GetClientId()\n\nlocal response = game:HttpGet(\n    "' + window.location.origin + '/api/verify?license=" .. license .. "&hwid=" .. hwid\n)\n\nif response then\n    loadstring(response)()\nend';
    if (el('loaderScript')) el('loaderScript').value = loader;
}

// ========== Load activity logs ==========
async function loadActivity() {
    const { data, error } = await NexaKS.supabase
        .from('logs')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Load activity error:', error);
        return;
    }

    const tbody = document.getElementById('activityTableBody');
    if (!tbody) return;

    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:32px;">No activity yet</td></tr>';
        return;
    }

    tbody.innerHTML = data.map(log => {
        const time = timeAgo(new Date(log.created_at));
        const badgeClass = log.status === 'success' ? 'badge-success'
            : log.status === 'failed' ? 'badge-danger'
            : log.status === 'warning' ? 'badge-warning'
            : 'badge-info';
        return '<tr><td><span class="badge ' + badgeClass + '">' + log.action + '</span></td><td>' + (log.metadata?.message || '-') + '</td><td style="color:var(--text-muted);">' + time + '</td></tr>';
    }).join('');
}

function timeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' mins ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' hours ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ========== Sidebar Toggle ==========
function toggleSidebar() {
    const s = document.getElementById('sidebar');
    if (s) s.classList.toggle('open');
}

document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.querySelector('.sidebar-toggle');
    if (window.innerWidth <= 968 && sidebar?.classList.contains('open') &&
        !sidebar.contains(e.target) && !toggle?.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});

// ========== Section Nav ==========
function showSection(section) {
    const target = document.getElementById('section-' + section);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.style.transition = 'box-shadow 0.3s';
        target.style.boxShadow = '0 0 0 2px var(--accent)';
        setTimeout(() => target.style.boxShadow = '', 1500);
    }
    const s = document.getElementById('sidebar');
    if (s) s.classList.remove('open');
}

// ========== Copy actions ==========
function copyKey() {
    if (!currentKey) return;
    navigator.clipboard.writeText(currentKey.key).then(() => {
        const btn = document.getElementById('copyText');
        if (btn) {
            const original = btn.textContent;
            btn.textContent = 'Copied';
            setTimeout(() => btn.textContent = original, 2000);
        }
        showToast('License key copied to clipboard', 'success');
    }).catch(() => showToast('Failed to copy', 'error'));
}

function copyLoader() {
    const t = document.getElementById('loaderScript');
    if (!t) return;
    navigator.clipboard.writeText(t.value).then(() => {
        showToast('Loader script copied', 'success');
    }).catch(() => showToast('Failed to copy', 'error'));
}

// ========== HWID Reset ==========
function openResetModal() {
    if (!currentKey) return showToast('No active license to reset', 'error');
    const m = document.getElementById('resetModal');
    if (m) m.classList.add('active');
}
function closeResetModal() {
    const m = document.getElementById('resetModal');
    if (m) m.classList.remove('active');
}

async function confirmReset() {
    closeResetModal();
    showToast('Resetting hardware ID...', 'info');

    if (currentKey.last_hwid_reset) {
        const lastReset = new Date(currentKey.last_hwid_reset);
        const hoursSince = (new Date() - lastReset) / (1000 * 60 * 60);
        if (hoursSince < 24) {
            const hoursLeft = Math.ceil(24 - hoursSince);
            return showToast('Cooldown active. Try again in ' + hoursLeft + 'h', 'error');
        }
    }

    if ((currentKey.hwid_reset_count || 0) >= (currentKey.hwid_reset_limit || 5)) {
        return showToast('Reset limit reached. Contact support.', 'error');
    }

    const { error } = await NexaKS.supabase
        .from('keys')
        .update({
            hwid: null,
            hwid_reset_count: (currentKey.hwid_reset_count || 0) + 1,
            last_hwid_reset: new Date().toISOString()
        })
        .eq('key', currentKey.key);

    if (error) {
        console.error('Reset error:', error);
        return showToast('Reset failed: ' + error.message, 'error');
    }

    await NexaKS.supabase.from('logs').insert({
        user_id: currentUser.id,
        key: currentKey.key,
        action: 'reset_hwid',
        status: 'success',
        metadata: { message: 'HWID reset via dashboard' }
    });

    showToast('Hardware ID reset successful', 'success');
    await loadUserKey();
    await loadActivity();
}

// ========== Redeem Key ==========
function openRedeemModal() {
    const m = document.getElementById('redeemModal');
    if (m) m.classList.add('active');
    setTimeout(() => {
        const i = document.getElementById('redeemInput');
        if (i) i.focus();
    }, 100);
}
function closeRedeemModal() {
    const m = document.getElementById('redeemModal');
    if (m) m.classList.remove('active');
    const i = document.getElementById('redeemInput');
    if (i) i.value = '';
}

async function confirmRedeem() {
    const input = document.getElementById('redeemInput');
    if (!input) return;
    const key = input.value.trim().toUpperCase();
    if (!key) return showToast('Please enter a license key', 'error');
    if (!key.startsWith('NXKS-')) return showToast('Invalid key format', 'error');

    closeRedeemModal();
    showToast('Redeeming license...', 'info');

    const { data: existingKey, error: fetchError } = await NexaKS.supabase
        .from('keys')
        .select('*')
        .eq('key', key)
        .maybeSingle();

    if (fetchError || !existingKey) {
        return showToast('License key not found', 'error');
    }
    if (existingKey.user_id && existingKey.user_id !== currentUser.id) {
        return showToast('Key already claimed by another user', 'error');
    }
    if (existingKey.status === 'revoked') {
        return showToast('This key has been revoked', 'error');
    }

    const updates = { user_id: currentUser.id, status: 'active' };
    if (existingKey.duration_days && !existingKey.expires_at) {
        const expires = new Date();
        expires.setDate(expires.getDate() + existingKey.duration_days);
        updates.expires_at = expires.toISOString();
    }

    const { error } = await NexaKS.supabase
        .from('keys')
        .update(updates)
        .eq('key', key);

    if (error) return showToast('Redeem failed: ' + error.message, 'error');

    await NexaKS.supabase.from('logs').insert({
        user_id: currentUser.id,
        key: key,
        action: 'redeem',
        status: 'success',
        metadata: { message: 'License redeemed via dashboard' }
    });

    showToast('License activated successfully', 'success');
    await loadUserKey();
    await loadActivity();
    renderUserInfo();
}

// ========== Logout ==========
async function handleLogout() {
    if (!confirm('Sign out from NexaKS?')) return;
    showToast('Signing out...', 'info');
    await NexaKS.signOut();
}

// ========== Modal ESC close ==========
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeResetModal();
        closeRedeemModal();
    }
});
document.getElementById('resetModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'resetModal') closeResetModal();
});
document.getElementById('redeemModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'redeemModal') closeRedeemModal();
});

// ========== Toast ==========
function showToast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = '<span>' + message + '</span>';
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
