/* ========================================
   NexaKS - Web Server + Bot + Lua Verify API
   v2.1 — with Projects Management System
   ======================================== */

const express = require("express");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

// Supabase admin client (bypasses RLS for server-side operations)
const SUPABASE_URL =
  process.env.SUPABASE_URL || "https://miscyjgmvxbshvtiecuu.supabase.co";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

let sb = null; // service-role client (server actions, verify endpoint)
if (SUPABASE_SERVICE_KEY) {
  sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ========== Middleware ==========
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static(__dirname));

// ========== HTML Routes ==========
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/dashboard", (req, res) =>
  res.sendFile(path.join(__dirname, "dashboard.html")),
);
app.get("/admin", (req, res) =>
  res.sendFile(path.join(__dirname, "admin.html")),
);
app.get("/projects", (req, res) =>
  res.sendFile(path.join(__dirname, "projects.html")),
);

// ========================================
// AUTH MIDDLEWARE
// Frontend sends Supabase user access token in Authorization: Bearer <jwt>
// We validate it and put user info on req.user
// ========================================
async function requireAuth(req, res, next) {
  if (!sb) return res.status(500).json({ error: "Server not configured" });

  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing auth token" });

  try {
    const { data, error } = await sb.auth.getUser(token);
    if (error || !data?.user)
      return res.status(401).json({ error: "Invalid token" });
    req.user = data.user; // { id, email, ... }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Auth check failed" });
  }
}

// Ensure the project belongs to req.user — reusable guard
async function ownedProject(req, res) {
  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: "Missing project id" });
    return null;
  }

  const { data, error } = await sb
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  if (data.owner_id !== req.user.id) {
    res.status(403).json({ error: "Forbidden" });
    return null;
  }
  return data;
}

// ========== API: Health ==========
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "NexaKS",
    version: "2.1.0",
    bot: global.botStatus || "unknown",
    db: sb ? "connected" : "disabled",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// ================================================================
// ============  PROJECTS MANAGEMENT SYSTEM  ======================
// ================================================================

/* ---------- LIST projects (pagination + search) ---------- */
app.get("/api/projects", requireAuth, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = Math.min(50, Math.max(1, parseInt(req.query.per_page) || 12));
  const search = (req.query.search || "").trim();
  const includeArchived = req.query.archived === "true";

  let q = sb
    .from("projects")
    .select("*", { count: "exact" })
    .eq("owner_id", req.user.id);

  if (!includeArchived) q = q.eq("archived", false);
  if (search) q = q.or(`name.ilike.%${search}%,description.ilike.%${search}%`);

  q = q
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });

  res.json({
    projects: data || [],
    pagination: {
      page,
      per_page: perPage,
      total: count || 0,
      total_pages: Math.ceil((count || 0) / perPage),
    },
  });
});

/* ---------- CREATE project ---------- */
app.post("/api/projects", requireAuth, async (req, res) => {
  const { name, description, version, script_content, settings } =
    req.body || {};
  if (!name || typeof name !== "string" || name.trim().length < 1)
    return res.status(400).json({ error: "Project name is required" });

  const insert = {
    owner_id: req.user.id,
    name: name.trim().slice(0, 80),
    description: (description || "").slice(0, 500),
    version: (version || "1.0.0").slice(0, 20),
    script_content: script_content || "",
    settings: settings && typeof settings === "object" ? settings : {},
    // api_key auto-generated by DB default
  };

  const { data, error } = await sb
    .from("projects")
    .insert(insert)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ project: data });
});

/* ---------- GET single project ---------- */
app.get("/api/projects/:id", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  res.json({ project });
});

/* ---------- UPDATE project ---------- */
app.patch("/api/projects/:id", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;

  const allowed = [
    "name",
    "description",
    "version",
    "script_content",
    "status",
    "archived",
    "settings",
  ];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];

  if (patch.name !== undefined)
    patch.name = String(patch.name).trim().slice(0, 80);
  if (patch.status && !["active", "disabled"].includes(patch.status))
    return res.status(400).json({ error: "Invalid status" });

  const { data, error } = await sb
    .from("projects")
    .update(patch)
    .eq("id", project.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ project: data });
});

