/* NexaKS - Access Gate
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

  // Cloudflare Turnstile SITE key (public - safe to expose).
  const TURNSTILE_SITE_KEY = window.NEXAKS_TURNSTILE_SITE_KEY ||
    "0x4AAAAAAD-YvdvOI_vA3JJt";

  // Pages that require admin privileges (either owner or admin-key session).
  const ADMIN_PAGES = ["admin", "projects", "analytics"];

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
        // Admin-key users land on the dashboard (they have full-site freedom
        // from there via the sidebar). This unifies the entry point.
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
  // Roles:
  //   OWNER          = Discord OAuth AND is_admin=true in DB
  //   ADMIN_KEY      = logged in through /api/verify-admin-key
  //   REGULAR        = Discord OAuth AND is_admin=false (or no admin session at all)
  //
  // OWNER  + ADMIN_KEY  =>  show every nav item, including the "Admin Panel" link
  // REGULAR            =>  hide Projects, Bot Commands, Analytics, Admin Panel

  const ADMIN_ONLY_HREF_PATTERNS = ["projects.html", "analytics.html", "admin.html"];
  const ADMIN_ONLY_SECTIONS      = ["botcommands"];

  function hideAdminNav() {
    document.querySelectorAll("a").forEach(function (a) {
      if (a.classList.contains("logo")) return;
      const href = (a.getAttribute("href") || "").toLowerCase();
      const onclick = (a.getAttribute("onclick") || "").toLowerCase();

      for (const pat of ADMIN_ONLY_HREF_PATTERNS) {
        if (href.includes(pat)) { a.style.display = "none"; return; }
      }
      for (const sec of ADMIN_ONLY_SECTIONS) {
        if (onclick.includes("showsection('" + sec + "'") ||
            onclick.includes('showsection("' + sec + '"')) {
          a.style.display = "none";
          return;
        }
      }
    });
  }

  function showAdminNav() {
    // Unhide anything that was hidden AND make the "Admin Panel" link functional.
    document.querySelectorAll("a").forEach(function (a) {
      if (a.classList.contains("logo")) return;
      const href = (a.getAttribute("href") || "").toLowerCase();
      const onclick = (a.getAttribute("onclick") || "").toLowerCase();
      let isAdminItem = false;
      for (const pat of ADMIN_ONLY_HREF_PATTERNS) if (href.includes(pat)) { isAdminItem = true; break; }
      if (!isAdminItem) {
        for (const sec of ADMIN_ONLY_SECTIONS) {
          if (onclick.includes("showsection('" + sec + "'") ||
              onclick.includes('showsection("' + sec + '"')) {
            isAdminItem = true; break;
          }
        }
      }
      if (isAdminItem) a.style.display = "";
    });

    // "Admin Panel" link on the dashboard is a plain anchor with id="adminLink"
    // and no href. Point it at admin.html so it actually navigates.
    const adminLink = document.getElementById("adminLink");
    if (adminLink) {
      adminLink.href = "admin.html";
      adminLink.style.display = "";
    }
  }

  function blockAdminNavClicks() {
    document.addEventListener("click", function (e) {
      const link = e.target.closest("a");
      if (!link || link.classList.contains("logo")) return;
      const href = (link.getAttribute("href") || "").toLowerCase();
      const onclick = (link.getAttribute("onclick") || "").toLowerCase();

      let isAdminItem = false;
      for (const pat of ADMIN_ONLY_HREF_PATTERNS) if (href.includes(pat)) { isAdminItem = true; break; }
      if (!isAdminItem) {
        for (const sec of ADMIN_ONLY_SECTIONS) {
          if (onclick.includes("showsection('" + sec + "'") ||
              onclick.includes('showsection("' + sec + '"')) {
            isAdminItem = true; break;
          }
        }
      }
      if (!isAdminItem) return;

      e.preventDefault();
      e.stopPropagation();
      // Regular users get the admin-key prompt so they can escalate on the spot.
      showKeyPrompt("This page requires an admin key. Enter it below to unlock.");
    }, true);
  }

  // ---------- MAIN GATE LOGIC ----------

  async function detectDiscordSession() {
    if (!window.NexaKS?.getCurrentUser) return null;
    try {
      const user = await window.NexaKS.getCurrentUser();
      return user || null;
    } catch (_) { return null; }
  }

  async function boot() {
    for (let i = 0; i < 20 && !window.NexaKS; i++) {
      await new Promise(r => setTimeout(r, 100));
    }

    const localSession = readSession();
    const discordUser = await detectDiscordSession();

    if (discordUser && (!localSession || (localSession.login_method === "admin_key" && !localSession.user_id))) {
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

    if (!localSession) {
      redirect("/login.html");
      return;
    }

    await guardAndApply(localSession);
  }

  async function guardAndApply(session) {
    const usedAdminKey = session.login_method &&
      (session.login_method === "admin_key" || String(session.login_method).includes("admin_key"));

    if (session.is_admin && usedAdminKey) {
      const ok = await reverifyAdminSession(session);
      if (!ok) {
        // Session was tampered with or key was revoked/expired
        const demoted = Object.assign({}, session, {
          is_admin: session.login_method === "discord+admin_key" ? session.is_admin && false : false,
          plan: undefined,
          login_method: session.user_id ? "discord" : undefined,
          key: undefined
        });
        // If they had a Discord identity underneath, keep it as regular user;
        // otherwise wipe the session.
        if (demoted.user_id) {
          demoted.is_admin = false;
          demoted.login_method = "discord";
          localStorage.setItem(SESSION_KEY, JSON.stringify(demoted));
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
      // Regular Discord user trying to open an admin page - prompt for key
      showKeyPrompt("This page requires an admin key. Enter it below to unlock.");
      return;
    }

    // Sidebar visibility rules
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
    // Re-apply after a beat in case the sidebar renders late (some dashboards do)
    setTimeout(applySidebar, 500);
    setTimeout(applySidebar, 1500);

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
