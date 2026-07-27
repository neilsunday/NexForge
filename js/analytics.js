/* NexaKS - Analytics Page JS */

let currentUser = null;
let currentProfile = null;
let currentRole = null;        // 'owner' or 'admin'
let scopedProjectIds = null;   // null = owner (see all); array = admin (own project IDs only)
const charts = {};

// Theme colors matching the site palette
const COLORS = {
  purple: '#7c3aed',
  pink:   '#ec4899',
  blue:   '#3b82f6',
  cyan:   '#06b6d4',
  green:  '#10b981',
  orange: '#f59e0b',
  red:    '#ef4444',
  gray:   '#64748b',
  text:   '#e5e7eb',
  muted:  '#9ca3af',
  grid:   'rgba(255,255,255,0.06)',
};

const PLAN_COLORS = { free: COLORS.gray, pro: COLORS.blue, enterprise: COLORS.orange };
const STATUS_COLORS = { active: COLORS.green, unclaimed: COLORS.gray, revoked: COLORS.red, expired: COLORS.orange };

// ========== Init ==========
document.addEventListener("DOMContentLoaded", async () => {
  const loader = document.getElementById("authLoader");
  const main = document.getElementById("analyticsMain");
  const denied = document.getElementById("deniedState");

  const forceShow = setTimeout(() => {
    if (loader) loader.style.display = "none";
    if (denied) denied.style.display = "flex";
  }, 8000);

  try {
    currentUser = await NexaKS.getCurrentUser();
    if (!currentUser) {
      clearTimeout(forceShow);
      window.location.href = "/";
      return;
    }

    // Resolve role via unified helper â€” allows both owner AND admin tier
    currentRole = await NexaKS.getUserRole();
    if (currentRole !== "owner" && currentRole !== "admin") {
      clearTimeout(forceShow);
      if (loader) loader.style.display = "none";
      if (denied) denied.style.display = "flex";
      return;
    }

    currentProfile = await NexaKS.getUserProfile(currentUser.id);

    // For admin tier: pre-fetch own project IDs so we can scope every query
    if (currentRole === "admin") {
      const { data: ownProjects } = await NexaKS.supabase
        .from("projects").select("id").eq("owner_id", currentUser.id);
      scopedProjectIds = (ownProjects || []).map(p => p.id);
      console.log("[analytics] admin tier: scoped to " + scopedProjectIds.length + " project(s)");
    }

    clearTimeout(forceShow);
    if (loader) loader.style.display = "none";
    if (main) main.style.display = "grid";

    if (window.Chart) {
      Chart.defaults.color = COLORS.muted;
      Chart.defaults.borderColor = COLORS.grid;
      Chart.defaults.font.family = "'Inter', sans-serif";
      Chart.defaults.font.size = 11;
    }

    await loadAnalytics();
    setInterval(loadAnalytics, 60_000);
  } catch (err) {
    console.error("Analytics init:", err);
    clearTimeout(forceShow);
    if (loader) loader.style.display = "none";
    if (denied) denied.style.display = "flex";
  }
});

// ========== Scoping helper ==========
// Returns a Supabase query with .in('project_id', scopedProjectIds) applied for admin tier.
// Owner sees everything, admin only sees rows tied to their own projects.
function scopeKeysQuery(q) {
  if (currentRole === "admin") {
    if (!scopedProjectIds || scopedProjectIds.length === 0) {
      // Admin with no projects yet â€” return a query that matches nothing
      return q.eq("project_id", "00000000-0000-0000-0000-000000000000");
    }
    return q.in("project_id", scopedProjectIds);
  }
  return q; // owner: no filter
}

// ========== Main loader ==========
async function loadAnalytics() {
  await Promise.all([
    loadDailyActivity(),
    loadKeysByStatus(),
    loadKeysByPlan(),
    loadKeysByProject(),
    loadHwidResets(),
    loadTopUsers(),
    loadTopKeys(),
  ]);
}

