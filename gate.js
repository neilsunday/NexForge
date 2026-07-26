/* NexaKS - Access Gate
 *
 * Drop this into every protected page BEFORE any other JS.
 * It enforces:
 *   - No session at all           -> redirect to /login.html
 *   - Discord OAuth session only  -> allow dashboard only, hide/block admin nav
 *   - Admin key session           -> full access (re-verified against server)
 *
 * Set window.NEXAKS_PAGE = "dashboard" | "admin" | "projects" | "analytics"
 * BEFORE loading this script (or add data-page="..." to <body>).
 */

(function () {
  "use strict";

  const SESSION_KEY = "nexaks_session";
  const PAGE = (window.NEXAKS_PAGE || document.body?.dataset?.page || guessPage()).toLowerCase();

  // Cloudflare Turnstile SITE key (public - safe to expose).
  const TURNSTILE_SITE_KEY = window.NEXAKS_TURNSTILE_SITE_KEY ||
    "0x4AAAAAAD-YvdvOI_vA3JJt"; // Cloudflare Turnstile site key

  // Pages that require admin key. Dashboard is user-level and needs any valid login.
  const ADMIN_PAGES = ["admin", "projects", "analytics"];
  const USER_PAGES  = ["dashboard"];

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

  function redirect(url) {
    window.location.replace(url);
  }

  // Re-verify an admin_key session against the server so localStorage tampering
  // cannot grant admin access, AND so RLS blocks don't cause false demotions.
  // The server uses the service role to bypass RLS on the keys table.
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
    } catch (_) {
      return false;
    }
  }

  // Verify a Turnstile token with our server. Returns true if valid.
  async function verifyTurnstileToken(token) {
    try {
      const res = await fetch("/api/verify-turnstile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token })
      });
      const data = await res.json();
      return !!data.success;
    } catch (_) {
      return false;
    }
  }

  // Load the Turnstile script once, on demand.
  function loadTurnstileScript() {
    if (window.turnstile) return Promise.resolve();
    if (window._nexaksTurnstileLoading) return window._nexaksTurnstileLoading;
    window._nexaksTurnstileLoading = new Promise((resolve) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => resolve(); // resolve either way; verify will just fail
      document.head.appendChild(s);
    });
    return window._nexaksTurnstileLoading;
  }

  function showKeyPrompt(reason) {
    // Full-screen modal asking for admin key (used when a non-admin tries admin nav)
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

    // Render Turnstile widget (async - safe to submit once user has a token)
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
        } catch (e) {
          console.warn("Turnstile render failed:", e);
        }
      }
    });

    input.focus();
    input.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
    });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit.click(); });

    cancel.addEventListener("click", () => {
      overlay.remove();
      // Go back to dashboard if they cancel
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
        // Single server-side call: verifies captcha + looks up key with service role.
        // Bypasses RLS on the keys table so unclaimed/anon-blocked admin keys work.
        const res = await fetch("/api/verify-admin-key", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: key, token: turnstileToken })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Verification failed.");
        }

        // Merge admin credentials into existing session (or create fresh)
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
        // Send them straight to the admin panel after successful login
        window.location.href = "/admin.html";
      } catch (ex) {
        err.textContent = ex.message || "Verification failed.";
        err.style.display = "block";
        submit.disabled = false;
        submit.textContent = "Verify";
        // Reset the captcha so the user gets a fresh token
        try { window.turnstile && turnstileWidgetId != null && window.turnstile.reset(turnstileWidgetId); } catch (_) {}
        turnstileToken = null;
      }
    });
  }

  function hideAdminNavLinks() {
    // Hide anything that links to admin.html / projects.html / analytics.html in the sidebar
    const links = document.querySelectorAll('a[href*="admin.html"], a[href*="projects.html"], a[href*="analytics.html"]');
    links.forEach(a => {
      // Skip logo / non-nav anchors
      if (a.classList.contains("logo")) return;
      a.style.display = "none";
    });
  }

  function interceptAdminNavClicks() {
    // Intercept clicks on hidden or visible admin links so a Discord-only user is prompted
    document.addEventListener("click", function (e) {
      const link = e.target.closest("a");
      if (!link) return;
      const href = (link.getAttribute("href") || "").toLowerCase();
      if (!href) return;
      const targetsAdmin =
        href.includes("admin.html") ||
        href.includes("projects.html") ||
        href.includes("analytics.html");
      if (!targetsAdmin) return;
      // Skip logo
      if (link.classList.contains("logo")) return;

      e.preventDefault();
      showKeyPrompt("This page requires an admin key. Enter it below to unlock.");
    }, true);
  }

  // ---------- MAIN GATE LOGIC ----------

  // 1. Check for Supabase Discord session first (if the client is already loaded)
  //    We need to wait a tick for supabase.js to init.
  async function detectDiscordSession() {
    if (!window.NexaKS?.getCurrentUser) return null;
    try {
      const user = await window.NexaKS.getCurrentUser();
      return user || null;
    } catch (_) { return null; }
  }

  async function boot() {
    // Wait briefly for NexaKS supabase client to be ready
    for (let i = 0; i < 20 && !window.NexaKS; i++) {
      await new Promise(r => setTimeout(r, 100));
    }

    const localSession = readSession();
    const discordUser = await detectDiscordSession();

    // If we came back from Discord OAuth, mint a user-level session
    if (discordUser && (!localSession || localSession.login_method === "admin_key" && !localSession.user_id)) {
      // Fetch profile to see if is_admin flag is set (redeemed an admin key already)
      let isAdmin = false;
      let username = "User";
      try {
        const profile = await window.NexaKS.getUserProfile(discordUser.id);
        isAdmin = !!profile?.is_admin;
        username = profile?.username || discordUser.user_metadata?.full_name || "User";
      } catch (_) {}

      const merged = Object.assign({}, localSession || {}, {
        user_id: discordUser.id,
        username: username,
        is_admin: localSession?.is_admin || isAdmin,
        login_method: localSession?.login_method === "admin_key" ? "discord+admin_key" : "discord",
        expires_at: Date.now() + 7 * 24 * 3600 * 1000
      });
      localStorage.setItem(SESSION_KEY, JSON.stringify(merged));
      localStorage.removeItem("nexaks_pending_discord");
      await guardAndApply(merged);
      return;
    }

    // No Discord session either
    if (!localSession) {
      redirect("/login.html");
      return;
    }

    await guardAndApply(localSession);
  }

  // Wrap applyGate with a DB re-verification step for admin sessions.
  // If a client tampered with localStorage to grant themselves is_admin,
  // the DB check will catch it and demote the session.
  async function guardAndApply(session) {
    const claimsAdmin = !!session.is_admin;
    const usedAdminKey = session.login_method &&
      (session.login_method === "admin_key" || session.login_method.includes("admin_key"));

    if (claimsAdmin && usedAdminKey) {
      const ok = await reverifyAdminSession(session);
      if (!ok) {
        // Demote - the key is gone, revoked, expired, or the plan is not admin.
        // Keep any Discord identity but strip admin flags.
        const demoted = Object.assign({}, session, {
          is_admin: false,
          plan: session.login_method === "admin_key" ? undefined : session.plan,
          login_method: session.login_method === "admin_key" ? "discord" : "discord",
          key: undefined
        });
        if (demoted.user_id) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(demoted));
        } else {
          clearSession();
        }
        // If the current page needs admin, prompt again with fresh Turnstile.
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

    if (wantsAdmin && !session.is_admin) {
      // User is logged in via Discord only, trying to open an admin page
      showKeyPrompt("This page requires an admin key. Enter it below to unlock.");
      return;
    }

    // If they're on a user page but not admin, hide admin nav links
    if (!session.is_admin) {
      // Wait for DOM to be ready
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
          hideAdminNavLinks();
          interceptAdminNavClicks();
        });
      } else {
        hideAdminNavLinks();
        interceptAdminNavClicks();
      }
    }

    // Expose session globally for pages that need it
    window.NEXAKS_SESSION = session;
  }

  // Global logout helper
  window.nexaksLogout = async function () {
    if (!confirm("Sign out from NexaKS?")) return;
    clearSession();
    try { if (window.NexaKS?.signOut) await window.NexaKS.signOut(); } catch (_) {}
    window.location.href = "/login.html";
  };

  boot();
})();


