/*
 * The admin API (/api/admin): everything the Admin Panel app on the desktop does, for
 * admins only. It adds to what Settings > Admin already offers (site settings, invite codes,
 * bans) with a dashboard, an account manager, sessions, bulk actions, a chat message
 * browser, announcements, maintenance mode, extra blocked sites, an audit log, server health,
 * a database backup and CSV exports. Every change is written to the audit log.
 */
import express from "express";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir, loadavg, cpus, totalmem, freemem } from "node:os";
import { join } from "node:path";
import { AdminError, createInvite, setBanned } from "./accountsdb.js";
import {
  backupTo, databaseInfo, deleteUser, getAdminSetting, listAudit, listSessions, listUsersPage, logAdmin, overview, prune,
  revokeSession, saveAnnouncement, saveBlocklist, saveMaintenance, saveStoreSettings, saveTerms, searchChat, setUserPassword, signOutUser, toCsv, userDetail,
} from "./admindb.js";
import * as apps from "./storedb.js";
import { HttpError, guardWrites } from "./http.js";
import { hashPassword } from "./passwords.js";

const BULK_MAX = 100;
const INVITES_BULK_MAX = 50;

/**
 * options: db, dataDir, userFor, isAdmin(row), serverAdmins (a Set of lowercase names),
 *   kick(userId), runtime() -> { chat, wisp, filter, config } for the dashboard,
 *   applyBlocklist(custom) to make a change to the blocked sites live, onChange(key, value) after an announcement or
 *   maintenance change (the live channel tells every open page).
 * Returns { router, announcement(), maintenance(), blocklist() }: the settings are cached for a few seconds.
 */
