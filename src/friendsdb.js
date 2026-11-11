/*
 * Friends: the database side. A friendship is one row in `friendships`:
 *   pending   user_id asked other_id
 *   accepted  user_id and other_id are friends (user_id asked)
 *   blocked   user_id blocked other_id (they can't ask again, and see nothing of each other)
 * Whether someone shows as online, away or invisible is `user_status` (default online).
 */
import { AdminError } from "./accountsdb.js";

export const LIMITS = { friends: 100, outgoing: 30 };
export const MODES = ["online", "away", "invisible"];

export function findUser(db, name) {
  return db.prepare("SELECT id, username, is_admin, avatar_version, banned_at FROM users WHERE username = ?").get(String(name ?? "").trim());
}

const between = (db, a, b) => db.prepare(`SELECT user_id, other_id, status FROM friendships
  WHERE (user_id = ? AND other_id = ?) OR (user_id = ? AND other_id = ?)`).all(a, b, b, a);

/** What stands between two people: { friends, pending: "out" | "in" | null, blockedByMe, blockedByThem }. */
export function relation(db, me, other) {
  const out = { friends: false, pending: null, blockedByMe: false, blockedByThem: false };
  for (const row of between(db, me, other)) {
    if (row.status === "accepted") out.friends = true;
    else if (row.status === "pending") out.pending = row.user_id === me ? "out" : "in";
    else if (row.user_id === me) out.blockedByMe = true;
    else out.blockedByThem = true;
  }
  return out;
}

const count = (db, sql, ...args) => db.prepare(sql).get(...args).n;
const friendCount = (db, id) => count(db, "SELECT COUNT(*) AS n FROM friendships WHERE status = 'accepted' AND (user_id = ? OR other_id = ?)", id, id);

/** Ask someone to be friends. Returns "requested", or "accepted" if they had already asked you. */
export function request(db, me, other) {
  if (me.id === other.id) throw new AdminError(400, "That's you.");
  const rel = relation(db, me.id, other.id);
  if (rel.blockedByMe) throw new AdminError(400, "You blocked this person. Unblock them first.");
  // Not saying that someone blocked you: it would only invite arguments.
  if (rel.blockedByThem || other.banned_at) throw new AdminError(404, "There's no one with that name to ask.");
  if (rel.friends) throw new AdminError(409, "You are already friends.");
  if (rel.pending === "out") throw new AdminError(409, "You already asked this person.");
  if (friendCount(db, me.id) >= LIMITS.friends) throw new AdminError(400, `You can have ${LIMITS.friends} friends.`);
  if (rel.pending === "in") { accept(db, me, other); return "accepted"; }
  if (count(db, "SELECT COUNT(*) AS n FROM friendships WHERE user_id = ? AND status = 'pending'", me.id) >= LIMITS.outgoing) {
    throw new AdminError(400, "You have a lot of requests waiting. Wait for answers first.");
  }
  db.prepare("INSERT INTO friendships (user_id, other_id, status, created_at) VALUES (?, ?, 'pending', ?)").run(me.id, other.id, Date.now());
  return "requested";
}

export function accept(db, me, other) {
  const rel = relation(db, me.id, other.id);
  if (rel.pending !== "in") throw new AdminError(404, "There's no request from that person.");
  if (friendCount(db, me.id) >= LIMITS.friends) throw new AdminError(400, `You can have ${LIMITS.friends} friends.`);
  db.prepare("UPDATE friendships SET status = 'accepted', created_at = ? WHERE user_id = ? AND other_id = ? AND status = 'pending'").run(Date.now(), other.id, me.id);
}

/** Decline a request, cancel your own, or end a friendship: all remove the row, and nobody is told. */
export function drop(db, me, other) {
  db.prepare("DELETE FROM friendships WHERE status <> 'blocked' AND ((user_id = ? AND other_id = ?) OR (user_id = ? AND other_id = ?))").run(me.id, other.id, other.id, me.id);
}

export function block(db, me, other) {
  if (me.id === other.id) throw new AdminError(400, "That's you.");
  drop(db, me, other);
  db.prepare("INSERT OR IGNORE INTO friendships (user_id, other_id, status, created_at) VALUES (?, ?, 'blocked', ?)").run(me.id, other.id, Date.now());
}

export function unblock(db, me, other) {
  db.prepare("DELETE FROM friendships WHERE user_id = ? AND other_id = ? AND status = 'blocked'").run(me.id, other.id);
}

const PERSON = "u.id, u.username, u.is_admin, u.avatar_version";

export function listFriends(db, id) {
  return db.prepare(`SELECT ${PERSON} FROM friendships f JOIN users u ON u.id = CASE WHEN f.user_id = ? THEN f.other_id ELSE f.user_id END
    WHERE f.status = 'accepted' AND (f.user_id = ? OR f.other_id = ?) AND u.banned_at IS NULL ORDER BY u.username COLLATE NOCASE`).all(id, id, id);
}

export function listIncoming(db, id) {
  return db.prepare(`SELECT ${PERSON}, f.created_at AS at FROM friendships f JOIN users u ON u.id = f.user_id
    WHERE f.other_id = ? AND f.status = 'pending' AND u.banned_at IS NULL ORDER BY f.created_at DESC`).all(id);
}

export function listOutgoing(db, id) {
  return db.prepare(`SELECT ${PERSON}, f.created_at AS at FROM friendships f JOIN users u ON u.id = f.other_id
    WHERE f.user_id = ? AND f.status = 'pending' AND u.banned_at IS NULL ORDER BY f.created_at DESC`).all(id);
}

export function listBlocked(db, id) {
  return db.prepare(`SELECT ${PERSON} FROM friendships f JOIN users u ON u.id = f.other_id
    WHERE f.user_id = ? AND f.status = 'blocked' ORDER BY u.username COLLATE NOCASE`).all(id);
}

export function incomingCount(db, id) {
  return count(db, `SELECT COUNT(*) AS n FROM friendships f JOIN users u ON u.id = f.user_id
    WHERE f.other_id = ? AND f.status = 'pending' AND u.banned_at IS NULL`, id);
}

export function getMode(db, id) {
  return db.prepare("SELECT mode FROM user_status WHERE user_id = ?").get(id)?.mode ?? "online";
}

export function setMode(db, id, mode) {
  if (!MODES.includes(mode)) throw new AdminError(400, "Pick online, away or invisible.");
  db.prepare("INSERT INTO user_status (user_id, mode) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode").run(id, mode);
}

/** The status modes of several people: Map of id to mode (missing means online). */
export function modes(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  for (const row of db.prepare(`SELECT user_id, mode FROM user_status WHERE user_id IN (${ids.map(() => "?").join(",")})`).all(...ids)) out.set(row.user_id, row.mode);
  return out;
}
