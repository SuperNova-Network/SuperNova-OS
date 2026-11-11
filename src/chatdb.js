/*
 * The chat's database operations (the tables are created by migration 5 in
 * accountsdb.js, in the same file as the accounts). Everything is synchronous, like
 * accountsdb.js, so a sequence of statements is never interleaved with another request's.
 */
import { randomBytes } from "node:crypto";
import { AdminError, transaction } from "./accountsdb.js";
import { cleanWordList, normalizeText } from "./chatfilter.js";

export const HISTORY_LIMIT = 2000;          // messages kept; older ones are pruned
export const MAX_TIMEOUT_MINUTES = 30 * 24 * 60;
const MINUTE = 60_000;
// Uploaded GIFs that no visible message uses any more.
const ORPHANED_MEDIA = "DELETE FROM chat_media WHERE id NOT IN (SELECT media_ref FROM chat_messages WHERE media_kind = 'upload' AND deleted_at IS NULL)";

// --- settings ----------------------------------------------------------------------

// How admins look in the chat: the tag beside their name. Set by admins in the Chat's
// moderation panel and the same for every admin. Everything is a short fixed choice or a #rrggbb colour,
// so nothing a page puts on screen from it can be script or markup.
export const ADMIN_LOOK_DEFAULTS = {
  tag: "ADMIN",             // the text beside the name (1 to 12 characters)
  style: "outline",         // "outline" (a box), "brackets" ([Tag]) or "plain"
  color: "#ff6b78",         // the tag's colour
  nameColor: "white",       // "white", "tag" (the same colour as the tag) or a #rrggbb colour
  shield: true,             // the little shield in the tag
};
const HEX = /^#[0-9a-fA-F]{6}$/;
const LOOK_CHECKS = {
  style: (v) => v === "outline" || v === "brackets" || v === "plain",
  color: (v) => typeof v === "string" && HEX.test(v),
  nameColor: (v) => v === "white" || v === "tag" || (typeof v === "string" && HEX.test(v)),
  shield: (v) => typeof v === "boolean",
};

/**
 * A complete admin look from what was sent (or saved): the defaults, changed by every valid field.
 * With `strict`, a field that isn't valid is an error instead of being ignored.
 */
export function cleanAdminLook(input, { strict = false } = {}) {
  const out = { ...ADMIN_LOOK_DEFAULTS };
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    if (strict) throw new AdminError(400, "Send the admin look as an object.");
    return out;
  }
  for (const [key, value] of Object.entries(input)) {
    if (key === "tag") {
      const text = Array.from(normalizeText(value).replace(/\s+/g, " ")).slice(0, 12).join("").trim();
      if (typeof value === "string" && text) out.tag = text;
      else if (strict) throw new AdminError(400, "The tag needs 1 to 12 characters.");
    } else if (LOOK_CHECKS[key]) {
      if (LOOK_CHECKS[key](value)) out[key] = key === "color" || (key === "nameColor" && value.startsWith("#")) ? value.toLowerCase() : value;
      else if (strict) throw new AdminError(400, `That isn't a valid value for ${key}.`);
    } else if (strict) {
      throw new AdminError(400, `Unknown admin look setting "${key}".`);
    }
  }
  return out;
}

export const CHAT_DEFAULTS = {
  enabled: true,            // the whole chat can be switched off
  locked: false,            // only admins can post
  slowSeconds: 3,           // least time between one person's messages
  links: "blocked",         // "blocked" or "allowed"
  gifs: true,               // GIFs (uploaded or searched) can be sent
  minAccountMinutes: 0,     // new accounts must wait this long before they can post
  words: [],                // blocked words (see chatfilter.js)
  adminLook: ADMIN_LOOK_DEFAULTS, // how admins' names and tags look (see above)
};

const SETTING_CHECKS = {
  enabled: (v) => typeof v === "boolean",
  locked: (v) => typeof v === "boolean",
  gifs: (v) => typeof v === "boolean",
  slowSeconds: (v) => Number.isInteger(v) && v >= 0 && v <= 300,
  minAccountMinutes: (v) => Number.isInteger(v) && v >= 0 && v <= 1440,
  links: (v) => v === "blocked" || v === "allowed",
};

export function getChatSettings(db) {
  const out = { ...CHAT_DEFAULTS, words: [] };
  for (const { key, value } of db.prepare("SELECT key, value FROM chat_settings").all()) {
    let parsed;
    try { parsed = JSON.parse(value); } catch { continue; }
    if (key === "words") out.words = cleanWordList(parsed);
    else if (key === "adminLook") out.adminLook = cleanAdminLook(parsed);
    else if (SETTING_CHECKS[key]?.(parsed)) out[key] = parsed;
  }
  return out;
}

