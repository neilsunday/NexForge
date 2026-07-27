/* Keyora - Access Gate v3
 *
 * Three tiers, all validated against the DB (not localStorage):
 *   - owner  : is_admin=true in users table (first Discord login gets this)
 *   - admin  : has valid admin-key session in localStorage (client with your key)
 *   - user   : Discord login only
 *
 * Page access:
 *   - admin.html       : owner + admin (admin sees tenant-scoped view)
 *   - projects.html    : owner + admin
 *   - analytics.html   : owner + admin
 *   - dashboard.html   : any logged-in user
 */

(function () {
  "use strict";

  const PAGE = (window.KEYORA_PAGE || document.body?.dataset?.page || guessPage()).toLowerCase();

  // Admin panel is now shared: owner sees full view, admin sees own-scoped view
  const OWNER_ONLY_PAGES = [];
  const ADMIN_PAGES      = ["admin", "projects", "analytics"];
  const ADMIN_ONLY_HREF  = ["projects.html", "analytics.html", "admin.html"];
  const ADMIN_ONLY_SECTIONS = ["botcommands"];

  function guessPage() {
    const path = window.location.pathname.toLowerCase();
    if (path.includes("admin"))     return "admin";
    if (path.includes("projects"))  return "projects";
    if (path.includes("analytics")) return "analytics";
    if (path.includes("dashboard")) return "dashboard";
    return "dashboard";
  }

  function redirect(url) { window.location.replace(url); }

  async function waitForClient() {
    for (let i = 0; i < 80; i++) {
      if (window.Keyora?.getUserRole) return true;
      await new Promise(r => setTimeout(r, 100));
    }
    return false;
  }

  async function getRoleResilient() {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const role = await window.Keyora.getUserRole();
        if (role !== null) return role;
      } catch (e) {
        console.warn("[gate] role lookup attempt " + (attempt + 1) + " failed:", e);
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  }

  function isAdminNavItem(a) {
    if (!a || a.classList.contains("logo")) return false;
    if (a.getAttribute("data-adminonly") === "true") return true;
    const href = (a.getAttribute("href") || "").toLowerCase();
    const onclick = (a.getAttribute("onclick") || "").toLowerCase();
    for (const pat of ADMIN_ONLY_HREF) if (href.includes(pat)) return true;
    for (const sec of ADMIN_ONLY_SECTIONS) {
      if (onclick.includes("showsection('" + sec + "'") ||
          onclick.includes('showsection("' + sec + '"')) return true;
    }
    return false;
  }

  function showAll() {
    document.querySelectorAll("a").forEach((a) => {
      if (isAdminNavItem(a)) a.style.display = "";
    });
    const adminLink = document.getElementById("adminLink");
    if (adminLink) { adminLink.href = "admin.html"; adminLink.style.display = ""; }
  }

  function showAdminIncludingPanel() {
    // Admin key holder: show Projects/Analytics/Bot Commands AND Admin Panel (tenant view)
    document.querySelectorAll("a").forEach((a) => {
      if (isAdminNavItem(a)) a.style.display = "";
    });
    const adminLink = document.getElementById("adminLink");
    if (adminLink) { adminLink.href = "admin.html"; adminLink.style.display = ""; }
  }

  function hideAll() {
    document.querySelectorAll("a").forEach((a) => {
      if (isAdminNavItem(a)) a.style.display = "none";
    });
    const adminLink = document.getElementById("adminLink");
    if (adminLink) adminLink.style.display = "none";
  }

  async function boot() {
    const ready = await waitForClient();
    console.log("[gate] client ready:", ready);

    if (!ready) {
      redirect("/");
      return;
    }

    const role = await getRoleResilient();
    console.log("[gate] resolved role:", role, "for page:", PAGE);

    if (!role) {
      if (PAGE === "dashboard") {
        applySidebar(null);
        return;
      }
      redirect("/");
      return;
    }

    // ADMIN pages (admin.html, projects.html, analytics.html) â€” owner + admin only
    if (ADMIN_PAGES.includes(PAGE) && role === "user") {
      console.log("[gate] admin page, but user is regular");
      alert("This page requires an admin key. Please enter one to unlock.");
      redirect("/dashboard.html");
      return;
    }

    applySidebar(role);
  }

  function applySidebar(role) {
    const apply = () => {
      if (role === "owner") {
        showAll();
      } else if (role === "admin") {
        showAdminIncludingPanel();
      } else {
        hideAll();
      }
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", apply);
    } else {
      apply();
    }
    setTimeout(apply, 300);
    setTimeout(apply, 1000);
    setTimeout(apply, 2500);

    window.KEYORA_ROLE = role;
  }

  window.keyoraLogout = async function () {
    if (!confirm("Sign out from Keyora?")) return;
    try {
      localStorage.removeItem("keyora_session");
      localStorage.removeItem("nexaks_session");
      localStorage.removeItem("nexaks_pending_discord");
      localStorage.removeItem("nexaks_pending_admin_key");
      sessionStorage.removeItem("nexaks_redirected");
    } catch (_) {}
    try { if (window.Keyora?.signOut) await window.Keyora.signOut(); } catch (_) {}
    window.location.href = "/";
  };
  window.nexaksLogout = window.keyoraLogout;

  boot();
})();
