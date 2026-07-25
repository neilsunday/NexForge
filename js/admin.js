/* NexaKS — Admin Panel JS (Phase 1b: server-API backed) */
let currentUser = null;
let currentProfile = null;
let allKeys = [];
let allUsers = [];
let allScripts = [];
let editingScriptId = null;

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
    const main = document.getElementById('adminMain');
    const denied = document.getElementById('deniedState');
    const forceShow = setTimeout(() => {
        if (loader) loader.style.display = 'none';
        if (denied) denied.style.display = 'flex';
    }, 8000);

    try {
        currentUser = await NexaKS.getCurrentUser();
        if (!currentUser) { clearTimeout(forceShow); window.location.href = '/'; return; }

        // Admin check via server (authoritative). 403 => not admin.
        try {
            const { profile } = await apiFetch('/api/me');
            currentProfile = profile;
        } catch (e) { console.error('profile:', e); }

        if (!currentProfile?.is_admin) {
            clearTimeout(forceShow);
            if (loader) loader.style.display = 'none';
            if (denied) denied.style.display = 'flex';
            return;
        }

        clearTimeout(forceShow);
        renderAdminInfo();
        await Promise.all([loadStats(), loadKeys(), loadUsers(), loadLogs(), loadScripts()]);

        if (loader) loader.style.display = 'none';
        if (main) main.style.display = 'grid';
        document.querySelectorAll('.card, .stat-card').forEach((el, i) => {
            el.style.opacity = '0';
            el.style.transform = 'translateY(10px)';
            el.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            setTimeout(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; }, i * 60);
        });
    } catch (err) {
        console.error('Admin init:', err);
        clearTimeout(forceShow);
        if (loader) loader.style.display = 'none';
        if (denied) denied.style.display = 'flex';
    }
});

function renderAdminInfo() {
    const meta = currentUser.user_metadata || {};
    const username = currentProfile?.username || meta.full_name || meta.name || 'Admin';
    const avatarUrl = currentProfile?.avatar_url || meta.avatar_url;
    const nameEl = document.getElementById('adminName');
    const avatarImg = document.getElementById('adminAvatarImg');
    const avatarDiv = document.getElementById('adminAvatar');
    if (nameEl) nameEl.textContent = username;
    if (avatarUrl && avatarImg) {
        avatarImg.src = avatarUrl; avatarImg.style.display = 'block';
        if (avatarDiv) avatarDiv.style.display = 'none';
    } else if (avatarDiv) {
        avatarDiv.textContent = username.charAt(0).toUpperCase();
    }
}

// ---- Stats ----
async function loadStats() {
    try {
        const s = await apiFetch('/api/admin/stats');
        const $ = (id) => document.getElementById(id);
        if ($('statTotalKeys')) $('statTotalKeys').textContent = s.total_keys ?? 0;
        if ($('statActiveKeys')) $('statActiveKeys').textContent = s.active_keys ?? 0;
        if ($('statRevoked')) $('statRevoked').textContent = s.revoked_keys ?? 0;
        if ($('statTotalUsers')) $('statTotalUsers').textContent = s.total_users ?? 0;
    } catch (e) { console.error('stats:', e); }
}

// ---- Keys ----
async function loadKeys() {
    try {
        const { keys } = await apiFetch('/api/admin/keys');
        allKeys = keys || [];
        renderKeys();
    } catch (e) { console.error('keys:', e); }
}

function renderKeys() {
    const tbody = document.getElementById('keysTableBody');
    if (!tbody) return;
    if (!allKeys.length) { tbody.innerHTML = '<tr><td colspan="6" style="color:#6b7280;padding:16px;">No keys.</td></tr>'; return; }
    tbody.innerHTML = allKeys.map(k => {
        const uname = k.users?.username || '<span style="color:#6b7280;">unclaimed</span>';
        return `<tr>
            <td class="mono">${escapeHtml(k.key)}</td>
            <td>${uname}</td>
            <td>${escapeHtml(k.plan || 'free')}</td>
            <td>${escapeHtml(k.status || '')}</td>
            <td>${k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Never'}</td>
            <td>
                <button class="btn-sm" onclick="copyKeyValue('${k.key}')">Copy</button>
                <button class="btn-sm" onclick="revokeKeyById('${k.key}')">Revoke</button>
            </td>
        </tr>`;
    }).join('');
}

function copyKeyValue(key) {
    navigator.clipboard.writeText(key).then(() => showToast('Key copied', 'success')).catch(() => showToast('Copy failed', 'error'));
}

async function revokeKeyById(key) {
    if (!confirm('Revoke this key permanently? The user will lose access immediately.')) return;
    try {
        await apiFetch('/api/admin/keys/revoke', { method: 'POST', body: JSON.stringify({ key }) });
        showToast('Key revoked', 'success');
        await loadKeys(); await loadStats();
    } catch (e) { showToast('Revoke failed: ' + e.message, 'error'); }
}

