/* NexaKS - Dashboard JS (fixed: no race with gate.js) */

let currentUser = null;
let currentProfile = null;
let currentKey = null;
let currentProject = null;
let currentScript = null;

// HWID reset cooldown in hours - keep in sync with dashboard.html modal text
// and with the Discord bot panel copy.
const HWID_RESET_COOLDOWN_HOURS = 15;

document.addEventListener("DOMContentLoaded", async () => {
  const loader = document.getElementById("authLoader");
  const main = document.getElementById("dashboardMain");

  const forceShow = setTimeout(() => {
    if (loader) loader.style.display = "none";
    if (main) main.style.display = "grid";
  }, 12000);

  try {
    // Wait for auth client (Keyora/NexaKS) to load - it's set by supabase.js in head
    const client = window.Keyora || window.NexaKS;
    if (!client) {
      // supabase.js never loaded â€” hard failure, show message
      clearTimeout(forceShow);
      if (loader)
        loader.innerHTML =
          '<div style="text-align:center;color:white;padding:40px;"><h2>Auth failed to load</h2><p style="color:#a0a0b0;margin:16px 0;">Please <a href="/" style="color:#8b5cf6;">reload</a> or try again.</p></div>';
      return;
    }

    // Wait for gate.js to resolve the role (it already retries + handles OAuth callback hash)
    // gate.js sets window.KEYORA_ROLE after DB lookup. Poll up to 10 seconds.
    let role = window.KEYORA_ROLE || null;
    for (let i = 0; i < 100 && !role; i++) {
      await new Promise(r => setTimeout(r, 100));
      role = window.KEYORA_ROLE || null;
    }

    // Get the Supabase user (should be cached now that gate.js resolved it)
    try { currentUser = await client.getCurrentUser(); } catch (_) { currentUser = null; }

    // If gate.js says not logged in AND we can't get a user, show sign-in prompt
    // (NO redirect loop â€” user stays here and sees a clear message)
    if (!role && !currentUser) {
      clearTimeout(forceShow);
      if (loader)
        loader.innerHTML =
          '<div style="text-align:center;color:white;padding:40px;"><h2>Not signed in</h2><p style="color:#a0a0b0;margin:16px 0;">Please <a href="/" style="color:#8b5cf6;">go back</a> and sign in with Discord.</p></div>';
      return;
    }

    // Clear any legacy redirect marker from the old buggy version
    try { sessionStorage.removeItem("nexaks_redirected"); } catch (_) {}

    // Retry user fetch once if it failed initially
    if (!currentUser) {
      try { currentUser = await client.getCurrentUser(); } catch (_) {}
    }
    if (!currentUser) {
      clearTimeout(forceShow);
      if (loader)
        loader.innerHTML =
          '<div style="text-align:center;color:white;padding:40px;"><h2>Session issue</h2><p style="color:#a0a0b0;margin:16px 0;">Please <a href="/" style="color:#8b5cf6;">reload</a> and sign in again.</p></div>';
      return;
    }

    // Load the user's profile row (with fallback creation if missing)
    currentProfile = await client.getUserProfile(currentUser.id);
    if (!currentProfile) {
      const meta = currentUser.user_metadata || {};
      const discordId = meta.provider_id || meta.sub || null;

      // Race-safe: if a Discord-first row already exists (bot created it earlier),
      // reuse it instead of inserting a duplicate.
      if (discordId) {
        try {
          const { data: existingByDiscord } = await client.supabase
            .from("users")
            .select("*")
            .eq("discord_id", discordId)
            .maybeSingle();
          if (existingByDiscord) currentProfile = existingByDiscord;
        } catch (e) {
          console.error("Discord-id lookup:", e);
        }
      }

      if (!currentProfile) {
        try {
          const { data } = await client.supabase
            .from("users")
            .insert({
              id: currentUser.id,
              discord_id: discordId,
              username:
                meta.full_name || meta.name || meta.user_name || "User",
              avatar_url: meta.avatar_url || null,
            })
            .select()
            .maybeSingle();
          currentProfile = data;
        } catch (e) {
          console.error("Manual profile insert:", e);
        }
      }

      if (!currentProfile) {
        currentProfile = {
          id: currentUser.id,
          username:
            meta.full_name || meta.name || meta.user_name || "User",
          avatar_url: meta.avatar_url || null,
          is_admin: false,
        };
      }
    }

    // ---- Fix A: Auto-bind pending admin key to this Discord user ----
    // If the user came here via the admin-key modal on index.html, ang key
    // ay naka-store sa 'nexaks_pending_admin_key' pero walang user_id kasi
    // walang Discord session pa noon. Bind it now para ma-detect ng gate.js
    // as 'admin' tier on the next role check.
    try {
      const pendingKey = localStorage.getItem("nexaks_pending_admin_key");
      if (pendingKey && currentUser?.id) {
        const { error: bindError } = await NexaKS.supabase
          .from("keys")
          .update({ user_id: currentUser.id })
          .eq("key", pendingKey)
          .eq("plan", "admin")
          .in("status", ["active", "unclaimed"])
          .is("user_id", null); // Only bind if not yet claimed by anyone

        if (bindError) {
          console.warn("Admin key auto-bind failed:", bindError.message);
        } else {
          console.log("[dashboard] Admin key bound to user:", currentUser.id);
          // Force reload so gate.js re-runs and picks up the new admin role
          localStorage.removeItem("nexaks_pending_admin_key");
          setTimeout(() => window.location.reload(), 500);
          return;
        }
        localStorage.removeItem("nexaks_pending_admin_key");
      }
    } catch (e) {
      console.warn("Admin key auto-bind exception:", e);
    }

    try {
      await loadUserKey();
    } catch (e) {
      console.error("loadUserKey:", e);
    }
    try {
      await loadActivity();
    } catch (e) {
      console.error("loadActivity:", e);
    }

    renderUserInfo();
  } catch (err) {
    console.error("Dashboard init:", err);
  } finally {
    clearTimeout(forceShow);
    if (loader) loader.style.display = "none";
    if (main) main.style.display = "grid";

    document.querySelectorAll(".card, .stat-card").forEach((el, i) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(10px)";
      el.style.transition = "opacity 0.4s ease, transform 0.4s ease";
      setTimeout(() => {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      }, i * 60);
    });
  }
});