/* ============================================================
 * NexForge - Sidebar Access Control
 * ------------------------------------------------------------
 * What it does:
 *   - If user is Discord-only (is_admin: false in DB):
 *       -> Hides Projects, Analytics, Bot Commands links in sidebar
 *       -> Blocks clicks to those pages (redirects back to dashboard)
 *   - If user is admin (is_admin: true in DB):
 *       -> Shows all sidebar links normally
 * ============================================================ */

(function () {
    'use strict';

    // Admin-only link patterns (href includes any of these = admin-only)
    const ADMIN_LINK_PATTERNS = [
        'projects.html',
        'analytics.html',
        'admin.html'
    ];

    // Admin-only section names (onclick="showSection('xxx')" = admin-only)
    const ADMIN_SECTIONS = [
        'botcommands'
    ];

    let hasHiddenLinks = false;

    function hideAdminLinks() {
        if (hasHiddenLinks) return;

        // Hide anchor links matching admin patterns
        document.querySelectorAll('a').forEach(function (a) {
            const href = (a.getAttribute('href') || '').toLowerCase();
            const onclick = (a.getAttribute('onclick') || '').toLowerCase();

            // Skip logo links
            if (a.classList.contains('logo')) return;

            // Hide by href
            for (const pattern of ADMIN_LINK_PATTERNS) {
                if (href.includes(pattern)) {
                    a.style.display = 'none';
                    return;
                }
            }

            // Hide by onclick showSection
            for (const section of ADMIN_SECTIONS) {
                if (onclick.includes("showsection('" + section + "'") ||
                    onclick.includes('showsection("' + section + '"')) {
                    a.style.display = 'none';
                    return;
                }
            }
        });

        hasHiddenLinks = true;
    }

    function blockAdminClicks() {
        // Extra layer: intercept any click on admin links (in case dynamically added)
        document.addEventListener('click', function (e) {
            const link = e.target.closest('a');
            if (!link) return;

            const href = (link.getAttribute('href') || '').toLowerCase();
            for (const pattern of ADMIN_LINK_PATTERNS) {
                if (href.includes(pattern) && !link.classList.contains('logo')) {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }
            }
        }, true);
    }

    async function checkAccess() {
        // Wait for NexaKS supabase client to be ready
        for (let i = 0; i < 40 && !window.NexaKS; i++) {
            await new Promise(r => setTimeout(r, 100));
        }

        if (!window.NexaKS?.getCurrentUser) {
            // Supabase not loaded - safest to hide admin links
            hideAdminLinks();
            blockAdminClicks();
            return;
        }

        try {
            const user = await window.NexaKS.getCurrentUser();
            if (!user) {
                // Not signed in - hide admin links
                hideAdminLinks();
                blockAdminClicks();
                return;
            }

            const profile = await window.NexaKS.getUserProfile(user.id);
            const isAdmin = !!profile?.is_admin;

            if (!isAdmin) {
                // Discord-only user - hide admin sections
                hideAdminLinks();
                blockAdminClicks();
            }
            // Admin - do nothing, all links visible
        } catch (e) {
            // On error, hide admin links to be safe
            hideAdminLinks();
            blockAdminClicks();
        }
    }

    // Run as soon as DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', checkAccess);
    } else {
        checkAccess();
    }

    // Also run again after 1s in case sidebar renders late
    setTimeout(checkAccess, 1000);
})();
