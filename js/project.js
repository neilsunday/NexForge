/* ========================================
   NexaKS — Projects Page JS
   Handles list/search/pagination, create/edit/delete,
   and per-project detail tabs (Keys, Whitelist, Blacklist, Logs, Settings).
   ======================================== */

let currentUser = null;
let currentProject = null;         // project currently open in detail panel
let currentTab = 'overview';
let state = {
    page: 1,
    perPage: 12,
    search: '',
    archived: false,
    total: 0
};
let searchDebounce = null;

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async () => {
    const loader = document.getElementById('authLoader');
    const main = document.getElementById('projectsMain');
    const forceShow = setTimeout(() => {
        if (loader) loader.style.display = 'none';
        if (main) main.style.display = 'grid';
    }, 6000);

    try {
        currentUser = await NexaKS.getCurrentUser();
        if (!currentUser) {
            clearTimeout(forceShow);
            if (loader) loader.innerHTML =
                '<div style="text-align:center;color:white;padding:40px;">' +
                '<h2>Not signed in</h2>' +
                '<p style="color:#a0a0b0;margin:16px 0;">Please <a href="/" style="color:#8b5cf6;">go back</a> and sign in with Discord.</p></div>';
            return;
        }

        document.getElementById('signOutBtn')?.addEventListener('click', async (e) => {
            e.preventDefault();
            await NexaKS.signOut();
            window.location.href = '/';
        });

        await loadProjects();
    } catch (err) {
        console.error('Projects init:', err);
        showToast('Failed to load projects', 'error');
    } finally {
        clearTimeout(forceShow);
        if (loader) loader.style.display = 'none';
        if (main) main.style.display = 'grid';
    }
});

// ---------- API helper ----------
async function api(path, opts = {}) {
    const session = await NexaKS.supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('No auth token');

    const res = await fetch(path, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token,
            ...(opts.headers || {})
        }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
}

// ---------- Projects list ----------
async function loadProjects() {
    state.archived = document.getElementById('showArchived')?.checked || false;
    const grid = document.getElementById('projectsGrid');
    const empty = document.getElementById('emptyState');
    const pag = document.getElementById('pagination');

    grid.innerHTML = '<div style="color:#a0a0b8;padding:20px;">Loading…</div>';
    pag.innerHTML = '';
    empty.style.display = 'none';

    try {
        const qs = new URLSearchParams({
            page: state.page, per_page: state.perPage,
            search: state.search, archived: state.archived
        });
        const data = await api('/api/projects?' + qs.toString());
        state.total = data.pagination.total;

        if (!data.projects.length) {
            grid.innerHTML = '';
            empty.style.display = 'block';
            return;
        }

        grid.innerHTML = data.projects.map(renderProjectCard).join('');
        renderPagination(data.pagination);
    } catch (err) {
        grid.innerHTML = '<div style="color:#f87171;padding:20px;">Error: ' + escapeHtml(err.message) + '</div>';
    }
}

function renderProjectCard(p) {
    const statusBadge = p.archived
        ? '<span class="badge-status badge-archived">Archived</span>'
        : (p.status === 'active'
            ? '<span class="badge-status badge-active">Active</span>'
            : '<span class="badge-status badge-disabled">Disabled</span>');
    const created = new Date(p.created_at).toLocaleDateString();
    return `
        <div class="project-card" onclick="openDetail('${p.id}')">
            <div class="project-card-head">
                <div class="project-card-title">${escapeHtml(p.name)}</div>
                ${statusBadge}
            </div>
            <div class="project-card-desc">${escapeHtml(p.description || 'No description')}</div>
            <div class="project-card-meta">
                <span>v${escapeHtml(p.version || '1.0.0')}</span>
                <span>•</span>
                <span>${created}</span>
            </div>
        </div>
    `;
}

