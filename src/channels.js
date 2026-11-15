/*
 * Chat channels (#general, #help, ...). Each has a name, a short description, a place in the order and two lists
 * of roles: who may read it and who may post in it. An empty list means everyone. Site admins can always read and post
 * everywhere, like everything else. Whoever may not read a channel never hears about it: it isn't in their list, its
 * messages aren't sent to them, and asking for it by number says it doesn't exist.
 *
 * The roles are kept by their id. Deleting a role takes it out of these lists, and a list that would be left
 * empty by that becomes "admins only", never "everyone".
 */
import { AdminError, transaction } from "./accountsdb.js";
import { normalizeText } from "./chatfilter.js";
import { rolesOf } from "./roles.js";

export const LIMITS = { channels: 20, name: 24, description: 120 };
const NAME = /^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$/;
const NOBODY = -1; // a role id that doesn't exist: "admins only" once a restricted role has been deleted

/** A channel name as typed: lower case, spaces become dashes, nothing else odd. */
export const slugOfChannel = (name) => String(name ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LIMITS.name);

const ids = (text) => { try { const list = JSON.parse(text || "[]"); return Array.isArray(list) ? list.filter(Number.isInteger) : []; } catch { return []; } };

const shape = (row, validRoles) => {
  const read = ids(row.read_roles), post = ids(row.post_roles);
  return {
    id: row.id, name: row.name, slug: row.slug, description: row.description, position: row.position,
    readRoles: read.filter((id) => validRoles.has(id)), postRoles: post.filter((id) => validRoles.has(id)),
    // A restricted list whose roles are all gone: only admins get in.
    readLocked: read.length > 0 && !read.some((id) => validRoles.has(id)),
    postLocked: post.length > 0 && !post.some((id) => validRoles.has(id)),
  };
};

const roleIds = (db) => new Set(db.prepare("SELECT id FROM roles").all().map((r) => r.id));

export function listChannels(db) {
  const valid = roleIds(db);
  return db.prepare("SELECT * FROM chat_channels ORDER BY position DESC, id").all().map((row) => shape(row, valid));
}

export function getChannel(db, id) {
  const row = db.prepare("SELECT * FROM chat_channels WHERE id = ?").get(Number(id));
  return row ? shape(row, roleIds(db)) : null;
}

/** Whether this person ({ id, admin }) may read the channel, given the ids of the roles they hold. */
export function mayRead(channel, user, held) {
  if (user.admin) return true;
  if (channel.readLocked) return false;
  return !channel.readRoles.length || channel.readRoles.some((id) => held.has(id));
}

export function mayPost(channel, user, held) {
  if (!mayRead(channel, user, held)) return false;
  if (user.admin) return true;
  if (channel.postLocked) return false;
  return !channel.postRoles.length || channel.postRoles.some((id) => held.has(id));
}

export const heldRoleIds = (db, userId) => new Set(rolesOf(db, userId).map((r) => r.id));

/** The channels this person can see, in order, each with whether they can post in it. */
export function visibleChannels(db, user, channels = listChannels(db), held = heldRoleIds(db, user.id)) {
  return channels.filter((c) => mayRead(c, user, held)).map((c) => ({ ...c, canPost: mayPost(c, user, held) }));
}

/** A channel as every reader sees it (who may read and post is for admins). */
export const publicChannel = (c) => ({ id: c.id, name: c.name, description: c.description, canPost: Boolean(c.canPost) });

/** What an admin typed: a valid { name, slug, description, readRoles, postRoles }. */
export function cleanChannel(db, input, current = null) {
  const name = slugOfChannel(input?.name ?? current?.name ?? "");
  if (!NAME.test(name)) throw new AdminError(400, "A channel name is 2 to 24 letters, numbers or dashes.");
  const description = Array.from(normalizeText(input?.description ?? current?.description ?? "").replace(/\s+/g, " ")).slice(0, LIMITS.description).join("").trim();
  const valid = roleIds(db);
  const pick = (value, fallback) => {
    const list = value === undefined ? fallback : value;
    if (!Array.isArray(list) || list.some((id) => !Number.isInteger(id) || !valid.has(id))) throw new AdminError(400, "Pick roles that exist.");
    return [...new Set(list)];
  };
  return { name, slug: name, description, readRoles: pick(input?.readRoles, current?.readRoles ?? []), postRoles: pick(input?.postRoles, current?.postRoles ?? []) };
}

function renumber(db) {
  const rows = db.prepare("SELECT id FROM chat_channels ORDER BY position DESC, id").all();
  rows.forEach((row, i) => db.prepare("UPDATE chat_channels SET position = ? WHERE id = ?").run(rows.length - i, row.id));
}

