/*
 * The App Store's data: community apps, their icons and who installed them.
 *
 * An app here is a web address with a name, a description and a category: SuperNova never
 * hosts anyone's page, so an app can't run script on this site's own origin. Installing one
 * adds it to the person's desktop like any app they add themselves, and it opens through
 * the proxy like any other site.
 *
 * Status: "pending" (waiting for an admin), "approved" (in the store) or "rejected".
 * Whether new apps wait or go live at once is the admin's "store" setting (admindb.js).
 */
import { AdminError } from "./accountsdb.js";
import { normalizeText } from "./chatfilter.js";

export const CATEGORIES = [
  { id: "games", label: "Games" },
  { id: "tools", label: "Tools" },
  { id: "social", label: "Social" },
  { id: "media", label: "Media" },
  { id: "learning", label: "Learning" },
  { id: "other", label: "Other" },
];
const CATEGORY_IDS = new Set(CATEGORIES.map((category) => category.id));

export const LIMITS = {
  nameMin: 2,
  nameMax: 40,
  descriptionMax: 300,
  urlMax: 500,
  reasonMax: 200,
  iconBytes: 120 * 1024,
  iconPixels: 1024,
};

/** Make a name or description plain: one line for names, a few for descriptions. */
export function cleanText(raw, { max, lines = 1 }) {
  let text = normalizeText(raw);
  if (lines === 1) text = text.replace(/\s*\n\s*/g, " ");
  else text = text.split("\n").slice(0, lines).join("\n");
  return Array.from(text).slice(0, max).join("").trim();
}

const HOSTNAME = /^(?=.{1,253}$)(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/iu;

/**
 * The address of an app, checked: { url, key, host }. Only http(s) with a real domain name:
 * no sign-in details inside the address, no bare IP addresses and no "localhost", which
 * would point the proxy at somebody's own network.
 */
export function normalizeUrl(input) {
  let value = String(input ?? "").trim();
  if (!value) throw new AdminError(400, "Add the web address of your app.");
  if (value.length > LIMITS.urlMax) throw new AdminError(400, "That web address is too long.");
  if (/\s/.test(value)) throw new AdminError(400, "A web address can't contain spaces.");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value}`;
  let parsed;
  try { parsed = new URL(value); } catch { throw new AdminError(400, "That doesn't look like a web address."); }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new AdminError(400, "Only http and https addresses can be apps.");
  if (parsed.username || parsed.password) throw new AdminError(400, "A web address can't contain a username or password.");
  const host = parsed.hostname.toLowerCase();
  if (!HOSTNAME.test(host)) throw new AdminError(400, "Use a web address with a domain name, like example.com.");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new AdminError(400, "That address isn't reachable from the internet.");
  parsed.hash = "";
  const href = parsed.href;
  const key = `${host}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  return { url: href, key, host };
}

/** Everything a submission needs, checked: { name, description, category, url, key, host }. */
export function checkSubmission(input) {
  const name = cleanText(input?.name, { max: LIMITS.nameMax });
  if (Array.from(name).length < LIMITS.nameMin) throw new AdminError(400, `Give your app a name of at least ${LIMITS.nameMin} characters.`);
  const description = cleanText(input?.description, { max: LIMITS.descriptionMax, lines: 4 });
  if (Array.from(description).length < 10) throw new AdminError(400, "Describe your app in a sentence or two, at least 10 characters.");
  const category = String(input?.category ?? "");
  if (!CATEGORY_IDS.has(category)) throw new AdminError(400, "Pick a category.");
  return { name, description, category, ...normalizeUrl(input?.url) };
}

// --- reading ---------------------------------------------------------------------------------

const COLUMNS = `a.id, a.name, a.description, a.url, a.url_key, a.category, a.status, a.reason, a.created_at, a.updated_at,
  a.reviewed_by, a.reviewed_at, a.icon_version, u.username AS owner, u.is_admin AS owner_is_admin,
  (SELECT COUNT(*) FROM store_installs i WHERE i.app_id = a.id) AS installs`;

export function publicApp(row, { forOwner = false } = {}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    category: row.category,
    owner: row.owner,
    installs: row.installs,
    icon: row.icon_version || 0,
    created: row.created_at,
    updated: row.updated_at,
    ...(forOwner ? { status: row.status, reason: row.reason ?? null } : {}),
  };
}

export function getApp(db, id) {
  return db.prepare(`SELECT ${COLUMNS} FROM store_apps a JOIN users u ON u.id = a.owner_id WHERE a.id = ?`).get(Number(id));
}

