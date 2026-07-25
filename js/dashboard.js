/* NexaKS — Dashboard JS (Phase 1b: server-API backed) */
let currentUser = null;
let currentProfile = null;
let currentKey = null;

// ---- server API helper (Bearer JWT) ----
async function apiFetch(path, opts = {}) {
    const session = await NexaKS.supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Not signed in');
    const res = await fetch(path, {
        ...opts,
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, ...(opts.headers || {}) }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
}

document.addEventListener('DOMContentLoaded', async () => {
    const loader = document.getElementById('authLoader');
    const main = document.getElementById('dashboardMain');
    const forceShow = setTimeout(() => {
        if (loader) loader.style.display = 'none';
        if (main) main.style.display = 'grid';
    }, 6000);

    try {
        currentUser = await NexaKS.getCurrentUser();
        if (!currentUser) {
            if (sessionStorage.getItem('nexaks_redirected')) {
                sessionStorage.removeItem('nexaks_redirected');
                clearTimeout(forceShow);
                if (loader) loader.innerHTML = '<div style="text-align:center;color:white;padding:40px;"><h2>Not signed in</h2><p style="color:#a0a0b0;margin:16px 0;">Please <a href="/" style="color:#8b5cf6;">go back</a> and sign in with Discord.</p></div>';
                return;
            }
            sessionStorage.setItem('nexaks_redirected', '1');
            window.location.href = '/';
            return;
        }
        sessionStorage.removeItem('nexaks_redirected');

        // Profile via server (users table is now RLS-locked; server upserts if needed)
        try {
            const { profile } = await apiFetch('/api/me');
            currentProfile = profile;
        } catch (e) { console.error('profile:', e); }
        if (!currentProfile) {
            const meta = currentUser.user_metadata || {};
            currentProfile = {
                id: currentUser.id,
                username: meta.full_name || meta.name || meta.user_name || 'User',
                avatar_url: meta.avatar_url || null,
                is_admin: false
            };
        }

        try { await loadUserKey(); } catch (e) { console.error('loadUserKey:', e); }
        try { await loadActivity(); } catch (e) { console.error('loadActivity:', e); }
        renderUserInfo();
    } catch (err) {
        console.error('Dashboard init:', err);
    } finally {
        clearTimeout(forceShow);
        if (loader) loader.style.display = 'none';
        if (main) main.style.display = 'grid';
        document.querySelectorAll('.card, .stat-card').forEach((el, i) => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px)';
            el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; }, i * 60);
        });
    }
});

function renderUserInfo() {
    if (!currentUser) return;
    const meta = currentUser.user_metadata || {};
    const username = currentProfile?.username || meta.full_name || meta.name || meta.user_name || 'User';
    const avatarUrl = currentProfile?.avatar_url || meta.avatar_url;
    const $ = (id) => document.getElementById(id);
    if ($('userName')) $('userName').textContent = username;
    if ($('userNameSmall')) $('userNameSmall').textContent = username;
    if (avatarUrl && $('userAvatarImg')) {
        $('userAvatarImg').src = avatarUrl;
        $('userAvatarImg').style.display = 'block';
        if ($('userAvatar')) $('userAvatar').style.display = 'none';
    } else if ($('userAvatar')) {
        $('userAvatar').textContent = username.charAt(0).toUpperCase();
    }
    if (currentProfile?.is_admin && $('adminLink')) {
        $('adminLink').style.display = 'flex';
        $('adminLink').href = 'admin.html';
    }
    const plan = currentKey?.plan || 'free';
    if ($('userRole')) $('userRole').textContent = plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan';
}

async function loadUserKey() {
    let data = null;
    try { const r = await apiFetch('/api/me/key'); data = r.key; }
    catch (e) { console.error('Load key:', e); return; }

    const noKey = document.getElementById('noKeyState');
    const active = document.getElementById('activeKeyState');
    if (!data) {
        if (noKey) noKey.style.display = 'block';
        if (active) active.style.display = 'none';
        return;
    }
    currentKey = data;
    if (noKey) noKey.style.display = 'none';
    if (active) active.style.display = 'block';
    renderKey();
}

