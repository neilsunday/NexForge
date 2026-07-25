/* NexaKS - Dashboard JS (Phase 4 compatibility fix) */
let currentUser = null;
let currentProfile = null;
let currentKey = null;

async function apiFetch(path, opts = {}) {
    const session = await NexaKS.supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('Not signed in');

    const response = await fetch(path, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
            ...(opts.headers || {})
        }
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || body.message || response.statusText);
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
                if (loader) {
                    loader.innerHTML = '<div style="text-align:center;color:white;padding:40px;"><h2>Not signed in</h2><p style="color:#a0a0b0;margin:16px 0;">Please <a href="/" style="color:#8b5cf6;">go back</a> and sign in with Discord.</p></div>';
                }
                return;
            }
            sessionStorage.setItem('nexaks_redirected', '1');
            window.location.href = '/';
            return;
        }
        sessionStorage.removeItem('nexaks_redirected');

        try {
            const { profile } = await apiFetch('/api/me');
            currentProfile = profile;
        } catch (error) {
            console.error('Profile:', error);
        }

        if (!currentProfile) {
            const meta = currentUser.user_metadata || {};
            currentProfile = {
                id: currentUser.id,
                username: meta.full_name || meta.name || meta.user_name || 'User',
                avatar_url: meta.avatar_url || null,
                is_admin: false
            };
        }

        await loadUserKey();
        await loadActivity();
        renderUserInfo();
    } catch (error) {
        console.error('Dashboard init:', error);
        showToast(error.message || 'Failed to load dashboard', 'error');
    } finally {
        clearTimeout(forceShow);
        if (loader) loader.style.display = 'none';
        if (main) main.style.display = 'grid';
    }
});

function renderUserInfo() {
    if (!currentUser) return;

    const meta = currentUser.user_metadata || {};
    const username = currentProfile?.username || meta.full_name || meta.name || meta.user_name || 'User';
    const avatarUrl = currentProfile?.avatar_url || meta.avatar_url;
    const get = id => document.getElementById(id);

    if (get('userName')) get('userName').textContent = username;
    if (get('userNameSmall')) get('userNameSmall').textContent = username;

    if (avatarUrl && get('userAvatarImg')) {
        get('userAvatarImg').src = avatarUrl;
        get('userAvatarImg').style.display = 'block';
        if (get('userAvatar')) get('userAvatar').style.display = 'none';
    } else if (get('userAvatar')) {
        get('userAvatar').textContent = username.charAt(0).toUpperCase();
    }

    if (currentProfile?.is_admin && get('adminLink')) {
        get('adminLink').style.display = 'flex';
        get('adminLink').href = 'admin.html';
    }

    const plan = currentKey?.plan || 'free';
    if (get('userRole')) {
        get('userRole').textContent = plan.charAt(0).toUpperCase() + plan.slice(1) + ' Plan';
    }
}

async function loadUserKey() {
    const noKey = document.getElementById('noKeyState');
    const active = document.getElementById('activeKeyState');

    try {
        const { key } = await apiFetch('/api/me/key');
        currentKey = key || null;
    } catch (error) {
        console.error('Load key:', error);
        currentKey = null;
        showToast('Unable to load license: ' + error.message, 'error');
    }

    if (!currentKey) {
        if (noKey) noKey.style.display = 'block';
        if (active) active.style.display = 'none';
        renderUserInfo();
        return;
    }

    if (noKey) noKey.style.display = 'none';
    if (active) active.style.display = 'block';
    renderKey();
    renderUserInfo();
}

