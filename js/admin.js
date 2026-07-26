/* NexaKS - Admin Panel JS */

let currentUser = null;
let currentProfile = null;
let allKeys = [];
let allUsers = [];

// ========== Init ==========
document.addEventListener("DOMContentLoaded", async () => {
  const loader = document.getElementById("authLoader");
  const main = document.getElementById("adminMain");
  const denied = document.getElementById("deniedState");

  const forceShow = setTimeout(() => {
    if (loader) loader.style.display = "none";
    if (denied) {
      denied.style.display = "flex";
    }
  }, 8000);

  try {
    // Check auth
    currentUser = await NexaKS.getCurrentUser();
    if (!currentUser && !DEV_MODE) {
      clearTimeout(forceShow);
      window.location.href = "/";
      return;
    }

    // Check admin status
    currentProfile = await NexaKS.getUserProfile(currentUser.id);
    if (!currentProfile?.is_admin) {
      clearTimeout(forceShow);
      if (loader) loader.style.display = "none";
      if (denied) denied.style.display = "flex";
      return;
    }

    // User is admin - show panel and load data
    clearTimeout(forceShow);
    renderAdminInfo();

    // Load all data in parallel
    await Promise.all([
      loadStats(),
      loadKeys(),
      loadUsers(),
      loadLogs(),
      loadScripts(),
      loadProjectsForForm(),
      loadNotifications(),
      loadNotifStats(),
    ]);

    // Subscribe to real-time log inserts for the toast + badge system
    subscribeToLogs();

    if (loader) loader.style.display = "none";
    if (main) main.style.display = "grid";

    // Fade-in
    document.querySelectorAll(".card, .stat-card").forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(10px)";
      el.style.transition = "opacity 0.4s ease, transform 0.4s ease";
      setTimeout(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      }, i * 60);
    });
  } catch (err) {
    console.error("Admin init:", err);
    clearTimeout(forceShow);
    if (loader) loader.style.display = "none";
    if (denied) denied.style.display = "flex";
  }
});

// ========== Render admin header ==========
function renderAdminInfo() {
  const meta = currentUser.user_metadata || {};
  const username =
    currentProfile?.username || meta.full_name || meta.name || "Admin";
  const avatarUrl = currentProfile?.avatar_url || meta.avatar_url;

  const nameEl = document.getElementById("adminName");
  const avatarImg = document.getElementById("adminAvatarImg");
  const avatarDiv = document.getElementById("adminAvatar");

  if (nameEl) nameEl.textContent = username;
  if (avatarUrl && avatarImg) {
    avatarImg.src = avatarUrl;
    avatarImg.style.display = "block";
    if (avatarDiv) avatarDiv.style.display = "none";
  } else if (avatarDiv) {
    avatarDiv.textContent = username.charAt(0).toUpperCase();
  }
}

// ========== Load stats ==========
async function loadStats() {
  try {
    // Total keys
    const { count: totalKeys } = await NexaKS.supabase
      .from("keys")
      .select("*", { count: "exact", head: true });

    // Active keys
    const { count: activeKeys } = await NexaKS.supabase
      .from("keys")
      .select("*", { count: "exact", head: true })
      .eq("status", "active");

    // Revoked keys
    const { count: revoked } = await NexaKS.supabase
      .from("keys")
      .select("*", { count: "exact", head: true })
      .eq("status", "revoked");

    // Total users
    const { count: totalUsers } = await NexaKS.supabase
      .from("users")
      .select("*", { count: "exact", head: true });

    // Active users (with active key)
    const { data: activeUserRows } = await NexaKS.supabase
      .from("keys")
      .select("user_id")
      .eq("status", "active")
      .not("user_id", "is", null);
    const activeUsers = new Set((activeUserRows || []).map((r) => r.user_id))
      .size;

    // Events today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { count: eventsToday } = await NexaKS.supabase
      .from("logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", startOfDay.toISOString());

    // Populate UI
    const $ = (id) => document.getElementById(id);
    if ($("statTotalKeys")) $("statTotalKeys").textContent = totalKeys ?? 0;
    if ($("statTotalKeysSub"))
      $("statTotalKeysSub").textContent = (activeKeys ?? 0) + " active";
    if ($("statActiveUsers")) $("statActiveUsers").textContent = activeUsers;
    if ($("statActiveUsersSub"))
      $("statActiveUsersSub").textContent = (totalUsers ?? 0) + " total users";
    if ($("statEventsToday"))
      $("statEventsToday").textContent = eventsToday ?? 0;
    if ($("statEventsTodaySub"))
      $("statEventsTodaySub").textContent = "Since midnight";
    if ($("statRevoked")) $("statRevoked").textContent = revoked ?? 0;
    if ($("statRevokedSub")) $("statRevokedSub").textContent = "Cannot be used";
  } catch (e) {
    console.error("loadStats:", e);
  }
}

// ========== Load all keys ==========
async function loadKeys() {
  try {
    const { data, error } = await NexaKS.supabase
      .from("keys")
      .select("*, users!keys_user_id_fkey(username, avatar_url)")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    allKeys = data || [];

    const desc = document.getElementById("keysDesc");
    if (desc)
      desc.textContent = "Showing " + allKeys.length + " most recent keys";

    renderKeysTable(allKeys);
  } catch (e) {
    console.error("loadKeys:", e);
    const tbody = document.getElementById("keysTableBody");
    if (tbody)
      tbody.innerHTML =
        '<tr><td colspan="6" style="text-align:center;color:var(--danger);padding:32px;">Failed to load keys: ' +
        e.message +
        "</td></tr>";
  }
}

