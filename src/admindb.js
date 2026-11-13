/*
 * What the admin panel needs from the database (the tables come from migration 6 in
 * accountsdb.js, and the accounts and chat tables from the earlier ones). Everything is
 * synchronous, like accountsdb.js.
 */
import { statSync } from "node:fs";
import { join } from "node:path";
import { AdminError, transaction } from "./accountsdb.js";

const DAY = 24 * 60 * 60 * 1000;
export const LOG_KEEP = 5000;

// --- audit log -----------------------------------------------------------------------

/** Remember what an admin did. `target` is who or what it was done to. */
export function logAdmin(db, actor, action, target = null, detail = null) {
  db.prepare("INSERT INTO admin_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)")
    .run(Date.now(), String(actor ?? "system"), String(action), target == null ? null : String(target).slice(0, 120), detail == null ? null : String(detail).slice(0, 300));
  db.prepare("DELETE FROM admin_log WHERE id <= (SELECT MAX(id) FROM admin_log) - ?").run(LOG_KEEP);
}

/**
 * The audit trail: what admins did on the site, and the chat's moderation log, newest first.
 * filters: { q, actor, source: "site" | "chat", before (a timestamp), limit }
 */
export function listAudit(db, { q = "", actor = "", source = "", before = null, limit = 100 } = {}) {
  limit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const like = `%${String(q).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT at, actor, action, target, detail, 'site' AS source FROM admin_log
      UNION ALL
      SELECT at, actor, action, target, detail, 'chat' AS source FROM chat_log
    )
    WHERE (? = '' OR source = ?)
      AND (? = '' OR lower(actor) = lower(?))
      AND (? = '%%' OR action LIKE ? ESCAPE '\\' OR COALESCE(target, '') LIKE ? ESCAPE '\\' OR COALESCE(detail, '') LIKE ? ESCAPE '\\')
      AND (? IS NULL OR at < ?)
    ORDER BY at DESC LIMIT ?`).all(source, source, actor, actor, like, like, like, like, before, before, limit);
  return rows;
}

// --- settings the panel manages -------------------------------------------------------------

export const ADMIN_DEFAULTS = {
  announcement: { id: 0, text: "", level: "info", active: false },
  maintenance: { on: false, message: "SuperNova OS is being updated. Please check back in a few minutes." },
  blocklist: { hosts: [], keywords: [], queryWords: [] },
  // The red "Acceptable use" screen everyone who isn't signed in must agree to once (off by default).
  terms: { enabled: false },
  // The App Store: do new apps wait for an admin ("manual") or go live at once ("auto")?
  store: { approval: "manual", publishing: true, maxPerUser: 5 },
};

export function getAdminSetting(db, key) {
  const row = db.prepare("SELECT value FROM admin_settings WHERE key = ?").get(key);
  if (!row) return structuredClone(ADMIN_DEFAULTS[key]);
  try { return { ...structuredClone(ADMIN_DEFAULTS[key]), ...JSON.parse(row.value) }; } catch { return structuredClone(ADMIN_DEFAULTS[key]); }
}

