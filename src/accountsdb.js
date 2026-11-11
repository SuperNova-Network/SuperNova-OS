/*
 * The accounts database: opening and migrating it, plus the operations that both
 * the server (src/accounts.js) and the command line (scripts/admin.js) need:
 * invite codes and bans.
 *
 * One SQLite file, DATA_DIR/accounts.db, through the built-in node:sqlite. Every
 * function here is synchronous, so a sequence of statements is never interleaved
 * with another request's.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Codes use an alphabet without look-alikes (no 0/O, 1/I/L), in groups of five.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function code(length) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out.match(/.{5}/g).join("-");
}
/** A recovery code: 20 characters, about 100 bits. */
export const newRecoveryCode = () => code(20);
/** An invite code: 10 characters, about 50 bits; plenty for something rate limited and short-lived. */
export const newInviteCode = () => code(10);
/** Codes are typed by people: ignore case, spaces and dashes. */
export const normalizeCode = (value) => String(value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

export const INVITE_MAX_USES = 1000;
export const INVITE_MAX_DAYS = 365;
const DAY = 24 * 60 * 60 * 1000;

// Each entry upgrades the schema by one version (PRAGMA user_version).
const MIGRATIONS = [
  // 1: accounts and sessions
  (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      recovery_hash TEXT NOT NULL,
      settings TEXT NOT NULL DEFAULT '{}',
      revision INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
  `),
  // 2: invite codes, bans, last seen
  (db) => {
    const columns = new Set(db.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
    for (const [name, type] of [["banned_at", "INTEGER"], ["ban_reason", "TEXT"], ["last_seen_at", "INTEGER"], ["invite_id", "INTEGER"]]) {
      if (!columns.has(name)) db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS invites (
        id INTEGER PRIMARY KEY,
        code_hash TEXT NOT NULL UNIQUE,
        hint TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        max_uses INTEGER NOT NULL,
        uses INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        created_by TEXT,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
    `);
  },
  // 3: site settings chosen in Settings > Admin, and admins as a flag on the account
  (db) => {
    const columns = new Set(db.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
    if (!columns.has("is_admin")) db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
    db.exec(`
      CREATE TABLE IF NOT EXISTS site_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      );
    `);
  },
  // 4: profile pictures. The picture lives in its own table so that the many queries
  // that load a user's row never drag the image bytes along; the version number on the
  // user changes with every new picture, so browsers cache each one for good.
  (db) => {
    const columns = new Set(db.prepare("PRAGMA table_info(users)").all().map((column) => column.name));
    if (!columns.has("avatar_version")) db.exec("ALTER TABLE users ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0");
    db.exec(`
      CREATE TABLE IF NOT EXISTS avatars (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        mime TEXT NOT NULL,
        data BLOB NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  },
  // 5: the live chat (see chatdb.js). Messages and sanctions belong to the account and
  // go with it when it is deleted.
  (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      media_kind TEXT,
      media_ref TEXT,
      created_at INTEGER NOT NULL,
      deleted_at INTEGER,
      deleted_by TEXT
    );
    CREATE INDEX IF NOT EXISTS chat_messages_user ON chat_messages(user_id, created_at);
    CREATE TABLE IF NOT EXISTS chat_media (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chat_sanctions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('timeout', 'ban')),
      reason TEXT,
      created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      lifted_at INTEGER,
      lifted_by TEXT
    );
    CREATE INDEX IF NOT EXISTS chat_sanctions_user ON chat_sanctions(user_id);
    CREATE TABLE IF NOT EXISTS chat_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS chat_log (
      id INTEGER PRIMARY KEY,
      at INTEGER NOT NULL,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT
    );
  `),
  // 6: the admin panel. Where a session was started from, an audit log of what admins do,
  // and settings it manages (announcement, maintenance mode, extra blocked sites).
  (db) => {
    const columns = new Set(db.prepare("PRAGMA table_info(sessions)").all().map((column) => column.name));
    for (const name of ["ip", "user_agent"]) if (!columns.has(name)) db.exec(`ALTER TABLE sessions ADD COLUMN ${name} TEXT`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS admin_log (
        id INTEGER PRIMARY KEY,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT,
        detail TEXT
      );
      CREATE INDEX IF NOT EXISTS admin_log_at ON admin_log(at);
      CREATE TABLE IF NOT EXISTS admin_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        updated_by TEXT
      );
    `);
  },
  // 7: the App Store. Community apps (a web address with a name, a description and a category),
  // their optional icons, and who installed what (so each person counts once).
  (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS store_apps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL,
      url_key TEXT NOT NULL,
      category TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      reviewed_by TEXT,
      reviewed_at INTEGER,
      icon_version INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS store_apps_status ON store_apps(status, created_at);
    CREATE INDEX IF NOT EXISTS store_apps_owner ON store_apps(owner_id);
    CREATE UNIQUE INDEX IF NOT EXISTS store_apps_url ON store_apps(url_key) WHERE status IN ('pending', 'approved');
    CREATE TABLE IF NOT EXISTS store_icons (
      app_id INTEGER PRIMARY KEY REFERENCES store_apps(id) ON DELETE CASCADE,
      mime TEXT NOT NULL,
      data BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS store_installs (
      app_id INTEGER NOT NULL REFERENCES store_apps(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      at INTEGER NOT NULL,
      PRIMARY KEY (app_id, user_id)
    );
  `),
  // 8: reports of store apps (one per person per app).
  (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS store_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      app_id INTEGER NOT NULL REFERENCES store_apps(id) ON DELETE CASCADE,
      reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reason TEXT NOT NULL,
      note TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (app_id, reporter_id)
    );
    CREATE INDEX IF NOT EXISTS store_reports_app ON store_reports(app_id);
  `),
];

/** Open (creating and upgrading as needed) DATA_DIR/accounts.db. */
export async function openDatabase(dataDir) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    throw new Error(`Accounts need Node.js 22.13 or newer (node:sqlite); this is ${process.version}.`);
  }
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "accounts.db"));
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const version = db.prepare("PRAGMA user_version").get().user_version;
  for (let next = version; next < MIGRATIONS.length; next++) {
    transaction(db, () => {
      MIGRATIONS[next](db);
      db.exec(`PRAGMA user_version = ${next + 1}`);
    });
  }
  return db;
}

/** Run fn inside one transaction (synchronous only). */
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export class AdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// --- invite codes ------------------------------------------------------------------

function inviteState(row, now = Date.now()) {
  if (row.revoked_at) return "revoked";
  if (row.uses >= row.max_uses) return "used up";
  if (row.expires_at && row.expires_at <= now) return "expired";
  return "active";
}

function publicInvite(row) {
  return {
    id: row.id,
    label: row.label,
    hint: row.hint,
    maxUses: row.max_uses,
    uses: row.uses,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    state: inviteState(row),
  };
}

/**
 * Make a new invite code. Returns { code, invite }; the code itself is stored only
 * as a hash, so this is the one time it can be shown.
 */
export function createInvite(db, { label = "", maxUses = 1, expiresInDays = 7, createdBy = null } = {}) {
  maxUses = Number(maxUses);
  expiresInDays = Number(expiresInDays);
  if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > INVITE_MAX_USES) throw new AdminError(400, `Uses must be a whole number from 1 to ${INVITE_MAX_USES}.`);
  if (!Number.isFinite(expiresInDays) || expiresInDays < 0 || expiresInDays > INVITE_MAX_DAYS) throw new AdminError(400, `Expiry must be 0 (never) to ${INVITE_MAX_DAYS} days.`);
  label = String(label ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  const value = newInviteCode();
  const now = Date.now();
  const expiresAt = expiresInDays ? now + Math.round(expiresInDays * DAY) : null;
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO invites (code_hash, hint, label, max_uses, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(sha256(normalizeCode(value)), value.slice(-4), label, maxUses, expiresAt, createdBy, now);
  return { code: value, invite: publicInvite(db.prepare("SELECT * FROM invites WHERE id = ?").get(Number(lastInsertRowid))) };
}

export function listInvites(db) {
  return db.prepare("SELECT * FROM invites ORDER BY created_at DESC LIMIT 500").all().map(publicInvite);
}

export function revokeInvite(db, id) {
  const { changes } = db.prepare("UPDATE invites SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").run(Date.now(), Number(id));
  if (!changes && !db.prepare("SELECT 1 FROM invites WHERE id = ?").get(Number(id))) throw new AdminError(404, "No such invite code.");
}

/**
 * Use up one use of an invite code, if it is valid. Returns its id, or null. Call
 * inside the transaction that creates the account, so a failed sign-up gives the
 * use back.
 */
export function redeemInvite(db, value) {
  const row = db.prepare("SELECT * FROM invites WHERE code_hash = ?").get(sha256(normalizeCode(value)));
  if (!row || inviteState(row) !== "active") return null;
  const { changes } = db.prepare("UPDATE invites SET uses = uses + 1 WHERE id = ? AND uses < max_uses").run(row.id);
  return changes ? row.id : null;
}

// --- site settings -------------------------------------------------------------------

export const SITE_SETTINGS = {
  // Accounts: off (none), optional (sign in from Settings) or required (sign-in screen).
  mode: ["off", "optional", "required"],
  // Who can create an account.
  signup: ["invite", "open", "closed"],
};

export function getSiteSettings(db) {
  const out = {};
  for (const { key, value } of db.prepare("SELECT key, value FROM site_settings").all()) {
    if (SITE_SETTINGS[key]?.includes(value)) out[key] = value;
  }
  return out;
}

export function setSiteSetting(db, key, value, updatedBy = null) {
  if (!SITE_SETTINGS[key]) throw new AdminError(400, `Unknown setting "${key}".`);
  if (!SITE_SETTINGS[key].includes(value)) throw new AdminError(400, `${key} must be one of: ${SITE_SETTINGS[key].join(", ")}.`);
  db.prepare("INSERT INTO site_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by")
    .run(key, value, Date.now(), updatedBy);
}

// --- admins ------------------------------------------------------------------------

/** Whether any name in ADMINS has an account (only then is it a working admin). */
function serverAdminExists(db, serverAdmins) {
  const names = [...serverAdmins];
  if (!names.length) return false;
  return Boolean(db.prepare(`SELECT 1 FROM users WHERE lower(username) IN (${names.map(() => "?").join(",")}) AND banned_at IS NULL LIMIT 1`).get(...names));
}

/** Admins in the database (ADMINS on the server adds more). */
export function adminCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1 AND banned_at IS NULL").get().n;
}

/** Make someone an admin, or not. `serverAdmins`: names from ADMINS, which stay admins. */
export function setAdmin(db, username, admin, { serverAdmins = new Set() } = {}) {
  const user = db.prepare("SELECT id, username, is_admin, banned_at FROM users WHERE username = ?").get(String(username ?? ""));
  if (!user) throw new AdminError(404, "There's no account with that name.");
  if (admin && user.banned_at) throw new AdminError(400, "Unban them first.");
  if (!admin && serverAdmins.has(user.username.toLowerCase())) throw new AdminError(403, "They're an admin through ADMINS on the server; remove them there.");
  if (!admin && user.is_admin && adminCount(db) <= 1 && !serverAdminExists(db, serverAdmins)) throw new AdminError(400, "They're the only admin. Make someone else an admin first.");
  db.prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(admin ? 1 : 0, user.id);
  return user.id;
}

// --- people and bans ---------------------------------------------------------------

/** Everyone, newest first (at most 1000), optionally filtered by part of the name. */
export function listUsers(db, { search = "", admins = new Set() } = {}) {
  const like = `%${String(search).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  return db.prepare(`
    SELECT users.username, users.created_at, users.last_seen_at, users.banned_at, users.ban_reason, users.is_admin,
           invites.label AS invite_label, invites.hint AS invite_hint
    FROM users LEFT JOIN invites ON invites.id = users.invite_id
    WHERE users.username LIKE ? ESCAPE '\\'
    ORDER BY users.created_at DESC LIMIT 1000
  `).all(like).map((row) => ({
    username: row.username,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    banned: Boolean(row.banned_at),
    bannedAt: row.banned_at,
    banReason: row.ban_reason,
    admin: Boolean(row.is_admin) || admins.has(row.username.toLowerCase()),
    serverAdmin: admins.has(row.username.toLowerCase()),
    invite: row.invite_label || (row.invite_hint ? `…${row.invite_hint}` : null),
  }));
}

/**
 * Ban or unban someone. Banning signs them out everywhere (their sessions are
 * deleted). Returns the user's id. `admins`: usernames that cannot be banned.
 */
export function setBanned(db, username, banned, { reason = "", admins = new Set() } = {}) {
  const user = db.prepare("SELECT id, username, is_admin FROM users WHERE username = ?").get(String(username ?? ""));
  if (!user) throw new AdminError(404, "There's no account with that name.");
  if (banned && (user.is_admin || admins.has(user.username.toLowerCase()))) throw new AdminError(403, "Admins can't be banned. Remove their admin role first.");
  transaction(db, () => {
    if (banned) {
      db.prepare("UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?").run(Date.now(), String(reason ?? "").trim().slice(0, 200) || null, user.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    } else {
      db.prepare("UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?").run(user.id);
    }
  });
  return user.id;
}

// --- profile pictures --------------------------------------------------------------

/** Set (or, with null, remove) someone's profile picture. Returns the new version (0 = none). */
export function setAvatar(db, userId, image) {
  return transaction(db, () => {
    if (!image) {
      db.prepare("DELETE FROM avatars WHERE user_id = ?").run(userId);
      db.prepare("UPDATE users SET avatar_version = 0 WHERE id = ?").run(userId);
      return 0;
    }
    const now = Date.now();
    db.prepare("INSERT INTO avatars (user_id, mime, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET mime = excluded.mime, data = excluded.data, updated_at = excluded.updated_at")
      .run(userId, image.mime, image.data, now);
    // Time-based, so it never repeats (and so never matches a cached older picture).
    db.prepare("UPDATE users SET avatar_version = ? WHERE id = ?").run(now, userId);
    return now;
  });
}

/** { mime, data, version } for a username, or null when they have no picture. */
export function getAvatar(db, username) {
  const row = db.prepare("SELECT avatars.mime, avatars.data, users.avatar_version FROM avatars JOIN users ON users.id = avatars.user_id WHERE users.username = ?").get(String(username ?? ""));
  return row ? { mime: row.mime, data: row.data, version: row.avatar_version } : null;
}