// ---- Generate keys ----
async function generateKeys() {
    const plan = document.getElementById('genPlan')?.value || 'free';
    const duration = document.getElementById('genDuration')?.value || 'lifetime';
    const quantity = parseInt(document.getElementById('genQuantity')?.value) || 1;
    try {
        const { keys } = await apiFetch('/api/admin/keys/generate', {
            method: 'POST', body: JSON.stringify({ plan, duration, quantity })
        });
        showToast('Generated ' + (keys?.length || 0) + ' keys', 'success');
        const out = document.getElementById('genOutput');
        if (out) out.value = (keys || []).map(k => k.key).join('\n');
        await loadKeys(); await loadStats();
    } catch (e) { showToast('Generate failed: ' + e.message, 'error'); }
}

// ---- Users ----
async function loadUsers() {
    try {
        const { users } = await apiFetch('/api/admin/users');
        allUsers = users || [];
        renderUsers();
    } catch (e) { console.error('users:', e); }
}

function renderUsers() {
    const tbody = document.getElementById('usersTableBody');
    const desc = document.getElementById('usersDesc');
    if (desc) desc.textContent = allUsers.length + ' total users';
    if (!tbody) return;
    tbody.innerHTML = allUsers.map(u => {
        const status = u.is_admin ? '<span class="badge badge-warning">Admin</span>'
            : u.is_banned ? '<span class="badge badge-danger">Banned</span>'
            : '<span class="badge">User</span>';
        const isSelf = u.id === currentUser.id;
        const action = isSelf ? '<span style="color:#6b7280;">You</span>'
            : `<button class="btn-sm" onclick="toggleUserBan('${u.id}', ${!u.is_banned})">${u.is_banned ? 'Unban' : 'Ban'}</button>`;
        return `<tr>
            <td>${escapeHtml(u.username || 'User')}</td>
            <td>${u.created_at ? new Date(u.created_at).toLocaleDateString() : ''}</td>
            <td>${status}</td>
            <td>${action}</td>
        </tr>`;
    }).join('');
}

async function toggleUserBan(userId, banned) {
    if (!confirm((banned ? 'Ban' : 'Unban') + ' this user?')) return;
    try {
        await apiFetch('/api/admin/users/ban', { method: 'POST', body: JSON.stringify({ user_id: userId, banned }) });
        showToast('User ' + (banned ? 'banned' : 'unbanned'), 'success');
        await loadUsers();
    } catch (e) { showToast('Failed: ' + e.message, 'error'); }
}

// ---- Logs ----
async function loadLogs() {
    try {
        const { logs } = await apiFetch('/api/admin/logs');
        renderLogs(logs || []);
    } catch (e) { console.error('logs:', e); }
}

function renderLogs(logs) {
    const tbody = document.getElementById('logsTableBody');
    if (!tbody) return;
    if (!logs.length) { tbody.innerHTML = '<tr><td colspan="4" style="color:#6b7280;padding:16px;">No logs.</td></tr>'; return; }
    tbody.innerHTML = logs.map(l => {
        const who = l.users?.username || 'system';
        const msg = (l.metadata && l.metadata.message) || '';
        return `<tr>
            <td>${new Date(l.created_at).toLocaleString()}</td>
            <td>${escapeHtml(who)}</td>
            <td class="mono">${escapeHtml(l.action || '')}</td>
            <td>${escapeHtml(msg)}</td>
        </tr>`;
    }).join('');
}

function refreshLogs() { loadLogs(); }

// ---- Scripts (legacy plan-based) ----
// NOTE: script writes are not yet exposed via server API in Phase 1.
// They will move to the project_scripts model in a later phase.
// For now, listing is read-only via the projects system; the legacy
// plan-based script editor is disabled under the RLS lockdown.
async function loadScripts() {
    const wrap = document.getElementById('scriptsTableBody');
    if (wrap) wrap.innerHTML = '<tr><td colspan="5" style="color:#6b7280;padding:16px;">Legacy script editor is being migrated to the Projects system. Manage scripts under <a href="projects.html" style="color:#8b5cf6;">Projects</a>.</td></tr>';
}
function saveScript() { showToast('Manage scripts under the Projects page now.', 'info'); }
function toggleScriptActive() { showToast('Manage scripts under the Projects page now.', 'info'); }
function deleteScript() { showToast('Manage scripts under the Projects page now.', 'info'); }
function openScriptModal() { showToast('Manage scripts under the Projects page now.', 'info'); }
function closeScriptModal() { document.getElementById('scriptModal')?.classList.remove('show'); }

// ---- Nav helpers ----
function toggleSidebar() { document.getElementById('sidebar')?.classList.toggle('open'); }
document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.querySelector('.sidebar-toggle');
    if (window.innerWidth <= 968 && sidebar?.classList.contains('open') &&
        !sidebar.contains(e.target) && !toggle?.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});
function showTab(tab) {
    const target = document.getElementById('tab-' + tab);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.style.transition = 'box-shadow 0.3s';
        target.style.boxShadow = '0 0 0 2px var(--accent)';
        setTimeout(() => target.style.boxShadow = '', 1500);
    }
    document.getElementById('sidebar')?.classList.remove('open');
}
async function handleLogout() {
    if (!confirm('Sign out from NexaKS?')) return;
    await NexaKS.signOut();
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeScriptModal(); });
document.getElementById('scriptModal')?.addEventListener('click', (e) => { if (e.target.id === 'scriptModal') closeScriptModal(); });

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