export function createAdmin({ db, dataDir, userFor, isAdmin, serverAdmins, kick, runtime, applyBlocklist, onChange = () => {} }) {
  const cache = {};
  function cached(key) {
    const hit = cache[key];
    if (hit && Date.now() - hit.at < 3000) return hit.value;
    const value = getAdminSetting(db, key);
    cache[key] = { at: Date.now(), value };
    return value;
  }
  const forget = (key) => { delete cache[key]; };

  function requireAdmin(req) {
    const user = userFor(req);
    if (!user) throw new HttpError(401, "You are not signed in.");
    if (!user.admin) throw new HttpError(403, "Only admins can do that.");
    return user;
  }

  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(guardWrites());
  router.use(express.json({ limit: "64kb" }));
  const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
  const rowOf = (name) => db.prepare("SELECT id, username, is_admin, banned_at FROM users WHERE username = ?").get(String(name ?? ""));

  // --- dashboard -------------------------------------------------------------------------------

  router.get("/overview", handle((req, res) => {
    requireAdmin(req);
    const data = overview(db);
    // Admins named in ADMINS count too, once they have an account.
    if (serverAdmins.size) {
      const names = [...serverAdmins];
      data.users.admins = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 OR lower(username) IN (${names.map(() => "?").join(",")})`).get(...names).n;
    }
    res.json({ ...data, runtime: runtime() });
  }));

  // --- accounts -----------------------------------------------------------------------------------

  router.get("/users", handle((req, res) => {
    requireAdmin(req);
    const { q, filter, sort, order, page, pageSize } = req.query;
    res.json(listUsersPage(db, { q: String(q ?? "").slice(0, 32), filter, sort, order, page, pageSize }, serverAdmins));
  }));

  router.get("/users/:username", handle((req, res) => {
    requireAdmin(req);
    const detail = userDetail(db, req.params.username, serverAdmins);
    if (!detail) throw new HttpError(404, "There's no account with that name.");
    res.json(detail);
  }));

  router.post("/users/:username/signout", handle((req, res) => {
    const admin = requireAdmin(req);
    const { id, ended } = signOutUser(db, req.params.username);
    kick(id);
    logAdmin(db, admin.username, "signed out", req.params.username, `${ended} session${ended === 1 ? "" : "s"}`);
    res.json({ ended });
  }));

  router.post("/users/:username/password", handle(async (req, res) => {
    const admin = requireAdmin(req);
    const password = req.body?.password;
    if (typeof password !== "string" || password.length < 8 || password.length > 200) throw new HttpError(400, "Use a password of 8 to 200 characters.");
    const row = rowOf(req.params.username);
    if (!row) throw new HttpError(404, "There's no account with that name.");
    if (isAdmin(row) && row.id !== userFor(req).id) throw new HttpError(403, "You can only change another admin's password by removing their admin role first.");
    const id = setUserPassword(db, req.params.username, await hashPassword(password));
    kick(id);
    logAdmin(db, admin.username, "set password", req.params.username, "signed out everywhere");
    res.json({ ok: true });
  }));

  router.post("/users/:username/delete", handle((req, res) => {
    const admin = requireAdmin(req);
    if (req.body?.confirm !== req.params.username) throw new HttpError(400, "Type the username to confirm.");
    const id = deleteUser(db, req.params.username, { by: admin.username, isAdminRow: isAdmin });
    kick(id);
    logAdmin(db, admin.username, "deleted account", req.params.username);
    res.json({ ok: true });
  }));

  // Do one thing to several accounts. Each is reported on its own, so one bad name doesn't stop the rest.
  router.post("/users/bulk", handle((req, res) => {
    const admin = requireAdmin(req);
    const { action, usernames, reason } = req.body ?? {};
    if (!["ban", "unban", "signout"].includes(action)) throw new HttpError(400, "Choose ban, unban or signout.");
    if (!Array.isArray(usernames) || !usernames.length || usernames.length > BULK_MAX) throw new HttpError(400, `Choose 1 to ${BULK_MAX} accounts.`);
    const results = [];
    for (const name of usernames) {
      try {
        const row = rowOf(name);
        if (!row) throw new AdminError(404, "No such account.");
        if (row.id === userFor(req).id) throw new AdminError(400, "Not yourself.");
        if (action === "ban") { setBanned(db, name, true, { reason, admins: serverAdmins }); kick(row.id); }
        else if (action === "unban") setBanned(db, name, false);
        else { signOutUser(db, name); kick(row.id); }
        results.push({ username: name, ok: true });
      } catch (err) {
        if (!(err instanceof AdminError)) throw err;
        results.push({ username: String(name).slice(0, 40), ok: false, error: err.message });
      }
    }
    const done = results.filter((r) => r.ok).length;
    logAdmin(db, admin.username, `bulk ${action}`, `${done} account${done === 1 ? "" : "s"}`, [...results.filter((r) => r.ok).map((r) => r.username).slice(0, 10), String(reason ?? "").slice(0, 100)].filter(Boolean).join(", "));
    res.json({ results });
  }));

  // --- sessions ---------------------------------------------------------------------------------------

  router.get("/sessions", handle((req, res) => {
    requireAdmin(req);
    res.json(listSessions(db, { q: String(req.query.q ?? "").slice(0, 32), page: req.query.page, pageSize: req.query.pageSize, currentHash: req.sessionHash ?? "" }));
  }));

  router.post("/sessions/:id/revoke", handle((req, res) => {
    const admin = requireAdmin(req);
    const owner = revokeSession(db, req.params.id);
    if (!owner) throw new HttpError(404, "That session has already ended.");
    const row = rowOf(owner);
    if (row) kick(row.id);
    logAdmin(db, admin.username, "ended a session", owner);
    res.json({ ok: true });
  }));

  // --- invite codes (making many at once; the rest is in /api/account/admin/invites) ----------------------

  router.post("/invites/bulk", handle((req, res) => {
    const admin = requireAdmin(req);
    const { count, label, maxUses, expiresInDays } = req.body ?? {};
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > INVITES_BULK_MAX) throw new HttpError(400, `Make 1 to ${INVITES_BULK_MAX} codes at a time.`);
    const codes = [];
    for (let i = 0; i < n; i++) codes.push(createInvite(db, { label, maxUses, expiresInDays, createdBy: admin.username }).code);
    logAdmin(db, admin.username, "made invites", `${n} codes`, `${String(label ?? "").slice(0, 60) || "no label"}, ${Number(maxUses) || 1} use${Number(maxUses) > 1 ? "s" : ""} each`);
    res.status(201).json({ codes });
  }));

  // --- chat messages --------------------------------------------------------------------------------------

  router.get("/chat/messages", handle((req, res) => {
    requireAdmin(req);
    const { q, username, before, deleted, limit } = req.query;
    res.json({ messages: searchChat(db, { q: String(q ?? "").slice(0, 100), username: String(username ?? "").slice(0, 32), before: before ? Number(before) : null, includeDeleted: deleted === "1", limit }) });
  }));

  // --- announcement, maintenance and the blocked sites ---------------------------------------------------

  router.get("/announcement", handle((req, res) => { requireAdmin(req); res.json(getAdminSetting(db, "announcement")); }));
  router.post("/announcement", handle((req, res) => {
    const admin = requireAdmin(req);
    const saved = saveAnnouncement(db, req.body, admin.username);
    forget("announcement");
    onChange("announcement", saved);
    logAdmin(db, admin.username, saved.active ? "posted announcement" : "cleared announcement", null, saved.active ? saved.text.slice(0, 100) : null);
    res.json(saved);
  }));

  router.get("/maintenance", handle((req, res) => { requireAdmin(req); res.json(getAdminSetting(db, "maintenance")); }));
  router.post("/maintenance", handle((req, res) => {
    const admin = requireAdmin(req);
    const saved = saveMaintenance(db, req.body, admin.username);
    forget("maintenance");
    onChange("maintenance", saved);
    logAdmin(db, admin.username, saved.on ? "turned maintenance mode on" : "turned maintenance mode off");
    res.json(saved);
  }));

  router.get("/terms", handle((req, res) => { requireAdmin(req); res.json(getAdminSetting(db, "terms")); }));
  router.post("/terms", handle((req, res) => {
    const admin = requireAdmin(req);
    const saved = saveTerms(db, req.body, admin.username);
    forget("terms");
    onChange("terms", saved);
    logAdmin(db, admin.username, saved.enabled ? "turned the acceptable use screen on" : "turned the acceptable use screen off");
    res.json(saved);
  }));

  router.get("/blocklist", handle((req, res) => {
    requireAdmin(req);
    res.json({ custom: getAdminSetting(db, "blocklist"), builtin: runtime().filter });
  }));
  router.post("/blocklist", handle((req, res) => {
    const admin = requireAdmin(req);
    const saved = saveBlocklist(db, req.body, admin.username);
    forget("blocklist");
    applyBlocklist(saved);
    logAdmin(db, admin.username, "changed the blocked sites", null, `${saved.hosts.length} sites, ${saved.keywords.length} keywords, ${saved.queryWords.length} search words`);
    res.json({ custom: saved, builtin: runtime().filter });
  }));

  // --- the App Store: the approval queue, the apps, and how new apps get in ----------------------------------

  const appOf = (req) => {
    const row = apps.getApp(db, req.params.id);
    if (!row) throw new HttpError(404, "That app isn't in the store.");
    return row;
  };
  const adminApp = (row) => ({ ...apps.publicApp(row, { forOwner: true }), reports: row.reports, key: row.url_key, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, ownerIsAdmin: Boolean(row.owner_is_admin) });

  router.get("/store", handle((req, res) => {
    requireAdmin(req);
    const { status, q, offset } = req.query;
    res.json({
      settings: getAdminSetting(db, "store"),
      counts: apps.countByStatus(db),
      categories: apps.CATEGORIES,
      apps: apps.listByStatus(db, { status: String(status ?? "pending"), q: String(q ?? ""), offset }).map(adminApp),
    });
  }));

  router.post("/store/settings", handle((req, res) => {
    const admin = requireAdmin(req);
    const before = getAdminSetting(db, "store");
    const saved = saveStoreSettings(db, req.body, admin.username);
    const changes = [];
    if (saved.approval !== before.approval) changes.push(`approval ${saved.approval === "auto" ? "automatic" : "manual"}`);
    if (saved.publishing !== before.publishing) changes.push(saved.publishing ? "publishing on" : "publishing paused");
    if (saved.maxPerUser !== before.maxPerUser) changes.push(`${saved.maxPerUser} apps each`);
    if (changes.length) logAdmin(db, admin.username, "changed the App Store settings", null, changes.join(", "));
    res.json({ settings: saved });
  }));

  router.get("/store/apps/:id/reports", handle((req, res) => {
    requireAdmin(req);
    res.json({ reports: apps.reportsFor(db, appOf(req).id) });
  }));

  router.post("/store/apps/:id/dismiss", handle((req, res) => {
    const admin = requireAdmin(req);
    const row = appOf(req);
    const removed = apps.dismissReports(db, row.id);
    logAdmin(db, admin.username, "dismissed reports of a store app", row.name, `${removed} report${removed === 1 ? "" : "s"}`);
    res.json({ app: adminApp(apps.getApp(db, row.id)), counts: apps.countByStatus(db) });
  }));

  router.post("/store/apps/:id/approve", handle((req, res) => {
    const admin = requireAdmin(req);
    const row = appOf(req);
    apps.decide(db, row.id, { status: "approved", by: admin.username });
    logAdmin(db, admin.username, "approved a store app", row.name, `by ${row.owner}`);
    res.json({ app: adminApp(apps.getApp(db, row.id)), counts: apps.countByStatus(db) });
  }));

  router.post("/store/apps/:id/reject", handle((req, res) => {
    const admin = requireAdmin(req);
    const row = appOf(req);
    apps.decide(db, row.id, { status: "rejected", by: admin.username, reason: req.body?.reason });
    logAdmin(db, admin.username, row.status === "approved" ? "took down a store app" : "rejected a store app", row.name, `by ${row.owner}`);
    res.json({ app: adminApp(apps.getApp(db, row.id)), counts: apps.countByStatus(db) });
  }));

  router.post("/store/apps/:id/delete", handle((req, res) => {
    const admin = requireAdmin(req);
    const row = appOf(req);
    apps.deleteApp(db, row.id);
    logAdmin(db, admin.username, "deleted a store app", row.name, `by ${row.owner}`);
    res.json({ ok: true, counts: apps.countByStatus(db) });
  }));

  // --- audit log -------------------------------------------------------------------------------------------

  router.get("/audit", handle((req, res) => {
    requireAdmin(req);
    const { q, actor, source, before, limit } = req.query;
    res.json({ entries: listAudit(db, { q: String(q ?? "").slice(0, 60), actor: String(actor ?? "").slice(0, 32), source: source === "site" || source === "chat" ? source : "", before: before ? Number(before) : null, limit }) });
  }));

  // --- the server -------------------------------------------------------------------------------------------

  router.get("/system", handle((req, res) => {
    requireAdmin(req);
    const memory = process.memoryUsage();
    res.json({
      process: {
        uptimeSeconds: Math.round(process.uptime()), node: process.version, platform: `${process.platform} ${process.arch}`, pid: process.pid,
        rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal,
      },
      host: { load: loadavg().map((n) => Math.round(n * 100) / 100), cpus: cpus().length, totalMemory: totalmem(), freeMemory: freemem(), fly: process.env.FLY_APP_NAME ? { app: process.env.FLY_APP_NAME, region: process.env.FLY_REGION ?? null, machine: process.env.FLY_MACHINE_ID ?? null } : null },
      database: databaseInfo(db, dataDir),
      runtime: runtime(),
    });
  }));

  router.post("/system/prune", handle((req, res) => {
    const admin = requireAdmin(req);
    const result = prune(db, dataDir);
    logAdmin(db, admin.username, "tidied the database", null, `${result.sessions} old sessions, ${result.messages} deleted messages`);
    res.json(result);
  }));

  // A copy of the whole database (it holds password hashes: only admins can get it, and it is logged).
  router.get("/system/backup", handle((req, res, next) => {
    const admin = requireAdmin(req);
    const dir = mkdtempSync(join(tmpdir(), "sn-backup-"));
    const file = join(dir, "accounts.db");
    try { backupTo(db, file); } catch (err) { rmSync(dir, { recursive: true, force: true }); throw err; }
    logAdmin(db, admin.username, "downloaded a database backup");
    res.download(file, `supernova-${new Date().toISOString().slice(0, 10)}.db`, (err) => {
      rmSync(dir, { recursive: true, force: true });
      if (err && !res.headersSent) next(err);
    });
  }));

  // --- exports -----------------------------------------------------------------------------------------------

  const iso = (ms) => (ms ? new Date(ms).toISOString() : "");
  function csv(res, name, text) {
    res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"` }).send(text);
  }

  router.get("/export/users.csv", handle((req, res) => {
    const admin = requireAdmin(req);
    const all = [];
    for (let page = 1; ; page++) {
      const result = listUsersPage(db, { pageSize: 100, sort: "name", order: "asc", page }, serverAdmins);
      all.push(...result.users);
      if (all.length >= result.total || !result.users.length) break;
    }
    logAdmin(db, admin.username, "exported accounts", null, `${all.length} rows`);
    csv(res, "accounts", toCsv([
      { label: "username", value: "username" }, { label: "created", value: (r) => iso(r.createdAt) }, { label: "last seen", value: (r) => iso(r.lastSeenAt) },
      { label: "admin", value: (r) => (r.admin ? "yes" : "") }, { label: "banned", value: (r) => (r.banned ? "yes" : "") }, { label: "ban reason", value: "banReason" },
      { label: "invite", value: "invite" }, { label: "chat messages", value: "messages" }, { label: "active sessions", value: "sessions" },
    ], all));
  }));

  router.get("/export/audit.csv", handle((req, res) => {
    const admin = requireAdmin(req);
    const entries = listAudit(db, { limit: 500 });
    logAdmin(db, admin.username, "exported the audit log", null, `${entries.length} rows`);
    csv(res, "audit-log", toCsv([{ label: "time", value: (r) => iso(r.at) }, { label: "source", value: "source" }, { label: "who", value: "actor" }, { label: "action", value: "action" }, { label: "target", value: "target" }, { label: "details", value: "detail" }], entries));
  }));

  router.get("/export/chat.csv", handle((req, res) => {
    const admin = requireAdmin(req);
    const messages = searchChat(db, { includeDeleted: true, limit: 200 });
    logAdmin(db, admin.username, "exported chat messages", null, `${messages.length} rows`);
    csv(res, "chat-messages", toCsv([{ label: "time", value: (r) => iso(r.at) }, { label: "user", value: "username" }, { label: "message", value: "text" }, { label: "gif", value: (r) => (r.gif ? "yes" : "") }, { label: "deleted", value: (r) => (r.deleted ? `by ${r.deletedBy}` : "") }], messages));
  }));

  router.use((_req, res) => res.status(404).json({ error: "Not found." }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof AdminError) return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "That request is too big." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "That request isn't valid JSON." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return {
    router,
    announcement: () => cached("announcement"),
    maintenance: () => cached("maintenance"),
    blocklist: () => cached("blocklist"),
    terms: () => cached("terms"),
  };
}

/** The router for /api/admin when accounts are unavailable. */
export function disabledAdmin() {
  const router = express.Router();
  router.use((_req, res) => res.status(404).json({ error: "The admin panel needs accounts, which aren't available on this site." }));
  const off = { on: false, message: "" };
  return { router, announcement: () => ({ id: 0, text: "", level: "info", active: false }), maintenance: () => off, blocklist: () => ({ hosts: [], keywords: [], queryWords: [] }), terms: () => ({ enabled: false }) };
}