function renderPagination({ page, total_pages }) {
    const pag = document.getElementById('pagination');
    if (total_pages <= 1) { pag.innerHTML = ''; return; }
    let html = '';
    html += `<button ${page === 1 ? 'disabled' : ''} onclick="gotoPage(${page - 1})">←</button>`;
    for (let i = 1; i <= total_pages; i++) {
        if (i === 1 || i === total_pages || Math.abs(i - page) <= 2) {
            html += `<button class="${i === page ? 'active' : ''}" onclick="gotoPage(${i})">${i}</button>`;
        } else if (Math.abs(i - page) === 3) {
            html += `<span style="padding:0 6px;color:#6b7280;">…</span>`;
        }
    }
    html += `<button ${page === total_pages ? 'disabled' : ''} onclick="gotoPage(${page + 1})">→</button>`;
    pag.innerHTML = html;
}

function gotoPage(p) { state.page = p; loadProjects(); }

function onSearchInput() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        state.search = document.getElementById('searchInput').value.trim();
        state.page = 1;
        loadProjects();
    }, 300);
}

// ---------- Create / Edit modal ----------
function openCreateModal() {
    document.getElementById('modalTitle').textContent = 'New Project';
    document.getElementById('submitBtn').textContent = 'Create';
    document.getElementById('editId').value = '';
    document.getElementById('fName').value = '';
    document.getElementById('fDesc').value = '';
    document.getElementById('fVersion').value = '1.0.0';
    document.getElementById('fScript').value = '';
    document.getElementById('fStatus').value = 'active';
    document.getElementById('projectModal').classList.add('show');
}

function openEditModal(p) {
    document.getElementById('modalTitle').textContent = 'Edit Project';
    document.getElementById('submitBtn').textContent = 'Save';
    document.getElementById('editId').value = p.id;
    document.getElementById('fName').value = p.name;
    document.getElementById('fDesc').value = p.description || '';
    document.getElementById('fVersion').value = p.version || '1.0.0';
    document.getElementById('fScript').value = p.script_content || '';
    document.getElementById('fStatus').value = p.status || 'active';
    document.getElementById('projectModal').classList.add('show');
}

function closeModal() {
    document.getElementById('projectModal').classList.remove('show');
}