function renderUserInfo() {
  if (!currentUser) return;
  const meta = currentUser.user_metadata || {};
  const username =
    currentProfile?.username ||
    meta.full_name ||
    meta.name ||
    meta.user_name ||
    "User";
  const avatarUrl = currentProfile?.avatar_url || meta.avatar_url;

  const $ = (id) => document.getElementById(id);
  if ($("userName")) $("userName").textContent = username;
  if ($("userNameSmall")) $("userNameSmall").textContent = username;

  if (avatarUrl && $("userAvatarImg")) {
    $("userAvatarImg").src = avatarUrl;
    $("userAvatarImg").style.display = "block";
    if ($("userAvatar")) $("userAvatar").style.display = "none";
  } else if ($("userAvatar")) {
    $("userAvatar").textContent = username.charAt(0).toUpperCase();
  }

  // Admin nav visibility is now owned by js/gate.js (which knows whether
  // the user is Discord-owner, admin-key session, or a regular user).
  // Do NOT touch adminLink here or we'd override gate.js for regular users.

  const plan = currentKey?.plan || "free";
  if ($("userRole"))
    $("userRole").textContent =
      plan.charAt(0).toUpperCase() + plan.slice(1) + " Plan";
}

async function loadUserKey() {
  const { data, error } = await NexaKS.supabase
    .from("keys")
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Load key:", error);
    return;
  }

  const noKey = document.getElementById("noKeyState");
  const active = document.getElementById("activeKeyState");

  if (!data) {
    if (noKey) noKey.style.display = "block";
    if (active) active.style.display = "none";
    return;
  }

  currentKey = data;
  if (noKey) noKey.style.display = "none";
  if (active) active.style.display = "block";

  // Fetch the linked project + its published script (for the short loader)
  currentProject = null;
  currentScript = null;
  if (currentKey.project_id) {
    const { data: proj } = await NexaKS.supabase
      .from("projects")
      .select("*")
      .eq("id", currentKey.project_id)
      .maybeSingle();
    currentProject = proj;
    if (proj) {
      const { data: scripts } = await NexaKS.supabase
        .from("project_scripts")
        .select("*")
        .eq("project_id", proj.id)
        .eq("status", "published")
        .order("updated_at", { ascending: false });
      if (scripts && scripts.length > 0) {
        currentScript =
          scripts.find((s) => s.plan === currentKey.plan) ||
          scripts.find((s) => s.plan === "free") ||
          scripts[0];
      }
    }
  }

  renderKey();
}