/* ---------- ARCHIVE / UNARCHIVE ---------- */
app.post("/api/projects/:id/archive", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const archived = req.body?.archived !== false; // default true

  const { data, error } = await sb
    .from("projects")
    .update({ archived })
    .eq("id", project.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ project: data });
});

/* ---------- DELETE project (cascades to all children) ---------- */
app.delete("/api/projects/:id", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const { error } = await sb.from("projects").delete().eq("id", project.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

/* ---------- REGENERATE api_key ---------- */
app.post("/api/projects/:id/regenerate-key", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const newKey = crypto.randomBytes(18).toString("base64");
  const { data, error } = await sb
    .from("projects")
    .update({ api_key: newKey })
    .eq("id", project.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ project: data });
});

// ============  PROJECT KEYS  ==============

/* ---------- LIST keys of a project ---------- */
app.get("/api/projects/:id/keys", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = Math.min(100, parseInt(req.query.per_page) || 25);
  const search = (req.query.search || "").trim();

  let q = sb
    .from("keys")
    .select("*", { count: "exact" })
    .eq("project_id", project.id);
  if (search) q = q.ilike("key", `%${search}%`);
  q = q
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ keys: data || [], total: count || 0, page, per_page: perPage });
});

/* ---------- GENERATE key ---------- */
app.post("/api/projects/:id/keys", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const { note, expires_days, plan } = req.body || {};

  // Generate NXKS-XXXX-XXXX-XXXX style key
  const rand = () => crypto.randomBytes(2).toString("hex").toUpperCase();
  const keyValue = `NXKS-${rand()}-${rand()}-${rand()}-${rand()}`;

  let expiresAt = null;
  if (expires_days && !isNaN(expires_days)) {
    expiresAt = new Date(
      Date.now() + Number(expires_days) * 86400e3,
    ).toISOString();
  }

  const insert = {
    project_id: project.id,
    key: keyValue,
    status: "active",
    plan: plan || "free",
    expires_at: expiresAt,
    metadata: { note: note || "" },
  };

  const { data, error } = await sb
    .from("keys")
    .insert(insert)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });

  await writeProjectLog(
    project.id,
    null,
    "key_created",
    "info",
    `Key ${keyValue} created`,
    null,
    null,
  );

  res.status(201).json({ key: data });
});

/* ---------- REVOKE key ---------- */
app.delete("/api/projects/:id/keys/:keyId", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const { keyId } = req.params;

  const { data, error } = await sb
    .from("keys")
    .update({ status: "revoked" })
    .eq("id", keyId)
    .eq("project_id", project.id)
    .select()
    .single();
  if (error || !data) return res.status(404).json({ error: "Key not found" });

  await writeProjectLog(
    project.id,
    keyId,
    "key_revoked",
    "warning",
    `Key ${data.key} revoked`,
    null,
    null,
  );
  res.json({ key: data });
});

/* ---------- RESET HWID of a key ---------- */
app.post(
  "/api/projects/:id/keys/:keyId/reset-hwid",
  requireAuth,
  async (req, res) => {
    const project = await ownedProject(req, res);
    if (!project) return;
    const { keyId } = req.params;

    const { data, error } = await sb
      .from("keys")
      .update({ hwid: null })
      .eq("id", keyId)
      .eq("project_id", project.id)
      .select()
      .single();
    if (error || !data) return res.status(404).json({ error: "Key not found" });

    await writeProjectLog(
      project.id,
      keyId,
      "hwid_reset",
      "info",
      `HWID reset for ${data.key}`,
      null,
      null,
    );
    res.json({ key: data });
  },
);

// ============  WHITELIST  ==============

app.get("/api/projects/:id/whitelist", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const { data, error } = await sb
    .from("project_whitelist")
    .select("*")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ whitelist: data || [] });
});

app.post("/api/projects/:id/whitelist", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const { identifier, type, note } = req.body || {};
  if (!identifier || !type)
    return res.status(400).json({ error: "identifier and type required" });
  if (!["discord_id", "hwid", "key", "user_id"].includes(type))
    return res.status(400).json({ error: "Invalid type" });

  const { data, error } = await sb
    .from("project_whitelist")
    .insert({
      project_id: project.id,
      identifier: String(identifier).trim(),
      type,
      note: note || "",
      added_by: req.user.id,
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ entry: data });
});

