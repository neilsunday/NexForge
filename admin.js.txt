/* ========================================
   KeySystem — Admin Panel JS
   ======================================== */

// ========== Sidebar Toggle (mobile) ==========
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
}

document.addEventListener('click', (e) => {
    const sidebar = document.getElementById('sidebar');
    const toggle = document.querySelector('.sidebar-toggle');
    if (window.innerWidth <= 968 &&
        sidebar.classList.contains('open') &&
        !sidebar.contains(e.target) &&
        !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
    }
});

// ========== Tab Scroll Navigation ==========
function showTab(tab) {
    const target = document.getElementById('tab-' + tab);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        target.style.transition = 'box-shadow 0.3s';
        target.style.boxShadow = '0 0 0 2px var(--accent)';
        setTimeout(() => target.style.boxShadow = '', 1500);
    }
    document.getElementById('sidebar').classList.remove('open');
}

// ========== Generate Keys ==========
function generateKeys() {
    const qty = parseInt(document.getElementById('genQty').value) || 1;
    const duration = document.getElementById('genDuration').value;
    const plan = document.getElementById('genPlan').value;
    const resets = document.getElementById('genResets').value;

    if (qty < 1 || qty > 1000) {
        showToast('Quantity must be between 1 and 1000', 'error');
        return;
    }

    showToast(`⚡ Generating ${qty} ${plan.toUpperCase()} keys...`, 'info');

    // Simulate generation — replace with Supabase insert later
    setTimeout(() => {
        const keys = [];
        for (let i = 0; i < qty; i++) {
            keys.push(generateKeyString());
        }

        showToast(`✓ Successfully generated ${qty} keys!`, 'success');
        console.log('Generated keys:', keys);
        console.log('Settings:', { plan, duration, resets });

        // TODO: Insert to Supabase
        // await supabase.from('keys').insert(keys.map(k => ({ key: k, plan, ... })));

        // Auto-download as .txt
        downloadKeys(keys, plan, duration);
    }, 1200);
}

function generateKeyString() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const segments = [];
    for (let s = 0; s < 5; s++) {
        let seg = '';
        for (let i = 0; i < 4; i++) {
            seg += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        segments.push(seg);
    }
    return 'KSYS-' + segments.join('-');
}

function downloadKeys(keys, plan, duration) {
    const header = `KeySystem — Generated Keys\nPlan: ${plan.toUpperCase()}\nDuration: ${duration}\nGenerated: ${new Date().toISOString()}\nTotal: ${keys.length}\n\n=========================\n\n`;
    const content = header + keys.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `keys-${plan}-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ========== Filter Keys ==========
function filterKeys() {
    const search = document.getElementById('keySearch').value.toLowerCase();
    const rows = document.querySelectorAll('#keysTableBody tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(search) ? '' : 'none';
    });
}

// ========== Revoke Key ==========
function revokeKey(btn) {
    if (!confirm('Revoke this key permanently? The user will lose access immediately.')) {
        return;
    }

    const row = btn.closest('tr');
    const keyCell = row.cells[0];
    const statusCell = row.cells[3];

    // Update UI
    keyCell.style.color = 'var(--text-muted)';
    keyCell.style.textDecoration = 'line-through';
    statusCell.innerHTML = '<span class="badge badge-danger">Revoked</span>';

    // Remove action buttons except view
    const actions = row.querySelector('.table-actions');
    actions.innerHTML = '<button class="icon-btn">👁</button>';

    showToast('Key revoked successfully', 'success');

    // TODO: await supabase.from('keys').update({ status: 'revoked' }).eq('key', keyValue);
}

// ========== Toast Notifications ==========
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✓',
        error: '✕',
        info: 'ℹ'
    };

    toast.innerHTML = `
        <span style="font-size:16px; font-weight:700;">${icons[type] || 'ℹ'}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ========== Admin Auth Check (placeholder) ==========
function checkAdminAccess() {
    // TODO: Real check with Supabase
    // const { data: { user } } = await supabase.auth.getUser();
    // const { data } = await supabase.from('users').select('is_admin').eq('discord_id', user.id).single();
    // if (!data?.is_admin) { window.location.href = 'dashboard.html'; }

    console.log('%c⚠ Admin access — verify identity in production', 'color:#f59e0b; font-weight:700;');
}

// ========== Init ==========
document.addEventListener('DOMContentLoaded', () => {
    checkAdminAccess();

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
});

console.log('%c⚙ KeySystem Admin Panel', 'color:#ef4444; font-size:18px; font-weight:800;');