/** Change some settings ({ key: value, ... }); returns the new settings. */
export function setChatSettings(db, patch, by = null) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new AdminError(400, "Send the settings to change.");
  const next = {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === "words") {
      if (!Array.isArray(value)) throw new AdminError(400, "The blocked words must be a list.");
      next.words = cleanWordList(value);
    } else if (key === "adminLook") {
      next.adminLook = cleanAdminLook(value, { strict: true });
    } else if (SETTING_CHECKS[key]) {
      if (!SETTING_CHECKS[key](value)) throw new AdminError(400, `That isn't a valid value for ${key}.`);
      next[key] = value;
    } else {
      throw new AdminError(400, `Unknown chat setting "${key}".`);
    }
  }
  const upsert = db.prepare("INSERT INTO chat_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by");
  transaction(db, () => { for (const [key, value] of Object.entries(next)) upsert.run(key, JSON.stringify(value), Date.now(), by); });
  return getChatSettings(db);
}

// --- messages ----------------------------------------------------------------------

const MESSAGE_SELECT = `
  SELECT chat_messages.id, chat_messages.user_id, chat_messages.body, chat_messages.media_kind, chat_messages.media_ref,
         chat_messages.created_at, users.username, users.is_admin, users.avatar_version
  FROM chat_messages JOIN users ON users.id = chat_messages.user_id`;

/**
 * A message as the page gets it. `isAdmin(row)` decides the admin badge from the
 * account as it is now, so removing someone's admin role removes it from their old messages too.
 */
export function publicMessage(row, isAdmin) {
  return {
    id: row.id,
    at: row.created_at,
    user: { username: row.username, ...(isAdmin(row) ? { admin: true } : {}), avatar: row.avatar_version ?? 0 },
    text: row.body,
    media: row.media_kind ? { kind: row.media_kind, id: row.media_ref } : null,
  };
}