function renderKey() {
    if (!currentKey) return;
    const $ = (id) => document.getElementById(id);
    if ($('keyValue')) $('keyValue').textContent = currentKey.key;
    const hwid = currentKey.hwid;
    if ($('hwidValue')) {
        $('hwidValue').textContent = hwid
            ? hwid.substring(0, 8) + '...' + hwid.substring(hwid.length - 4)
            : 'Not bound yet';
    }
    if ($('activatedDate')) {
        $('activatedDate').textContent = currentKey.created_at
            ? new Date(currentKey.created_at).toLocaleDateString() : '—';
    }
    if ($('expiresDate')) {
        $('expiresDate').textContent = currentKey.expires_at
            ? new Date(currentKey.expires_at).toLocaleDateString() : 'Never';
    }
    const plan = currentKey.plan || 'free';
    const badge = $('planBadge');
    if (badge) {
        badge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
        badge.className = 'badge ' + (plan === 'enterprise' ? 'badge-warning' : plan === 'pro' ? 'badge-info' : 'badge');
    }

    // Lua loader
    const loaderLines = [
        '-- NexaKS Authentication Loader',
        'local license = "' + currentKey.key + '"',
        'local hwid = game:GetService("RbxAnalyticsService"):GetClientId()',
        'local url = "' + window.location.origin + '/api/verify?license=" .. license .. "&hwid=" .. hwid',
        '',
        'local ok, response = pcall(function() return game:HttpGet(url, true) end)',
        'if not ok then warn("[NexaKS] Network error: " .. tostring(response)) return end',
        'if not response or response == "" then warn("[NexaKS] Empty response from server") return end',
        '',
        'local success, err = pcall(function() loadstring(response)() end)',
        'if not success then warn("[NexaKS] " .. tostring(err)) end'
    ];
    if ($('loaderCode')) $('loaderCode').textContent = loaderLines.join('\n');
}

async function loadActivity() {
    let data = [];
    try { const r = await apiFetch('/api/me/activity'); data = r.logs || []; }
    catch (e) { console.error('Load activity:', e); return; }
    const list = document.getElementById('activityList');
    if (!list) return;
    if (!data.length) { list.innerHTML = '<div style="color:#6b7280;padding:16px;">No activity yet.</div>'; return; }
    list.innerHTML = data.map(l => {
        const msg = (l.metadata && l.metadata.message) || l.action;
        const t = new Date(l.created_at).toLocaleString();
        return `<div class="activity-item"><span>${escapeHtml(msg)}</span><span style="color:#6b7280;font-size:12px;">${t}</span></div>`;
    }).join('');
}

// ---- Reset HWID (self) ----
async function resetHwid() {
    try {
        await apiFetch('/api/me/reset-hwid', { method: 'POST' });
        showToast('Hardware ID reset', 'success');
        closeResetModal();
        await loadUserKey();
    } catch (e) { showToast(e.message, 'error'); }
}

// ---- Redeem (self) ----
async function confirmRedeem() {
    const input = document.getElementById('redeemInput');
    const key = (input?.value || '').trim().toUpperCase();
    if (!key) return showToast('Enter a key', 'error');
    try {
        await apiFetch('/api/me/redeem', { method: 'POST', body: JSON.stringify({ key }) });
        showToast('Key redeemed', 'success');
        closeRedeemModal();
        await loadUserKey();
    } catch (e) { showToast(e.message, 'error'); }
}

// ---- Modal + misc helpers (unchanged behavior) ----
function openResetModal() { document.getElementById('resetModal')?.classList.add('show'); }
function closeResetModal() { document.getElementById('resetModal')?.classList.remove('show'); }
function openRedeemModal() { document.getElementById('redeemModal')?.classList.add('show'); }
function closeRedeemModal() { document.getElementById('redeemModal')?.classList.remove('show'); }

function copyKey() {
    if (!currentKey) return;
    navigator.clipboard.writeText(currentKey.key).then(() => showToast('Key copied', 'success'));
}
function copyLoader() {
    const code = document.getElementById('loaderCode')?.textContent || '';
    navigator.clipboard.writeText(code).then(() => showToast('Loader copied', 'success'));
}

async function handleLogout() {
    if (!confirm('Sign out from NexaKS?')) return;
    await NexaKS.signOut();
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeResetModal(); closeRedeemModal(); }
});
document.getElementById('resetModal')?.addEventListener('click', (e) => { if (e.target.id === 'resetModal') closeResetModal(); });
document.getElementById('redeemModal')?.addEventListener('click', (e) => { if (e.target.id === 'redeemModal') closeRedeemModal(); });

function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function showToast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = '<span>' + escapeHtml(message) + '</span>';
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
