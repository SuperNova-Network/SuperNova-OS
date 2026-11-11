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
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createLimiter } from "./ratelimit.js";
import {
  AdminError, adminCount, createInvite, getSiteSettings, listInvites, listUsers, newInviteCode, newRecoveryCode,
  getAvatar, normalizeCode, openDatabase, redeemInvite, revokeInvite, setAdmin, setAvatar, setBanned, setSiteSetting, sha256, transaction,
} from "./accountsdb.js";
import { imageInfo } from "./imageinfo.js";

const scrypt = promisify(scryptCb);

export const COOKIE = "sn_session";
const SESSION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const USERNAME = /^[A-Za-z0-9_.-]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;

// Profile pictures: the page shrinks them to 256 px, so these limits are generous.
// Only raster formats that can't carry script are accepted (see imageinfo.js).
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AVATAR_MAX_BYTES = 120 * 1024;
const AVATAR_MAX_PIXELS = 1024;

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

/** The router for /api/account when accounts are off: it only says so. */
function disabledRouter() {
  const router = express.Router();
  router.get("/", (_req, res) => res.set("Cache-Control", "no-store").json({ enabled: false }));
  router.use((_req, res) => res.status(404).json({ error: "Accounts are not enabled on this site." }));
  return router;
}

/** Without a database (no node:sqlite, or DATA_DIR not writable): no accounts, no admin panel. */
function unavailable() {
  return {
    router: disabledRouter(),
    userFor: () => null,
    sessionActive: () => false,
    database: null,
    isAdmin: () => false,
    site: () => ({ mode: "off", signup: "closed", locked: { mode: true, signup: true } }),
    setupCode: null,
    onBan() {},
    onSiteChange() {},
    close() {},
  };
}

/**
 * Build the /api/account router. Resolves to { router, userFor(req), sessionActive(hash),
 * site(), setupCode, onBan(fn), onSiteChange(fn), close() }.
 * options (from config.accounts; see config.js):
 *   mode, signup  fixed by the server when set; otherwise chosen in Settings > Admin
 *   inviteCode    a fixed code accepted besides the generated ones (INVITE_CODE)
 *   admins        usernames that are always admins (ADMINS)
 *   authPass      the old site password (AUTH_PASS), accepted as an invite code when
 *                 accounts are required and there is no INVITE_CODE
 *   dataDir       where accounts.db lives
 */