function renderKey() {
  if (!currentKey) return;
  const $ = (id) => document.getElementById(id);

  if ($("keyValue")) $("keyValue").textContent = currentKey.key;

  const hwid = currentKey.hwid;
  if ($("hwidValue")) {
    $("hwidValue").textContent = hwid
      ? hwid.length > 12
        ? hwid.substring(0, 8) + "..." + hwid.substring(hwid.length - 4)
        : hwid
      : "Not bound yet";
  }

  if ($("activatedDate")) {
    $("activatedDate").textContent = currentKey.created_at
      ? new Date(currentKey.created_at).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "-";
  }

  if (currentKey.expires_at) {
    const expires = new Date(currentKey.expires_at);
    const daysLeft = Math.max(0, Math.ceil((expires - new Date()) / 86400000));
    if ($("expiresIn"))
      $("expiresIn").innerHTML =
        daysLeft +
        '<span style="font-size:14px;color:var(--text-muted);"> days</span>';
    if ($("expiresDate"))
      $("expiresDate").textContent =
        "Renews " +
        expires.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
    if ($("expiresValue"))
      $("expiresValue").textContent = expires.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  } else if (currentKey.duration_days) {
    const d = currentKey.duration_days;
    const label = d + " day" + (d > 1 ? "s" : "");
    if ($("expiresIn"))
      $("expiresIn").innerHTML =
        d +
        '<span style="font-size:14px;color:var(--text-muted);"> days</span>';
    if ($("expiresDate"))
      $("expiresDate").textContent = "Starts on first use";
    if ($("expiresValue")) $("expiresValue").textContent = label;
  } else {
    if ($("expiresIn")) $("expiresIn").textContent = "Lifetime";
    if ($("expiresDate")) $("expiresDate").textContent = "Never expires";
    if ($("expiresValue")) $("expiresValue").textContent = "Lifetime";
  }

  const used = currentKey.hwid_reset_count || 0;
  const limit = currentKey.hwid_reset_limit || 5;
  if ($("hwidResets"))
    $("hwidResets").innerHTML =
      used +
      '<span style="font-size:14px;color:var(--text-muted);">/' +
      limit +
      "</span>";
  if ($("hwidResetsSub"))
    $("hwidResetsSub").textContent =
      Math.max(0, limit - used) + " resets remaining";
  if ($("execCount"))
    $("execCount").textContent = currentKey.execution_count || 0;
  if ($("execSub"))
    $("execSub").textContent = currentKey.last_used
      ? "Last used " + timeAgo(new Date(currentKey.last_used))
      : "No executions yet";

  const plan = currentKey.plan || "free";
  const badge = $("planBadge");
  if (badge) {
    badge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
    badge.className =
      "badge " +
      (plan === "enterprise"
        ? "badge-warning"
        : plan === "pro"
          ? "badge-info"
          : "badge");
  }

  // ---- SHORT LOADER ----
  const origin = window.location.origin;
  const HWID_SUFFIX =
    '&hwid="..game:GetService("RbxAnalyticsService"):GetClientId()';
  let loader;
  if (currentProject && currentScript) {
    const base =
      origin +
      "/api/load/" +
      currentProject.slug +
      (currentScript.load_id ? "?script=" + currentScript.load_id : "");
    if (currentScript.keyless) {
      loader = 'loadstring(game:HttpGet("' + base + '"))()';
    } else {
      const sep = base.includes("?") ? "&" : "?";
      loader =
        '_G.script_key = "' +
        currentKey.key +
        '"\n' +
        'loadstring(game:HttpGet("' +
        base +
        sep +
        'key=".._G.script_key..' +
        '"' +
        HWID_SUFFIX +
        "))()";
    }
  } else {
    loader =
      '_G.script_key = "' +
      currentKey.key +
      '"\n' +
      'loadstring(game:HttpGet("' +
      origin +
      '/api/verify?license=".._G.script_key..' +
      '"' +
      HWID_SUFFIX +
      "))()";
  }
  if ($("loaderScript")) $("loaderScript").value = loader;
}

