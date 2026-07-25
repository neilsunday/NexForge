/* ========================================
   NexaKS — Projects Page (Luarmor-style, Phase 2)
   ======================================== */

let currentUser = null;
let projectsCache = [];
let currentProject = null;   // project open in settings modal
let currentTab = 'overview';
let searchDebounce = null;
let searchTerm = '';

// ---------- Boot ----------
document.addEventListener('DOMContentLoaded', async () => {
    const loader = document.getElementById('authLoader');
    const main = document.getElementById('projectsMain');
    const forceShow = setTimeout(() => { if (loader) loader.style.display='none'; if (main) main.style.display='grid'; }, 6000);

    try {
        currentUser = await NexaKS.getCurrentUser();
        if (!currentUser) {
            clearTimeout(forceShow);
            if (loader) loader.innerHTML =
                '<div style="text-align:center;color:white;padding:40px;"><h2>Not signed in</h2>' +
                '<p style="color:#a0a0b0;margin:16px 0;">Please <a href="/" style="color:#8b5cf6;">go back</a> and sign in with Discord.</p></div>';
            return;
        }
        document.getElementById('signOutBtn')?.addEventListener('click', async (e) => {
            e.preventDefault(); await NexaKS.signOut(); window.location.href='/';
        });
        await loadProjects();
    } catch (err) {
        console.error('init', err); showToast('Failed to load', 'error');
    } finally {
        clearTimeout(forceShow);
        if (loader) loader.style.display='none';
        if (main) main.style.display='grid';
    }
});

