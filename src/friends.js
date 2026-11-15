/*
 * Friends and online status (/api/friends).
 *
 * Every desktop that is open and signed in sends a small "ping" about once a minute. Someone counts
 * as online for a couple of minutes after their last ping, so presence needs no connection kept open
 * and nothing is stored: it is a map in memory that starts empty when the server does.
 *
 * Only accepted friends see each other's status, and "invisible" shows as offline. Blocking removes any
 * friendship and request between two people and stops either asking the other; the blocked person is
 * never told (a request to someone who blocked you just says there's no one by that name to ask).
 */
import express from "express";
import { AdminError } from "./accountsdb.js";
import { HttpError, guardWrites } from "./http.js";
import { createLimiter } from "./ratelimit.js";
import * as db_ from "./friendsdb.js";
import * as roles from "./roles.js";
import * as reportsdb from "./reportsdb.js";

const ONLINE_MS = 150_000;

/** options: db, site(), userFor, isAdmin(row) */
export function createFriends({ db, site, userFor, isAdmin, achieve = () => {} }) {
  const seen = new Map(); // user id -> time of the last ping
  const sweep = setInterval(() => { const cutoff = Date.now() - ONLINE_MS * 4; for (const [id, at] of seen) if (at < cutoff) seen.delete(id); }, 5 * 60_000);
  sweep.unref();

  const limits = {
    ask: createLimiter({ limit: 20, windowMs: 60 * 60_000 }),
    change: createLimiter({ limit: 120, windowMs: 60_000 }),
    ping: createLimiter({ limit: 20, windowMs: 60_000 }),
    read: createLimiter({ limit: 240, windowMs: 60_000 }),
    report: createLimiter({ limit: 20, windowMs: 60 * 60_000 }),
  };
  const limit = (limiter, key) => {
    const wait = limiter.hit(key);
    if (wait) throw new HttpError(429, "Slow down a little.", { retryAfter: wait });
  };

  function requireUser(req) {
    const user = userFor(req);
    if (!user) throw new HttpError(401, "Sign in to use friends.");
    if (site().mode === "off") throw new HttpError(403, "Friends need accounts, which are turned off on this site.");
    return user;
  }

  const state = (id, mode) => (mode === "invisible" || Date.now() - (seen.get(id) ?? 0) > ONLINE_MS ? "offline" : mode);
  const person = (row, extra = {}) => ({ username: row.username, avatar: row.avatar_version, ...(isAdmin(row) ? { admin: true } : {}), ...extra });

  const target = (req) => {
    const row = db_.findUser(db, req.body?.username);
    if (!row) throw new HttpError(404, "There's no one with that name.");
    return row;
  };

  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(guardWrites());
  router.use(express.json({ limit: "4kb" }));
  const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

  router.get("/", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.read, `u${user.id}`);
    seen.set(user.id, Date.now());
    const friends = db_.listFriends(db, user.id);
    const modes = db_.modes(db, friends.map((f) => f.id));
    res.json({
      me: { mode: db_.getMode(db, user.id) },
      limits: db_.LIMITS,
      friends: friends.map((f) => person(f, { status: state(f.id, modes.get(f.id) ?? "online") }))
        .sort((a, b) => Number(b.status !== "offline") - Number(a.status !== "offline") || a.username.localeCompare(b.username)),
      incoming: db_.listIncoming(db, user.id).map((f) => person(f, { at: f.at })),
      outgoing: db_.listOutgoing(db, user.id).map((f) => person(f, { at: f.at })),
      blocked: db_.listBlocked(db, user.id).map((f) => person(f)),
    });
  }));

  // A profile card: who someone is, to anyone signed in. Their status shows only to their friends, and someone who
  // blocked you is not there at all.
  router.get("/profile/:username", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.read, `u${user.id}`);
    const row = db.prepare("SELECT id, username, is_admin, is_owner, avatar_version, banned_at, created_at, bio FROM users WHERE username = ?").get(String(req.params.username ?? "").trim());
    if (!row || row.banned_at) throw new HttpError(404, "There's no one with that name.");
    const self = row.id === user.id;
    const rel = self ? { friends: false, pending: null, blockedByMe: false, blockedByThem: false } : db_.relation(db, user.id, row.id);
    if (rel.blockedByThem) throw new HttpError(404, "There's no one with that name.");
    let mutual = [];
    if (!self) {
      const theirs = new Set(db_.listFriends(db, row.id).map((f) => f.id));
      mutual = db_.listFriends(db, user.id).filter((f) => theirs.has(f.id));
    }
    res.json({
      username: row.username,
      avatar: row.avatar_version ?? 0,
      ...(isAdmin(row) ? { admin: true } : {}),
      ...(row.is_owner ? { owner: true } : {}),
      roles: roles.rolesOf(db, row.id).slice(0, 8).map(({ name, color, slug }) => ({ name, color, slug })),
      joinedAt: row.created_at,
      bio: row.bio || "",
      self,
      relation: { friends: rel.friends, pending: rel.pending, blockedByMe: rel.blockedByMe },
      ...(rel.friends ? { status: state(row.id, db_.getMode(db, row.id)) } : {}),
      mutual: { count: mutual.length, people: mutual.slice(0, 8).map((f) => person(f)) },
    });
  }));

  // Tell the admins about someone's profile (their picture, name or bio): { reason, note? }.
  router.post("/profile/:username/report", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.report, `u${user.id}`);
    const row = db.prepare("SELECT id, banned_at FROM users WHERE username = ?").get(String(req.params.username ?? "").trim());
    if (!row || row.banned_at) throw new HttpError(404, "There's no one with that name.");
    if (row.id === user.id) throw new HttpError(400, "That's you.");
    if (db_.relation(db, user.id, row.id).blockedByThem) throw new HttpError(404, "There's no one with that name.");
    reportsdb.addReport(db, { kind: "profile", reporterId: user.id, targetUserId: row.id, reason: req.body?.reason, note: req.body?.note });
    res.status(201).json({ ok: true });
  }));

  // The heartbeat: "I'm here". The answer is what the desktop needs to know without opening the app.
  router.post("/ping", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.ping, `u${user.id}`);
    seen.set(user.id, Date.now());
    const friends = db_.listFriends(db, user.id);
    const modes = db_.modes(db, friends.map((f) => f.id));
    res.json({ requests: db_.incomingCount(db, user.id), online: friends.filter((f) => state(f.id, modes.get(f.id) ?? "online") !== "offline").length });
  }));

  router.post("/status", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.change, `u${user.id}`);
    db_.setMode(db, user.id, req.body?.mode);
    res.json({ mode: db_.getMode(db, user.id) });
  }));

  router.post("/request", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.ask, `u${user.id}`);
    const other = target(req);
    const result = db_.request(db, user, other);
    if (result === "accepted") { achieve(user.id); achieve(other.id); }
    res.status(201).json({ result });
  }));

  const action = (name, fn) => router.post(`/${name}`, handle((req, res) => {
    const user = requireUser(req);
    limit(limits.change, `u${user.id}`);
    fn(user, target(req));
    res.json({ ok: true });
  }));
  action("accept", (user, other) => { db_.accept(db, user, other); achieve(user.id); achieve(other.id); });
  action("decline", (user, other) => db_.drop(db, user, other));
  action("cancel", (user, other) => db_.drop(db, user, other));
  action("remove", (user, other) => db_.drop(db, user, other));
  action("block", (user, other) => db_.block(db, user, other));
  action("unblock", (user, other) => db_.unblock(db, user, other));

  router.use((_req, res) => res.status(404).json({ error: "Not found." }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.extra.retryAfter) res.set("Retry-After", String(err.extra.retryAfter));
      return res.status(err.status).json({ error: err.message });
    }
    if (err instanceof AdminError) return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "That request is too big." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "That request isn't valid JSON." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return { router, close() { clearInterval(sweep); } };
}

/** The router for /api/friends when accounts are unavailable. */
export function disabledFriends() {
  const router = express.Router();
  router.use((_req, res) => res.status(404).json({ error: "Friends need accounts, which aren't available on this site." }));
  return { router, close() {} };
}