/** Add a message, keep the history to HISTORY_LIMIT, and return its row. */
export function insertMessage(db, { userId, text = "", media = null }) {
  return transaction(db, () => {
    const now = Date.now();
    let mediaRef = media?.ref ?? null;
    if (media?.upload) {
      mediaRef = randomBytes(12).toString("hex");
      db.prepare("INSERT INTO chat_media (id, user_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)").run(mediaRef, userId, media.upload.mime, media.upload.data, now);
    }
    const { lastInsertRowid } = db.prepare("INSERT INTO chat_messages (user_id, body, media_kind, media_ref, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(userId, text, media ? (media.upload ? "upload" : media.kind) : null, mediaRef, now);
    const id = Number(lastInsertRowid);
    db.prepare("DELETE FROM chat_messages WHERE id <= ?").run(id - HISTORY_LIMIT);
    db.prepare(ORPHANED_MEDIA).run();
    return db.prepare(`${MESSAGE_SELECT} WHERE chat_messages.id = ?`).get(id);
  });
}

/** The newest `limit` messages (older than `before`, if given), oldest first. */
export function listMessages(db, { before = null, limit = 60 } = {}) {
  limit = Math.min(Math.max(Number(limit) || 60, 1), 200);
  const rows = before
    ? db.prepare(`${MESSAGE_SELECT} WHERE chat_messages.deleted_at IS NULL AND chat_messages.id < ? ORDER BY chat_messages.id DESC LIMIT ?`).all(Number(before), limit)
    : db.prepare(`${MESSAGE_SELECT} WHERE chat_messages.deleted_at IS NULL ORDER BY chat_messages.id DESC LIMIT ?`).all(limit);
  return rows.reverse();
}

export function getMessage(db, id) {
  return db.prepare(`${MESSAGE_SELECT} WHERE chat_messages.id = ? AND chat_messages.deleted_at IS NULL`).get(Number(id)) ?? null;
}

// Not in a transaction of its own: callers that remove several messages wrap them in one.
function markDeleted(db, id, by) {
  const { changes } = db.prepare("UPDATE chat_messages SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at IS NULL").run(Date.now(), by, Number(id));
  if (changes) db.prepare(ORPHANED_MEDIA).run();
  return changes > 0;
}

/** Remove a message from the chat (its uploaded GIF is deleted too). Returns whether it existed. */
export function deleteMessage(db, id, by) {
  return transaction(db, () => markDeleted(db, id, by));
}

/** Remove everything a person said in the last `minutes` minutes. Returns the ids removed. */
export function deleteRecentMessages(db, userId, minutes, by) {
  return transaction(db, () => {
    const ids = db.prepare("SELECT id FROM chat_messages WHERE user_id = ? AND deleted_at IS NULL AND created_at > ?").all(userId, Date.now() - minutes * MINUTE).map((row) => row.id);
    for (const id of ids) markDeleted(db, id, by);
    return ids;
  });
}

export function clearMessages(db, by) {
  return transaction(db, () => {
    const { changes } = db.prepare("UPDATE chat_messages SET deleted_at = ?, deleted_by = ? WHERE deleted_at IS NULL").run(Date.now(), by);
    db.prepare("DELETE FROM chat_media").run();
    return changes;
  });
}

export function getMedia(db, id) {
  return db.prepare("SELECT mime, data FROM chat_media WHERE id = ?").get(String(id)) ?? null;
}

// --- sanctions (timeouts and chat bans) ---------------------------------------------

/** The sanction that stops this person posting right now, or null. A ban beats a timeout. */
export function activeSanction(db, userId, now = Date.now()) {
  const row = db.prepare("SELECT * FROM chat_sanctions WHERE user_id = ? AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY (kind = 'ban') DESC, created_at DESC LIMIT 1").get(userId, now);
  return row ? publicSanction(row) : null;
}

function publicSanction(row) {
  return { id: row.id, kind: row.kind, reason: row.reason || "", by: row.created_by, at: row.created_at, until: row.expires_at, ...(row.username ? { username: row.username } : {}) };
}

/** Timeout (minutes > 0) or ban (minutes null). A new sanction replaces the person's current one. */
export function addSanction(db, { userId, kind, minutes = null, reason = "", by }) {
  if (kind === "timeout") {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_TIMEOUT_MINUTES) throw new AdminError(400, `A timeout is 1 minute to ${MAX_TIMEOUT_MINUTES / 1440} days.`);
  } else if (kind !== "ban") {
    throw new AdminError(400, "A sanction is a timeout or a ban.");
  }
  reason = String(reason ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  return transaction(db, () => {
    const now = Date.now();
    db.prepare("UPDATE chat_sanctions SET lifted_at = ?, lifted_by = ? WHERE user_id = ? AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)").run(now, by, userId, now);
    const { lastInsertRowid } = db.prepare("INSERT INTO chat_sanctions (user_id, kind, reason, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, kind, reason, by, now, kind === "timeout" ? now + minutes * MINUTE : null);
    return publicSanction(db.prepare("SELECT * FROM chat_sanctions WHERE id = ?").get(Number(lastInsertRowid)));
  });
}

/** End whatever is stopping this person from posting. Returns whether there was anything. */
export function liftSanctions(db, userId, by) {
  const now = Date.now();
  return db.prepare("UPDATE chat_sanctions SET lifted_at = ?, lifted_by = ? WHERE user_id = ? AND lifted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)").run(now, by, userId, now).changes > 0;
}

export function listActiveSanctions(db, now = Date.now()) {
  return db.prepare(`
    SELECT chat_sanctions.*, users.username FROM chat_sanctions JOIN users ON users.id = chat_sanctions.user_id
    WHERE chat_sanctions.lifted_at IS NULL AND (chat_sanctions.expires_at IS NULL OR chat_sanctions.expires_at > ?)
    ORDER BY chat_sanctions.created_at DESC LIMIT 500`).all(now).map(publicSanction);
}

/** How many automatic timeouts this person has had in the last day (it sets how long the next one is). */
export function recentAutoTimeouts(db, userId, now = Date.now()) {
  return db.prepare("SELECT COUNT(*) AS n FROM chat_sanctions WHERE user_id = ? AND created_by = 'AutoMod' AND created_at > ?").get(userId, now - 24 * 60 * MINUTE).n;
}

// --- moderation log ------------------------------------------------------------------

export function addLog(db, actor, action, target = null, detail = null) {
  db.prepare("INSERT INTO chat_log (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)").run(Date.now(), actor, action, target, detail);
  db.prepare("DELETE FROM chat_log WHERE id <= (SELECT MAX(id) FROM chat_log) - 1000").run();
}

export function listLog(db, limit = 100) {
  limit = Math.min(Math.max(Number(limit) || 100, 1), 500);
  return db.prepare("SELECT at, actor, action, target, detail FROM chat_log ORDER BY id DESC LIMIT ?").all(limit);
}