async function submitProject(e) {
    e.preventDefault();
    const id = document.getElementById('editId').value;
    const payload = {
        name: document.getElementById('fName').value.trim(),
        description: document.getElementById('fDesc').value.trim(),
        version: document.getElementById('fVersion').value.trim(),
        script_content: document.getElementById('fScript').value,
        status: document.getElementById('fStatus').value
    };
    try {
        if (id) {
            const { project } = await api('/api/projects/' + id, {
                method: 'PATCH', body: JSON.stringify(payload)
            });
            showToast('Project updated', 'success');
            if (currentProject && currentProject.id === id) {
                currentProject = project;
                renderDetailHeader();
                switchTab(currentTab);
            }
        } else {
            await api('/api/projects', {
                method: 'POST', body: JSON.stringify(payload)
            });
            showToast('Project created', 'success');
        }
        closeModal();
        loadProjects();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// ---------- Detail panel ----------
async function openDetail(id) {
    try {
        const { project } = await api('/api/projects/' + id);
        currentProject = project;
        document.getElementById('detailPanel').classList.add('show');
        renderDetailHeader();
        switchTab('overview');
    } catch (err) {
        showToast('Failed to load project', 'error');
    }
}

function closeDetail() {
    document.getElementById('detailPanel').classList.remove('show');
    currentProject = null;
    loadProjects();
}

function renderDetailHeader() {
    if (!currentProject) return;
    document.getElementById('dName').textContent = currentProject.name;
    const statusText = currentProject.archived ? 'Archived'
        : (currentProject.status === 'active' ? 'Active' : 'Disabled');
    document.getElementById('dMeta').textContent =
        `v${currentProject.version || '1.0.0'} • ${statusText} • ID: ${currentProject.id.slice(0, 8)}…`;
}

function editCurrentProject() { openEditModal(currentProject); }

async function toggleArchive() {
    if (!currentProject) return;
    const archived = !currentProject.archived;
    if (archived && !confirm('Archive this project?')) return;
    try {
        const { project } = await api('/api/projects/' + currentProject.id + '/archive', {
            method: 'POST', body: JSON.stringify({ archived })
        });
        currentProject = project;
        renderDetailHeader();
        showToast(archived ? 'Project archived' : 'Project restored', 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function deleteCurrentProject() {
    if (!currentProject) return;
    if (!confirm(`Delete "${currentProject.name}"? This deletes all its keys, whitelist, blacklist, and logs. Cannot be undone.`)) return;
    try {
        await api('/api/projects/' + currentProject.id, { method: 'DELETE' });
        showToast('Project deleted', 'success');
        closeDetail();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// ---------- Tabs ----------
function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.detail-tabs button').forEach(b => {
        b.classList.toggle('active', b.dataset.tab === tab);
    });
    const c = document.getElementById('detailContent');
    c.innerHTML = '<div style="color:#a0a0b8;padding:20px;">Loading…</div>';

    if (tab === 'overview') renderOverviewTab(c);
    else if (tab === 'keys') renderKeysTab(c);
    else if (tab === 'whitelist') renderWhitelistTab(c);
    else if (tab === 'blacklist') renderBlacklistTab(c);
    else if (tab === 'logs') renderLogsTab(c);
    else if (tab === 'settings') renderSettingsTab(c);
}

// ---------- OVERVIEW ----------
async function renderOverviewTab(c) {
    try {
        const { analytics } = await api('/api/projects/' + currentProject.id + '/analytics');
        const a = analytics || {};
        const loaderUrl = `${window.location.origin}/api/verify?license=USER_KEY&hwid=HWID&project=${encodeURIComponent(currentProject.api_key)}`;
        const luaLoader =
`-- NexaKS Loader for ${currentProject.name}
local license = "PASTE_KEY_HERE"
local hwid = game:GetService("RbxAnalyticsService"):GetClientId()
local url = "${window.location.origin}/api/verify?license=" .. license .. "&hwid=" .. hwid .. "&project=${currentProject.api_key}"
local ok, response = pcall(function() return game:HttpGet(url, true) end)
if not ok then return error("NexaKS: Network error") end
loadstring(response)()`;

        c.innerHTML = `
            <div class="stat-grid">
                ${statBox('Total Keys', a.total_keys ?? 0)}
                ${statBox('Active Keys', a.active_keys ?? 0)}
                ${statBox('Total Executions', a.total_executions ?? 0)}
                ${statBox('Executions (24h)', a.executions_24h ?? 0)}
                ${statBox('Unique HWIDs (7d)', a.unique_hwids_7d ?? 0)}
                ${statBox('Whitelist', a.whitelist_count ?? 0)}
                ${statBox('Blacklist', a.blacklist_count ?? 0)}
                ${statBox('Logs (24h)', a.logs_24h ?? 0)}
            </div>
            <h3 style="color:#fff; margin:24px 0 12px;">Project API Key</h3>
            <div class="code-block">${escapeHtml(currentProject.api_key)}</div>
            <button class="btn-sm" style="margin-top:8px;" onclick="regenerateApiKey()">Regenerate API Key</button>

            <h3 style="color:#fff; margin:24px 0 12px;">Lua Loader Snippet</h3>
            <div class="code-block">${escapeHtml(luaLoader)}</div>
            <button class="btn-sm" style="margin-top:8px;" onclick="copyText(\`${luaLoader.replace(/`/g, '\\`')}\`)">Copy loader</button>
        `;
    } catch (err) {
        c.innerHTML = `<div style="color:#f87171;">Failed to load analytics: ${escapeHtml(err.message)}</div>`;
    }
}

async function regenerateApiKey() {
    if (!confirm('Regenerate API key? Existing loaders will stop working until updated.')) return;
    try {
        const { project } = await api('/api/projects/' + currentProject.id + '/regenerate-key',
            { method: 'POST' });
        currentProject = project;
        showToast('API key regenerated', 'success');
        switchTab('overview');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

// ---------- KEYS ----------
async function renderKeysTab(c) {
    try {
        const { keys } = await api('/api/projects/' + currentProject.id + '/keys?per_page=100');
        c.innerHTML = `
            <div style="display:flex; gap:10px; margin-bottom:16px; align-items:center;">
                <button class="btn btn-primary" onclick="promptGenerateKey()">+ Generate Key</button>
                <span style="color:#a0a0b8; font-size:13px;">${keys.length} key(s)</span>
            </div>
            ${keys.length === 0 ? '<div class="empty-state"><h3>No keys yet</h3><p>Generate your first key.</p></div>' : `
            <table class="data-table">
                <thead><tr>
                    <th>Key</th><th>Status</th><th>HWID</th><th>Executions</th><th>Expires</th><th></th>
                </tr></thead>
                <tbody>
                ${keys.map(k => `
                    <tr>
                        <td class="mono">${escapeHtml(k.key)}</td>
                        <td>${statusPill(k.status)}</td>
                        <td class="mono" title="${escapeHtml(k.hwid || '')}">${k.hwid ? escapeHtml(k.hwid.slice(0, 12) + '…') : '<span style="color:#6b7280;">unbound</span>'}</td>
                        <td>${k.execution_count || 0}</td>
                        <td>${k.expires_at ? new Date(k.expires_at).toLocaleDateString() : '<span style="color:#6b7280;">Never</span>'}</td>
                        <td class="row-actions">
                            <button class="btn-sm" onclick="resetKeyHwid('${k.id}')">Reset HWID</button>
                            <button class="btn-sm btn-danger-sm" onclick="revokeKey('${k.id}')">Revoke</button>
                        </td>
                    </tr>
                `).join('')}
                </tbody>
            </table>`}
        `;
    } catch (err) {
        c.innerHTML = `<div style="color:#f87171;">Failed to load keys: ${escapeHtml(err.message)}</div>`;
    }
}

async function promptGenerateKey() {
    const days = prompt('Expiry in days (leave empty for lifetime):', '');
    const note = prompt('Note (optional):', '') || '';
    try {
        await api('/api/projects/' + currentProject.id + '/keys', {
            method: 'POST',
            body: JSON.stringify({
                expires_days: days ? Number(days) : null,
                note
            })
        });
        showToast('Key generated', 'success');
        switchTab('keys');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}

async function revokeKey(id) {
    if (!confirm('Revoke this key?')) return;
    try {
        await api(`/api/projects/${currentProject.id}/keys/${id}`, { method: 'DELETE' });
        showToast('Key revoked', 'success');
        switchTab('keys');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function resetKeyHwid(id) {
    if (!confirm('Reset HWID for this key?')) return;
    try {
        await api(`/api/projects/${currentProject.id}/keys/${id}/reset-hwid`, { method: 'POST' });
        showToast('HWID reset', 'success');
        switchTab('keys');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ---------- WHITELIST ----------
async function renderWhitelistTab(c) {
    try {
        const { whitelist } = await api('/api/projects/' + currentProject.id + '/whitelist');
        c.innerHTML = `
            <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; align-items:center;">
                <input id="wlIdent" placeholder="Identifier (discord id, hwid, key…)" style="flex:1; min-width:200px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 12px; color:#fff; font-family:inherit;">
                <select id="wlType" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 12px; color:#fff; font-family:inherit;">
                    <option value="discord_id">Discord ID</option>
                    <option value="hwid">HWID</option>
                    <option value="key">Key</option>
                    <option value="user_id">User ID</option>
                </select>
                <input id="wlNote" placeholder="Note (optional)" style="width:180px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 12px; color:#fff; font-family:inherit;">
                <button class="btn btn-primary" onclick="addWhitelist()">Add</button>
            </div>
            ${whitelist.length === 0 ? '<div class="empty-state"><p>Whitelist is empty.</p></div>' : `
            <table class="data-table">
                <thead><tr><th>Identifier</th><th>Type</th><th>Note</th><th>Added</th><th></th></tr></thead>
                <tbody>
                ${whitelist.map(w => `
                    <tr>
                        <td class="mono">${escapeHtml(w.identifier)}</td>
                        <td>${escapeHtml(w.type)}</td>
                        <td>${escapeHtml(w.note || '')}</td>
                        <td>${new Date(w.created_at).toLocaleDateString()}</td>
                        <td><button class="btn-sm btn-danger-sm" onclick="removeWhitelist('${w.id}')">Remove</button></td>
                    </tr>
                `).join('')}
                </tbody>
            </table>`}
        `;
    } catch (err) {
        c.innerHTML = `<div style="color:#f87171;">${escapeHtml(err.message)}</div>`;
    }
}

async function addWhitelist() {
    const identifier = document.getElementById('wlIdent').value.trim();
    const type = document.getElementById('wlType').value;
    const note = document.getElementById('wlNote').value.trim();
    if (!identifier) return showToast('Identifier required', 'error');
    try {
        await api('/api/projects/' + currentProject.id + '/whitelist', {
            method: 'POST', body: JSON.stringify({ identifier, type, note })
        });
        showToast('Added to whitelist', 'success');
        switchTab('whitelist');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function removeWhitelist(id) {
    if (!confirm('Remove from whitelist?')) return;
    try {
        await api(`/api/projects/${currentProject.id}/whitelist/${id}`, { method: 'DELETE' });
        showToast('Removed', 'success');
        switchTab('whitelist');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ---------- BLACKLIST ----------
async function renderBlacklistTab(c) {
    try {
        const { blacklist } = await api('/api/projects/' + currentProject.id + '/blacklist');
        c.innerHTML = `
            <div style="display:flex; gap:8px; margin-bottom:16px; flex-wrap:wrap; align-items:center;">
                <input id="blIdent" placeholder="Identifier" style="flex:1; min-width:180px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 12px; color:#fff; font-family:inherit;">
                <select id="blType" style="background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 12px; color:#fff; font-family:inherit;">
                    <option value="discord_id">Discord ID</option>
                    <option value="hwid">HWID</option>
                    <option value="key">Key</option>
                    <option value="ip">IP</option>
                    <option value="user_id">User ID</option>
                </select>
                <input id="blReason" placeholder="Reason" style="width:180px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 12px; color:#fff; font-family:inherit;">
                <input id="blDays" type="number" min="1" placeholder="Days (∞)" style="width:100px; background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:6px; padding:8px 12px; color:#fff; font-family:inherit;">
                <button class="btn btn-primary" onclick="addBlacklist()">Ban</button>
            </div>
            ${blacklist.length === 0 ? '<div class="empty-state"><p>Blacklist is empty.</p></div>' : `
            <table class="data-table">
                <thead><tr><th>Identifier</th><th>Type</th><th>Reason</th><th>Expires</th><th></th></tr></thead>
                <tbody>
                ${blacklist.map(b => `
                    <tr>
                        <td class="mono">${escapeHtml(b.identifier)}</td>
                        <td>${escapeHtml(b.type)}</td>
                        <td>${escapeHtml(b.reason || '')}</td>
                        <td>${b.ban_expire ? new Date(b.ban_expire).toLocaleDateString() : '<span style="color:#f87171;">Permanent</span>'}</td>
                        <td><button class="btn-sm btn-danger-sm" onclick="removeBlacklist('${b.id}')">Unban</button></td>
                    </tr>
                `).join('')}
                </tbody>
            </table>`}
        `;
    } catch (err) {
        c.innerHTML = `<div style="color:#f87171;">${escapeHtml(err.message)}</div>`;
    }
}

async function addBlacklist() {
    const identifier = document.getElementById('blIdent').value.trim();
    const type = document.getElementById('blType').value;
    const reason = document.getElementById('blReason').value.trim();
    const days = document.getElementById('blDays').value;
    if (!identifier) return showToast('Identifier required', 'error');
    try {
        await api('/api/projects/' + currentProject.id + '/blacklist', {
            method: 'POST',
            body: JSON.stringify({ identifier, type, reason, ban_days: days ? Number(days) : null })
        });
        showToast('Added to blacklist', 'success');
        switchTab('blacklist');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

async function removeBlacklist(id) {
    if (!confirm('Unban this entry?')) return;
    try {
        await api(`/api/projects/${currentProject.id}/blacklist/${id}`, { method: 'DELETE' });
        showToast('Unbanned', 'success');
        switchTab('blacklist');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ---------- LOGS ----------
async function renderLogsTab(c) {
    try {
        const { logs } = await api('/api/projects/' + currentProject.id + '/logs?per_page=100');
        c.innerHTML = `
            <div style="color:#a0a0b8; font-size:13px; margin-bottom:12px;">
                Showing latest ${logs.length} events
            </div>
            ${logs.length === 0 ? '<div class="empty-state"><p>No logs yet.</p></div>' : `
            <table class="data-table">
                <thead><tr>
                    <th>Time</th><th>Event</th><th>Status</th><th>Message</th><th>IP</th><th>HWID</th>
                </tr></thead>
                <tbody>
                ${logs.map(l => `
                    <tr>
                        <td>${new Date(l.created_at).toLocaleString()}</td>
                        <td class="mono">${escapeHtml(l.event_type)}</td>
                        <td>${statusPill(l.status)}</td>
                        <td>${escapeHtml(l.message || '')}</td>
                        <td class="mono">${escapeHtml(l.ip || '')}</td>
                        <td class="mono" title="${escapeHtml(l.hwid || '')}">${l.hwid ? escapeHtml(l.hwid.slice(0, 10) + '…') : ''}</td>
                    </tr>
                `).join('')}
                </tbody>
            </table>`}
        `;
    } catch (err) {
        c.innerHTML = `<div style="color:#f87171;">${escapeHtml(err.message)}</div>`;
    }
}

// ---------- SETTINGS ----------
function renderSettingsTab(c) {
    const s = currentProject.settings || {};
    c.innerHTML = `
        <div style="max-width:600px;">
            <div class="form-group">
                <label>Whitelist mode</label>
                <select id="setWlMode">
                    <option value="open" ${s.whitelist_mode !== 'strict' ? 'selected' : ''}>Open — anyone with a valid key</option>
                    <option value="strict" ${s.whitelist_mode === 'strict' ? 'selected' : ''}>Strict — only whitelisted identifiers</option>
                </select>
            </div>
            <div class="form-group">
                <label>Discord webhook URL (for log forwarding)</label>
                <input id="setWebhook" type="text" placeholder="https://discord.com/api/webhooks/…" value="${escapeAttr(s.webhook_url || '')}">
            </div>
            <div class="form-group">
                <label>HWID reset cooldown (hours, 0 = disabled)</label>
                <input id="setCooldown" type="number" min="0" value="${s.hwid_reset_cooldown_hours ?? 0}">
            </div>
            <div class="form-group">
                <label>Max executions per key (0 = unlimited)</label>
                <input id="setMaxExec" type="number" min="0" value="${s.max_executions ?? 0}">
            </div>
            <button class="btn btn-primary" onclick="saveSettings()">Save settings</button>
        </div>
    `;
}

async function saveSettings() {
    const settings = {
        whitelist_mode: document.getElementById('setWlMode').value,
        webhook_url: document.getElementById('setWebhook').value.trim(),
        hwid_reset_cooldown_hours: Number(document.getElementById('setCooldown').value) || 0,
        max_executions: Number(document.getElementById('setMaxExec').value) || 0
    };
    try {
        const { project } = await api('/api/projects/' + currentProject.id, {
            method: 'PATCH', body: JSON.stringify({ settings })
        });
        currentProject = project;
        showToast('Settings saved', 'success');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}

// ---------- Helpers ----------
function statBox(label, value) {
    return `<div class="stat-box"><div class="stat-label">${label}</div><div class="stat-value">${value}</div></div>`;
}

function statusPill(status) {
    const map = {
        active: 'badge-active', success: 'badge-active',
        disabled: 'badge-disabled', failed: 'badge-disabled',
        revoked: 'badge-disabled', expired: 'badge-archived',
        warning: 'badge-archived', info: 'badge-archived'
    };
    return `<span class="badge-status ${map[status] || 'badge-archived'}">${escapeHtml(status || 'unknown')}</span>`;
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, ' '); }

async function copyText(t) {
    try {
        await navigator.clipboard.writeText(t);
        showToast('Copied to clipboard', 'success');
    } catch { showToast('Copy failed', 'error'); }
}

function showToast(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    if (!c) return alert(msg);
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.textContent = msg;
    t.style.cssText = `
        background:#14141f; border:1px solid rgba(255,255,255,0.1);
        border-left:3px solid ${type === 'success' ? '#4ade80' : type === 'error' ? '#f87171' : '#7c3aed'};
        color:#fff; padding:12px 16px; border-radius:8px;
        margin-bottom:8px; font-size:14px; max-width:360px;
        animation:slideIn 0.3s ease;
    `;
    c.appendChild(t);
    setTimeout(() => {
        t.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => t.remove(), 300);
    }, 3500);
}
