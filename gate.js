/* NexaKS - Access Gate v2 (fixed boot flow)
 *
 * Drop this into every protected page BEFORE any other JS.
 * It enforces:
 *   - No session at all           -> redirect to /login.html
 *   - Discord OAuth session only  -> allow dashboard only, hide admin nav
 *   - Admin key session           -> full access (re-verified against server)
 *
 * Set window.NEXAKS_PAGE = "dashboard" | "admin" | "projects" | "analytics"
 * BEFORE loading this script (or add data-page="..." to <body>).
 */

(function () {
  "use strict";

  const SESSION_KEY = "nexaks_session";
  const PAGE = (window.NEXAKS_PAGE || document.body?.dataset?.page || guessPage()).toLowerCase();

  const TURNSTILE_SITE_KEY = window.NEXAKS_TURNSTILE_SITE_KEY ||
    "0x4AAAAAAD-YvdvOI_vA3JJt";

  const ADMIN_PAGES = ["admin", "projects", "analytics"];
  const ADMIN_ONLY_HREF_PATTERNS = ["projects.html", "analytics.html", "admin.html"];
  const ADMIN_ONLY_SECTIONS      = ["botcommands"];

  function guessPage() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes("admin"))     return "admin";
    if (path.includes("projects"))  return "projects";
    if (path.includes("analytics")) return "analytics";
    if (path.includes("dashboard")) return "dashboard";
    return "dashboard";
  }

  function readSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || typeof s !== "object") return null;
      if (s.expires_at && Date.now() > s.expires_at) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch (_) { return null; }
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("nexaks_pending_discord");
  }

  function redirect(url) { window.location.replace(url); }

  async function reverifyAdminSession(session) {
    if (!session || !session.key) return false;
    try {
      const res = await fetch("/api/verify-admin-key-refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: session.key })
      });
      const data = await res.json().catch(() => ({}));
      return !!(res.ok && data.success);
    } catch (_) { return false; }
  }

  function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve();
    if (window._nexaksTurnstileLoading) return window._nexaksTurnstileLoading;
    window._nexaksTurnstileLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true; s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => resolve();
      document.head.appendChild(s);
    });
    return window._nexaksTurnstileLoading;
  }

  function showKeyPrompt(reason) {
    const existing = document.getElementById("nexaks-key-prompt");
    if (existing) { existing.style.display = "flex"; return; }
    const overlay = document.createElement("div");
    overlay.id = "nexaks-key-prompt";
    overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;font-family:'Inter',sans-serif;";
    overlay.innerHTML =
      '<div style="max-width:420px;width:100%;background:#1a1a1e;border:1px solid #2a2a2f;border-radius:16px;padding:32px 28px;">' +
        '<h2 style="font-size:22px;font-weight:700;margin:0 0 8px;color:#e5e7eb;letter-spacing:-0.02em;">Admin Key Required</h2>' +
        '<p style="color:#9ca3af;font-size:14px;margin:0 0 20px;">' + (reason || "This page requires an admin key to access.") + '</p>' +
        '<div id="nexaks-prompt-err" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#fca5a5;padding:10px 12px;border-radius:8px;font-size:13px;margin-bottom:12px;"></div>' +
        '<input id="nexaks-prompt-input" type="text" placeholder="NXKS-XXXX-XXXX-XXXX-XXXX" maxlength="24" ' +
          'style="width:100%;box-sizing:border-box;padding:12px 14px;background:#0f0f11;border:1px solid #3a3a3f;border-radius:8px;color:#fff;font-family:\'JetBrains Mono\',monospace;font-size:14px;text-transform:uppercase;margin-bottom:14px;">' +
        '<div id="nexaks-prompt-turnstile" style="display:flex;justify-content:center;margin-bottom:14px;min-height:65px;"></div>' +
        '<div style="display:flex;gap:10px;">' +
          '<button id="nexaks-prompt-cancel" style="flex:1;padding:12px;background:transparent;border:1px solid #3a3a3f;border-radius:8px;color:#9ca3af;font-weight:600;cursor:pointer;font-family:inherit;">Cancel</button>' +
          '<button id="nexaks-prompt-submit" style="flex:2;padding:12px;background:linear-gradient(135deg,#7c3aed,#ec4899);border:none;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;font-family:inherit;">Verify</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    const input = document.getElementById("nexaks-prompt-input");
    const err = document.getElementById("nexaks-prompt-err");
    const submit = document.getElementById("nexaks-prompt-submit");
    const cancel = document.getElementById("nexaks-prompt-cancel");
    const turnstileBox = document.getElementById("nexaks-prompt-turnstile");

    let turnstileToken = null;
    let turnstileWidgetId = null;
    loadTurnstileScript().then(() => {
      if (window.turnstile && turnstileBox) {
        try {
          turnstileWidgetId = window.turnstile.render(turnstileBox, {
            sitekey: TURNSTILE_SITE_KEY,
            theme: "dark",
            callback: (token) => { turnstileToken = token; },
            "expired-callback": () => { turnstileToken = null; },
            "error-callback": () => { turnstileToken = null; }
          });
        } catch (e) { console.warn("Turnstile render failed:", e); }
      }
    });

    input.focus();
    input.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit.click(); });

    cancel.addEventListener("click", () => {
      overlay.remove();
      if (PAGE !== "dashboard") window.location.href = "/dashboard.html";
    });

    submit.addEventListener("click", async () => {
      err.style.display = "none";
      const key = input.value.trim().toUpperCase();
      if (!key.startsWith("NXKS-") || key.length !== 24) {
        err.textContent = "Invalid key format.";
        err.style.display = "block";
        return;
      }
      if (!turnstileToken) {
        err.textContent = "Please complete the captcha first.";
        err.style.display = "block";
        return;
      }
      submit.disabled = true;
      submit.textContent = "Verifying...";

      try {
        const res = await fetch("/api/verify-admin-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: key, token: turnstileToken })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) throw new Error(data.error || "Verification failed.");

        const existing = readSession() || {};
        const session = Object.assign({}, existing, {
          key: data.session.key,
          plan: "admin",
          user_id: data.session.user_id || existing.user_id || null,
          username: data.session.username || existing.username || "Admin",
          is_admin: true,
          login_method: existing.login_method === "discord" ? "discord+admin_key" : "admin_key",
          expires_at: Date.now() + 7 * 24 * 3600 * 1000
        });
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));

        overlay.remove();
        window.location.href = "/dashboard.html";
      } catch (ex) {
        err.textContent = ex.message || "Verification failed.";
        err.style.display = "block";
        submit.disabled = false;
        submit.textContent = "Verify";
        try { window.turnstile && turnstileWidgetId != null && window.turnstile.reset(turnstileWidgetId); } catch (_) {}
        turnstileToken = null;
      }
    });
  }

  // ---------- SIDEBAR VISIBILITY ----------

  function isAdminNavItem(a) {
    if (!a || a.classList.contains("logo")) return false;
    // Preferred: explicit marker (works even for anchors we don't recognize)
    if (a.getAttribute("data-adminonly") === "true") return true;
    // Legacy fallback: match by href/onclick
    const href = (a.getAttribute("href") || "").toLowerCase();
    const onclick = (a.getAttribute("onclick") || "").toLowerCase();
    for (const pat of ADMIN_ONLY_HREF_PATTERNS) if (href.includes(pat)) return true;
    for (const sec of ADMIN_ONLY_SECTIONS) {
      if (onclick.includes("showsection('" + sec + "'") ||
          onclick.includes('showsection("' + sec + '"')) return true;
    }
    return false;
  }

  function hideAdminNav() {
    document.querySelectorAll("a").forEach((a) => {
      if (isAdminNavItem(a)) a.style.display = "none";
    });
    // The Admin Panel link has id="adminLink"; make sure it's hidden too
    const adminLink = document.getElementById("adminLink");
    if (adminLink) adminLink.style.display = "none";
  }

  function showAdminNav() {
    document.querySelectorAll("a").forEach((a) => {
      if (isAdminNavItem(a)) a.style.display = "";
    });
    const adminLink = document.getElementById("adminLink");
    if (adminLink) {
      adminLink.href = "admin.html";
      adminLink.style.display = "";
    }
  }

  function blockAdminNavClicks() {
    document.addEventListener("click", function (e) {
      const link = e.target.closest("a");
      if (!isAdminNavItem(link)) return;
      e.preventDefault();
      e.stopPropagation();
      showKeyPrompt("This page requires an admin key. Enter it below to unlock.");
    }, true);
  }

  // ---------- MAIN GATE LOGIC (rewritten for reliability) ----------

  // Wait up to ~5s for the Supabase client wrapper to be available.
  async function waitForNexaKS() {
    for (let i = 0; i < 50; i++) {
      if (window.NexaKS?.getCurrentUser) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  // Try to get the Discord OAuth user, retrying briefly since supabase.js
  // may still be settling the session from the URL hash.
  async function getDiscordUserResilient() {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const user = await window.NexaKS.getCurrentUser();
        if (user) return user;
      } catch (_) {}
      await new Promise(r => setTimeout(r, 400));
    }
    return null;
  }

  // Retry profile lookup with a small backoff since RLS/session may not be
  // fully settled on the very first attempt after OAuth callback.
  async function getProfileResilient(userId) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const profile = await window.NexaKS.getUserProfile(userId);
        if (profile) return profile;
      } catch (e) {
        console.warn("[gate] profile lookup attempt " + (attempt + 1) + " failed:", e);
      }
      await new Promise(r => setTimeout(r, 400));
    }
    return null;
  }

  async function boot() {
    const nexaReady = await waitForNexaKS();
    console.log("[gate] nexaReady:", nexaReady);

    // ---- Step 1: read whatever's in localStorage ----
    let session = readSession();
    console.log("[gate] existing session:", session);

    // ---- Step 2: fold in Discord OAuth if there's an active one ----
    if (nexaReady) {
      const discordUser = await getDiscordUserResilient();
      console.log("[gate] discord user:", discordUser?.id);

      if (discordUser) {
        // Fetch profile for is_admin flag (with retry)
        const profile = await getProfileResilient(discordUser.id);
        console.log("[gate] profile:", profile);

        const isAdminFromDb = !!profile?.is_admin;
        const username = profile?.username ||
                         discordUser.user_metadata?.full_name ||
                         discordUser.user_metadata?.name || "User";

        // Detect "account switch": existing session belongs to a different user.
        const previousUserId = session?.user_id;
        const isAccountSwitch = previousUserId && previousUserId !== discordUser.id;

        const wasAdminKey = !isAccountSwitch && session?.login_method &&
          String(session.login_method).includes("admin_key");
        const inheritAdminKey = wasAdminKey && session?.is_admin && session?.key;

        // Preserve the existing admin-key credentials BEFORE overwriting session
        const preservedKey = inheritAdminKey ? session.key : null;

        session = {
          user_id: discordUser.id,
          username: username,
          is_admin: isAdminFromDb || !!inheritAdminKey,
          login_method: inheritAdminKey ? "discord+admin_key" : "discord",
          expires_at: Date.now() + 7 * 24 * 3600 * 1000
        };
        if (inheritAdminKey && preservedKey) {
          session.key = preservedKey;
          session.plan = "admin";
        }

        // ALWAYS save - no try/catch swallowing so bugs surface in console
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        localStorage.removeItem("nexaks_pending_discord");
        console.log("[gate] session saved. is_admin:", session.is_admin);
      }
    }

    // ---- Step 3: no session at all => login page ----
    if (!session) {
      console.log("[gate] no session, redirecting to login");
      redirect("/login.html");
      return;
    }

    // ---- Step 4: reverify admin-key sessions against the server ----
    await guardAndApply(session);
  }

  async function guardAndApply(session) {
    const usedAdminKey = session.login_method &&
      String(session.login_method).includes("admin_key");

    if (session.is_admin && usedAdminKey && session.key) {
      const ok = await reverifyAdminSession(session);
      if (!ok) {
        // The admin key is gone/revoked/expired. Demote to whatever remains.
        const demoted = Object.assign({}, session);
        delete demoted.key;
        delete demoted.plan;
        if (demoted.user_id) {
          // Keep the Discord identity, strip admin
          demoted.is_admin = false;
          demoted.login_method = "discord";
          try { localStorage.setItem(SESSION_KEY, JSON.stringify(demoted)); } catch (_) {}
        } else {
          clearSession();
        }
        if (ADMIN_PAGES.includes(PAGE)) {
          showKeyPrompt("Your admin session is no longer valid. Enter your admin key again.");
          return;
        }
        applyGate(demoted);
        return;
      }
    }

    applyGate(session);
  }

  function applyGate(session) {
    const wantsAdmin = ADMIN_PAGES.includes(PAGE);
    const isAdmin = !!session.is_admin;

    if (wantsAdmin && !isAdmin) {
      showKeyPrompt("This page requires an admin key. Enter it below to unlock.");
      return;
    }

    // Apply sidebar visibility as soon as the DOM (and thus the sidebar) exists.
    const applySidebar = () => {
      if (isAdmin) {
        showAdminNav();
      } else {
        hideAdminNav();
        blockAdminNavClicks();
      }
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", applySidebar);
    } else {
      applySidebar();
    }
    // Re-apply in case the sidebar renders after the initial paint
    setTimeout(applySidebar, 300);
    setTimeout(applySidebar, 1000);
    setTimeout(applySidebar, 2500);

    window.NEXAKS_SESSION = session;
  }

  window.nexaksLogout = async function () {
    if (!confirm("Sign out from NexaKS?")) return;
    clearSession();
    try { if (window.NexaKS?.signOut) await window.NexaKS.signOut(); } catch (_) {}
    window.location.href = "/login.html";
  };

  boot();
})();