async function loadActivity() {
  const { data, error } = await NexaKS.supabase
    .from("logs")
    .select("*")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Load activity:", error);
    return;
  }

  const tbody = document.getElementById("activityTableBody");
  if (!tbody) return;

  if (!data || data.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="3" style="text-align:center;color:var(--text-muted);padding:32px;">No activity yet</td></tr>';
    return;
  }

  tbody.innerHTML = data
    .map((log) => {
      const time = timeAgo(new Date(log.created_at));
      const cls =
        log.status === "success"
          ? "badge-success"
          : log.status === "failed"
            ? "badge-danger"
            : log.status === "warning"
              ? "badge-warning"
              : "badge-info";
      return (
        '<tr><td><span class="badge ' +
        cls +
        '">' +
        escapeHtml(log.action) +
        "</span></td><td>" +
        escapeHtml(log.metadata?.message || "-") +
        '</td><td style="color:var(--text-muted);">' +
        time +
        "</td></tr>"
      );
    })
    .join("");
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function timeAgo(date) {
  const s = Math.floor((new Date() - date) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return Math.floor(s / 60) + " mins ago";
  if (s < 86400) return Math.floor(s / 3600) + " hours ago";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function toggleSidebar() {
  const s = document.getElementById("sidebar");
  if (s) s.classList.toggle("open");
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

function showSection(section) {
  const target = document.getElementById("section-" + section);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.style.transition = "box-shadow 0.3s";
    target.style.boxShadow = "0 0 0 2px var(--accent)";
    setTimeout(() => (target.style.boxShadow = ""), 1500);
  }
  document.getElementById("sidebar")?.classList.remove("open");
}

function copyKey() {
  if (!currentKey) return;
  navigator.clipboard
    .writeText(currentKey.key)
    .then(() => {
      const btn = document.getElementById("copyText");
      if (btn) {
        const original = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(() => (btn.textContent = original), 2000);
      }
      showToast("License key copied", "success");
    })
    .catch(() => showToast("Failed to copy", "error"));
}

function copyLoader() {
  const t = document.getElementById("loaderScript");
  if (!t) return;
  navigator.clipboard
    .writeText(t.value)
    .then(() => showToast("Loader copied", "success"))
    .catch(() => showToast("Failed to copy", "error"));
}

function openResetModal() {
  if (!currentKey) return showToast("No active license", "error");
  document.getElementById("resetModal")?.classList.add("active");
}
function closeResetModal() {
  document.getElementById("resetModal")?.classList.remove("active");
}

async function confirmReset() {
  if (!currentKey) return showToast("No active license", "error");

  if (currentKey.last_hwid_reset) {
    const hrs =
      (new Date() - new Date(currentKey.last_hwid_reset)) / 3600000;
    if (hrs < HWID_RESET_COOLDOWN_HOURS) {
      return showToast(
        "Cooldown active. Try again in " +
          Math.ceil(HWID_RESET_COOLDOWN_HOURS - hrs) +
          "h",
        "error",
      );
    }
  }
  if (
    (currentKey.hwid_reset_count || 0) >= (currentKey.hwid_reset_limit || 5)
  ) {
    return showToast("Reset limit reached", "error");
  }

  closeResetModal();
  showToast("Resetting hardware ID...", "info");

  const { error } = await NexaKS.supabase
    .from("keys")
    .update({
      hwid: null,
      hwid_reset_count: (currentKey.hwid_reset_count || 0) + 1,
      last_hwid_reset: new Date().toISOString(),
    })
    .eq("key", currentKey.key);

  if (error) return showToast("Reset failed: " + error.message, "error");

  await NexaKS.supabase.from("logs").insert({
    user_id: currentUser.id,
    key: currentKey.key,
    action: "reset_hwid",
    status: "success",
    metadata: { message: "HWID reset via dashboard" },
  });

  showToast("Hardware ID reset", "success");
  await loadUserKey();
  await loadActivity();
}

function openRedeemModal() {
  document.getElementById("redeemModal")?.classList.add("active");
  setTimeout(() => document.getElementById("redeemInput")?.focus(), 100);
}
function closeRedeemModal() {
  document.getElementById("redeemModal")?.classList.remove("active");
  const i = document.getElementById("redeemInput");
  if (i) i.value = "";
}

async function confirmRedeem() {
  const input = document.getElementById("redeemInput");
  if (!input) return;
  const key = input.value.trim().toUpperCase();
  if (!key) return showToast("Enter a license key", "error");
  if (!key.startsWith("NXKS-")) return showToast("Invalid key format", "error");

  closeRedeemModal();
  showToast("Redeeming...", "info");

  const { data: existing } = await NexaKS.supabase
    .from("keys")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (!existing) return showToast("Key not found", "error");
  if (existing.user_id && existing.user_id !== currentUser.id)
    return showToast("Key already claimed", "error");
  if (existing.status === "revoked") return showToast("Key revoked", "error");
  if (existing.status === "expired") return showToast("Key expired", "error");

  if (existing.project_id && existing.plan !== "admin") {
    try {
      const { data: proj } = await NexaKS.supabase
        .from("projects")
        .select("id, name")
        .eq("id", existing.project_id)
        .maybeSingle();
      if (proj) {
        const { data: matching } = await NexaKS.supabase
          .from("project_scripts")
          .select("id")
          .eq("project_id", proj.id)
          .eq("plan", existing.plan)
          .eq("status", "published")
          .limit(1);
        if (!matching || matching.length === 0) {
          return showToast(
            "This " + existing.plan.toUpperCase() + " key needs a matching " +
            existing.plan.toUpperCase() + " script in " + proj.name +
            ". Contact the owner.",
            "error"
          );
        }
      }
    } catch (e) {
      console.warn("Plan match check:", e);
    }
  }

  const updates = { user_id: currentUser.id, status: "active" };
  if (existing.duration_days && !existing.expires_at) {
    const exp = new Date();
    exp.setDate(exp.getDate() + existing.duration_days);
    updates.expires_at = exp.toISOString();
  }

  const { error } = await NexaKS.supabase
    .from("keys")
    .update(updates)
    .eq("key", key);
  if (error) return showToast("Redeem failed: " + error.message, "error");

  // NOTE: admin keys no longer auto-promote is_admin â€” role is DB-driven now.
  // Owner status is set only by the trg_first_user_admin trigger on the first Discord login.
  // Client admins are detected via hasActiveAdminKey() in supabase.js (v5).

  await NexaKS.supabase.from("logs").insert({
    user_id: currentUser.id,
    key: key,
    action: "redeem",
    status: "success",
    metadata: { message: "Redeemed via dashboard" },
  });

  showToast("License activated", "success");
  await loadUserKey();
  await loadActivity();
  renderUserInfo();

  // Reload the page so gate.js re-runs and picks up the new admin role
  setTimeout(() => window.location.reload(), 1000);
}

async function handleLogout() {
  if (!confirm("Sign out from Keyora?")) return;
  try {
    localStorage.removeItem("keyora_session");
    localStorage.removeItem("nexaks_session");
    localStorage.removeItem("nexaks_pending_discord");
    localStorage.removeItem("nexaks_pending_admin_key");
    localStorage.removeItem("keyora_session_row_id");
    sessionStorage.removeItem("nexaks_redirected");
  } catch (_) {}
  try {
    const client = window.Keyora || window.NexaKS;
    if (client?.signOut) await client.signOut();
  } catch (e) {
    console.warn("signOut:", e);
  }
  window.location.href = "/";
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeResetModal();
    closeRedeemModal();
  }
});
document.getElementById("resetModal")?.addEventListener("click", (e) => {
  if (e.target.id === "resetModal") closeResetModal();
});
document.getElementById("redeemModal")?.addEventListener("click", (e) => {
  if (e.target.id === "redeemModal") closeRedeemModal();
});

function showToast(message, type) {
  type = type || "info";
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast " + type;
  const span = document.createElement("span");
  span.textContent = message;
  toast.appendChild(span);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = "slideIn 0.3s ease reverse";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}