app.delete(
  "/api/projects/:id/whitelist/:wlId",
  requireAuth,
  async (req, res) => {
    const project = await ownedProject(req, res);
    if (!project) return;
    const { error } = await sb
      .from("project_whitelist")
      .delete()
      .eq("id", req.params.wlId)
      .eq("project_id", project.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  },
);

// ============  BLACKLIST  ==============

app.get("/api/projects/:id/blacklist", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const { data, error } = await sb
    .from("project_blacklist")
    .select("*")
    .eq("project_id", project.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ blacklist: data || [] });
});

app.post("/api/projects/:id/blacklist", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const { identifier, type, reason, ban_days } = req.body || {};
  if (!identifier || !type)
    return res.status(400).json({ error: "identifier and type required" });
  if (!["discord_id", "hwid", "key", "ip", "user_id"].includes(type))
    return res.status(400).json({ error: "Invalid type" });

  let banExpire = null;
  if (ban_days && !isNaN(ban_days)) {
    banExpire = new Date(Date.now() + Number(ban_days) * 86400e3).toISOString();
  }

  const { data, error } = await sb
    .from("project_blacklist")
    .insert({
      project_id: project.id,
      identifier: String(identifier).trim(),
      type,
      reason: reason || "",
      ban_expire: banExpire,
      added_by: req.user.id,
    })
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json({ entry: data });
});

app.delete(
  "/api/projects/:id/blacklist/:blId",
  requireAuth,
  async (req, res) => {
    const project = await ownedProject(req, res);
    if (!project) return;
    const { error } = await sb
      .from("project_blacklist")
      .delete()
      .eq("id", req.params.blId)
      .eq("project_id", project.id);
    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true });
  },
);

// ============  LOGS  ==============

app.get("/api/projects/:id/logs", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const perPage = Math.min(200, parseInt(req.query.per_page) || 50);
  const eventType = (req.query.event || "").trim();

  let q = sb
    .from("project_logs")
    .select("*", { count: "exact" })
    .eq("project_id", project.id);
  if (eventType) q = q.eq("event_type", eventType);
  q = q
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ logs: data || [], total: count || 0, page, per_page: perPage });
});

// ============  ANALYTICS  ==============

app.get("/api/projects/:id/analytics", requireAuth, async (req, res) => {
  const project = await ownedProject(req, res);
  if (!project) return;
  const { data, error } = await sb.rpc("get_project_analytics", {
    p_project_id: project.id,
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ analytics: data || {} });
});