export function setAdminSetting(db, key, value, by = null) {
  if (!ADMIN_DEFAULTS[key]) throw new AdminError(400, `Unknown setting "${key}".`);
  db.prepare("INSERT INTO admin_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .run(key, JSON.stringify(value), Date.now(), by);
  return value;
}

const LEVELS = ["info", "warning", "danger"];

/** Validate and save the announcement. Every change gets a new id, so people see it again. */
export function saveAnnouncement(db, input, by) {
  const text = String(input?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  const level = LEVELS.includes(input?.level) ? input.level : "info";
  const active = Boolean(input?.active) && text.length > 0;
  if (input?.active && !text) throw new AdminError(400, "Write the announcement first.");
  return setAdminSetting(db, "announcement", { id: Date.now(), text, level, active }, by);
}

export function saveTerms(db, input, by) {
  return setAdminSetting(db, "terms", { enabled: Boolean(input?.enabled) }, by);
}

export function saveMaintenance(db, input, by) {
  const message = String(input?.message ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || ADMIN_DEFAULTS.maintenance.message;
  return setAdminSetting(db, "maintenance", { on: Boolean(input?.on), message }, by);
}

export function saveStoreSettings(db, input, by) {
  const current = getAdminSetting(db, "store");
  const next = { ...current };
  if (input?.approval !== undefined) {
    if (input.approval !== "manual" && input.approval !== "auto") throw new AdminError(400, "Approval is manual or auto.");
    next.approval = input.approval;
  }
  if (input?.publishing !== undefined) next.publishing = Boolean(input.publishing);
  if (input?.maxPerUser !== undefined) {
    const n = Number(input.maxPerUser);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new AdminError(400, "People can publish 1 to 50 apps.");
    next.maxPerUser = n;
  }
  return setAdminSetting(db, "store", next, by);
}

const HOST = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A clean list of items: trimmed, lowercased, unique, each passing `valid`; throws on the first bad one. */
function cleanList(list, valid, what, max = 500) {
  if (!Array.isArray(list)) throw new AdminError(400, `The ${what} must be a list.`);
  const out = [];
  for (const raw of list) {
    let item = String(raw ?? "").trim().toLowerCase();
    if (what === "sites") item = item.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
    if (!item) continue;
    if (!valid(item)) throw new AdminError(400, `"${String(raw).slice(0, 60)}" isn't a valid entry for the ${what}.`);
    if (!out.includes(item)) out.push(item);
  }
  if (out.length > max) throw new AdminError(400, `You can block up to ${max} ${what}.`);
  return out;
}

/** Extra blocked sites, hostname keywords and search words, on top of the server's built-in list. */
export function saveBlocklist(db, input, by) {
  const value = {
    hosts: cleanList(input?.hosts ?? [], (item) => HOST.test(item), "sites"),
    keywords: cleanList(input?.keywords ?? [], (item) => /^[a-z0-9-]{3,40}$/.test(item), "hostname keywords"),
    queryWords: cleanList(input?.queryWords ?? [], (item) => item.length >= 2 && item.length <= 40 && !/[\n\r]/.test(item), "search words"),
  };
  return setAdminSetting(db, "blocklist", value, by);
}

// --- the dashboard ----------------------------------------------------------------------------

function series(times, days, now) {
  const out = Array.from({ length: days }, () => 0);
  for (const time of times) {
    const index = days - 1 - Math.floor((now - time) / DAY);
    if (index >= 0 && index < days) out[index]++;
  }
  return out;
}

/** The numbers on the dashboard. */
export function overview(db, now = Date.now()) {
  const one = (sql, ...params) => db.prepare(sql).get(...params);
  const users = one(`SELECT COUNT(*) AS total,
      COALESCE(SUM(is_admin), 0) AS admins,
      COALESCE(SUM(banned_at IS NOT NULL), 0) AS banned,
      COALESCE(SUM(created_at > ?), 0) AS today,
      COALESCE(SUM(created_at > ?), 0) AS week,
      COALESCE(SUM(last_seen_at > ?), 0) AS active
    FROM users`, now - DAY, now - 7 * DAY, now - DAY);
  const days = 14;
  const since = now - days * DAY;
  return {
    users,
    sessions: one("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?", now).n,
    invites: one("SELECT COUNT(*) AS n FROM invites WHERE revoked_at IS NULL AND uses < max_uses AND (expires_at IS NULL OR expires_at > ?)", now).n,
    chat: {
      messages: one("SELECT COUNT(*) AS n FROM chat_messages WHERE deleted_at IS NULL").n,
      today: one("SELECT COUNT(*) AS n FROM chat_messages WHERE deleted_at IS NULL AND created_at > ?", now - DAY).n,
      sanctions: one("SELECT COUNT(*) AS n FROM chat_sanctions WHERE lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)", now).n,
    },
    signups: series(db.prepare("SELECT created_at FROM users WHERE created_at >= ?").all(since).map((r) => r.created_at), days, now),
    messages: series(db.prepare("SELECT created_at FROM chat_messages WHERE deleted_at IS NULL AND created_at >= ?").all(since).map((r) => r.created_at), days, now),
    store: {
      pending: one("SELECT COUNT(*) AS n FROM store_apps WHERE status = 'pending'").n,
      live: one("SELECT COUNT(*) AS n FROM store_apps WHERE status = 'approved'").n,
      reported: one("SELECT COUNT(DISTINCT app_id) AS n FROM store_reports").n,
    },
    recent: listAudit(db, { limit: 8 }),
  };
}

// --- people --------------------------------------------------------------------------------------

const likeOf = (text) => `%${String(text).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const SORTS = {
  created: "users.created_at",
  seen: "COALESCE(users.last_seen_at, 0)",
  name: "users.username COLLATE NOCASE",
  messages: "messages",
};

/**
 * One page of accounts. options: { q, filter: all|admins|banned|new|active|inactive,
 * sort: created|seen|name|messages, order: asc|desc, page, pageSize }.
 * `serverAdmins`: names that are admins through ADMINS on the server.
 */
export function listUsersPage(db, { q = "", filter = "all", sort = "created", order = "desc", page = 1, pageSize = 25 } = {}, serverAdmins = new Set(), now = Date.now()) {
  pageSize = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  page = Math.max(Number(page) || 1, 1);
  const where = ["users.username LIKE ? ESCAPE '\\'"];
  const params = [likeOf(q)];
  if (filter === "admins") {
    const names = [...serverAdmins];
    where.push(names.length ? `(users.is_admin = 1 OR lower(users.username) IN (${names.map(() => "?").join(",")}))` : "users.is_admin = 1");
    params.push(...names);
  } else if (filter === "banned") where.push("users.banned_at IS NOT NULL");
  else if (filter === "new") { where.push("users.created_at > ?"); params.push(now - 7 * DAY); }
  else if (filter === "active") { where.push("users.last_seen_at > ?"); params.push(now - DAY); }
  else if (filter === "inactive") { where.push("(users.last_seen_at IS NULL OR users.last_seen_at < ?)"); params.push(now - 30 * DAY); }
  const orderBy = `${SORTS[sort] ?? SORTS.created} ${order === "asc" ? "ASC" : "DESC"}, users.id DESC`;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE ${where.join(" AND ")}`).get(...params).n;
  const rows = db.prepare(`
    SELECT users.id, users.username, users.created_at, users.last_seen_at, users.banned_at, users.ban_reason, users.is_admin, users.avatar_version,
           invites.label AS invite_label, invites.hint AS invite_hint,
           (SELECT COUNT(*) FROM chat_messages WHERE chat_messages.user_id = users.id AND chat_messages.deleted_at IS NULL) AS messages,
           (SELECT COUNT(*) FROM sessions WHERE sessions.user_id = users.id AND sessions.expires_at > ?) AS sessions
    FROM users LEFT JOIN invites ON invites.id = users.invite_id
    WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(now, ...params, pageSize, (page - 1) * pageSize);
  return { total, page, pageSize, users: rows.map((row) => publicRow(row, serverAdmins)) };
}

function publicRow(row, serverAdmins) {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    banned: Boolean(row.banned_at),
    banReason: row.ban_reason,
    admin: Boolean(row.is_admin) || serverAdmins.has(row.username.toLowerCase()),
    serverAdmin: serverAdmins.has(row.username.toLowerCase()),
    avatar: row.avatar_version ?? 0,
    invite: row.invite_label || (row.invite_hint ? `…${row.invite_hint}` : null),
    messages: row.messages ?? 0,
    sessions: row.sessions ?? 0,
  };
}

/** Everything about one account, for the details window. Returns null if there is no such account. */
export function userDetail(db, username, serverAdmins = new Set(), now = Date.now()) {
  const row = db.prepare(`
    SELECT users.id, users.username, users.created_at, users.last_seen_at, users.banned_at, users.ban_reason, users.is_admin, users.avatar_version, users.revision,
           length(users.settings) AS settings_bytes, invites.label AS invite_label, invites.hint AS invite_hint,
           (SELECT COUNT(*) FROM chat_messages WHERE chat_messages.user_id = users.id AND chat_messages.deleted_at IS NULL) AS messages,
           (SELECT COUNT(*) FROM sessions WHERE sessions.user_id = users.id AND sessions.expires_at > ?) AS sessions
    FROM users LEFT JOIN invites ON invites.id = users.invite_id WHERE users.username = ?`).get(now, String(username ?? ""));
  if (!row) return null;
  return {
    ...publicRow(row, serverAdmins),
    settingsBytes: row.settings_bytes,
    settingsRevision: row.revision,
    sessionList: db.prepare("SELECT rowid AS id, created_at, expires_at, ip, user_agent FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20").all(row.id, now)
      .map((s) => ({ id: s.id, createdAt: s.created_at, expiresAt: s.expires_at, ip: s.ip, userAgent: s.user_agent })),
    recentMessages: db.prepare("SELECT id, body, media_kind, created_at FROM chat_messages WHERE user_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 8").all(row.id)
      .map((m) => ({ id: m.id, text: m.body, gif: Boolean(m.media_kind), at: m.created_at })),
    sanctions: db.prepare("SELECT kind, reason, created_by, created_at, expires_at, lifted_at, lifted_by FROM chat_sanctions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").all(row.id)
      .map((s) => ({ kind: s.kind, reason: s.reason, by: s.created_by, at: s.created_at, until: s.expires_at, liftedAt: s.lifted_at, liftedBy: s.lifted_by })),
    audit: listAudit(db, { q: row.username, limit: 15 }),
  };
}

/** Sign someone out everywhere. Returns how many sessions ended. */
export function signOutUser(db, username) {
  const user = db.prepare("SELECT id FROM users WHERE username = ?").get(String(username ?? ""));
  if (!user) throw new AdminError(404, "There's no account with that name.");
  return { id: user.id, ended: db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id).changes };
}

/** Set a new password hash and sign every browser out. `hash` is made by passwords.js. */
export function setUserPassword(db, username, hash) {
  const user = db.prepare("SELECT id FROM users WHERE username = ?").get(String(username ?? ""));
  if (!user) throw new AdminError(404, "There's no account with that name.");
  transaction(db, () => {
    db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?").run(hash, Date.now(), user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
  });
  return user.id;
}

/** Delete an account and everything of its. Admins and the last admin are protected; `by` can't delete themselves. */
export function deleteUser(db, username, { by = "", isAdminRow }) {
  const user = db.prepare("SELECT id, username, is_admin FROM users WHERE username = ?").get(String(username ?? ""));
  if (!user) throw new AdminError(404, "There's no account with that name.");
  if (user.username.toLowerCase() === String(by).toLowerCase()) throw new AdminError(400, "You can't delete your own account here. Use Settings > Account.");
  if (isAdminRow(user)) throw new AdminError(403, "Remove their admin role first.");
  db.prepare("DELETE FROM users WHERE id = ?").run(user.id); // sessions, pictures, messages, sanctions go with it
  return user.id;
}

// --- sessions ------------------------------------------------------------------------------------------

export function listSessions(db, { q = "", page = 1, pageSize = 25, currentHash = "" } = {}, now = Date.now()) {
  pageSize = Math.min(Math.max(Number(pageSize) || 25, 1), 100);
  page = Math.max(Number(page) || 1, 1);
  const like = likeOf(q);
  const total = db.prepare("SELECT COUNT(*) AS n FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.expires_at > ? AND users.username LIKE ? ESCAPE '\\'").get(now, like).n;
  const rows = db.prepare(`
    SELECT sessions.rowid AS id, users.username, sessions.created_at, sessions.expires_at, sessions.ip, sessions.user_agent, (sessions.token_hash = ?) AS current
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.expires_at > ? AND users.username LIKE ? ESCAPE '\\'
    ORDER BY sessions.created_at DESC LIMIT ? OFFSET ?`).all(currentHash, now, like, pageSize, (page - 1) * pageSize);
  return { total, page, pageSize, sessions: rows.map((s) => ({ id: s.id, username: s.username, createdAt: s.created_at, expiresAt: s.expires_at, ip: s.ip, userAgent: s.user_agent, current: Boolean(s.current) })) };
}

/** End one session by its id. Returns the owner's username, or null if it was already gone. */
export function revokeSession(db, id) {
  const row = db.prepare("SELECT users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.rowid = ?").get(Number(id));
  if (!row) return null;
  db.prepare("DELETE FROM sessions WHERE rowid = ?").run(Number(id));
  return row.username;
}

// --- chat messages ---------------------------------------------------------------------------------------

/** Search the chat's messages (also the deleted ones), newest first. */
export function searchChat(db, { q = "", username = "", before = null, includeDeleted = false, limit = 50 } = {}) {
  limit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return db.prepare(`
    SELECT chat_messages.id, chat_messages.body, chat_messages.media_kind, chat_messages.created_at, chat_messages.deleted_at, chat_messages.deleted_by, users.username
    FROM chat_messages JOIN users ON users.id = chat_messages.user_id
    WHERE (? = 1 OR chat_messages.deleted_at IS NULL)
      AND users.username LIKE ? ESCAPE '\\'
      AND chat_messages.body LIKE ? ESCAPE '\\'
      AND (? IS NULL OR chat_messages.id < ?)
    ORDER BY chat_messages.id DESC LIMIT ?`).all(includeDeleted ? 1 : 0, likeOf(username), likeOf(q), before, before, limit)
    .map((m) => ({ id: m.id, username: m.username, text: m.body, gif: Boolean(m.media_kind), at: m.created_at, deleted: Boolean(m.deleted_at), deletedBy: m.deleted_by }));
}

// --- the server itself -------------------------------------------------------------------------------------

const TABLES = ["users", "sessions", "invites", "avatars", "chat_messages", "chat_media", "chat_sanctions", "chat_log", "admin_log"];

const sizeOf = (path) => { try { return statSync(path).size; } catch { return 0; } };

/** Table sizes and database file sizes. */
export function databaseInfo(db, dataDir) {
  const counts = Object.fromEntries(TABLES.map((table) => [table, db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));
  return {
    counts,
    bytes: {
      database: sizeOf(join(dataDir, "accounts.db")),
      wal: sizeOf(join(dataDir, "accounts.db-wal")),
      pictures: db.prepare("SELECT COALESCE(SUM(length(data)), 0) AS n FROM avatars").get().n,
      gifs: db.prepare("SELECT COALESCE(SUM(length(data)), 0) AS n FROM chat_media").get().n,
    },
    schemaVersion: db.prepare("PRAGMA user_version").get().user_version,
  };
}

/** Tidy up: end expired sessions, drop deleted chat messages older than a week, shrink the file. */
export function prune(db, dataDir, now = Date.now()) {
  const before = sizeOf(join(dataDir, "accounts.db")) + sizeOf(join(dataDir, "accounts.db-wal"));
  const sessions = db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now).changes;
  const messages = db.prepare("DELETE FROM chat_messages WHERE deleted_at IS NOT NULL AND deleted_at < ?").run(now - 7 * DAY).changes;
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
  const after = sizeOf(join(dataDir, "accounts.db")) + sizeOf(join(dataDir, "accounts.db-wal"));
  return { sessions, messages, bytesBefore: before, bytesAfter: after };
}

/** Write a consistent copy of the database to `path` (which must not exist). */
export function backupTo(db, path) {
  db.prepare("VACUUM INTO ?").run(path);
}

// --- CSV -----------------------------------------------------------------------------------------------------

/** CSV text. Cells that a spreadsheet would run as a formula get a leading quote. */
export function toCsv(columns, rows) {
  const cell = (value) => {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [columns.map((c) => c.label).map(cell).join(","), ...rows.map((row) => columns.map((c) => cell(typeof c.value === "function" ? c.value(row) : row[c.value])).join(","))].join("\r\n") + "\r\n";
}