// ---------- API helper ----------
async function api(path, opts = {}) {
    const session = await NexaKS.supabase.auth.getSession();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error('No auth token');
    const res = await fetch(path, {
        ...opts,
        headers: { 'Content-Type':'application/json', 'Authorization':'Bearer '+token, ...(opts.headers||{}) }
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || res.statusText);
    return body;
}

// ---------- Load + render projects ----------
async function loadProjects() {
    const list = document.getElementById('projectsList');
    const empty = document.getElementById('emptyState');
    list.innerHTML = '<div style="color:#a0a0b8;padding:20px;">Loading…</div>';
    empty.style.display = 'none';

    try {
        const qs = new URLSearchParams({ per_page: 50, search: searchTerm });
        const data = await api('/api/projects?' + qs.toString());
        projectsCache = data.projects || [];

        if (!projectsCache.length) {
            list.innerHTML = '';
            empty.style.display = 'block';
            renderStats(0, 0);
            return;
        }

        // fetch scripts for each project in parallel
        const withScripts = await Promise.all(projectsCache.map(async (p) => {
            try {
                const s = await api('/api/projects/' + p.id + '/scripts');
                return { ...p, scripts: s.scripts || [] };
            } catch { return { ...p, scripts: [] }; }
        }));
        projectsCache = withScripts;

        const totalScripts = withScripts.reduce((n, p) => n + p.scripts.length, 0);
        renderStats(withScripts.length, totalScripts);
        list.innerHTML = withScripts.map(renderProjectCard).join('');
    } catch (err) {
        list.innerHTML = '<div style="color:#f87171;padding:20px;">Error: ' + escapeHtml(err.message) + '</div>';
    }
}

function renderStats(projectCount, scriptCount) {
    document.getElementById('statsRow').innerHTML = `
        <div class="stat-card">
            <div class="stat-icon green">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M9 12h6M9 16h6M9 8h2M6 2h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </div>
            <div class="stat-body">
                <div class="label">Total Scripts</div>
                <div class="value">${scriptCount}</div>
                <div class="stat-bar"><span style="width:100%"></span></div>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-icon purple">
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none"><rect x="5" y="11" width="14" height="10" rx="2" stroke="#fff" stroke-width="1.6"/><path d="M8 11V8a4 4 0 018 0v3" stroke="#fff" stroke-width="1.6"/></svg>
            </div>
            <div class="stat-body">
                <div class="label">Total Projects</div>
                <div class="value">${projectCount}</div>
                <div class="stat-bar"><span style="width:100%"></span></div>
            </div>
        </div>`;
}

function renderProjectCard(p) {
    const scriptsHtml = p.scripts.length
        ? `<table class="scripts-table">
            <thead><tr>
                <th style="width:40px;"></th><th>Script Name</th><th>Status</th>
                <th>Version</th><th>Last Edit</th><th style="text-align:right;">Actions</th>
            </tr></thead>
            <tbody>
            ${p.scripts.map(s => renderScriptRow(p, s)).join('')}
            </tbody></table>`
        : `<div class="project-empty">No scripts yet — click <strong>Add Script</strong> to create one.</div>`;

    return `
    <div class="project-card">
        <div class="project-head">
            <div class="project-logo">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M4 6l8-4 8 4v12l-8 4-8-4V6z" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>
            </div>
            <div class="project-meta">
                <div class="project-name">${escapeHtml(p.name)}</div>
                <div class="project-id">${escapeHtml(p.id)}</div>
            </div>
            <div class="project-actions">
                <button class="btn-mini btn-edit" onclick="openScriptModal('${p.id}')">＋ Add Script</button>
                <button class="btn-sm" title="Settings" onclick="openSettings('${p.id}')">⚙</button>
            </div>
        </div>
        ${scriptsHtml}
    </div>`;
}

function renderScriptRow(p, s) {
    const statusClass = s.status === 'active' ? 'status-active' : s.status === 'disabled' ? 'status-disabled' : 'status-free';
    const statusLabel = (s.status || 'free').toUpperCase();
    const lastEdit = s.last_edit ? new Date(s.last_edit).toLocaleString() : '—';
    const lock = s.obfuscated ? ' 🔒' : '';
    return `
    <tr>
        <td>
            <label class="switch">
                <input type="checkbox" ${s.enabled ? 'checked' : ''} onchange="toggleScript('${p.id}','${s.id}',this.checked)">
                <span class="slider"></span>
            </label>
        </td>
        <td>
            <div class="script-name-cell">
                <div class="lua-badge">LUA</div>
                <div>
                    <div class="script-name">${escapeHtml(s.name)}${lock}</div>
                    <div class="script-id">${escapeHtml(s.id)}</div>
                </div>
            </div>
        </td>
        <td><span class="status-badge ${statusClass}">${statusLabel}</span></td>
        <td style="color:#d1d5db;">v${escapeHtml(s.version || '0.0.0.0')} ${s.published_version_id ? '<span class="status-badge status-active">PUBLISHED</span>' : '<span class="status-badge status-free">DRAFT</span>'}</td>
        <td style="color:#a0a0b8; font-size:12px;">${lastEdit}</td>
        <td>
            <div class="table-actions">
                <button class="btn-mini btn-loader" onclick="showLoader('${p.id}','${s.id}')" ${s.published_version_id ? '' : 'disabled title="Publish first"'}>⬇ Loader</button>
                <button class="btn-mini btn-edit" onclick="openScriptModal('${p.id}','${s.id}')">✎ Draft</button>
                <button class="btn-mini btn-edit" onclick="publishScript('${p.id}','${s.id}')">▲ Publish</button>
                <button class="btn-mini btn-loader" onclick="showVersionHistory('${p.id}','${s.id}')">History</button>
                <button class="btn-mini btn-del" onclick="deleteScript('${p.id}','${s.id}')">🗑 Delete</button>
            </div>
        </td>
    </tr>`;
}

// ---------- Search ----------
function onSearchInput() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        searchTerm = document.getElementById('searchInput').value.trim();
        loadProjects();
    }, 300);
}