function renderKey() {
    if (!currentKey) return;

    const get = id => document.getElementById(id);
    const status = String(currentKey.status || 'active').toLowerCase();
    const plan = String(currentKey.plan || 'free');
    const executionCount = Math.max(0, Number(currentKey.execution_count || 0));
    const resetCount = Math.max(0, Number(currentKey.hwid_reset_count || 0));
    const resetLimit = Math.max(0, Number(currentKey.hwid_reset_limit ?? 5));

    if (get('keyValue')) get('keyValue').textContent = currentKey.key || '';
    if (get('hwidValue')) {
        const hwid = currentKey.hwid;
        get('hwidValue').textContent = hwid
            ? hwid.substring(0, 8) + '...' + hwid.substring(Math.max(8, hwid.length - 4))
            : 'Not bound yet';
    }

    if (get('activatedDate')) {
        get('activatedDate').textContent = currentKey.created_at
            ? new Date(currentKey.created_at).toLocaleDateString()
            : '-';
    }

    const expiresAt = currentKey.expires_at ? new Date(currentKey.expires_at) : null;
    const validExpiry = expiresAt && !Number.isNaN(expiresAt.getTime());
    const expiryText = validExpiry ? expiresAt.toLocaleDateString() : 'Never';
    if (get('expiresDate')) get('expiresDate').textContent = expiryText;
    if (get('expiresValue')) get('expiresValue').textContent = expiryText;

    if (get('expiresIn')) {
        if (!validExpiry) {
            get('expiresIn').textContent = 'Lifetime';
        } else {
            const days = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400000));
            get('expiresIn').textContent = days + (days === 1 ? ' day' : ' days');
        }
    }

    if (get('execCount')) get('execCount').textContent = String(executionCount);
    if (get('hwidResets')) get('hwidResets').textContent = resetCount + '/' + resetLimit;
    if (get('hwidResetsSub')) {
        get('hwidResetsSub').textContent = resetCount >= resetLimit ? 'Limit reached' : 'Available';
    }

    if (get('statusBadge')) {
        get('statusBadge').textContent = status.charAt(0).toUpperCase() + status.slice(1);
        get('statusBadge').className = 'badge ' + (status === 'active' ? 'badge-success' : 'badge-danger');
    }
    if (get('statusSub')) {
        get('statusSub').textContent = currentKey.hwid ? 'Hardware bound' : 'Waiting for first execution';
    }

    if (get('planBadge')) {
        get('planBadge').textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
        get('planBadge').className = 'badge ' + (
            plan === 'enterprise' ? 'badge-warning' :
            plan === 'pro' ? 'badge-info' : 'badge-success'
        );
    }

    renderDashboardLoader();
}

function renderDashboardLoader() {
    const field = document.getElementById('loaderScript');
    if (!field || !currentKey) return;

    field.value = [
        '-- NexForge license loader',
        '-- Use Projects > Script > Loader for deterministic project/script routing.',
        'local license = "' + String(currentKey.key || '').replace(/\/g, '\\').replace(/"/g, '\"') + '"',
        'local hwid = game:GetService("RbxAnalyticsService"):GetClientId()',
        '',
        'local function encode(value)',
        '    return (tostring(value):gsub("([^%w%-_%.~])", function(char)',
        '        return string.format("%%%02X", string.byte(char))',
        '    end))',
        'end',
        '',
        'local url = "' + window.location.origin + '/api/verify?license=" .. encode(license) .. "&hwid=" .. encode(hwid)',
        'local requestOk, response = pcall(function()',
        '    return game:HttpGet(url, true)',
        'end)',
        'if not requestOk then error("NexForge: Unable to reach the licensing service") end',
        'if type(response) ~= "string" or response == "" then error("NexForge: Empty server response") end',
        'local chunk, compileError = loadstring(response)',
        'if not chunk then error("NexForge: Invalid server response: " .. tostring(compileError)) end',
        'local runOk, runError = pcall(chunk)',
        'if not runOk then error(tostring(runError)) end'
    ].join('\n');
}

async function loadActivity() {
    const tbody = document.getElementById('activityTableBody');
    if (!tbody) return;

    try {
        const { logs } = await apiFetch('/api/me/activity');
        const items = logs || [];

        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#6b7280;padding:32px;">No activity yet</td></tr>';
            return;
        }

        tbody.innerHTML = items.map(log => {
            const message = log.metadata?.message || log.details || log.action || '';
            const createdAt = log.created_at ? new Date(log.created_at).toLocaleString() : '';
            return '<tr>' +
                '<td>' + escapeHtml(log.action || '') + '</td>' +
                '<td>' + escapeHtml(message) + '</td>' +
                '<td>' + escapeHtml(createdAt) + '</td>' +
                '</tr>';
        }).join('');
    } catch (error) {
        console.error('Load activity:', error);
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#ef4444;padding:32px;">Unable to load activity</td></tr>';
    }
}

