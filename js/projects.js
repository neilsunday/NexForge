/* NexaKS - Projects Feature (client-side, mirrors dashboard.js patterns) */

let projUser = null;
let projProfile = null;
let projects = [];
let activeProject = null;
let projScripts = [];

// Bumped every time openProject() is called so a stale in-flight fetch
// from a previously-opened project can't overwrite the current view.
let openProjectRequestId = 0;

document.addEventListener('DOMContentLoaded', async () => {
    const loader = document.getElementById('authLoader');
    const main = document.getElementById('projectsMain');

    const forceShow = setTimeout(() => {
        if (loader) loader.style.display = 'none';
        if (main) main.style.display = 'grid';
    }, 6000);

    try {
        projUser = await NexaKS.getCurrentUser();
        if (!projUser) {
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

        projProfile = await NexaKS.getUserProfile(projUser.id);
        renderProjUser();
        await loadProjects();
    } catch (err) {
        console.error('Projects init:', err);
    } finally {
        clearTimeout(forceShow);
        if (loader) loader.style.display = 'none';
        if (main) main.style.display = 'grid';
    }
});

function renderProjUser() {
    const meta = projUser.user_metadata || {};
    const username = projProfile?.username || meta.full_name || meta.name || meta.user_name || 'User';
    const avatarUrl = projProfile?.avatar_url || meta.avatar_url;
    const $ = (id) => document.getElementById(id);
    if ($('userNameSmall')) $('userNameSmall').textContent = username;
    if (avatarUrl && $('userAvatarImg')) {
        $('userAvatarImg').src = avatarUrl;
        $('userAvatarImg').style.display = 'block';
        if ($('userAvatar')) $('userAvatar').style.display = 'none';
    } else if ($('userAvatar')) {
        $('userAvatar').textContent = username.charAt(0).toUpperCase();
    }
    if (projProfile?.is_admin && $('adminLink')) {
        $('adminLink').style.display = 'flex';
        $('adminLink').href = 'admin.html';
    }
}

// ---------- Projects list ----------
async function loadProjects() {
    const { data, error } = await NexaKS.supabase
        .from('projects').select('*')
        .eq('owner_id', projUser.id)
        .order('created_at', { ascending: false });

    if (error) { console.error('Load projects:', error); showToast('Failed to load projects', 'error'); return; }
    projects = data || [];
    renderProjectsList();
}

function renderProjectsList() {
    const grid = document.getElementById('projectsGrid');
    const empty = document.getElementById('projectsEmpty');
    if (!grid) return;

    if (projects.length === 0) {
        grid.innerHTML = '';
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';

    grid.innerHTML = '';
    for (const p of projects) {
        const statusCls = p.status === 'active' ? 'badge-success' : p.status === 'paused' ? 'badge-warning' : 'badge';
        const card = document.createElement('div');
        card.className = 'card project-card';
        card.style.cursor = 'pointer';
        card.dataset.projectId = p.id;
        card.innerHTML = `
            <div class="card-header">
                <div>
                    <div class="card-title">${escapeHtml(p.name)}</div>
                    <div class="card-desc">${escapeHtml(p.description || 'No description')}</div>
                </div>
                <span class="badge ${statusCls}">${escapeHtml(p.status)}</span>
            </div>
            <div class="info-grid" style="margin-top:12px;">
                <div class="info-item"><div class="info-label">Slug</div><div class="info-value" style="font-family:'JetBrains Mono',monospace;font-size:12px;">${escapeHtml(p.slug)}</div></div>
                <div class="info-item"><div class="info-label">Version</div><div class="info-value">${escapeHtml(p.version || '1.0.0')}</div></div>
            </div>`;
        card.addEventListener('click', () => openProject(p.id));
        grid.appendChild(card);
    }
}

// ---------- Create project ----------
function openCreateModal() {
    document.getElementById('createModal')?.classList.add('active');
    setTimeout(() => document.getElementById('projName')?.focus(), 100);
}
function closeCreateModal() {
    document.getElementById('createModal')?.classList.remove('active');
    ['projName', 'projSlug', 'projDesc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

let createInFlight = false;
async function confirmCreate() {
    if (createInFlight) return;

    const name = document.getElementById('projName')?.value.trim();
    let slug = document.getElementById('projSlug')?.value.trim().toLowerCase();
    const desc = document.getElementById('projDesc')?.value.trim();

    if (!name) return showToast('Project name is required', 'error');
    if (!slug) slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!/^[a-z0-9-]{2,40}$/.test(slug)) return showToast('Slug must be 2-40 chars: a-z, 0-9, dashes', 'error');

    createInFlight = true;
    closeCreateModal();
    showToast('Creating project...', 'info');

    try {
        const { data, error } = await NexaKS.supabase.from('projects').insert({
            owner_id: projUser.id,
            name, slug, description: desc || null
        }).select().maybeSingle();

        if (error) {
            if (error.code === '23505') return showToast('That slug is already taken', 'error');
            return showToast('Create failed: ' + error.message, 'error');
        }
        showToast('Project created', 'success');
        await loadProjects();
        if (data) openProject(data.id);
    } finally {
        createInFlight = false;
    }
}

// ---------- Project detail ----------
async function openProject(id) {
    const myRequestId = ++openProjectRequestId;

    let candidate = projects.find(p => p.id === id);
    if (!candidate) {
        await loadProjects();
        if (myRequestId !== openProjectRequestId) return;
        candidate = projects.find(p => p.id === id);
    }
    if (!candidate) return;

    activeProject = candidate;

    document.getElementById('projectsListView').style.display = 'none';
    document.getElementById('projectDetailView').style.display = 'block';

    document.getElementById('detailName').textContent = activeProject.name;
    document.getElementById('detailSlug').textContent = activeProject.slug;
    document.getElementById('detailStatus').textContent = activeProject.status;
    document.getElementById('detailStatus').className = 'badge ' + (activeProject.status === 'active' ? 'badge-success' : 'badge-warning');

    await Promise.all([loadScripts(myRequestId), loadBlacklist(myRequestId), loadWhitelist(myRequestId), loadProjectLogs(myRequestId)]);
}

function backToList() {
    openProjectRequestId++;
    document.getElementById('projectDetailView').style.display = 'none';
    document.getElementById('projectsListView').style.display = 'block';
    activeProject = null;
}

function requireActiveProject() {
    if (!activeProject) {
        showToast('No project selected', 'error');
        return false;
    }
    return true;
}

// ---------- File upload for script content ----------
// Reads the selected .lua / .txt file and drops its text into the target textarea.
// Mobile-friendly: no clipboard needed, works with Files app on iOS/Android.
const MAX_SCRIPT_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_SCRIPT_EXTS = ['lua', 'txt'];

function handleScriptFileUpload(event, targetTextareaId) {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;

    // Locate the sibling filename display span (matches by convention: <textareaId>FileName -> textareaId+"FileName")
    // We support two IDs today: scriptContent -> scriptFileName; updateScriptContent -> updateScriptFileName
    const filenameSpanId = targetTextareaId === 'updateScriptContent' ? 'updateScriptFileName' : 'scriptFileName';
    const nameEl = document.getElementById(filenameSpanId);
    const setName = (txt) => { if (nameEl) nameEl.textContent = txt; };

    // Validate extension
    const parts = file.name.split('.');
    const ext = parts.length > 1 ? parts.pop().toLowerCase() : '';
    if (!ALLOWED_SCRIPT_EXTS.includes(ext)) {
        showToast('Only .lua or .txt files are accepted', 'error');
        input.value = '';
        setName('');
        return;
    }

    // Validate size
    if (file.size > MAX_SCRIPT_FILE_BYTES) {
        const mb = (file.size / 1024 / 1024).toFixed(1);
        showToast('File too large (' + mb + ' MB). Max is 10 MB.', 'error');
        input.value = '';
        setName('');
        return;
    }

    setName('Reading ' + file.name + '...');

    const reader = new FileReader();
    reader.onload = (e) => {
        const text = String(e.target?.result || '');
        const target = document.getElementById(targetTextareaId);
        if (!target) {
            showToast('Textarea not found', 'error');
            return;
        }
        target.value = text;
        const sizeKb = (file.size / 1024).toFixed(1);
        setName(file.name + ' (' + sizeKb + ' KB) loaded');
        showToast('Loaded ' + file.name, 'success');
        // Reset the file input so the same file can be re-selected later
        input.value = '';
    };
    reader.onerror = () => {
        setName('');
        showToast('Failed to read file', 'error');
        input.value = '';
    };
    reader.readAsText(file);
}

// ---------- Scripts ----------
async function loadScripts(requestId) {
    if (!activeProject) return;
    const myId = requestId ?? openProjectRequestId;
    const { data } = await NexaKS.supabase.from('project_scripts')
        .select('*').eq('project_id', activeProject.id).order('updated_at', { ascending: false });
    if (myId !== openProjectRequestId) return;
    const tbody = document.getElementById('scriptsBody');
    if (!tbody) return;
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:24px;">No scripts yet</td></tr>';
        projScripts = [];
        return;
    }
    projScripts = data;
    tbody.innerHTML = data.map(s => `
        <tr>
            <td>${escapeHtml(s.name)} ${s.keyless ? '<span class="badge badge-info" style="font-size:10px;">KEYLESS</span>' : ''}</td>
            <td><span class="badge badge-info">${escapeHtml(s.plan)}</span></td>
            <td>${escapeHtml(s.version || '-')}</td>
            <td><span class="badge ${s.status === 'published' ? 'badge-success' : 'badge-warning'}">${escapeHtml(s.status)}</span></td>
            <td>
                <button class="btn btn-primary" style="padding:4px 10px;font-size:12px;" onclick="showLoader('${s.id}')">Loader</button>
                <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="openUpdateScript('${s.id}')">Update</button>
                <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="openHistory('${s.id}')">History</button>
                <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="togglePublish('${s.id}','${s.status}')">${s.status === 'published' ? 'Unpublish' : 'Publish'}</button>
                <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="deleteScript('${s.id}')">Delete</button>
            </td>
        </tr>`).join('');
}

function generateLoadId() {
    if (window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID().replace(/-/g, '').substring(0, 8);
    }
    const arr = new Uint8Array(4);
    (window.crypto || {}).getRandomValues?.(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
}

async function addScript() {
    if (!requireActiveProject()) return;
    const name = document.getElementById('scriptName')?.value.trim() || 'Main Script';
    const plan = document.getElementById('scriptPlan')?.value || 'free';
    const content = document.getElementById('scriptContent')?.value;
    if (!content || !content.trim()) return showToast('Script content is empty', 'error');

    const keyless = document.getElementById('scriptKeyless')?.checked || false;
    const load_id = generateLoadId();
    const { error } = await NexaKS.supabase.from('project_scripts').insert({
        project_id: activeProject.id, name, plan, script_content: content, keyless, load_id
    });
    if (error) return showToast('Add script failed: ' + error.message, 'error');
    document.getElementById('scriptContent').value = '';
    document.getElementById('scriptName').value = '';
    // Reset the upload UI too
    const nameSpan = document.getElementById('scriptFileName');
    if (nameSpan) nameSpan.textContent = '';
    showToast('Script saved as draft', 'success');
    await loadScripts();
}

async function togglePublish(id, current) {
    const next = current === 'published' ? 'draft' : 'published';
    const { error } = await NexaKS.supabase.from('project_scripts')
        .update({ status: next, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) return showToast('Update failed', 'error');
    showToast('Script ' + next, 'success');
    await loadScripts();
}

async function deleteScript(id) {
    if (!confirm('Delete this script?')) return;
    const { error } = await NexaKS.supabase.from('project_scripts').delete().eq('id', id);
    if (error) return showToast('Delete failed', 'error');
    showToast('Script deleted', 'success');
    await loadScripts();
}

// ---------- Update script (blind replace) ----------
let updateScriptId = null;
function openUpdateScript(scriptId) {
    const s = projScripts.find(x => x.id === scriptId);
    if (!s) return;
    updateScriptId = scriptId;
    document.getElementById('updateScriptTitle').textContent = 'Update: ' + s.name;
    document.getElementById('updateScriptVersion').value = bumpVersion(s.version || '1.0.0');
    document.getElementById('updateScriptContent').value = '';
    // Reset the upload UI so a previous filename doesn't linger
    const nameSpan = document.getElementById('updateScriptFileName');
    if (nameSpan) nameSpan.textContent = '';
    const fileInput = document.getElementById('updateScriptFileInput');
    if (fileInput) fileInput.value = '';
    document.getElementById('updateModal')?.classList.add('active');
    setTimeout(() => document.getElementById('updateScriptContent')?.focus(), 100);
}
function closeUpdateModal() {
    document.getElementById('updateModal')?.classList.remove('active');
    updateScriptId = null;
}
function bumpVersion(v) {
    const raw = String(v || '1.0.0').trim();
    if (!/^\d+(\.\d+)*$/.test(raw)) return '1.0.1';
    const parts = raw.split('.').map(x => parseInt(x, 10) || 0);
    while (parts.length < 3) parts.push(0);
    parts[parts.length - 1]++;
    return parts.join('.');
}
async function confirmUpdateScript() {
    if (!updateScriptId) return;
    const content = document.getElementById('updateScriptContent')?.value;
    const version = document.getElementById('updateScriptVersion')?.value.trim() || null;
    if (!content || !content.trim()) return showToast('New script content is required', 'error');

    showToast('Updating script...', 'info');
    const { error } = await NexaKS.supabase.from('project_scripts')
        .update({
            script_content: content,
            version: version,
            updated_at: new Date().toISOString()
        })
        .eq('id', updateScriptId);
    if (error) return showToast('Update failed: ' + error.message, 'error');
    closeUpdateModal();
    showToast('Script updated - clients get the new version on next execution', 'success');
    await loadScripts();
}

// ---------- Script version history ----------
let historyScriptId = null;
let historyVersions = [];

async function openHistory(scriptId) {
    historyScriptId = scriptId;
    const script = projScripts.find(x => x.id === scriptId);
    document.getElementById('historyTitle').textContent = 'History: ' + (script?.name || 'Script');
    document.getElementById('historyModal')?.classList.add('active');
    await loadHistory();
}
function closeHistoryModal() {
    document.getElementById('historyModal')?.classList.remove('active');
    historyScriptId = null;
    historyVersions = [];
}

async function loadHistory() {
    const body = document.getElementById('historyBody');
    if (body) body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">Loading...</td></tr>';

    const { data, error } = await NexaKS.supabase.from('project_script_versions')
        .select('*').eq('script_id', historyScriptId)
        .order('saved_at', { ascending: false });
    if (error) { console.error(error); if (body) body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">Failed to load history</td></tr>'; return; }

    historyVersions = data || [];
    if (historyVersions.length === 0) {
        if (body) body.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">No previous versions yet. Every update from now on will be saved here.</td></tr>';
        return;
    }
    if (body) {
        body.innerHTML = historyVersions.map(v => {
            const saved = v.saved_at ? new Date(v.saved_at) : null;
            const savedText = (saved && !isNaN(saved)) ? saved.toLocaleString() : '-';
            return `
            <tr>
                <td>${escapeHtml(v.version || '-')}</td>
                <td style="color:var(--text-muted);">${escapeHtml(savedText)}</td>
                <td>${v.script_content ? v.script_content.length : 0} chars</td>
                <td>
                    <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="restoreVersion('${v.id}')">Restore</button>
                </td>
            </tr>`;
        }).join('');
    }
}

async function restoreVersion(versionId) {
    const v = historyVersions.find(x => x.id === versionId);
    if (!v) return;
    if (!confirm('Restore version ' + (v.version || '(unversioned)') + '? The current script will be replaced. It will still be saved to history so you can roll forward again.')) return;

    showToast('Restoring...', 'info');
    const { error } = await NexaKS.supabase.from('project_scripts')
        .update({
            script_content: v.script_content,
            version: v.version,
            updated_at: new Date().toISOString()
        })
        .eq('id', historyScriptId);
    if (error) return showToast('Restore failed: ' + error.message, 'error');
    showToast('Restored - clients get this version on next execution', 'success');
    closeHistoryModal();
    await loadScripts();
}

// ---------- Blacklist ----------
async function loadBlacklist(requestId) {
    if (!activeProject) return;
    const myId = requestId ?? openProjectRequestId;
    const { data } = await NexaKS.supabase.from('project_blacklist')
        .select('*').eq('project_id', activeProject.id).order('created_at', { ascending: false });
    if (myId !== openProjectRequestId) return;
    renderEntries('blacklistBody', data, 'blacklist');
}

async function addBlacklist() {
    if (!requireActiveProject()) return;
    const type = document.getElementById('blType')?.value || 'hwid';
    const value = document.getElementById('blValue')?.value.trim();
    const reason = document.getElementById('blReason')?.value.trim();
    if (!value) return showToast('Value is required', 'error');
    const { error } = await NexaKS.supabase.from('project_blacklist').insert({
        project_id: activeProject.id, type, value, reason: reason || null
    });
    if (error) return showToast(error.code === '23505' ? 'Already blacklisted' : 'Failed: ' + error.message, 'error');
    document.getElementById('blValue').value = '';
    document.getElementById('blReason').value = '';
    showToast('Added to blacklist', 'success');
    await loadBlacklist();
}

// ---------- Whitelist ----------
async function loadWhitelist(requestId) {
    if (!activeProject) return;
    const myId = requestId ?? openProjectRequestId;
    const { data } = await NexaKS.supabase.from('project_whitelist')
        .select('*').eq('project_id', activeProject.id).order('created_at', { ascending: false });
    if (myId !== openProjectRequestId) return;
    renderEntries('whitelistBody', data, 'whitelist');
}

async function addWhitelist() {
    if (!requireActiveProject()) return;
    const type = document.getElementById('wlType')?.value || 'hwid';
    const value = document.getElementById('wlValue')?.value.trim();
    if (!value) return showToast('Value is required', 'error');
    const { error } = await NexaKS.supabase.from('project_whitelist').insert({
        project_id: activeProject.id, type, value
    });
    if (error) return showToast(error.code === '23505' ? 'Already whitelisted' : 'Failed: ' + error.message, 'error');
    document.getElementById('wlValue').value = '';
    showToast('Added to whitelist', 'success');
    await loadWhitelist();
}

function renderEntries(tbodyId, data, kind) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:24px;">No entries</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(e => `
        <tr>
            <td><span class="badge badge-info">${escapeHtml(e.type)}</span></td>
            <td style="font-family:'JetBrains Mono',monospace;font-size:12px;">${escapeHtml(e.value)}</td>
            <td>${escapeHtml(e.reason || e.note || '-')}</td>
            <td><button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="deleteEntry('${escapeHtml(kind)}','${escapeHtml(e.id)}')">Remove</button></td>
        </tr>`).join('');
}

async function deleteEntry(kind, id) {
    const table = kind === 'blacklist' ? 'project_blacklist' : 'project_whitelist';
    const { error } = await NexaKS.supabase.from(table).delete().eq('id', id);
    if (error) return showToast('Remove failed', 'error');
    showToast('Removed', 'success');
    kind === 'blacklist' ? await loadBlacklist() : await loadWhitelist();
}

// ---------- Project logs ----------
async function loadProjectLogs(requestId) {
    if (!activeProject) return;
    const myId = requestId ?? openProjectRequestId;
    const { data } = await NexaKS.supabase.from('project_logs')
        .select('*').eq('project_id', activeProject.id)
        .order('created_at', { ascending: false }).limit(20);
    if (myId !== openProjectRequestId) return;
    const tbody = document.getElementById('projLogsBody');
    if (!tbody) return;
    if (!data || data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:24px;">No activity yet</td></tr>';
        return;
    }
    tbody.innerHTML = data.map(log => {
        const cls = log.status === 'success' ? 'badge-success' : log.status === 'failed' ? 'badge-danger' : log.status === 'warning' ? 'badge-warning' : 'badge-info';
        return `<tr><td><span class="badge ${cls}">${escapeHtml(log.action)}</span></td><td>${escapeHtml(log.metadata?.message || '-')}</td><td style="color:var(--text-muted);">${timeAgo(new Date(log.created_at))}</td></tr>`;
    }).join('');
}

// ---------- Danger zone ----------
async function toggleProjectStatus() {
    if (!requireActiveProject()) return;
    const next = activeProject.status === 'active' ? 'paused' : 'active';
    const { error } = await NexaKS.supabase.from('projects')
        .update({ status: next, updated_at: new Date().toISOString() }).eq('id', activeProject.id);
    if (error) return showToast('Update failed', 'error');
    activeProject.status = next;
    document.getElementById('detailStatus').textContent = next;
    document.getElementById('detailStatus').className = 'badge ' + (next === 'active' ? 'badge-success' : 'badge-warning');
    showToast('Project ' + next, 'success');
    await loadProjects();
}

async function deleteProject() {
    if (!requireActiveProject()) return;
    if (!confirm('Delete "' + activeProject.name + '"? This removes its scripts, lists and logs. This cannot be undone.')) return;
    const { error } = await NexaKS.supabase.from('projects').delete().eq('id', activeProject.id);
    if (error) return showToast('Delete failed: ' + error.message, 'error');
    showToast('Project deleted', 'success');
    backToList();
    await loadProjects();
}

// ---------- Loader modal ----------
function showLoader(scriptId) {
    const s = projScripts.find(x => x.id === scriptId);
    if (!s) return;
    if (s.status !== 'published') return showToast('Publish the script first to get its loader', 'error');
    if (!requireActiveProject()) return;

    const site = window.location.origin;
    const slug = activeProject.slug;
    const loadParam = s.load_id ? ('?script=' + s.load_id) : '';
    let code;
    if (s.keyless) {
        code = 'loadstring(game:HttpGet("' + site + '/api/load/' + slug + loadParam + '"))()';
    } else {
        const sep = loadParam ? '&' : '?';
        code = '_G.script_key = "YOUR_KEY_HERE" -- replace with your key\n' +
               'loadstring(game:HttpGet("' + site + '/api/load/' + slug + loadParam + sep +
               'key=".._G.script_key.."&hwid="..game:GetService("RbxAnalyticsService"):GetClientId()))()';
    }
    document.getElementById('loaderCode').value = code;
    document.getElementById('loaderModal')?.classList.add('active');
}
function closeLoaderModal() { document.getElementById('loaderModal')?.classList.remove('active'); }
function copyLoaderCode() {
    const t = document.getElementById('loaderCode');
    if (!t) return;
    navigator.clipboard.writeText(t.value).then(() => showToast('Loader copied', 'success')).catch(() => showToast('Failed to copy', 'error'));
}

// ---------- Discord command modal ----------
function showDiscord() {
    if (!requireActiveProject()) return;
    const cmds = [
        '// Post the panel in a Discord channel:',
        '/setup-panel project:' + activeProject.slug,
        '',
        '// Generate keys tied to this project:',
        '/key create plan:pro duration:30 quantity:1 project:' + activeProject.slug
    ].join('\n');
    document.getElementById('discordCode').value = cmds;
    document.getElementById('discordModal')?.classList.add('active');
}
function closeDiscordModal() { document.getElementById('discordModal')?.classList.remove('active'); }
function copyDiscordCode() {
    const t = document.getElementById('discordCode');
    if (!t) return;
    navigator.clipboard.writeText(t.value).then(() => showToast('Commands copied', 'success')).catch(() => showToast('Failed to copy', 'error'));
}

// ---------- Utils ----------
function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function timeAgo(date) {
    if (!(date instanceof Date) || isNaN(date)) return '-';
    const s = Math.floor((new Date() - date) / 1000);
    if (s < 60) return 'Just now';
    if (s < 3600) return Math.floor(s / 60) + ' mins ago';
    if (s < 86400) return Math.floor(s / 3600) + ' hours ago';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function toggleSidebar() { document.getElementById('sidebar')?.classList.toggle('open'); }

async function handleLogout() {
    if (!confirm('Sign out from NexaKS?')) return;
    try {
        localStorage.removeItem('nexaks_session');
        localStorage.removeItem('nexaks_pending_discord');
        sessionStorage.removeItem('nexaks_redirected');
    } catch (_) {}
    try {
        if (NexaKS?.signOut) await NexaKS.signOut();
    } catch (e) {
        console.warn('signOut:', e);
    }
    window.location.href = '/';
}

function showToast(message, type) {
    type = type || 'info';
    const container = document.getElementById('toastContainer');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    const span = document.createElement('span');
    span.textContent = String(message ?? '');
    toast.appendChild(span);
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeCreateModal();
        closeDiscordModal();
        closeUpdateModal();
        closeHistoryModal();
        closeLoaderModal();
    }
});