// ========== Chart 1: Daily Activity (line chart) ==========
async function loadDailyActivity() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffIso = cutoff.toISOString();

    // For admin: filter logs to those tied to keys they created
    // Simpler: pull scoped keys first, then filter logs by their key values
    let scopedKeys = null;
    if (currentRole === "admin") {
      const { data: keys } = await scopeKeysQuery(
        NexaKS.supabase.from("keys").select("key")
      );
      scopedKeys = (keys || []).map(k => k.key);
      if (scopedKeys.length === 0) {
        renderChart("chartDailyActivity", emptyLineChart());
        return;
      }
    }

    const buildQuery = (actions) => {
      let q = NexaKS.supabase.from("logs").select("created_at, key")
        .in("action", actions).eq("status", "success").gte("created_at", cutoffIso);
      if (scopedKeys) q = q.in("key", scopedKeys);
      return q;
    };

    const [redeems, execs] = await Promise.all([
      buildQuery(["redeem", "verify_bind"]),
      buildQuery(["verify"]),
    ]);

    const labels = [], activations = [], executions = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString("en-US", { month: "short", day: "numeric" }));
      activations.push((redeems.data || []).filter(r => r.created_at.slice(0, 10) === key).length);
      executions.push((execs.data || []).filter(r => r.created_at.slice(0, 10) === key).length);
    }

    renderChart("chartDailyActivity", {
      type: "line",
      data: { labels, datasets: [
        { label: "Activations", data: activations, borderColor: COLORS.green, backgroundColor: COLORS.green + "20", tension: 0.3, fill: true, pointRadius: 2, pointHoverRadius: 5 },
        { label: "Executions", data: executions, borderColor: COLORS.purple, backgroundColor: COLORS.purple + "20", tension: 0.3, fill: true, pointRadius: 2, pointHoverRadius: 5 },
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { position: "top", labels: { boxWidth: 12, padding: 12 } } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  } catch (e) { console.error("loadDailyActivity:", e); }
}

function emptyLineChart() {
  return {
    type: "line",
    data: { labels: [], datasets: [] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  };
}

// ========== Chart 2: Keys by Status (doughnut) ==========
async function loadKeysByStatus() {
  try {
    const { data } = await scopeKeysQuery(NexaKS.supabase.from("keys").select("status"));
    const counts = { active: 0, unclaimed: 0, revoked: 0, expired: 0 };
    (data || []).forEach(k => { if (counts.hasOwnProperty(k.status)) counts[k.status]++; });

    renderChart("chartKeysByStatus", {
      type: "doughnut",
      data: {
        labels: ["Active", "Unclaimed", "Revoked", "Expired"],
        datasets: [{
          data: [counts.active, counts.unclaimed, counts.revoked, counts.expired],
          backgroundColor: [STATUS_COLORS.active, STATUS_COLORS.unclaimed, STATUS_COLORS.revoked, STATUS_COLORS.expired],
          borderColor: "rgba(0,0,0,0.4)", borderWidth: 2,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 8, font: { size: 11 } } } },
        cutout: "60%",
      },
    });
  } catch (e) { console.error("loadKeysByStatus:", e); }
}

// ========== Chart 3: Keys by Plan (doughnut) ==========
async function loadKeysByPlan() {
  try {
    const { data } = await scopeKeysQuery(NexaKS.supabase.from("keys").select("plan"));
    const counts = { free: 0, pro: 0, enterprise: 0 };
    (data || []).forEach(k => { if (counts.hasOwnProperty(k.plan)) counts[k.plan]++; });

    renderChart("chartKeysByPlan", {
      type: "doughnut",
      data: {
        labels: ["Free", "Pro", "Enterprise"],
        datasets: [{
          data: [counts.free, counts.pro, counts.enterprise],
          backgroundColor: [PLAN_COLORS.free, PLAN_COLORS.pro, PLAN_COLORS.enterprise],
          borderColor: "rgba(0,0,0,0.4)", borderWidth: 2,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10, padding: 8, font: { size: 11 } } } },
        cutout: "60%",
      },
    });
  } catch (e) { console.error("loadKeysByPlan:", e); }
}

// ========== Chart 4: Keys by Project (bar chart) ==========
async function loadKeysByProject() {
  try {
    // Scope both queries â€” admin sees only own projects
    const projectsQuery = (currentRole === "admin")
      ? NexaKS.supabase.from("projects").select("id, name, slug").eq("owner_id", currentUser.id)
      : NexaKS.supabase.from("projects").select("id, name, slug");

    const [keysRes, projRes] = await Promise.all([
      scopeKeysQuery(NexaKS.supabase.from("keys").select("project_id")),
      projectsQuery,
    ]);

    const projectMap = {};
    (projRes.data || []).forEach(p => { projectMap[p.id] = p.name || p.slug; });

    const counts = {};
    (keysRes.data || []).forEach(k => {
      const label = k.project_id ? (projectMap[k.project_id] || "Unknown") : "Unattached";
      counts[label] = (counts[label] || 0) + 1;
    });

    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const labels = sorted.map(x => x[0]);
    const values = sorted.map(x => x[1]);
    const palette = [COLORS.purple, COLORS.pink, COLORS.blue, COLORS.cyan, COLORS.green, COLORS.orange, COLORS.gray];

    renderChart("chartKeysByProject", {
      type: "bar",
      data: { labels, datasets: [{
        data: values,
        backgroundColor: labels.map((_, i) => palette[i % palette.length]),
        borderRadius: 6, maxBarThickness: 40,
      }]},
      options: { responsive: true, maintainAspectRatio: false, indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { grid: { display: false } } },
      },
    });
  } catch (e) { console.error("loadKeysByProject:", e); }
}