function renderKeysTable(keys) {
  const tbody = document.getElementById("keysTableBody");
  if (!tbody) return;

  if (!keys || keys.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px;">No keys yet. Generate some above.</td></tr>';
    return;
  }

  tbody.innerHTML = keys
    .map((k) => {
      const shortKey =
        k.key.length > 20 ? k.key.substring(0, 18) + "..." : k.key;
      const user = k.users?.username || (k.user_id ? "Unknown" : "Unclaimed");
      const planClass =
        k.plan === "enterprise"
          ? "badge-warning"
          : k.plan === "pro"
            ? "badge-info"
            : "badge";
      const statusClass =
        k.status === "active"
          ? "badge-success"
          : k.status === "revoked"
            ? "badge-danger"
            : k.status === "expired"
              ? "badge-warning"
              : "badge";
      const expires = k.expires_at
        ? new Date(k.expires_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : k.duration_days
          ? k.duration_days + " day" + (k.duration_days > 1 ? "s" : "") + " (unclaimed)"
          : "Lifetime";
      const isRevoked = k.status === "revoked";
      const keyStyle = isRevoked
        ? "font-family:monospace;font-size:12px;color:var(--text-muted);text-decoration:line-through;"
        : "font-family:monospace;font-size:12px;color:var(--accent-hover);";

      return (
        "<tr>" +
        '<td style="' +
        keyStyle +
        '">' +
        shortKey +
        "</td>" +
        "<td>" +
        user +
        "</td>" +
        '<td><span class="badge ' +
        planClass +
        '">' +
        k.plan +
        "</span></td>" +
        '<td><span class="badge ' +
        statusClass +
        '">' +
        k.status +
        "</span></td>" +
        '<td style="color:var(--text-secondary);font-size:13px;">' +
        expires +
        "</td>" +
        '<td><div class="table-actions">' +
        (isRevoked
          ? ""
          : '<button class="icon-btn" title="Copy key" onclick="copyKeyValue(\'' +
            k.key +
            "')\">" +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="1.5"/></svg>' +
            "</button>" +
            '<button class="icon-btn danger" title="Revoke" onclick="revokeKeyById(\'' +
            k.key +
            "')\">" +
            '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M4.9 4.9l14.2 14.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
            "</button>") +
        "</div></td>" +
        "</tr>"
      );
    })
    .join("");
}

function filterKeys() {
  const search = (document.getElementById("keySearch")?.value || "")
    .toLowerCase()
    .trim();
  if (!search) return renderKeysTable(allKeys);

  const filtered = allKeys.filter((k) => {
    const user = (k.users?.username || "").toLowerCase();
    return (
      k.key.toLowerCase().includes(search) ||
      user.includes(search) ||
      k.plan.toLowerCase().includes(search) ||
      k.status.toLowerCase().includes(search)
    );
  });
  renderKeysTable(filtered);
}

function copyKeyValue(key) {
  navigator.clipboard
    .writeText(key)
    .then(() => showToast("Key copied", "success"))
    .catch(() => showToast("Failed to copy", "error"));
}

async function revokeKeyById(key) {
  if (
    !confirm(
      "Revoke this key permanently? The user will lose access immediately.",
    )
  )
    return;

  showToast("Revoking key...", "info");

  const { error } = await NexaKS.supabase
    .from("keys")
    .update({ status: "revoked" })
    .eq("key", key);

  if (error) return showToast("Revoke failed: " + error.message, "error");

  await NexaKS.supabase.from("logs").insert({
    user_id: currentUser.id,
    key: key,
    action: "admin_revoke",
    status: "success",
    metadata: {
      message: "Key revoked by admin " + (currentProfile?.username || "admin"),
    },
  });

  showToast("Key revoked successfully", "success");
  await loadKeys();
  await loadStats();
}

// ========== Load users ==========
async function loadUsers() {
  try {
    const { data, error } = await NexaKS.supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;
    allUsers = data || [];

    const desc = document.getElementById("usersDesc");
    if (desc) desc.textContent = allUsers.length + " total users";

    // Get key counts per user
    const { data: keyRows } = await NexaKS.supabase
      .from("keys")
      .select("user_id")
      .not("user_id", "is", null);
    const keyCountMap = {};
    (keyRows || []).forEach((r) => {
      keyCountMap[r.user_id] = (keyCountMap[r.user_id] || 0) + 1;
    });

    const tbody = document.getElementById("usersTableBody");
    if (!tbody) return;

    if (allUsers.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px;">No users yet</td></tr>';
      return;
    }

    tbody.innerHTML = allUsers
      .map((u) => {
        const avatar = u.avatar_url
          ? '<img src="' +
            u.avatar_url +
            '" style="width:24px;height:24px;border-radius:50%;">'
          : '<div class="user-avatar" style="width:24px;height:24px;font-size:11px;">' +
            (u.username || "U").charAt(0).toUpperCase() +
            "</div>";
        const joined = u.created_at
          ? new Date(u.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "-";
        const keyCount = keyCountMap[u.id] || 0;
        const statusBadge = u.is_banned
          ? '<span class="badge badge-danger">Banned</span>'
          : u.is_admin
            ? '<span class="badge badge-warning">Admin</span>'
            : '<span class="badge badge-success">Active</span>';

        return (
          "<tr>" +
          '<td><div style="display:flex;align-items:center;gap:8px;">' +
          avatar +
          "<span>" +
          (u.username || "Unknown") +
          "</span></div></td>" +
          '<td style="color:var(--text-secondary);font-size:13px;">' +
          joined +
          "</td>" +
          "<td>" +
          keyCount +
          "</td>" +
          "<td>" +
          statusBadge +
          "</td>" +
          '<td><div class="table-actions">' +
          (u.id === currentUser.id
            ? '<span style="color:var(--text-muted);font-size:12px;padding:0 8px;">You</span>'
            : u.is_banned
              ? '<button class="icon-btn" title="Unban" onclick="toggleBan(\'' +
                u.id +
                '\', false)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>'
              : '<button class="icon-btn danger" title="Ban user" onclick="toggleBan(\'' +
                u.id +
                '\', true)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M4.9 4.9l14.2 14.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>') +
          "</div></td>" +
          "</tr>"
        );
      })
      .join("");
  } catch (e) {
    console.error("loadUsers:", e);
    const tbody = document.getElementById("usersTableBody");
    if (tbody)
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:32px;">Failed to load users: ' +
        e.message +
        "</td></tr>";
  }
}

async function toggleBan(userId, banned) {
  const action = banned ? "Ban this user" : "Unban this user";
  if (
    !confirm(
      action +
        "? This will " +
        (banned ? "block" : "restore") +
        " their access.",
    )
  )
    return;

  const { error } = await NexaKS.supabase
    .from("users")
    .update({ is_banned: banned })
    .eq("id", userId);

  if (error) return showToast("Failed: " + error.message, "error");

  await NexaKS.supabase.from("logs").insert({
    user_id: currentUser.id,
    action: banned ? "admin_ban" : "admin_unban",
    status: "success",
    metadata: { message: (banned ? "Banned" : "Unbanned") + " user " + userId },
  });

  showToast("User " + (banned ? "banned" : "unbanned"), "success");
  await loadUsers();
}

// ========== Load logs ==========
async function loadLogs() {
  try {
    const { data, error } = await NexaKS.supabase
      .from("logs")
      .select("*, users!logs_user_id_fkey(username)")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) throw error;

    const desc = document.getElementById("logsDesc");
    if (desc)
      desc.textContent =
        "Showing " + (data?.length || 0) + " most recent events";

    const tbody = document.getElementById("logsTableBody");
    if (!tbody) return;

    if (!data || data.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:32px;">No activity yet</td></tr>';
      return;
    }

    tbody.innerHTML = data
      .map((log) => {
        const time = timeAgo(new Date(log.created_at));
        const user = log.users?.username || "System";
        const cls =
          log.status === "success"
            ? "badge-success"
            : log.status === "failed"
              ? "badge-danger"
              : log.status === "warning"
                ? "badge-warning"
                : "badge-info";
        return (
          "<tr>" +
          '<td style="color:var(--text-muted);font-size:13px;">' +
          time +
          "</td>" +
          "<td>" +
          user +
          "</td>" +
          '<td><span class="badge ' +
          cls +
          '">' +
          log.action +
          "</span></td>" +
          '<td style="color:var(--text-secondary);font-size:13px;">' +
          (log.metadata?.message || "-") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  } catch (e) {
    console.error("loadLogs:", e);
    const tbody = document.getElementById("logsTableBody");
    if (tbody)
      tbody.innerHTML =
        '<tr><td colspan="4" style="text-align:center;color:var(--danger);padding:32px;">Failed to load logs: ' +
        e.message +
        "</td></tr>";
  }
}

// ========== Generate keys ==========
function generateKeyString() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = "";
    for (let i = 0; i < 4; i++) {
      seg += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    segments.push(seg);
  }
  return "NXKS-" + segments.join("-");
}

// Resolve the users.id that corresponds to the signed-in admin.
// Ensures we have a valid users row before inserting a key (keys.created_by has a FK to users.id).
async function resolveAdminUserId() {
  // 1. Match by auth id " common case for web-first admins
  const { data: byId } = await NexaKS.supabase
    .from("users").select("id").eq("id", currentUser.id).maybeSingle();
  if (byId) return byId.id;

  // 2. Match by discord_id from OAuth metadata (admin used /redeem on Discord first)
  const meta = currentUser.user_metadata || {};
  const discordId = meta.provider_id || meta.sub;
  if (discordId) {
    const { data: byDiscord } = await NexaKS.supabase
      .from("users").select("id").eq("discord_id", discordId).maybeSingle();
    if (byDiscord) return byDiscord.id;
  }

  // 3. Create a fresh row keyed by the auth id
  const { data: created, error } = await NexaKS.supabase.from("users").insert({
    id: currentUser.id,
    discord_id: discordId || null,
    username: meta.full_name || meta.name || meta.user_name || "Admin",
    avatar_url: meta.avatar_url || null,
    is_admin: true,
  }).select("id").single();
  if (error) throw new Error("Could not resolve admin profile: " + error.message);
  return created.id;
}

async function generateKeys() {
  const btn = document.getElementById("genBtn");
  const qty = parseInt(document.getElementById("genQty").value) || 1;
  const duration = document.getElementById("genDuration").value;
  const plan = document.getElementById("genPlan").value;
  const resets = parseInt(document.getElementById("genResets").value) || 5;
  const projectId = document.getElementById("genProject")?.value || null;

  if (qty < 1 || qty > 500) return showToast("Quantity must be 1-500", "error");

  // Warn admin when generating admin-plan keys (grant full site access)
  if (plan === "admin") {
    if (!confirm("Generate " + qty + " ADMIN key(s)?\n\nThese keys grant full admin access to the website when redeemed. Only issue them to trusted staff.")) {
      return;
    }
  }

  if (btn) {
    btn.disabled = true;
    btn.textContent = "Generating...";
  }
  showToast(
    "Generating " + qty + " " + plan.toUpperCase() + " keys...",
    "info",
  );

  // If a project is selected, warn when no matching published script exists.
  // Admin keys skip this check (they don't need a project script).
  if (projectId && plan !== "admin") {
    try {
      const { data: matching } = await NexaKS.supabase
        .from("project_scripts")
        .select("id")
        .eq("project_id", projectId)
        .eq("plan", plan)
        .eq("status", "published")
        .limit(1);
      if (!matching || matching.length === 0) {
        if (!confirm(
          "Warning: the selected project has no published " + plan.toUpperCase() +
          " script yet.\n\nUsers who redeem this key will be BLOCKED at redeem and cannot get any script until you publish one for this plan.\n\nContinue anyway?"
        )) {
          return;
        }
      }
    } catch (e) {
      console.warn("Plan-vs-project check:", e);
    }
  }

  try {
    // Make sure the admin has a users row (needed for keys.created_by FK)
    const adminId = await resolveAdminUserId();

    // Generate unique key strings " retry on in-batch collisions
    const keySet = new Set();
    let attempts = 0;
    while (keySet.size < qty && attempts < qty * 10) {
      keySet.add(generateKeyString());
      attempts++;
    }
    if (keySet.size < qty) {
      throw new Error("Could not generate " + qty + " unique keys");
    }
    const keys = Array.from(keySet);

    const rows = keys.map((key) => ({
      key: key,
      plan: plan,
      duration_days: duration === "lifetime" ? null : parseInt(duration),
      hwid_reset_limit: resets,
      status: "unclaimed",
      created_by: adminId,
      project_id: projectId || null,
    }));

    const { error } = await NexaKS.supabase.from("keys").insert(rows);
    if (error) {
      // Surface the real reason (FK violation, unique collision, RLS, etc.)
      const detail = error.message + (error.details ? " (" + error.details + ")" : "");
      throw new Error(detail);
    }

    // Log it
    await NexaKS.supabase.from("logs").insert({
      user_id: adminId,
      action: "admin_generate",
      status: "success",
      metadata: {
        message: "Generated " + qty + " " + plan + " keys (" + duration + ")" +
                 (projectId ? " for project " + projectId : ""),
      },
    });

    showToast("Successfully generated " + qty + " keys!", "success");
    downloadKeysFile(keys, plan, duration);
    await loadKeys();
    await loadStats();
    await loadLogs();
  } catch (err) {
    console.error("Generate:", err);
    showToast("Generation failed: " + err.message, "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML =
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg> Generate Keys';
    }
  }
}

function downloadKeysFile(keys, plan, duration) {
  const header =
    "NexaKS - Generated Keys\nPlan: " +
    plan.toUpperCase() +
    "\nDuration: " +
    duration +
    "\nGenerated: " +
    new Date().toISOString() +
    "\nTotal: " +
    keys.length +
    "\n\n=========================\n\n";
  const content = header + keys.join("\n");
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "nexaks-keys-" + plan + "-" + Date.now() + ".txt";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ========== Nav helpers ==========
function toggleSidebar() {
  document.getElementById("sidebar")?.classList.toggle("open");
}

document.addEventListener("click", (e) => {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.querySelector(".sidebar-toggle");
  if (
    window.innerWidth <= 968 &&
    sidebar?.classList.contains("open") &&
    !sidebar.contains(e.target) &&
    !toggle?.contains(e.target)
  ) {
    sidebar.classList.remove("open");
  }
});

function showTab(tab) {
  const target = document.getElementById("tab-" + tab);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.style.transition = "box-shadow 0.3s";
    target.style.boxShadow = "0 0 0 2px var(--accent)";
    setTimeout(() => (target.style.boxShadow = ""), 1500);
  }
  document.getElementById("sidebar")?.classList.remove("open");

  // If entering the notifications tab, clear the unread badge
  if (tab === "notifications") {
    clearNotifBadge();
    // Refresh stats on tab open (cheap query)
    if (typeof loadNotifStats === "function") loadNotifStats();
  }
}

async function handleLogout() {
  if (!confirm("Sign out from NexaKS?")) return;
  await NexaKS.signOut();
}

function timeAgo(date) {
  const s = Math.floor((new Date() - date) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + " mins ago";
  if (s < 86400) return Math.floor(s / 3600) + " hours ago";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function showToast(message, type) {
  type = type || "info";
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast " + type;
  toast.innerHTML = "<span>" + message + "</span>";
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ========== Scripts Management ==========
let allScripts = [];

async function loadScripts() {
  try {
    const { data, error } = await NexaKS.supabase
      .from("scripts")
      .select("*, users!scripts_created_by_fkey(username)")
      .order("created_at", { ascending: false });

    if (error) throw error;
    allScripts = data || [];

    const desc = document.getElementById("scriptsDesc");
    if (desc) desc.textContent = allScripts.length + " total scripts";

    renderScriptsTable();
  } catch (e) {
    console.error("loadScripts:", e);
    const tbody = document.getElementById("scriptsTableBody");
    if (tbody)
      tbody.innerHTML =
        '<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:32px;">Failed to load scripts: ' +
        e.message +
        "</td></tr>";
  }
}

function renderScriptsTable() {
  const tbody = document.getElementById("scriptsTableBody");
  if (!tbody) return;

  if (!allScripts.length) {
    tbody.innerHTML =
      '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px;">No scripts yet. Click "Add New Script" to create your first one.</td></tr>';
    return;
  }

  tbody.innerHTML = allScripts
    .map((s) => {
      const planClass =
        s.plan_required === "enterprise"
          ? "badge-warning"
          : s.plan_required === "pro"
            ? "badge-info"
            : "badge";
      const statusClass = s.is_active ? "badge-success" : "badge";
      const statusText = s.is_active ? "active" : "inactive";
      return (
        "<tr>" +
        '<td style="font-weight:600;">' +
        escapeHtml(s.name) +
        "</td>" +
        '<td style="color:var(--text-secondary);font-size:13px;">' +
        escapeHtml(s.description || "-").substring(0, 60) +
        "</td>" +
        '<td><span class="badge ' +
        planClass +
        '">' +
        s.plan_required +
        "</span></td>" +
        '<td><span class="badge ' +
        statusClass +
        '">' +
        statusText +
        "</span></td>" +
        '<td><div class="table-actions">' +
        '<button class="icon-btn" title="Edit" onclick="openScriptModal(\'' +
        s.id +
        "')\">" +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        "</button>" +
        '<button class="icon-btn" title="Toggle" onclick="toggleScript(\'' +
        s.id +
        "', " +
        !s.is_active +
        ')">' +
        (s.is_active
          ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/></svg>'
          : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M5 12l5 5 9-11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>') +
        "</button>" +
        '<button class="icon-btn danger" title="Delete" onclick="deleteScript(\'' +
        s.id +
        "')\">" +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        "</button>" +
        "</div></td>" +
        "</tr>"
      );
    })
    .join("");
}

function escapeHtml(str) {
  return String(str || "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
}

// ========== Script Modal ==========
let editingScriptId = null;

function openScriptModal(scriptId) {
  editingScriptId = scriptId || null;
  const modal = document.getElementById("scriptModal");
  const title = document.getElementById("scriptModalTitle");
  const nameInput = document.getElementById("scriptNameInput");
  const descInput = document.getElementById("scriptDescInput");
  const planInput = document.getElementById("scriptPlanInput");
  const contentInput = document.getElementById("scriptContentInput");
  const activeInput = document.getElementById("scriptActiveInput");

  if (scriptId) {
    const s = allScripts.find((x) => x.id === scriptId);
    if (!s) return showToast("Script not found", "error");
    title.textContent = "Edit Script";
    nameInput.value = s.name;
    descInput.value = s.description || "";
    planInput.value = s.plan_required;
    contentInput.value = s.script_content;
    activeInput.checked = s.is_active;
  } else {
    title.textContent = "Add New Script";
    nameInput.value = "";
    descInput.value = "";
    planInput.value = "free";
    contentInput.value =
      '-- Paste your Lua script here\nprint("Hello from NexaKS!")';
    activeInput.checked = true;
  }

  modal.classList.add("active");
}

function closeScriptModal() {
  document.getElementById("scriptModal")?.classList.remove("active");
  editingScriptId = null;
}

async function saveScript() {
  const name = document.getElementById("scriptNameInput").value.trim();
  const description = document.getElementById("scriptDescInput").value.trim();
  const plan_required = document.getElementById("scriptPlanInput").value;
  const script_content = document.getElementById("scriptContentInput").value;
  const is_active = document.getElementById("scriptActiveInput").checked;

  if (!name) return showToast("Name is required", "error");
  if (!script_content.trim())
    return showToast("Script content is required", "error");

  showToast(
    editingScriptId ? "Updating script..." : "Creating script...",
    "info",
  );

  try {
    if (editingScriptId) {
      const { error } = await NexaKS.supabase
        .from("scripts")
        .update({ name, description, plan_required, script_content, is_active })
        .eq("id", editingScriptId);
      if (error) throw error;
      await NexaKS.supabase.from("logs").insert({
        user_id: currentUser.id,
        action: "admin_script_edit",
        status: "success",
        metadata: { message: "Edited script: " + name },
      });
      showToast("Script updated", "success");
    } else {
      const { error } = await NexaKS.supabase.from("scripts").insert({
        name,
        description,
        plan_required,
        script_content,
        is_active,
        created_by: currentUser.id,
      });
      if (error) throw error;
      await NexaKS.supabase.from("logs").insert({
        user_id: currentUser.id,
        action: "admin_script_create",
        status: "success",
        metadata: {
          message: "Created script: " + name + " (" + plan_required + ")",
        },
      });
      showToast("Script created", "success");
    }
    closeScriptModal();
    await loadScripts();
  } catch (e) {
    showToast("Save failed: " + e.message, "error");
  }
}

async function toggleScript(id, newActiveState) {
  const script = allScripts.find((s) => s.id === id);
  if (!script) return;

  const { error } = await NexaKS.supabase
    .from("scripts")
    .update({ is_active: newActiveState })
    .eq("id", id);
  if (error) return showToast("Toggle failed: " + error.message, "error");

  await NexaKS.supabase.from("logs").insert({
    user_id: currentUser.id,
    action: newActiveState ? "admin_script_enable" : "admin_script_disable",
    status: "success",
    metadata: {
      message:
        (newActiveState ? "Enabled" : "Disabled") + " script: " + script.name,
    },
  });

  showToast("Script " + (newActiveState ? "enabled" : "disabled"), "success");
  await loadScripts();
}

async function deleteScript(id) {
  const script = allScripts.find((s) => s.id === id);
  if (!script) return;
  if (!confirm('Delete "' + script.name + '"? This cannot be undone.')) return;

  const { error } = await NexaKS.supabase.from("scripts").delete().eq("id", id);
  if (error) return showToast("Delete failed: " + error.message, "error");

  await NexaKS.supabase.from("logs").insert({
    user_id: currentUser.id,
    action: "admin_script_delete",
    status: "success",
    metadata: { message: "Deleted script: " + script.name },
  });

  showToast("Script deleted", "success");
  await loadScripts();
}

// Modal ESC + overlay click
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeScriptModal();
});
document.getElementById("scriptModal")?.addEventListener("click", (e) => {
  if (e.target.id === "scriptModal") closeScriptModal();
});

// ========== Clear Logs ==========
function openClearLogsModal() {
  const modal = document.getElementById("clearLogsModal");
  const scope = document.getElementById("clearLogsScope");
  const confirmWrap = document.getElementById("clearLogsConfirmWrap");
  const confirmInput = document.getElementById("clearLogsConfirm");
  if (!modal) return;

  // Reset state
  if (scope) scope.value = "7";
  if (confirmInput) confirmInput.value = "";

  // Show confirm field only for "all" scope
  const updateConfirmVisibility = () => {
    if (confirmWrap)
      confirmWrap.style.display = scope.value === "all" ? "block" : "none";
  };
  updateConfirmVisibility();
  scope?.addEventListener("change", updateConfirmVisibility);

  modal.classList.add("active");
}

function closeClearLogsModal() {
  document.getElementById("clearLogsModal")?.classList.remove("active");
  const c = document.getElementById("clearLogsConfirm");
  if (c) c.value = "";
}

async function executeClearLogs() {
  const scope = document.getElementById("clearLogsScope")?.value || "7";
  const confirmInput = document.getElementById("clearLogsConfirm");

  if (scope === "all") {
    if (confirmInput?.value !== "DELETE") {
      return showToast("Type DELETE to confirm total wipe", "error");
    }
  }

  // Close modal + reset input immediately
  closeClearLogsModal();
  if (confirmInput) confirmInput.value = "";

  showToast("Clearing logs...", "info");

  try {
    let count = 0;

    if (scope === "all") {
      // Nuclear option - delete every single log row
      // Use a filter that matches all rows (id > 0 covers all bigserial IDs)
      const { data, error } = await NexaKS.supabase
        .from("logs")
        .delete()
        .gt("id", 0)
        .select("id");
      if (error) throw error;
      count = data ? data.length : 0;
    } else {
      // Delete logs older than N days
      const days = parseInt(scope);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const { data, error } = await NexaKS.supabase
        .from("logs")
        .delete()
        .lt("created_at", cutoff.toISOString())
        .select("id");
      if (error) throw error;
      count = data ? data.length : 0;
    }

    // Log the cleanup action itself (irony intended)
    await NexaKS.supabase.from("logs").insert({
      user_id: currentUser.id,
      action: "admin_clear_logs",
      status: "success",
      metadata: {
        message:
          scope === "all"
            ? "Cleared ALL logs (" + count + " entries)"
            : "Cleared logs older than " +
              scope +
              " days (" +
              count +
              " entries)",
      },
    });

    showToast("Cleared " + count + " log entries", "success");
    await loadLogs();
    await loadStats();
  } catch (e) {
    console.error("Clear logs:", e);
    showToast("Clear failed: " + e.message, "error");
  }
}

// ========== Bulk Delete Keys ==========
function openBulkDeleteModal() {
  const modal = document.getElementById("bulkDeleteModal");
  const scope = document.getElementById("bulkDeleteScope");
  const confirmWrap = document.getElementById("bulkDeleteConfirmWrap");
  const confirmInput = document.getElementById("bulkDeleteConfirm");
  if (!modal) return;

  if (scope) scope.value = "unclaimed";
  if (confirmInput) confirmInput.value = "";

  // Always require DELETE confirmation for key deletion (destructive)
  if (confirmWrap) confirmWrap.style.display = "block";

  modal.classList.add("active");
}

function closeBulkDeleteModal() {
  document.getElementById("bulkDeleteModal")?.classList.remove("active");
  const c = document.getElementById("bulkDeleteConfirm");
  if (c) c.value = "";
}

async function executeBulkDelete() {
  const scope =
    document.getElementById("bulkDeleteScope")?.value || "unclaimed";
  const confirmInput = document.getElementById("bulkDeleteConfirm");

  if (confirmInput?.value !== "DELETE") {
    return showToast("Type DELETE to confirm", "error");
  }

  closeBulkDeleteModal();
  showToast("Deleting keys...", "info");

  try {
    let statusFilter;
    let scopeLabel;
    if (scope === "unclaimed") {
      statusFilter = ["unclaimed"];
      scopeLabel = "unclaimed";
    } else if (scope === "revoked") {
      statusFilter = ["revoked"];
      scopeLabel = "revoked";
    } else if (scope === "expired") {
      statusFilter = ["expired"];
      scopeLabel = "expired";
    } else if (scope === "unclaimed_revoked") {
      statusFilter = ["unclaimed", "revoked"];
      scopeLabel = "unclaimed + revoked";
    }

    // Safety: never delete active keys via bulk
    const { data, error } = await NexaKS.supabase
      .from("keys")
      .delete()
      .in("status", statusFilter)
      .select("key");

    if (error) throw error;
    const count = data ? data.length : 0;

    await NexaKS.supabase.from("logs").insert({
      user_id: currentUser.id,
      action: "admin_bulk_delete",
      status: "success",
      metadata: {
        message: "Bulk deleted " + (count || 0) + " " + scopeLabel + " keys",
      },
    });

    showToast("Deleted " + (count || 0) + " keys", "success");
    await loadKeys();
    await loadStats();
    await loadLogs();
  } catch (e) {
    console.error("Bulk delete:", e);
    showToast("Delete failed: " + e.message, "error");
  }
}

// Modal overlay click handlers
document.getElementById("clearLogsModal")?.addEventListener("click", (e) => {
  if (e.target.id === "clearLogsModal") closeClearLogsModal();
});
document.getElementById("bulkDeleteModal")?.addEventListener("click", (e) => {
  if (e.target.id === "bulkDeleteModal") closeBulkDeleteModal();
});

// ESC key handling for new modals
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeClearLogsModal();
    closeBulkDeleteModal();
  }
});

// ========== Load projects into Generate Keys dropdown ==========
async function loadProjectsForForm() {
  try {
    const { data, error } = await NexaKS.supabase
      .from("projects")
      .select("id, name, slug")
      .order("name", { ascending: true });
    if (error) throw error;
    const select = document.getElementById("genProject");
    if (!select) return;
    const options = [
      '<option value="">-- None (unattached) --</option>',
    ].concat(
      (data || []).map(
        (p) =>
          '<option value="' +
          p.id +
          '">' +
          escapeHtml(p.name) +
          " (" +
          p.slug +
          ")</option>",
      ),
    );
    select.innerHTML = options.join("");
  } catch (e) {
    console.error("loadProjectsForForm:", e);
  }
}


// ========== Notifications (Activity Feed) ==========
// The "notifications" tab is a filtered live view of the logs table.
// We track script executions, HWID resets, and failed attempts.

const NOTIF_PAGE_SIZE = 100;
let notifOffset = 0;
let notifFilter = "all";
let notifCache = []; // rows currently displayed
let notifUnreadCount = 0;
let notifChannel = null;

// Action types we care about, grouped by filter
const NOTIF_ACTIONS = {
  executions: ["verify", "verify_bind"],
  resets: ["reset_hwid"],
  failed: ["verify_fail", "verify_error"],
};
NOTIF_ACTIONS.all = [
  ...NOTIF_ACTIONS.executions,
  ...NOTIF_ACTIONS.resets,
  ...NOTIF_ACTIONS.failed,
];

function actionLabel(action) {
  if (action === "verify" || action === "verify_bind") return "Script executed";
  if (action === "reset_hwid") return "HWID reset";
  if (action === "verify_fail") return "Failed attempt";
  if (action === "verify_error") return "Server error";
  return action;
}

function actionBadgeClass(action) {
  if (action === "verify" || action === "verify_bind") return "badge-success";
  if (action === "reset_hwid") return "badge-info";
  if (action === "verify_fail") return "badge-warning";
  if (action === "verify_error") return "badge-danger";
  return "badge";
}

function escapeHtmlNotif(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function loadNotifications(reset = true) {
  if (reset) {
    notifOffset = 0;
    notifCache = [];
    const tbody = document.getElementById("notifTableBody");
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px;">Loading...</td></tr>';
  }

  const actions = NOTIF_ACTIONS[notifFilter] || NOTIF_ACTIONS.all;
  try {
    const { data, error } = await NexaKS.supabase
      .from("logs")
      .select("*, users!logs_user_id_fkey(username)")
      .in("action", actions)
      .order("created_at", { ascending: false })
      .range(notifOffset, notifOffset + NOTIF_PAGE_SIZE - 1);

    if (error) throw error;

    if (reset) notifCache = data || [];
    else notifCache = notifCache.concat(data || []);

    notifOffset += NOTIF_PAGE_SIZE;
    renderNotifications();

    const loadMoreBtn = document.getElementById("notifLoadMore");
    if (loadMoreBtn) {
      loadMoreBtn.style.display = (data && data.length === NOTIF_PAGE_SIZE) ? "inline-flex" : "none";
    }
  } catch (e) {
    console.error("loadNotifications:", e);
    const tbody = document.getElementById("notifTableBody");
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--danger);padding:32px;">Failed to load: ' + escapeHtmlNotif(e.message) + '</td></tr>';
  }
}

function loadMoreNotifications() {
  loadNotifications(false);
}

function filterNotifications() {
  const sel = document.getElementById("notifFilter");
  notifFilter = sel ? sel.value : "all";
  loadNotifications(true);
}

function renderNotifications() {
  const tbody = document.getElementById("notifTableBody");
  const desc = document.getElementById("notifDesc");
  if (!tbody) return;

  if (desc) desc.textContent = "Showing " + notifCache.length + " event" + (notifCache.length === 1 ? "" : "s");

  if (notifCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px;">No activity yet</td></tr>';
    return;
  }

  tbody.innerHTML = notifCache.map((log) => {
    const when = timeAgo(new Date(log.created_at));
    const username = log.users?.username || (log.user_id ? "Unknown" : "Unclaimed");
    const details = escapeHtmlNotif(log.metadata?.message || log.key || "-");
    return (
      "<tr>" +
      '<td style="color:var(--text-muted);font-size:13px;white-space:nowrap;">' + escapeHtmlNotif(when) + "</td>" +
      '<td><span class="badge ' + actionBadgeClass(log.action) + '">' + escapeHtmlNotif(actionLabel(log.action)) + "</span></td>" +
      "<td>" + escapeHtmlNotif(username) + "</td>" +
      '<td style="color:var(--text-secondary);font-size:13px;">' + details + "</td>" +
      '<td><button class="icon-btn danger" title="Clear" onclick="clearNotification(\'' + log.id + '\')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button></td>' +
      "</tr>"
    );
  }).join("");
}

async function clearNotification(id) {
  const { error } = await NexaKS.supabase.from("logs").delete().eq("id", id);
  if (error) return showToast("Clear failed: " + error.message, "error");
  notifCache = notifCache.filter((n) => n.id !== id);
  renderNotifications();
  await loadNotifStats();
}

async function clearAllNotifications() {
  if (!confirm("Delete all notifications in the current view? This cannot be undone.")) return;
  const actions = NOTIF_ACTIONS[notifFilter] || NOTIF_ACTIONS.all;
  showToast("Clearing notifications...", "info");
  const { error } = await NexaKS.supabase
    .from("logs")
    .delete()
    .in("action", actions);
  if (error) return showToast("Clear failed: " + error.message, "error");
  notifCache = [];
  notifOffset = 0;
  renderNotifications();
  showToast("All notifications cleared", "success");
  await loadNotifStats();
}

// Daily summary stats (executions / resets / failed / unique users today)
async function loadNotifStats() {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const iso = startOfDay.toISOString();

  try {
    const [execRes, resetRes, failRes, userRes] = await Promise.all([
      NexaKS.supabase.from("logs").select("*", { count: "exact", head: true })
        .in("action", NOTIF_ACTIONS.executions).gte("created_at", iso),
      NexaKS.supabase.from("logs").select("*", { count: "exact", head: true })
        .eq("action", "reset_hwid").gte("created_at", iso),
      NexaKS.supabase.from("logs").select("*", { count: "exact", head: true })
        .in("action", NOTIF_ACTIONS.failed).gte("created_at", iso),
      NexaKS.supabase.from("logs").select("user_id")
        .in("action", NOTIF_ACTIONS.executions).gte("created_at", iso)
        .not("user_id", "is", null),
    ]);

    const $ = (id) => document.getElementById(id);
    if ($("notifStatExecToday")) $("notifStatExecToday").textContent = execRes.count ?? 0;
    if ($("notifStatResetToday")) $("notifStatResetToday").textContent = resetRes.count ?? 0;
    if ($("notifStatFailedToday")) $("notifStatFailedToday").textContent = failRes.count ?? 0;
    const uniqueUsers = new Set((userRes.data || []).map((r) => r.user_id)).size;
    if ($("notifStatUsersToday")) $("notifStatUsersToday").textContent = uniqueUsers;
  } catch (e) {
    console.error("loadNotifStats:", e);
  }
}

// Real-time subscription: whenever a new log row is inserted with a tracked
// action, prepend it to the visible list (if the filter matches), bump the
// unread badge, and show a toast.
function subscribeToLogs() {
  if (!NexaKS.supabase?.channel) return;
  if (notifChannel) return; // already subscribed

  notifChannel = NexaKS.supabase
    .channel("admin-activity-feed")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "logs" },
      async (payload) => {
        const log = payload.new;
        if (!log || !NOTIF_ACTIONS.all.includes(log.action)) return;

        // Fetch username since realtime payload doesn't include the join
        let username = "Unknown";
        if (log.user_id) {
          try {
            const { data: u } = await NexaKS.supabase
              .from("users").select("username").eq("id", log.user_id).maybeSingle();
            if (u?.username) username = u.username;
          } catch (_) {}
        } else {
          username = "Unclaimed";
        }
        const enriched = { ...log, users: { username } };

        // Prepend to cache if filter allows
        const actions = NOTIF_ACTIONS[notifFilter] || NOTIF_ACTIONS.all;
        if (actions.includes(log.action)) {
          notifCache.unshift(enriched);
          if (notifCache.length > NOTIF_PAGE_SIZE * 3) notifCache.pop();
          renderNotifications();
        }

        // Toast (only if not currently viewing the notifications tab)
        const tab = document.getElementById("tab-notifications");
        const isViewingNotifs = tab && tab.getBoundingClientRect().top > -100 && tab.getBoundingClientRect().top < window.innerHeight / 2;
        if (!isViewingNotifs) {
          bumpNotifBadge();
          showNotifToast(actionLabel(log.action), username, log.metadata?.message || "");
        }

        // Refresh stats
        loadNotifStats();
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "logs" },
      (payload) => {
        const id = payload.old?.id;
        if (!id) return;
        notifCache = notifCache.filter((n) => n.id !== id);
        renderNotifications();
      }
    )
    .subscribe();
}

function bumpNotifBadge() {
  notifUnreadCount++;
  const badge = document.getElementById("notifBadge");
  if (!badge) return;
  badge.textContent = notifUnreadCount > 99 ? "99+" : notifUnreadCount;
  badge.style.display = "inline-block";
}

function clearNotifBadge() {
  notifUnreadCount = 0;
  const badge = document.getElementById("notifBadge");
  if (badge) badge.style.display = "none";
}

function showNotifToast(title, username, message) {
  const container = document.getElementById("notifToastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.style.cssText = "background:#1a1a1e;border:1px solid #2a2a2f;border-left:3px solid #7c3aed;border-radius:10px;padding:12px 14px;color:#e5e7eb;font-family:'Inter',sans-serif;font-size:13px;box-shadow:0 8px 24px rgba(0,0,0,0.35);pointer-events:auto;opacity:0;transform:translateX(20px);transition:opacity 0.25s ease,transform 0.25s ease;";
  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-weight:700;margin-bottom:4px;color:#fff;";
  titleEl.textContent = title;
  const bodyEl = document.createElement("div");
  bodyEl.style.cssText = "color:#a0a0b0;font-size:12px;";
  bodyEl.textContent = username + (message ? " â€” " + message : "");
  toast.appendChild(titleEl);
  toast.appendChild(bodyEl);
  container.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateX(0)";
  });
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(20px)";
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}
