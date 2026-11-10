/*
 * Accounts: a username and password that carry a person's settings (apps,
 * wallpaper, bookmarks, preferences) from one browser to another.
 *
 * Off unless ACCOUNTS=1. Data lives in one SQLite file (node:sqlite, built into
 * Node 22.13+) under DATA_DIR, which must be on a disk that survives restarts and
 * deploys. There is no email: a recovery code shown once at sign-up is the only
 * way back in after a forgotten password.
 *
 * Only settings are stored, never anything sensitive: proxied pages run on this
 * origin, so a page that escaped the proxy's rewriting could call this API with
 * the visitor's session. Changing the password or deleting the account therefore
 * asks for the password again.
 */
import express from "express";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createLimiter } from "./ratelimit.js";

const scrypt = promisify(scryptCb);

export const COOKIE = "sn_session";
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

// Settings: the same rules as a backup file (public/proxy/backup.js).
const KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const DEVICE_ONLY = new Set(["history", "visited-before", "welcome-popup"]);
const MAX_KEYS = 500;
const MAX_VALUE = 200_000;
const MAX_SETTINGS_BYTES = 512 * 1024;

// scrypt cost: about 50 ms and 32 MB per hash. Hashing runs off the main thread.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function checkPassword(password, stored) {
  const [scheme, N, r, p, salt, expected] = String(stored).split("$");
  if (scheme !== "scrypt") return false;
  const want = Buffer.from(expected, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), want.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return key.length === want.length && timingSafeEqual(key, want);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// 20 characters from an alphabet without look-alikes (no 0/O, 1/I/L): about 100 bits.
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
function newRecoveryCode() {
  const bytes = randomBytes(20);
  let code = "";
  for (let i = 0; i < 20; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return code.match(/.{5}/g).join("-");
}
const normalizeCode = (code) => String(code ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index !== -1 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/** Validate a settings change ({ set, remove }) and apply it to `current`. */
function mergeSettings(current, change) {
  const set = change?.set ?? {};
  const remove = change?.remove ?? [];
  if (typeof set !== "object" || Array.isArray(set) || !Array.isArray(remove)) {
    throw new HttpError(400, "Settings changes must be { set: {...}, remove: [...] }.");
  }
  const next = { ...current };
  for (const key of remove) {
    if (typeof key === "string") delete next[key];
  }
  for (const [key, value] of Object.entries(set)) {
    // Silently skipped, like a backup import: history never leaves the device.
    if (!KEY.test(key) || DEVICE_ONLY.has(key)) continue;
    if (typeof value !== "string" || value.length > MAX_VALUE) throw new HttpError(400, `The value of "${key}" is not a string or is too long.`);
    next[key] = value;
  }
  if (Object.keys(next).length > MAX_KEYS) throw new HttpError(413, "Too many settings.");
  const json = JSON.stringify(next);
  if (Buffer.byteLength(json) > MAX_SETTINGS_BYTES) throw new HttpError(413, "Your settings are too large to save to your account.");
  return { next, json };
}

function openDatabase(dataDir, DatabaseSync) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, "accounts.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 2000;
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
  `);
  return db;
}

/** The router for /api/account when accounts are off: it only says so. */
function disabledRouter() {
  const router = express.Router();
  router.get("/", (_req, res) => res.set("Cache-Control", "no-store").json({ enabled: false }));
  router.use((_req, res) => res.status(404).json({ error: "Accounts are not enabled on this site." }));
  return router;
}

/**
 * Build the /api/account router. Resolves to { router, userFor(req), close() }.
 * options: { enabled, required, signup, inviteCode, dataDir }
 *   required    the site needs an account (app.js guards everything else)
 *   inviteCode  when set, needed to create an account
 */
export async function createAccounts({ enabled, required = false, signup = true, inviteCode = "", dataDir = "data" } = {}) {
  if (!enabled) return { router: disabledRouter(), userFor: () => null, close() {} };
  const inviteHash = inviteCode ? sha256(inviteCode) : null;

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    throw new Error(`ACCOUNTS=1 needs Node.js 22.13 or newer (node:sqlite); this is ${process.version}.`);
  }
  const db = openDatabase(dataDir, DatabaseSync);

  const sql = {
    userByName: db.prepare("SELECT * FROM users WHERE username = ?"),
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    insertUser: db.prepare("INSERT INTO users (username, password_hash, recovery_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"),
    setPassword: db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?"),
    setRecovery: db.prepare("UPDATE users SET password_hash = ?, recovery_hash = ?, updated_at = ? WHERE id = ?"),
    setSettings: db.prepare("UPDATE users SET settings = ?, revision = revision + 1, updated_at = ? WHERE id = ? RETURNING revision"),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
    session: db.prepare("SELECT users.*, sessions.expires_at AS session_expires FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?"),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    extendSession: db.prepare("UPDATE sessions SET expires_at = ? WHERE token_hash = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    deleteOtherSessions: db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?"),
    deleteAllSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
    deleteExpired: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
  };

  // Compared against when a username does not exist, so a wrong username takes as
  // long to refuse as a wrong password and does not reveal which accounts exist.
  const dummyHash = await hashPassword(randomBytes(16).toString("hex"));

  const limits = {
    loginIp: createLimiter({ limit: 20, windowMs: 10 * 60 * 1000 }),
    loginUser: createLimiter({ limit: 10, windowMs: 10 * 60 * 1000 }),
    signupIp: createLimiter({ limit: 5, windowMs: 60 * 60 * 1000 }),
    recoverIp: createLimiter({ limit: 10, windowMs: 60 * 60 * 1000 }),
    recoverUser: createLimiter({ limit: 5, windowMs: 60 * 60 * 1000 }),
    sync: createLimiter({ limit: 120, windowMs: 60 * 1000 }),
  };

  function limit(limiter, key) {
    const wait = limiter.hit(key);
    if (wait) throw new HttpError(429, "Too many attempts. Try again later.", { retryAfter: wait });
  }

  const publicUser = (user) => ({ username: user.username });

  function startSession(req, res, userId) {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    sql.deleteExpired.run(now);
    sql.insertSession.run(sha256(token), userId, now, now + SESSION_DAYS * DAY);
    setCookie(req, res, token, SESSION_DAYS * DAY);
    return token;
  }

  function setCookie(req, res, token, maxAge) {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: req.secure,
      path: "/",
      maxAge,
    });
  }

  function clearCookie(req, res) {
    res.clearCookie(COOKIE, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" });
  }

  /** The signed-in user for this request, or null. Sets req.sessionHash. */
  function currentUser(req) {
    const token = readCookie(req, COOKIE);
    if (!token) return null;
    req.sessionHash = sha256(token);
    return sql.session.get(req.sessionHash, Date.now()) ?? null;
  }

  function requireUser(req) {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, "You are not signed in.");
    return user;
  }

  function readCredentials(body) {
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    return { username, password };
  }

  function checkNewPassword(password) {
    if (typeof password !== "string" || password.length < PASSWORD_MIN) throw new HttpError(400, `Use a password of at least ${PASSWORD_MIN} characters.`);
    if (password.length > PASSWORD_MAX) throw new HttpError(400, "That password is too long.");
  }

  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });

  // Changes must come from this site's own pages: the cookie is SameSite=Strict and
  // bodies must be JSON, and a cross-site Origin is refused outright.
  router.use((req, _res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const origin = req.get("origin");
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* "null" or garbage */ }
      if (host !== req.get("host")) return next(new HttpError(403, "Cross-site requests are not allowed."));
    }
    if (!req.is("application/json")) return next(new HttpError(415, "Send JSON."));
    next();
  });
  router.use(express.json({ limit: "640kb" }));

  // Async handlers: errors go to the error handler below.
  const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

  router.get("/", handle((req, res) => {
    const user = currentUser(req);
    // Sliding expiry: a session in use is renewed once it is past half its life.
    if (user && user.session_expires - Date.now() < (SESSION_DAYS / 2) * DAY) {
      sql.extendSession.run(Date.now() + SESSION_DAYS * DAY, req.sessionHash);
      setCookie(req, res, readCookie(req, COOKIE), SESSION_DAYS * DAY);
    }
    res.json({ enabled: true, required, signup, invite: Boolean(inviteHash), user: user ? publicUser(user) : null });
  }));

  router.post("/register", handle(async (req, res) => {
    if (!signup) throw new HttpError(403, "New accounts can't be created on this site.");
    const { username, password } = readCredentials(req.body);
    if (!USERNAME.test(username)) throw new HttpError(400, "Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.");
    checkNewPassword(password);
    // Counted before the invite code is checked, so the code can't be guessed quickly.
    limit(limits.signupIp, req.ip);
    if (inviteHash) {
      const given = Buffer.from(sha256(String(req.body?.inviteCode ?? "").trim()));
      if (!timingSafeEqual(given, Buffer.from(inviteHash))) throw new HttpError(403, "That invite code isn't right.");
    }
    if (sql.userByName.get(username)) throw new HttpError(409, "That username is taken.");
    const recoveryCode = newRecoveryCode();
    const now = Date.now();
    let id;
    try {
      ({ lastInsertRowid: id } = sql.insertUser.run(username, await hashPassword(password), sha256(normalizeCode(recoveryCode)), now, now));
    } catch (err) {
      // Lost a race for the same name between the check and the insert.
      if (/UNIQUE/.test(err.message)) throw new HttpError(409, "That username is taken.");
      throw err;
    }
    startSession(req, res, Number(id));
    res.status(201).json({ user: { username }, recoveryCode });
  }));

  router.post("/login", handle(async (req, res) => {
    const { username, password } = readCredentials(req.body);
    if (!username || !password) throw new HttpError(400, "Enter your username and password.");
    limit(limits.loginIp, req.ip);
    limit(limits.loginUser, username.toLowerCase());
    const user = sql.userByName.get(username);
    const ok = await checkPassword(password, user ? user.password_hash : dummyHash);
    if (!user || !ok) throw new HttpError(401, "Wrong username or password.");
    limits.loginUser.reset(username.toLowerCase());
    startSession(req, res, user.id);
    res.json({ user: publicUser(user) });
  }));

  router.post("/logout", handle((req, res) => {
    currentUser(req); // sets req.sessionHash when there is a cookie
    if (req.sessionHash) sql.deleteSession.run(req.sessionHash);
    clearCookie(req, res);
    res.json({ ok: true });
  }));

  // Forgotten password: the recovery code sets a new password, signs out every other
  // browser, and is replaced by a new code (each code works once).
  router.post("/recover", handle(async (req, res) => {
    const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    const code = normalizeCode(req.body?.recoveryCode);
    const password = req.body?.newPassword;
    if (!username || !code) throw new HttpError(400, "Enter your username and recovery code.");
    checkNewPassword(password);
    limit(limits.recoverIp, req.ip);
    limit(limits.recoverUser, username.toLowerCase());
    const user = sql.userByName.get(username);
    const expected = Buffer.from(user ? user.recovery_hash : sha256("no such user"));
    const given = Buffer.from(sha256(code));
    if (!user || !timingSafeEqual(expected, given)) throw new HttpError(401, "That username and recovery code don't match.");
    const recoveryCode = newRecoveryCode();
    sql.setRecovery.run(await hashPassword(password), sha256(normalizeCode(recoveryCode)), Date.now(), user.id);
    sql.deleteAllSessions.run(user.id);
    startSession(req, res, user.id);
    res.json({ user: publicUser(user), recoveryCode });
  }));

  router.post("/password", handle(async (req, res) => {
    const user = requireUser(req);
    limit(limits.loginUser, user.username.toLowerCase());
    if (!(await checkPassword(String(req.body?.currentPassword ?? ""), user.password_hash))) throw new HttpError(401, "Your current password is wrong.");
    checkNewPassword(req.body?.newPassword);
    sql.setPassword.run(await hashPassword(req.body.newPassword), Date.now(), user.id);
    sql.deleteOtherSessions.run(user.id, req.sessionHash);
    res.json({ ok: true });
  }));

  router.post("/delete", handle(async (req, res) => {
    const user = requireUser(req);
    limit(limits.loginUser, user.username.toLowerCase());
    if (!(await checkPassword(String(req.body?.password ?? ""), user.password_hash))) throw new HttpError(401, "Your password is wrong.");
    sql.deleteUser.run(user.id); // sessions go with it (ON DELETE CASCADE)
    clearCookie(req, res);
    res.json({ ok: true });
  }));

  router.get("/settings", handle((req, res) => {
    const user = requireUser(req);
    res.json({ settings: JSON.parse(user.settings), revision: user.revision });
  }));

  router.patch("/settings", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.sync, String(user.id));
    const { json } = mergeSettings(JSON.parse(user.settings), req.body);
    const { revision } = sql.setSettings.get(json, Date.now(), user.id);
    res.json({ revision });
  }));

  router.use((req, res) => res.status(404).json({ error: "Not found." }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.extra.retryAfter) res.set("Retry-After", String(err.extra.retryAfter));
      return res.status(err.status).json({ error: err.message });
    }
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Your settings are too large to save to your account." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "That request isn't valid JSON." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  /** The signed-in user ({ username }) for a request (or WebSocket upgrade), or null. */
  function userFor(req) {
    const user = currentUser(req);
    return user ? publicUser(user) : null;
  }

  return { router, userFor, close: () => db.close() };
}