// ---------- Project create/edit ----------
function openProjectModal(id) {
    const p = id ? projectsCache.find(x => x.id === id) : null;
    document.getElementById('pmTitle').textContent = p ? 'Edit Project' : 'Create Project';
    document.getElementById('pmSubmit').textContent = p ? 'Save' : 'Create';
    document.getElementById('pmId').value = p ? p.id : '';
    document.getElementById('pmName').value = p ? p.name : '';
    document.getElementById('pmDesc').value = p ? (p.description || '') : '';
    document.getElementById('pmVersion').value = p ? (p.version || '1.0.0') : '1.0.0';
    document.getElementById('pmStatus').value = p ? (p.status || 'active') : 'active';
    document.getElementById('projectModal').classList.add('show');
}

async function submitProject(e) {
    e.preventDefault();
    const id = document.getElementById('pmId').value;
    const payload = {
        name: document.getElementById('pmName').value.trim(),
        description: document.getElementById('pmDesc').value.trim(),
        version: document.getElementById('pmVersion').value.trim(),
        status: document.getElementById('pmStatus').value
    };
    try {
        if (id) { await api('/api/projects/' + id, { method:'PATCH', body:JSON.stringify(payload) }); showToast('Project updated','success'); }
        else { await api('/api/projects', { method:'POST', body:JSON.stringify(payload) }); showToast('Project created','success'); }
        closeModal('projectModal');
        loadProjects();
    } catch (err) { showToast('Error: '+err.message,'error'); }
}

async function deleteCurrentProject() {
    if (!currentProject) return;
    if (!confirm(`Delete "${currentProject.name}"? This removes all its scripts, keys, whitelist, blacklist and logs. Cannot be undone.`)) return;
    try {
        await api('/api/projects/' + currentProject.id, { method:'DELETE' });
        showToast('Project deleted','success');
        closeModal('settingsModal');
        loadProjects();
    } catch (err) { showToast('Error: '+err.message,'error'); }
}

// ---------- Script create/edit ----------
function openScriptModal(projectId, scriptId) {
    const p = projectsCache.find(x => x.id === projectId);
    const s = scriptId ? p?.scripts.find(x => x.id === scriptId) : null;
    document.getElementById('smTitle').textContent = s ? 'Edit Script' : 'Add Script';
    document.getElementById('smSub').textContent = 'Project: ' + (p ? p.name : '');
    document.getElementById('smSubmit').textContent = s ? 'Save' : 'Add Script';
    document.getElementById('smProjectId').value = projectId;
    document.getElementById('smId').value = s ? s.id : '';
    document.getElementById('smName').value = s ? s.name : '';
    document.getElementById('smVersion').value = s ? (s.version || '0.0.0.0') : '0.0.0.0';
    document.getElementById('smStatus').value = s ? (s.status || 'free') : 'free';
    document.getElementById('smObf').value = s && s.obfuscated ? 'true' : 'false';
    document.getElementById('smContent').value = s ? (s.script_content || '') : '';
    document.getElementById('scriptModal').classList.add('show');
}

async function submitScript(e) {
    e.preventDefault();
    const projectId = document.getElementById('smProjectId').value;
    const id = document.getElementById('smId').value;
    const payload = {
        name: document.getElementById('smName').value.trim(),
        version: document.getElementById('smVersion').value.trim(),
        status: document.getElementById('smStatus').value,
        obfuscated: document.getElementById('smObf').value === 'true',
        script_content: document.getElementById('smContent').value
    };
    try {
        if (id) { await api(`/api/projects/${projectId}/scripts/${id}`, { method:'PATCH', body:JSON.stringify(payload) }); showToast('Script updated','success'); }
        else { await api(`/api/projects/${projectId}/scripts`, { method:'POST', body:JSON.stringify(payload) }); showToast('Script added','success'); }
        closeModal('scriptModal');
        loadProjects();
    } catch (err) { showToast('Error: '+err.message,'error'); }
}