// ================================================================
// ============  /api/verify — LUA LOADER ENDPOINT ================
// Enhanced to route by project (backward compatible)
// ================================================================
app.get("/api/verify", async (req, res) => {
  const { license, hwid, project } = req.query;
  const clientIp =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown";

  if (!license || !hwid) {
    return res
      .status(400)
      .type("text/plain")
      .send('error("NexaKS: Missing license or hwid parameter")');
  }
  if (!sb) {
    return res
      .status(500)
      .type("text/plain")
      .send('error("NexaKS: Server not configured - contact admin")');
  }

  const licenseUpper = license.trim().toUpperCase();
  const hwidClean = hwid.trim().substring(0, 128);

  try {
    // If project api_key is provided, resolve the project first
    let projectRow = null;
    if (project) {
      const { data } = await sb
        .from("projects")
        .select("*")
        .eq("api_key", project)
        .maybeSingle();
      if (!data) {
        return res
          .status(200)
          .type("text/plain")
          .send('error("NexaKS: Invalid project key")');
      }
      if (data.status !== "active" || data.archived) {
        return res
          .status(200)
          .type("text/plain")
          .send('error("NexaKS: Project is disabled")');
      }
      projectRow = data;
    }

    // Fetch key (scoped to project if given)
    let keyQuery = sb
      .from("keys")
      .select("*, users!keys_user_id_fkey(username, is_banned)")
      .eq("key", licenseUpper);
    if (projectRow) keyQuery = keyQuery.eq("project_id", projectRow.id);
    const { data: key, error } = await keyQuery.maybeSingle();

    if (error || !key) {
      await logAttempt(
        null,
        licenseUpper,
        "verify_fail",
        "failed",
        "Key not found",
        clientIp,
      );
      if (projectRow)
        await writeProjectLog(
          projectRow.id,
          null,
          "verify_fail",
          "failed",
          "Key not found",
          clientIp,
          hwidClean,
        );
      return res
        .status(200)
        .type("text/plain")
        .send('error("NexaKS: Invalid license key")');
    }

    // Auto-load project from key if not passed
    if (!projectRow && key.project_id) {
      const { data } = await sb
        .from("projects")
        .select("*")
        .eq("id", key.project_id)
        .maybeSingle();
      projectRow = data;
    }

    // ---- Blacklist check (per project) ----
    if (projectRow) {
      const now = new Date().toISOString();
      const { data: bl } = await sb
        .from("project_blacklist")
        .select("identifier, type, reason, ban_expire")
        .eq("project_id", projectRow.id)
        .or(
          `and(type.eq.key,identifier.eq.${licenseUpper}),and(type.eq.hwid,identifier.eq.${hwidClean}),and(type.eq.ip,identifier.eq.${clientIp})`,
        )
        .limit(1);
      const active = (bl || []).find(
        (b) => !b.ban_expire || b.ban_expire > now,
      );
      if (active) {
        await writeProjectLog(
          projectRow.id,
          key.id,
          "blocked_blacklist",
          "warning",
          `Blocked (${active.type}): ${active.reason || "no reason"}`,
          clientIp,
          hwidClean,
        );
        return res
          .status(200)
          .type("text/plain")
          .send(
            `error("NexaKS: Access denied — ${active.reason || "blacklisted"}")`,
          );
      }
    }

    // ---- Banned user ----
    if (key.users?.is_banned) {
      await logAttempt(
        key.user_id,
        licenseUpper,
        "verify_fail",
        "failed",
        "User banned",
        clientIp,
      );
      return res
        .status(200)
        .type("text/plain")
        .send('error("NexaKS: Account suspended")');
    }

    // ---- Key status ----
    if (key.status !== "active") {
      await logAttempt(
        key.user_id,
        licenseUpper,
        "verify_fail",
        "failed",
        "Key status: " + key.status,
        clientIp,
      );
      const msg =
        key.status === "revoked"
          ? "License revoked"
          : key.status === "expired"
            ? "License expired"
            : key.status === "unclaimed"
              ? "License not activated - use /redeem first"
              : "License inactive";
      return res
        .status(200)
        .type("text/plain")
        .send('error("NexaKS: ' + msg + '")');
    }

    // ---- Expiry ----
    if (key.expires_at && new Date(key.expires_at) < new Date()) {
      await sb
        .from("keys")
        .update({ status: "expired" })
        .eq("key", licenseUpper);
      await logAttempt(
        key.user_id,
        licenseUpper,
        "verify_fail",
        "failed",
        "Key expired",
        clientIp,
      );
      return res
        .status(200)
        .type("text/plain")
        .send(
          'error("NexaKS: License expired on ' +
            new Date(key.expires_at).toLocaleDateString() +
            '")',
        );
    }

    // ---- HWID handling ----
    if (!key.hwid) {
      await sb
        .from("keys")
        .update({
          hwid: hwidClean,
          execution_count: (key.execution_count || 0) + 1,
          last_used: new Date().toISOString(),
        })
        .eq("key", licenseUpper);
      await logAttempt(
        key.user_id,
        licenseUpper,
        "verify_bind",
        "success",
        "HWID bound: " + hwidClean.substring(0, 12),
        clientIp,
      );
      if (projectRow)
        await writeProjectLog(
          projectRow.id,
          key.id,
          "hwid_bind",
          "success",
          "HWID bound",
          clientIp,
          hwidClean,
        );
    } else if (key.hwid !== hwidClean) {
      await logAttempt(
        key.user_id,
        licenseUpper,
        "verify_fail",
        "warning",
        "HWID mismatch: got " +
          hwidClean.substring(0, 12) +
          ", expected " +
          key.hwid.substring(0, 12),
        clientIp,
      );
      if (projectRow)
        await writeProjectLog(
          projectRow.id,
          key.id,
          "verify_fail",
          "warning",
          "HWID mismatch",
          clientIp,
          hwidClean,
        );
      return res
        .status(200)
        .type("text/plain")
        .send(
          'error("NexaKS: Hardware ID mismatch. Use /resethwid on Discord to migrate to this device.")',
        );
    } else {
      await sb
        .from("keys")
        .update({
          execution_count: (key.execution_count || 0) + 1,
          last_used: new Date().toISOString(),
        })
        .eq("key", licenseUpper);
      await logAttempt(
        key.user_id,
        licenseUpper,
        "verify",
        "success",
        "Script executed",
        clientIp,
      );
      if (projectRow)
        await writeProjectLog(
          projectRow.id,
          key.id,
          "verify_success",
          "success",
          "Script executed",
          clientIp,
          hwidClean,
        );
    }

    // ---- Serve script ----
    // Priority: project.script_content > plan-based script > fallback
    let scriptContent = null;
    if (projectRow && projectRow.script_content) {
      scriptContent = projectRow.script_content;
    } else {
      scriptContent = await fetchScriptForKey(key);
    }
    const finalPayload = scriptContent || fallbackPayload(key);
    return res.status(200).type("text/plain").send(finalPayload);
  } catch (err) {
    console.error("Verify error:", err);
    await logAttempt(
      null,
      licenseUpper,
      "verify_error",
      "failed",
      "Server error: " + err.message,
      clientIp,
    );
    return res
      .status(500)
      .type("text/plain")
      .send('error("NexaKS: Server error - try again later")');
  }
});