// ========== Chart 5: HWID Resets (last 7 days, bar chart) ==========
async function loadHwidResets() {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);

    let scopedKeys = null;
    if (currentRole === "admin") {
      const { data: keys } = await scopeKeysQuery(NexaKS.supabase.from("keys").select("key"));
      scopedKeys = (keys || []).map(k => k.key);
      if (scopedKeys.length === 0) { renderChart("chartHwidResets", emptyLineChart()); return; }
    }

    let q = NexaKS.supabase.from("logs").select("created_at, key")
      .in("action", ["reset_hwid", "owner_force_reset"])
      .eq("status", "success")
      .gte("created_at", cutoff.toISOString());
    if (scopedKeys) q = q.in("key", scopedKeys);
    const { data } = await q;

    const labels = [], values = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      labels.push(d.toLocaleDateString("en-US", { weekday: "short" }));
      values.push((data || []).filter(r => r.created_at.slice(0, 10) === key).length);
    }

    renderChart("chartHwidResets", {
      type: "bar",
      data: { labels, datasets: [{ data: values, backgroundColor: COLORS.orange, borderRadius: 6, maxBarThickness: 32 }]},
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  } catch (e) { console.error("loadHwidResets:", e); }
}

// ========== Top 10 Users by Execution Count ==========
async function loadTopUsers() {
  const container = document.getElementById("topUsersList");
  if (!container) return;

  try {
    const { data: keys } = await scopeKeysQuery(
      NexaKS.supabase.from("keys").select("user_id, execution_count")
        .not("user_id", "is", null).gt("execution_count", 0)
    );

    const totals = {};
    (keys || []).forEach(k => { totals[k.user_id] = (totals[k.user_id] || 0) + (k.execution_count || 0); });

    const topIds = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (topIds.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">No executions yet</div>';
      return;
    }

    const userIds = topIds.map(x => x[0]);
    const { data: users } = await NexaKS.supabase.from("users")
      .select("id, username, avatar_url").in("id", userIds);
    const userMap = {};
    (users || []).forEach(u => { userMap[u.id] = u; });

    container.innerHTML = topIds.map(([id, count], i) => {
      const u = userMap[id] || {};
      const rank = i + 1;
      const rankClass = rank <= 3 ? ' top-' + rank : '';
      return '<div class="top-list-item">' +
        '<div class="top-list-rank' + rankClass + '">' + rank + '</div>' +
        '<div class="top-list-name">' + (u.username || 'Unknown') + '</div>' +
        '<div class="top-list-value">' + count.toLocaleString() + '</div>' +
      '</div>';
    }).join("");
  } catch (e) {
    console.error("loadTopUsers:", e);
    container.innerHTML = '<div style="text-align:center;color:var(--danger);padding:20px;font-size:13px;">Failed to load</div>';
  }
}

// ========== Top 10 Keys by Execution Count ==========
async function loadTopKeys() {
  const container = document.getElementById("topKeysList");
  if (!container) return;

  try {
    const { data } = await scopeKeysQuery(
      NexaKS.supabase.from("keys").select("key, execution_count, plan")
        .gt("execution_count", 0)
        .order("execution_count", { ascending: false })
        .limit(10)
    );

    if (!data || data.length === 0) {
      container.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:20px;font-size:13px;">No executions yet</div>';
      return;
    }

    container.innerHTML = data.map((k, i) => {
      const rank = i + 1;
      const rankClass = rank <= 3 ? ' top-' + rank : '';
      const shortKey = k.key.length > 20 ? k.key.substring(0, 18) + "..." : k.key;
      return '<div class="top-list-item">' +
        '<div class="top-list-rank' + rankClass + '">' + rank + '</div>' +
        '<div class="top-list-name" style="font-family:\'JetBrains Mono\',monospace;font-size:11px;">' + shortKey + '</div>' +
        '<div class="top-list-value">' + (k.execution_count || 0).toLocaleString() + '</div>' +
      '</div>';
    }).join("");
  } catch (e) {
    console.error("loadTopKeys:", e);
    container.innerHTML = '<div style="text-align:center;color:var(--danger);padding:20px;font-size:13px;">Failed to load</div>';
  }
}

// ========== Helper: render/rebuild chart ==========
function renderChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || !window.Chart) return;
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(canvas, config);
}

// ========== Nav helpers ==========
function toggleSidebar() {
  document.getElementById("sidebar")?.classList.toggle("open");
}

document.addEventListener("click", (e) => {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.querySelector(".sidebar-toggle");
  if (window.innerWidth <= 968 && sidebar?.classList.contains("open") &&
      !sidebar.contains(e.target) && !toggle?.contains(e.target)) {
    sidebar.classList.remove("open");
  }
});

async function handleLogout() {
  if (!confirm("Sign out from NexaKS?")) return;
  await NexaKS.signOut();
}