export async function createAccounts({ mode: serverMode = null, signup: serverSignup = null, inviteCode = "", admins = [], authPass = "", dataDir = "data" } = {}) {
  let db;
  try {
    db = await openDatabase(dataDir);
  } catch (err) {
    // Only fatal when the server's configuration asks for accounts.
    if (serverMode && serverMode !== "off") throw err;
    console.warn(`Accounts and the admin panel are unavailable: ${err.message}`);
    return unavailable();
  }

  const serverAdmins = new Set(admins.map((name) => name.toLowerCase()));
  const isAdmin = (user) => Boolean(user.is_admin) || serverAdmins.has(user.username.toLowerCase());
  const banListeners = [];
  const siteListeners = [];

  // Site settings: the server's configuration wins, then the admin panel's choice.
  // Read from the database at most every few seconds, so a change made with the
  // command line reaches a running server too.
  let siteCache = null;
  function site() {
    if (siteCache && Date.now() - siteCache.at < 5000) return siteCache.value;
    const stored = getSiteSettings(db);
    const mode = serverMode ?? stored.mode ?? "off";
    // Before the admin panel, ACCOUNTS without ACCOUNTS_SIGNUP meant open sign-up
    // unless sign-in was required or there was an invite code; keep that.
    const fallback = serverMode ? (serverMode === "required" || inviteCode ? "invite" : "open") : "invite";
    const signup = serverSignup ?? stored.signup ?? fallback;
    const value = { mode, signup, locked: { mode: serverMode !== null, signup: serverSignup !== null } };
    siteCache = { at: Date.now(), value };
    return value;
  }

  function fixedInviteHash() {
    const code = inviteCode || (site().mode === "required" ? authPass : "");
    return code ? sha256(code) : null;
  }

  // First run: nobody can manage the site yet. A one-time code, printed in the
  // server's log, lets whoever runs the server create the first admin at /setup.
  function needsSetup() {
    if (adminCount(db) > 0) return false;
    if (!serverAdmins.size) return true;
    const names = [...serverAdmins];
    return !db.prepare(`SELECT 1 FROM users WHERE lower(username) IN (${names.map(() => "?").join(",")}) LIMIT 1`).get(...names);
  }
  let setupCode = needsSetup() ? newInviteCode() : null;

  const sql = {
    userByName: db.prepare("SELECT * FROM users WHERE username = ?"),
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    insertUser: db.prepare("INSERT INTO users (username, password_hash, recovery_hash, created_at, updated_at, last_seen_at, invite_id) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    touch: db.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?"),
    setPassword: db.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?"),
    setRecovery: db.prepare("UPDATE users SET password_hash = ?, recovery_hash = ?, updated_at = ? WHERE id = ?"),
    setSettings: db.prepare("UPDATE users SET settings = ?, revision = revision + 1, updated_at = ? WHERE id = ? RETURNING revision"),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
    // A banned account has no sessions, and gets none: checked here as well, so a ban
    // made from the command line takes effect even for a session created meanwhile.
    session: db.prepare("SELECT users.*, sessions.expires_at AS session_expires FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.banned_at IS NULL"),
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
    avatar: createLimiter({ limit: 10, windowMs: 60 * 60 * 1000 }),
  };

  function limit(limiter, key) {
    const wait = limiter.hit(key);
    if (wait) throw new HttpError(429, "Too many attempts. Try again later.", { retryAfter: wait });
  }

  // `avatar` is the picture's version (0 = none): the page asks for the image only when
  // there is one, and the version in the address makes each new picture a new URL.
  const publicUser = (user) => ({ username: user.username, ...(isAdmin(user) ? { admin: true } : {}), avatar: user.avatar_version ?? 0 });

  function bannedError(user) {
    return new HttpError(403, `This account has been suspended.${user.ban_reason ? ` Reason: ${user.ban_reason}` : ""}`);
  }

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
    const user = sql.session.get(req.sessionHash, Date.now()) ?? null;
    // With accounts off only admins are signed in (to reach the admin panel); other
    // sessions simply wait until accounts are turned on again.
    if (user && site().mode === "off" && !isAdmin(user)) return null;
    return user;
  }

  const offError = () => new HttpError(403, "Accounts are turned off on this site.");

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
    // "Last seen" for the admin list, written at most once an hour.
    if (user && Date.now() - (user.last_seen_at ?? 0) > 60 * 60 * 1000) sql.touch.run(Date.now(), user.id);
    const { mode, signup } = site();
    res.json({
      mode,
      enabled: mode !== "off",
      required: mode === "required",
      signup: mode !== "off" && signup !== "closed",
      invite: signup === "invite",
      setup: Boolean(setupCode) && needsSetup(),
      user: user ? publicUser(user) : null,
    });
  }));

  // First run: create the first admin with the code from the server's log.
  router.post("/setup", handle(async (req, res) => {
    if (!setupCode || !needsSetup()) throw new HttpError(409, "This site is already set up. Sign in instead.");
    limit(limits.recoverIp, req.ip);
    const { username, password } = readCredentials(req.body);
    const given = Buffer.from(sha256(normalizeCode(req.body?.code)));
    if (!timingSafeEqual(given, Buffer.from(sha256(normalizeCode(setupCode))))) throw new HttpError(403, "That setup code isn't right. It's in the server's log.");
    if (!USERNAME.test(username)) throw new HttpError(400, "Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.");
    checkNewPassword(password);
    if (sql.userByName.get(username)) throw new HttpError(409, "That username is taken. To make an existing account an admin, use `npm run admin -- make-admin <name>`.");
    const passwordHash = await hashPassword(password);
    if (!setupCode || !needsSetup()) throw new HttpError(409, "This site is already set up. Sign in instead.");
    const recoveryCode = newRecoveryCode();
    const now = Date.now();
    const id = transaction(db, () => {
      const newId = Number(sql.insertUser.run(username, passwordHash, sha256(normalizeCode(recoveryCode)), now, now, now, null).lastInsertRowid);
      db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?").run(newId);
      return newId;
    });
    setupCode = null;
    startSession(req, res, id);
    res.status(201).json({ user: { username, admin: true }, recoveryCode });
  }));

  router.post("/register", handle(async (req, res) => {
    const { mode, signup } = site();
    if (mode === "off") throw offError();
    if (signup === "closed") throw new HttpError(403, "New accounts can't be created on this site.");
    const { username, password } = readCredentials(req.body);
    if (!USERNAME.test(username)) throw new HttpError(400, "Usernames are 3 to 32 letters, numbers, dots, dashes or underscores.");
    checkNewPassword(password);
    // Counted before the invite code is checked, so codes can't be guessed quickly.
    limit(limits.signupIp, req.ip);
    const given = String(req.body?.inviteCode ?? "").trim();
    const fixedHash = fixedInviteHash();
    const fixedCode = Boolean(fixedHash && given) && timingSafeEqual(Buffer.from(sha256(given)), Buffer.from(fixedHash));
    if (signup === "invite" && !given) throw new HttpError(403, "Enter an invite code.");
    if (sql.userByName.get(username)) throw new HttpError(409, "That username is taken.");
    const passwordHash = await hashPassword(password); // before the transaction: it awaits
    const recoveryCode = newRecoveryCode();
    const now = Date.now();
    // One transaction, so a failed sign-up gives the invite code's use back.
    const id = transaction(db, () => {
      let inviteId = null;
      if (signup === "invite" && !fixedCode) {
        inviteId = redeemInvite(db, given);
        if (inviteId === null) throw new HttpError(403, "That invite code isn't right, or it has expired or been used up.");
      }
      try {
        return Number(sql.insertUser.run(username, passwordHash, sha256(normalizeCode(recoveryCode)), now, now, now, inviteId).lastInsertRowid);
      } catch (err) {
        // Lost a race for the same name between the check and the insert.
        if (/UNIQUE/.test(err.message)) throw new HttpError(409, "That username is taken.");
        throw err;
      }
    });
    startSession(req, res, id);
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
    // Only after the password: whether an account is banned isn't anyone else's business.
    if (user.banned_at) throw bannedError(user);
    if (site().mode === "off" && !isAdmin(user)) throw offError();
    limits.loginUser.reset(username.toLowerCase());
    sql.touch.run(Date.now(), user.id);
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
    if (user.banned_at) throw bannedError(user);
    if (site().mode === "off" && !isAdmin(user)) throw offError();
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

  // --- profile pictures ----------------------------------------------------------------

  // Anyone signed in may see anyone's picture (it is shown in chat). The address carries
  // the picture's version (?v=), so a cached copy is never stale and can be kept forever.
  router.get("/avatar/:username", handle((req, res) => {
    requireUser(req);
    const avatar = getAvatar(db, req.params.username);
    if (!avatar) throw new HttpError(404, "No profile picture.");
    res.set({
      "Content-Type": avatar.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    }).send(avatar.data);
  }));

  // { mime, data } with data in base64. The type and size are read from the bytes, not trusted.
  router.post("/avatar", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.avatar, String(user.id));
    const { mime, data } = req.body ?? {};
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, "Send the picture as base64.");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > AVATAR_MAX_BYTES) throw new HttpError(413, `Profile pictures can be up to ${AVATAR_MAX_BYTES / 1024} KB.`);
    const info = imageInfo(bytes);
    if (!info || !AVATAR_TYPES.has(info.mime) || (mime && mime !== info.mime)) throw new HttpError(400, "Use a PNG, JPEG or WebP picture.");
    if (info.width > AVATAR_MAX_PIXELS || info.height > AVATAR_MAX_PIXELS) throw new HttpError(400, `Profile pictures can be up to ${AVATAR_MAX_PIXELS} by ${AVATAR_MAX_PIXELS} pixels.`);
    res.json({ avatar: setAvatar(db, user.id, { mime: info.mime, data: bytes }) });
  }));

  router.post("/avatar/remove", handle((req, res) => {
    const user = requireUser(req);
    res.json({ avatar: setAvatar(db, user.id, null) });
  }));

  // --- admin: invite codes and bans (usernames in ADMINS) ----------------------------

  function requireAdmin(req) {
    const user = requireUser(req);
    if (!isAdmin(user)) throw new HttpError(403, "Only admins can do that.");
    return user;
  }

  // Site settings: accounts off / optional / required, and who can sign up.
  router.get("/admin/site", handle((req, res) => {
    requireAdmin(req);
    res.json(site());
  }));

  router.post("/admin/site", handle((req, res) => {
    const admin = requireAdmin(req);
    const current = site();
    for (const [key, variable] of [["mode", "ACCOUNTS"], ["signup", "ACCOUNTS_SIGNUP"]]) {
      if (req.body?.[key] === undefined || req.body[key] === current[key]) continue;
      if (current.locked[key]) throw new HttpError(409, `${variable} is set on the server, so this is fixed there.`);
      setSiteSetting(db, key, req.body[key], admin.username);
    }
    siteCache = null;
    const next = site();
    for (const listener of siteListeners) listener(next);
    res.json(next);
  }));

  router.post("/admin/users/:username/admin", handle((req, res) => {
    requireAdmin(req);
    setAdmin(db, req.params.username, true, { serverAdmins });
    res.json({ ok: true });
  }));

  router.post("/admin/users/:username/unadmin", handle((req, res) => {
    requireAdmin(req);
    setAdmin(db, req.params.username, false, { serverAdmins });
    res.json({ ok: true });
  }));

  router.get("/admin/users", handle((req, res) => {
    requireAdmin(req);
    res.json({ users: listUsers(db, { search: String(req.query.q ?? "").slice(0, 32), admins: serverAdmins }) });
  }));

  router.post("/admin/users/:username/ban", handle((req, res) => {
    const admin = requireAdmin(req);
    if (req.params.username.toLowerCase() === admin.username.toLowerCase()) throw new HttpError(400, "You can't ban yourself.");
    const id = setBanned(db, req.params.username, true, { reason: req.body?.reason, admins: serverAdmins });
    for (const listener of banListeners) listener(id);
    res.json({ ok: true });
  }));

  router.post("/admin/users/:username/unban", handle((req, res) => {
    requireAdmin(req);
    setBanned(db, req.params.username, false);
    res.json({ ok: true });
  }));

  router.get("/admin/invites", handle((req, res) => {
    requireAdmin(req);
    res.json({ invites: listInvites(db) });
  }));

  router.post("/admin/invites", handle((req, res) => {
    const admin = requireAdmin(req);
    const { label, maxUses, expiresInDays } = req.body ?? {};
    res.status(201).json(createInvite(db, { label, maxUses, expiresInDays, createdBy: admin.username }));
  }));

  router.post("/admin/invites/:id/revoke", handle((req, res) => {
    requireAdmin(req);
    revokeInvite(db, req.params.id);
    res.json({ ok: true });
  }));

  router.use((req, res) => res.status(404).json({ error: "Not found." }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.extra.retryAfter) res.set("Retry-After", String(err.extra.retryAfter));
      return res.status(err.status).json({ error: err.message });
    }
    if (err instanceof AdminError) return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Your settings are too large to save to your account." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "That request isn't valid JSON." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  /** The signed-in user ({ id, username, admin }) for a request or WebSocket upgrade, or null. Sets req.sessionHash. */
  function userFor(req) {
    const user = currentUser(req);
    return user ? { id: user.id, ...publicUser(user) } : null;
  }

  /** Whether a session (by hash) is still valid: not signed out, expired or banned. */
  function sessionActive(hash) {
    return Boolean(hash && sql.session.get(hash, Date.now()));
  }

  return {
    router,
    userFor,
    sessionActive,
    /** The open database, for the chat (src/chat.js), which keeps its tables in the same file. */
    database: db,
    /** Whether a users row ({ username, is_admin }) is an admin, ADMINS included. */
    isAdmin,
    /** { mode, signup, locked }: the current site settings. */
    site,
    /** The first-run code for /setup, while nobody can manage the site yet. */
    get setupCode() { return setupCode && needsSetup() ? setupCode : null; },
    /** fn(userId) is called right after someone is banned from the web admin page. */
    onBan: (fn) => banListeners.push(fn),
    /** fn(site) is called after the site settings change in the admin panel. */
    onSiteChange: (fn) => siteListeners.push(fn),
    close: () => db.close(),
  };
}