async function toggleScript(projectId, scriptId, enabled) {
    try {
        await api(`/api/projects/${projectId}/scripts/${scriptId}/toggle`, { method:'POST', body:JSON.stringify({ enabled }) });
        const p = projectsCache.find(x => x.id === projectId);
        const s = p?.scripts.find(x => x.id === scriptId);
        if (s) s.enabled = enabled;
        showToast(enabled ? 'Script enabled' : 'Script disabled','success');
    } catch (err) { showToast('Error: '+err.message,'error'); loadProjects(); }
}

async function deleteScript(projectId, scriptId) {
    if (!confirm('Delete this script? Cannot be undone.')) return;
    try {
        await api(`/api/projects/${projectId}/scripts/${scriptId}`, { method:'DELETE' });
        showToast('Script deleted','success');
        loadProjects();
    } catch (err) { showToast('Error: '+err.message,'error'); }
}

async function publishScript(projectId, scriptId) {
    const notes = prompt('Publish notes (optional):', '') || '';
    try {
        await api(`/api/projects/${projectId}/scripts/${scriptId}/publish`, {
            method:'POST', body:JSON.stringify({ notes })
        });
        showToast('Draft published','success');
        await loadProjects();
    } catch (err) { showToast('Publish failed: '+err.message,'error'); }
}