export function createChannel(db, input) {
  if (db.prepare("SELECT COUNT(*) AS n FROM chat_channels").get().n >= LIMITS.channels) throw new AdminError(400, `There can be ${LIMITS.channels} channels.`);
  const channel = cleanChannel(db, input);
  if (db.prepare("SELECT 1 FROM chat_channels WHERE slug = ?").get(channel.slug)) throw new AdminError(409, "There is already a channel with that name.");
  const { lastInsertRowid } = db.prepare("INSERT INTO chat_channels (name, slug, description, position, read_roles, post_roles, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)")
    .run(channel.name, channel.slug, channel.description, JSON.stringify(channel.readRoles), JSON.stringify(channel.postRoles), Date.now());
  renumber(db); // new channels start at the bottom
  return getChannel(db, Number(lastInsertRowid));
}

export function updateChannel(db, id, input) {
  const current = getChannel(db, id);
  if (!current) throw new AdminError(404, "There's no such channel.");
  const channel = cleanChannel(db, input, current);
  if (db.prepare("SELECT 1 FROM chat_channels WHERE slug = ? AND id <> ?").get(channel.slug, current.id)) throw new AdminError(409, "There is already a channel with that name.");
  db.prepare("UPDATE chat_channels SET name = ?, slug = ?, description = ?, read_roles = ?, post_roles = ? WHERE id = ?")
    .run(channel.name, channel.slug, channel.description, JSON.stringify(channel.readRoles), JSON.stringify(channel.postRoles), current.id);
  return getChannel(db, current.id);
}

/** Delete a channel and what was said in it. There always has to be one left. */
export function deleteChannel(db, id) {
  const current = getChannel(db, id);
  if (!current) throw new AdminError(404, "There's no such channel.");
  if (db.prepare("SELECT COUNT(*) AS n FROM chat_channels").get().n <= 1) throw new AdminError(400, "There has to be at least one channel.");
  transaction(db, () => {
    db.prepare("DELETE FROM chat_messages WHERE channel_id = ?").run(current.id);
    db.prepare("DELETE FROM chat_media WHERE id NOT IN (SELECT media_ref FROM chat_messages WHERE media_kind = 'upload' AND deleted_at IS NULL)").run();
    db.prepare("DELETE FROM chat_channels WHERE id = ?").run(current.id); // what people had read in it goes too
    renumber(db);
  });
  return current;
}

/** Swap a channel with its neighbour: direction -1 moves it up, 1 down. */
export function moveChannel(db, id, direction) {
  const rows = db.prepare("SELECT id FROM chat_channels ORDER BY position DESC, id").all().map((r) => r.id);
  const at = rows.indexOf(Number(id));
  if (at === -1) throw new AdminError(404, "There's no such channel.");
  const to = at + (direction < 0 ? -1 : 1);
  if (to < 0 || to >= rows.length) return;
  [rows[at], rows[to]] = [rows[to], rows[at]];
  rows.forEach((channelId, i) => db.prepare("UPDATE chat_channels SET position = ? WHERE id = ?").run(rows.length - i, channelId));
}

/** A role was deleted: take it out of the channels' lists, and never let that open a restricted channel to everyone. */
export function forgetRole(db, roleId) {
  for (const row of db.prepare("SELECT id, read_roles, post_roles FROM chat_channels").all()) {
    const fix = (text) => {
      const list = ids(text);
      if (!list.includes(roleId)) return text;
      const left = list.filter((id) => id !== roleId);
      return JSON.stringify(left.length ? left : [NOBODY]);
    };
    const read = fix(row.read_roles), post = fix(row.post_roles);
    if (read !== row.read_roles || post !== row.post_roles) db.prepare("UPDATE chat_channels SET read_roles = ?, post_roles = ? WHERE id = ?").run(read, post, row.id);
  }
}

// --- what each person has read, per channel -------------------------------------------------

const latestIn = (db, channelId) => db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM chat_messages WHERE channel_id = ?").get(channelId).id;

/**
 * Messages from other people since this person last read each channel: a Map of channel id to a count.
 * A channel they have never read starts at "everything so far is read", not with its whole history unread.
 */
export function unreadByChannel(db, userId, channelIds) {
  const out = new Map();
  for (const channelId of channelIds) {
    try {
      const row = db.prepare("SELECT last_id FROM chat_channel_reads WHERE user_id = ? AND channel_id = ?").get(userId, channelId);
      if (!row) { markChannelRead(db, userId, channelId); out.set(channelId, 0); continue; }
      out.set(channelId, db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE channel_id = ? AND id > ? AND user_id <> ? AND deleted_at IS NULL").get(channelId, row.last_id, userId).n);
    } catch (error) {
      console.error("Chat: could not count unread messages:", error.message); // never stop the chat from opening
      out.set(channelId, 0);
    }
  }
  return out;
}

export function markChannelRead(db, userId, channelId) {
  db.prepare("INSERT INTO chat_channel_reads (user_id, channel_id, last_id, at) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET last_id = excluded.last_id, at = excluded.at")
    .run(userId, channelId, latestIn(db, channelId), Date.now());
}