/** The approved apps, filtered and ordered. { q, category, sort: "popular" | "new" | "name", limit, offset } */
export function listApproved(db, { q = "", category = "", sort = "popular", limit = 60, offset = 0 } = {}) {
  const where = ["a.status = 'approved'"];
  const args = [];
  if (category && CATEGORY_IDS.has(category)) { where.push("a.category = ?"); args.push(category); }
  const text = String(q ?? "").trim().slice(0, 60);
  if (text) {
    const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(a.name LIKE ? ESCAPE '\\' OR a.description LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  const order = sort === "new" ? "a.created_at DESC" : sort === "name" ? "a.name COLLATE NOCASE ASC" : "installs DESC, a.created_at DESC";
  const rows = db.prepare(`SELECT ${COLUMNS} FROM store_apps a JOIN users u ON u.id = a.owner_id
    WHERE ${where.join(" AND ")} ORDER BY ${order}, a.id DESC LIMIT ? OFFSET ?`)
    .all(...args, Math.min(Math.max(Number(limit) || 60, 1), 100), Math.max(Number(offset) || 0, 0));
  return rows;
}

export function listMine(db, userId) {
  return db.prepare(`SELECT ${COLUMNS} FROM store_apps a JOIN users u ON u.id = a.owner_id
    WHERE a.owner_id = ? ORDER BY a.created_at DESC, a.id DESC`).all(userId);
}

/** For the Admin Panel: apps by status, oldest first for the queue. */
export function listByStatus(db, { status = "pending", q = "", limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (status === "pending" || status === "approved" || status === "rejected") { where.push("a.status = ?"); args.push(status); }
  const text = String(q ?? "").trim().slice(0, 60);
  if (text) {
    const like = `%${text.replace(/[\\%_]/g, "\\$&")}%`;
    where.push("(a.name LIKE ? ESCAPE '\\' OR a.url LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\')");
    args.push(like, like, like);
  }
  const order = status === "pending" ? "a.created_at ASC" : "a.updated_at DESC";
  const rows = db.prepare(`SELECT ${COLUMNS} FROM store_apps a JOIN users u ON u.id = a.owner_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${order}, a.id DESC LIMIT ? OFFSET ?`)
    .all(...args, Math.min(Math.max(Number(limit) || 100, 1), 200), Math.max(Number(offset) || 0, 0));
  return rows;
}

export function countByStatus(db) {
  const counts = { pending: 0, approved: 0, rejected: 0 };
  for (const row of db.prepare("SELECT status, COUNT(*) AS n FROM store_apps GROUP BY status").all()) counts[row.status] = row.n;
  return counts;
}

/** How many apps a person has in the store or waiting (rejected ones don't count). */
export function countActive(db, userId) {
  return db.prepare("SELECT COUNT(*) AS n FROM store_apps WHERE owner_id = ? AND status IN ('pending', 'approved')").get(userId).n;
}

// --- writing ---------------------------------------------------------------------------------

/** Is this address already in the store (or waiting)? Optionally ignoring one app (when it is edited). */
export function urlTaken(db, key, exceptId = 0) {
  return Boolean(db.prepare("SELECT 1 FROM store_apps WHERE url_key = ? AND status IN ('pending', 'approved') AND id <> ?").get(key, exceptId));
}

export function insertApp(db, { ownerId, name, description, url, key, category, status, by = null, icon = null }) {
  const now = Date.now();
  const decided = status === "approved";
  db.exec("BEGIN");
  try {
    const { lastInsertRowid } = db.prepare(`INSERT INTO store_apps (owner_id, name, description, url, url_key, category, status, created_at, updated_at, reviewed_by, reviewed_at, icon_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ownerId, name, description, url, key, category, status, now, now, decided ? by : null, decided ? now : null, icon ? 1 : 0);
    if (icon) db.prepare("INSERT INTO store_icons (app_id, mime, data) VALUES (?, ?, ?)").run(lastInsertRowid, icon.mime, icon.data);
    db.exec("COMMIT");
    return Number(lastInsertRowid);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Change an app's details (and icon, when `icon` is given; `icon: false` removes it). */
export function updateApp(db, id, { name, description, url, key, category, status, icon }) {
  const now = Date.now();
  db.exec("BEGIN");
  try {
    db.prepare(`UPDATE store_apps SET name = ?, description = ?, url = ?, url_key = ?, category = ?, status = ?, updated_at = ?,
      reason = CASE WHEN ? = 'pending' THEN NULL ELSE reason END WHERE id = ?`)
      .run(name, description, url, key, category, status, now, status, id);
    if (icon) {
      db.prepare("INSERT INTO store_icons (app_id, mime, data) VALUES (?, ?, ?) ON CONFLICT(app_id) DO UPDATE SET mime = excluded.mime, data = excluded.data").run(id, icon.mime, icon.data);
      db.prepare("UPDATE store_apps SET icon_version = icon_version + 1 WHERE id = ?").run(id);
    } else if (icon === false) {
      db.prepare("DELETE FROM store_icons WHERE app_id = ?").run(id);
      db.prepare("UPDATE store_apps SET icon_version = 0 WHERE id = ?").run(id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** An admin's decision. Approving needs no reason; rejecting can carry one the owner sees. */
export function decide(db, id, { status, by, reason = null }) {
  if (status !== "approved" && status !== "rejected") throw new AdminError(400, "Approve or reject.");
  const now = Date.now();
  const cleaned = reason ? cleanText(reason, { max: LIMITS.reasonMax }) : null;
  db.prepare("UPDATE store_apps SET status = ?, reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
    .run(status, status === "rejected" ? cleaned || null : null, String(by), now, now, id);
}

export function deleteApp(db, id) {
  db.prepare("DELETE FROM store_apps WHERE id = ?").run(id);
}

export function getIcon(db, id) {
  return db.prepare("SELECT mime, data FROM store_icons WHERE app_id = ?").get(Number(id));
}

export function addInstall(db, appId, userId) {
  db.prepare("INSERT OR IGNORE INTO store_installs (app_id, user_id, at) VALUES (?, ?, ?)").run(appId, userId, Date.now());
}

export function removeInstall(db, appId, userId) {
  db.prepare("DELETE FROM store_installs WHERE app_id = ? AND user_id = ?").run(appId, userId);
}

/** Of these apps, which has this person installed? */
export function installedIds(db, userId) {
  return new Set(db.prepare("SELECT app_id FROM store_installs WHERE user_id = ?").all(userId).map((row) => row.app_id));
}