async function showVersionHistory(projectId, scriptId) {
    const p = projectsCache.find(x => x.id === projectId);
    const s = p?.scripts.find(x => x.id === scriptId);
    if (!p || !s) return;
    try {
        const data = await api(`/api/projects/${projectId}/scripts/${scriptId}/versions`);
        currentProject = p;
        document.getElementById('setTitle').textContent = 'Version History — ' + s.name;
        document.getElementById('setTabs').style.display = 'none';
        const rows = (data.versions || []).map(v => {
            const current = v.id === data.published_version_id;
            return `<tr>
                <td>v${escapeHtml(v.version)}</td>
                <td>${current ? '<span class="status-badge status-active">LIVE</span>' : escapeHtml(v.state)}</td>
                <td>${escapeHtml(v.publish_notes || '')}</td>
                <td>${new Date(v.published_at).toLocaleString()}</td>
                <td>${current ? '' : `<button class="btn-sm" onclick="rollbackScript('${projectId}','${scriptId}','${v.id}')">Rollback</button>`}</td>
            </tr>`;
        }).join('');
        document.getElementById('setContent').innerHTML = rows
            ? `<table class="data-table"><thead><tr><th>Version</th><th>State</th><th>Notes</th><th>Published</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="empty-mini">No published versions yet.</div>';
        document.getElementById('settingsModal').classList.add('show');
    } catch (err) { showToast('History failed: '+err.message,'error'); }
}

async function rollbackScript(projectId, scriptId, versionId) {
    if (!confirm('Make this version live again? Draft content will not be changed.')) return;
    try {
        await api(`/api/projects/${projectId}/scripts/${scriptId}/rollback/${versionId}`, { method:'POST' });
        showToast('Rollback complete','success');
        await loadProjects();
        await showVersionHistory(projectId, scriptId);
    } catch (err) { showToast('Rollback failed: '+err.message,'error'); }
}

// ---------- Loader snippet ----------
// ---------- Loader snippet ----------
function showLoader(projectId, scriptId) {
    const p = projectsCache.find(x => x.id === projectId);
    const s = p?.scripts.find(x => x.id === scriptId);

    if (!p || !s) {
        showToast('Project or script not found', 'error');
        return;
    }

    const origin = window.location.origin;
    const verifyBase = origin + '/api/verify';
    const statusBase = origin + '/api/status';

    // These values are inserted as fixed URL components.
    const projectKey = encodeURIComponent(String(p.api_key));
    const scriptKey = encodeURIComponent(String(s.id));

    const loader =
`-- NexForge authorized loader - ${p.name} / ${s.name}
local license = "PASTE_KEY_HERE"
local hwid = game:GetService("RbxAnalyticsService"):GetClientId()

local function encode(value)
    return (tostring(value):gsub("([^%w%-_%.~])", function(char)
        return string.format("%%%02X", string.byte(char))
    end))
end

local url = "${verifyBase}?project=${projectKey}&script=${scriptKey}&license="
    .. encode(license)
    .. "&hwid="
    .. encode(hwid)

local requestOk, response = pcall(function()
    return game:HttpGet(url, true)
end)

if not requestOk then
    error("NexForge: Unable to reach the licensing service")
end

if type(response) ~= "string" or response == "" then
    error("NexForge: Empty server response")
end

local chunk, compileError = loadstring(response)

if not chunk then
    error("NexForge: Invalid server response: " .. tostring(compileError))
end

local runOk, runError = pcall(chunk)

if not runOk then
    error(tostring(runError))
end`;

    const statusUrl =
        statusBase +
        '?project=' + projectKey +
        '&script=' + scriptKey +
        '&license=PASTE_KEY_HERE' +
        '&hwid=PASTE_HWID_HERE';

    currentProject = p;

    document.getElementById('setTitle').textContent =
        'Loader - ' + s.name;

    document.getElementById('setTabs').style.display = 'none';

    document.getElementById('setContent').innerHTML = `
        <p class="sub">
            Use this loader only for authorized users.
            Replace <strong>PASTE_KEY_HERE</strong> with the user's license key.
        </p>

        <div class="code-block">${escapeHtml(loader)}</div>

        <button
            class="btn-sm"
            style="margin-top:10px;"
            id="copyLoaderBtn">
            Copy loader
        </button>

        <h3 style="color:#fff;margin:18px 0 8px;font-size:14px;">
            Status endpoint - no source returned
        </h3>

        <div class="code-block">${escapeHtml(statusUrl)}</div>

        <button
            class="btn-sm"
            style="margin-top:10px;"
            id="copyStatusUrlBtn">
            Copy status URL
        </button>
    `;

    // Avoid putting generated text inside inline onclick attributes.
    document.getElementById('copyLoaderBtn')
        ?.addEventListener('click', () => copyText(loader));

    document.getElementById('copyStatusUrlBtn')
        ?.addEventListener('click', () => copyText(statusUrl));

    document.getElementById('settingsModal').classList.add('show');
}


// ---------- Project settings modal (tabs) ----------
async function openSettings(projectId) {
    try {
        const { project } = await api('/api/projects/' + projectId);
        currentProject = project;
        document.getElementById('setTitle').textContent = 'Project — ' + project.name;
        document.getElementById('setTabs').style.display = 'flex';
        document.getElementById('settingsModal').classList.add('show');
        switchTab('overview');
    } catch (err) { showToast('Failed to open settings','error'); }
}

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('#setTabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const c = document.getElementById('setContent');
    c.innerHTML = '<div style="color:#a0a0b8;padding:20px;">Loading…</div>';
    if (tab==='overview') overviewTab(c);
    else if (tab==='keys') keysTab(c);
    else if (tab==='whitelist') whitelistTab(c);
    else if (tab==='blacklist') blacklistTab(c);
    else if (tab==='logs') logsTab(c);
    else if (tab==='config') configTab(c);
}

async function overviewTab(c) {
    try {
        const { analytics:a } = await api('/api/projects/' + currentProject.id + '/analytics');
        c.innerHTML = `
            <div class="mini-stat-grid">
                ${mini('Scripts', a.total_scripts ?? 0)}
                ${mini('Active Scripts', a.active_scripts ?? 0)}
                ${mini('Total Keys', a.total_keys ?? 0)}
                ${mini('Active Keys', a.active_keys ?? 0)}
                ${mini('Executions', a.total_executions ?? 0)}
                ${mini('Exec (24h)', a.executions_24h ?? 0)}
                ${mini('Whitelist', a.whitelist_count ?? 0)}
                ${mini('Blacklist', a.blacklist_count ?? 0)}
            </div>
            <h3 style="color:#fff; margin:8px 0 8px; font-size:15px;">Project API Key</h3>
            <div class="code-block">${escapeHtml(currentProject.api_key)}</div>
            <button class="btn-sm" style="margin-top:8px;" onclick="regenApiKey()">Regenerate API Key</button>`;
    } catch (err) { c.innerHTML = `<div style="color:#f87171;">${escapeHtml(err.message)}</div>`; }
}

async function regenApiKey() {
    if (!confirm('Regenerate API key? Existing loaders stop working until updated.')) return;
    try {
        const { project } = await api('/api/projects/' + currentProject.id + '/regenerate-key', { method:'POST' });
        currentProject = project; showToast('API key regenerated','success'); switchTab('overview'); loadProjects();
    } catch (err) { showToast('Error: '+err.message,'error'); }
}

async function keysTab(c) {
    try {
        const { keys } = await api('/api/projects/' + currentProject.id + '/keys?per_page=100');
        c.innerHTML = `
            <div class="row-inline">
                <button class="btn btn-primary btn-sm" onclick="genKey()">＋ Generate Key</button>
                <span style="color:#a0a0b8; font-size:13px;">${keys.length} key(s)</span>
            </div>
            ${keys.length ? `<table class="data-table"><thead><tr><th>Key</th><th>Status</th><th>HWID</th><th>Exec</th><th>Expires</th><th></th></tr></thead><tbody>
            ${keys.map(k => `<tr>
                <td class="mono">${escapeHtml(k.key)}</td>
                <td>${escapeHtml(k.status)}</td>
                <td class="mono">${k.hwid ? escapeHtml(k.hwid.slice(0,10)+'…') : '<span style="color:#6b7280;">unbound</span>'}</td>
                <td>${k.execution_count||0}</td>
                <td>${k.expires_at ? new Date(k.expires_at).toLocaleDateString() : 'Never'}</td>
                <td><button class="btn-sm" onclick="resetKeyHwid('${k.id}')">Reset HWID</button> <button class="btn-sm btn-danger-sm" onclick="revokeKey('${k.id}')">Revoke</button></td>
            </tr>`).join('')}</tbody></table>` : '<div class="empty-mini">No keys yet.</div>'}`;
    } catch (err) { c.innerHTML = `<div style="color:#f87171;">${escapeHtml(err.message)}</div>`; }
}
async function genKey() {
    const days = prompt('Expiry in days (blank = lifetime):', '');
    try { await api('/api/projects/'+currentProject.id+'/keys', { method:'POST', body:JSON.stringify({ expires_days: days?Number(days):null }) }); showToast('Key generated','success'); switchTab('keys'); }
    catch (err) { showToast('Error: '+err.message,'error'); }
}
async function revokeKey(id) { if(!confirm('Revoke this key?'))return; try{ await api(`/api/projects/${currentProject.id}/keys/${id}`,{method:'DELETE'}); showToast('Revoked','success'); switchTab('keys'); }catch(e){ showToast('Error: '+e.message,'error'); } }
async function resetKeyHwid(id) { if(!confirm('Reset HWID?'))return; try{ await api(`/api/projects/${currentProject.id}/keys/${id}/reset-hwid`,{method:'POST'}); showToast('HWID reset','success'); switchTab('keys'); }catch(e){ showToast('Error: '+e.message,'error'); } }

async function whitelistTab(c) {
    try {
        const { whitelist } = await api('/api/projects/' + currentProject.id + '/whitelist');
        c.innerHTML = `
            <div class="row-inline">
                <input id="wlIdent" placeholder="Identifier" style="flex:1; min-width:160px;">
                <select id="wlType"><option value="discord_id">Discord ID</option><option value="hwid">HWID</option><option value="key">Key</option><option value="user_id">User ID</option></select>
                <input id="wlNote" placeholder="Note" style="width:140px;">
                <button class="btn btn-primary btn-sm" onclick="addWl()">Add</button>
            </div>
            ${whitelist.length ? `<table class="data-table"><thead><tr><th>Identifier</th><th>Type</th><th>Note</th><th></th></tr></thead><tbody>
            ${whitelist.map(w => `<tr><td class="mono">${escapeHtml(w.identifier)}</td><td>${escapeHtml(w.type)}</td><td>${escapeHtml(w.note||'')}</td><td><button class="btn-sm btn-danger-sm" onclick="rmWl('${w.id}')">Remove</button></td></tr>`).join('')}
            </tbody></table>` : '<div class="empty-mini">Whitelist is empty.</div>'}`;
    } catch (err) { c.innerHTML = `<div style="color:#f87171;">${escapeHtml(err.message)}</div>`; }
}
async function addWl() {
    const identifier = document.getElementById('wlIdent').value.trim();
    const type = document.getElementById('wlType').value;
    const note = document.getElementById('wlNote').value.trim();
    if (!identifier) return showToast('Identifier required','error');
    try { await api('/api/projects/'+currentProject.id+'/whitelist',{method:'POST',body:JSON.stringify({identifier,type,note})}); showToast('Added','success'); switchTab('whitelist'); }
    catch (err) { showToast('Error: '+err.message,'error'); }
}
async function rmWl(id) { if(!confirm('Remove?'))return; try{ await api(`/api/projects/${currentProject.id}/whitelist/${id}`,{method:'DELETE'}); showToast('Removed','success'); switchTab('whitelist'); }catch(e){ showToast('Error: '+e.message,'error'); } }

async function blacklistTab(c) {
    try {
        const { blacklist } = await api('/api/projects/' + currentProject.id + '/blacklist');
        c.innerHTML = `
            <div class="row-inline">
                <input id="blIdent" placeholder="Identifier" style="flex:1; min-width:140px;">
                <select id="blType"><option value="discord_id">Discord ID</option><option value="hwid">HWID</option><option value="key">Key</option><option value="ip">IP</option><option value="user_id">User ID</option></select>
                <input id="blReason" placeholder="Reason" style="width:130px;">
                <input id="blDays" type="number" min="1" placeholder="Days ∞" style="width:80px;">
                <button class="btn btn-primary btn-sm" onclick="addBl()">Ban</button>
            </div>
            ${blacklist.length ? `<table class="data-table"><thead><tr><th>Identifier</th><th>Type</th><th>Reason</th><th>Expires</th><th></th></tr></thead><tbody>
            ${blacklist.map(b => `<tr><td class="mono">${escapeHtml(b.identifier)}</td><td>${escapeHtml(b.type)}</td><td>${escapeHtml(b.reason||'')}</td><td>${b.ban_expire ? new Date(b.ban_expire).toLocaleDateString() : '<span style="color:#f87171;">Permanent</span>'}</td><td><button class="btn-sm btn-danger-sm" onclick="rmBl('${b.id}')">Unban</button></td></tr>`).join('')}
            </tbody></table>` : '<div class="empty-mini">Blacklist is empty.</div>'}`;
    } catch (err) { c.innerHTML = `<div style="color:#f87171;">${escapeHtml(err.message)}</div>`; }
}
async function addBl() {
    const identifier = document.getElementById('blIdent').value.trim();
    const type = document.getElementById('blType').value;
    const reason = document.getElementById('blReason').value.trim();
    const days = document.getElementById('blDays').value;
    if (!identifier) return showToast('Identifier required','error');
    try { await api('/api/projects/'+currentProject.id+'/blacklist',{method:'POST',body:JSON.stringify({identifier,type,reason,ban_days:days?Number(days):null})}); showToast('Banned','success'); switchTab('blacklist'); }
    catch (err) { showToast('Error: '+err.message,'error'); }
}
async function rmBl(id) { if(!confirm('Unban?'))return; try{ await api(`/api/projects/${currentProject.id}/blacklist/${id}`,{method:'DELETE'}); showToast('Unbanned','success'); switchTab('blacklist'); }catch(e){ showToast('Error: '+e.message,'error'); } }

async function logsTab(c) {
    try {
        const { logs } = await api('/api/projects/' + currentProject.id + '/logs?per_page=100');
        c.innerHTML = logs.length
            ? `<table class="data-table"><thead><tr><th>Time</th><th>Event</th><th>Status</th><th>Message</th><th>IP</th></tr></thead><tbody>
               ${logs.map(l => `<tr><td>${new Date(l.created_at).toLocaleString()}</td><td class="mono">${escapeHtml(l.event_type)}</td><td>${escapeHtml(l.status)}</td><td>${escapeHtml(l.message||'')}</td><td class="mono">${escapeHtml(l.ip||'')}</td></tr>`).join('')}
               </tbody></table>`
            : '<div class="empty-mini">No logs yet.</div>';
    } catch (err) { c.innerHTML = `<div style="color:#f87171;">${escapeHtml(err.message)}</div>`; }
}

function configTab(c) {
    const s = currentProject.settings || {};
    c.innerHTML = `
        <div class="form-group"><label>Whitelist mode</label>
            <select id="cfgWl"><option value="open" ${s.whitelist_mode!=='strict'?'selected':''}>Open — any valid key</option><option value="strict" ${s.whitelist_mode==='strict'?'selected':''}>Strict — whitelisted only</option></select></div>
        <div class="form-group"><label>Discord webhook URL</label><input id="cfgWebhook" value="${escapeAttr(s.webhook_url||'')}" placeholder="https://discord.com/api/webhooks/…"></div>
        <div class="form-group"><label>HWID reset cooldown (hours)</label><input id="cfgCooldown" type="number" min="0" value="${s.hwid_reset_cooldown_hours??0}"></div>
        <button class="btn btn-primary btn-sm" onclick="saveConfig()">Save settings</button>
        <div style="margin-top:16px; padding-top:16px; border-top:1px solid rgba(255,255,255,0.08);">
            <button class="btn-sm" onclick="openProjectModal('${currentProject.id}')">Edit name / version</button>
        </div>`;
}
async function saveConfig() {
    const settings = {
        whitelist_mode: document.getElementById('cfgWl').value,
        webhook_url: document.getElementById('cfgWebhook').value.trim(),
        hwid_reset_cooldown_hours: Number(document.getElementById('cfgCooldown').value)||0
    };
    try { const { project } = await api('/api/projects/'+currentProject.id, { method:'PATCH', body:JSON.stringify({ settings }) }); currentProject = project; showToast('Settings saved','success'); }
    catch (err) { showToast('Error: '+err.message,'error'); }
}

// ---------- Helpers ----------
function mini(l, v) { return `<div class="mini-stat"><div class="l">${l}</div><div class="v">${v}</div></div>`; }
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function escapeHtml(s) { if (s==null) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escapeAttr(s) { return escapeHtml(s).replace(/\n/g,' '); }
async function copyText(t) { try { await navigator.clipboard.writeText(t); showToast('Copied','success'); } catch { showToast('Copy failed','error'); } }
function showToast(msg, type='info') {
    const c = document.getElementById('toastContainer'); if (!c) return alert(msg);
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `background:#14141f; border:1px solid rgba(255,255,255,0.1); border-left:3px solid ${type==='success'?'#4ade80':type==='error'?'#f87171':'#7c3aed'}; color:#fff; padding:12px 16px; border-radius:8px; margin-bottom:8px; font-size:14px; max-width:360px; animation:slideIn 0.3s ease;`;
    c.appendChild(t);
    setTimeout(() => { t.style.animation='slideIn 0.3s ease reverse'; setTimeout(()=>t.remove(),300); }, 3500);
}

// close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('show');
});
