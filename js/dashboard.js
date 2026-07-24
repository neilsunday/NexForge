/* ========================================
   KeySystem â€” Dashboard JS
   ======================================== */

// ========== Sidebar Toggle (mobile) ==========
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('open');
}

// Close sidebar when clicking outside on mobile
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

// ========== Section Scroll ==========
function showSection(section) {
    const target = document.getElementById('section-' + section);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Flash highlight
        target.style.transition = 'box-shadow 0.3s';
        target.style.boxShadow = '0 0 0 2px var(--accent)';
        setTimeout(() => target.style.boxShadow = '', 1500);
    }
    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
}

// ========== Copy to Clipboard ==========
function copyKey() {
    const key = document.getElementById('keyValue').textContent;
    navigator.clipboard.writeText(key).then(() => {
        const btn = document.getElementById('copyText');
        const original = btn.textContent;
        btn.textContent = 'âœ“ Copied!';
        showToast('Key copied to clipboard', 'success');
        setTimeout(() => btn.textContent = original, 2000);
    }).catch(() => {
        showToast('Failed to copy key', 'error');
    });
}

function copyLoader() {
    const loader = document.getElementById('loaderScript').value;
    navigator.clipboard.writeText(loader).then(() => {
        showToast('Loader script copied â€” paste into your executor', 'success');
    }).catch(() => {
        showToast('Failed to copy loader', 'error');
    });
}

// ========== HWID Reset Modal ==========
function openResetModal() {
    document.getElementById('resetModal').classList.add('active');
}

function closeResetModal() {
    document.getElementById('resetModal').classList.remove('active');
}

function confirmReset() {
    closeResetModal();
    showToast('ðŸ”„ HWID reset in progress...', 'info');

    // Simulate API call â€” replace with real Supabase call later
    setTimeout(() => {
        showToast('âœ“ HWID reset successful! Run the script to bind a new device.', 'success');
    }, 1500);
}

// Close modal when clicking overlay
document.getElementById('resetModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'resetModal') closeResetModal();
});

// ESC to close modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeResetModal();
});

// ========== Revoke Key ==========
function revokeKey() {
    if (!confirm('Are you sure? This will permanently revoke your key and cannot be undone.')) {
        return;
    }
    showToast('Key revoked', 'error');
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1500);
}

// ========== Logout ==========
document.getElementById('logoutBtn')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (confirm('Logout from KeySystem?')) {
        // Later: supabase.auth.signOut()
        showToast('Logged out', 'info');
        setTimeout(() => window.location.href = 'index.html', 1000);
    }
});

// ========== Toast Notifications ==========
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: 'âœ“',
        error: 'âœ•',
        info: 'â„¹'
    };

    toast.innerHTML = `
        <span style="font-size:16px; font-weight:700;">${icons[type] || 'â„¹'}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 0.3s ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// ========== Load User Data (placeholder â€” connect to Supabase later) ==========
function loadUserData() {
    // TODO: Replace with real Supabase query
    // const { data: { user } } = await supabase.auth.getUser();
    // const { data: userData } = await supabase.from('users').select('*').eq('discord_id', user.id).single();

    const mockUser = {
        username: 'juandelacruz',
        plan: 'Pro',
        avatar: 'J'
    };

    document.getElementById('userName').textContent = mockUser.username;
    document.getElementById('userNameSmall').textContent = mockUser.username;
    document.getElementById('userRole').textContent = mockUser.plan + ' Plan';
    document.getElementById('userAvatar').textContent = mockUser.avatar;
}

// ========== Init ==========
document.addEventListener('DOMContentLoaded', () => {
    loadUserData();

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

console.log('%câš¡ KeySystem Dashboard', 'color:#7c3aed; font-size:18px; font-weight:800;');