async function resetHwid() {
    try {
        await apiFetch('/api/me/reset-hwid', { method: 'POST' });
        showToast('Hardware ID reset', 'success');
        closeResetModal();
        await loadUserKey();
        await loadActivity();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function confirmReset() {
    await resetHwid();
}

async function confirmRedeem() {
    const input = document.getElementById('redeemInput');
    const button = document.getElementById('redeemConfirmBtn');
    const key = String(input?.value || '').trim().toUpperCase();

    if (!key) {
        showToast('Enter a license key', 'error');
        input?.focus();
        return;
    }
    if (!/^NXKS-[A-Z0-9-]{4,64}$/.test(key)) {
        showToast('Invalid license key format', 'error');
        input?.focus();
        return;
    }

    if (button) button.disabled = true;
    try {
        await apiFetch('/api/me/redeem', {
            method: 'POST',
            body: JSON.stringify({ key })
        });
        if (input) input.value = '';
        showToast('License key redeemed', 'success');
        closeRedeemModal();
        await loadUserKey();
        await loadActivity();
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

function openResetModal() {
    const modal = document.getElementById('resetModal');
    modal?.classList.add('active');
    modal?.setAttribute('aria-hidden', 'false');
}

function closeResetModal() {
    const modal = document.getElementById('resetModal');
    modal?.classList.remove('active');
    modal?.setAttribute('aria-hidden', 'true');
}

function openRedeemModal() {
    const modal = document.getElementById('redeemModal');
    modal?.classList.add('active');
    modal?.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('redeemInput')?.focus(), 0);
}

function closeRedeemModal() {
    const modal = document.getElementById('redeemModal');
    modal?.classList.remove('active');
    modal?.setAttribute('aria-hidden', 'true');
}

function showSection(section) {
    const target = document.getElementById('section-' + section);
    if (!target) {
        showToast('Section is available after redeeming a license', 'info');
        return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.style.boxShadow = '0 0 0 2px var(--accent)';
    setTimeout(() => { target.style.boxShadow = ''; }, 1200);
    document.getElementById('sidebar')?.classList.remove('open');
}

function toggleSidebar() {
    document.getElementById('sidebar')?.classList.toggle('open');
}

function copyKey() {
    if (!currentKey?.key) return;
    copyToClipboard(currentKey.key, 'Key copied');
}

function copyLoader() {
    const code = document.getElementById('loaderScript')?.value || '';
    if (!code) return showToast('No loader available', 'error');
    copyToClipboard(code, 'Loader copied');
}

async function copyToClipboard(text, successMessage) {
    try {
        await navigator.clipboard.writeText(text);
        showToast(successMessage, 'success');
    } catch (error) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        showToast(copied ? successMessage : 'Copy failed', copied ? 'success' : 'error');
    }
}

async function handleLogout() {
    if (!confirm('Sign out from NexaKS?')) return;
    await NexaKS.signOut();
}

document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        closeResetModal();
        closeRedeemModal();
    }
    if (event.key === 'Enter' && document.getElementById('redeemModal')?.classList.contains('active')) {
        confirmRedeem();
    }
});

document.addEventListener('click', event => {
    const resetModal = document.getElementById('resetModal');
    const redeemModal = document.getElementById('redeemModal');
    if (event.target === resetModal) closeResetModal();
    if (event.target === redeemModal) closeRedeemModal();

    const sidebar = document.getElementById('sidebar');
    const toggle = document.querySelector('.sidebar-toggle');
    if (window.innerWidth <= 968 && sidebar?.classList.contains('open') &&
        !sidebar.contains(event.target) && !toggle?.contains(event.target)) {
        sidebar.classList.remove('open');
    }
});

function escapeHtml(value) {
    if (value == null) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const text = document.createElement('span');
    text.textContent = String(message || '');
    toast.appendChild(text);
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}