// ---- Helpers (existing) ----
async function fetchScriptForKey(key) {
  try {
    const { data, error } = await sb.rpc("get_script_for_plan", {
      user_plan: key.plan,
    });
    if (error || !data || data.length === 0) return null;
    const script = data[0];
    sb.from("scripts")
      .update({
        execution_count: (script.execution_count || 0) + 1,
      })
      .eq("id", script.id)
      .then(
        () => {},
        () => {},
      );
    return script.script_content;
  } catch (err) {
    console.error("fetchScriptForKey:", err);
    return null;
  }
}

function fallbackPayload(key) {
  return `-- NexaKS: No script configured yet
-- License: ${key.key} (${(key.plan || "free").toUpperCase()})
print("[NexaKS] Verified but no script configured yet")
print("[NexaKS] Owner: please add a script sa /projects or /admin")
`;
}

async function logAttempt(userId, key, action, status, message, ip) {
  if (!sb) return;
  try {
    await sb.from("logs").insert({
      user_id: userId,
      key: key,
      action: action,
      status: status,
      metadata: { message: message, source: "lua_loader" },
      ip_address: ip,
    });
  } catch (e) {
    console.warn("Log insert failed:", e.message);
  }
}

async function writeProjectLog(
  projectId,
  keyId,
  eventType,
  status,
  message,
  ip,
  hwid,
) {
  if (!sb || !projectId) return;
  try {
    await sb.from("project_logs").insert({
      project_id: projectId,
      key_id: keyId,
      event_type: eventType,
      status: status || "info",
      message: message || "",
      ip,
      hwid,
      metadata: {},
    });
  } catch (e) {
    console.warn("Project log insert failed:", e.message);
  }
}

// 404 handler
app.use((req, res) => {
  if (req.accepts("html")) return res.redirect("/");
  res.status(404).json({ error: "Not found" });
});

// ========== Start server ==========
app.listen(PORT, () => {
  console.log("NexaKS web server running on port " + PORT);
});

// ========== Start Discord bot ==========
if (process.env.DISCORD_BOT_TOKEN) {
  console.log("Starting Discord bot...");
  try {
    require("./bot.js");
  } catch (err) {
    console.error("Bot startup failed:", err.message);
    global.botStatus = "error: " + err.message;
  }
} else {
  console.log("DISCORD_BOT_TOKEN not set - skipping bot startup");
  global.botStatus = "disabled (no token)";
}
