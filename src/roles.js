/*
 * Roles. Admins make as many as they like (Admin Panel > Roles); each has a name, a colour, a place in the
 * order (higher is more important), a set of permissions, and whether anyone can @mention it. Owner, Admin,
 * Moderator and Supporter exist from the start. A person can hold any number of roles: they get all of those
 * roles' permissions, their name takes the colour of their highest role, and they can only be moderated by
 * people whose highest role is above theirs.
 *
 * Site admins (the Admin Panel, ADMINS) always have every permission here, and can't be moderated by roles.
 * Holding a role does not make anyone a site admin: that stays Settings > Admin.
 */
import { AdminError } from "./accountsdb.js";
import { normalizeText } from "./chatfilter.js";

export const PERMISSIONS = [
  { id: "chat.moderate", label: "Moderate the chat", hint: "Delete messages, time people out or ban them from the chat, and see the moderation log." },
  { id: "chat.manage", label: "Manage the chat", hint: "Change the chat's settings and blocked words, its admin look, and clear it." },
  { id: "chat.bypass_limits", label: "Skip the chat's limits", hint: "No slow mode, spam rules, link ban, minimum account age or locked chat." },
  { id: "chat.mention_everyone", label: "Ping @everyone and @here", hint: "Notify everyone in the chat." },
  { id: "chat.mention_roles", label: "Ping any role", hint: "Even roles that members can't ping." },
  { id: "store.instant_publish", label: "Publish apps without review", hint: "Their apps go live in the App Store at once, even when new apps need approval." },
];
const PERMISSION_IDS = new Set(PERMISSIONS.map((p) => p.id));

export const LIMITS = { roles: 50, name: 24 };
const RESERVED = new Set(["everyone", "here"]);
const HEX = /^#[0-9a-fA-F]{6}$/;

export const slugOf = (name) => String(name ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

const shape = (row, members = 0) => ({
  id: row.id, name: row.name, slug: row.slug, color: row.color, position: row.position,
  permissions: JSON.parse(row.permissions || "[]").filter((p) => PERMISSION_IDS.has(p)),
  mentionable: Boolean(row.mentionable), members,
});

export function listRoles(db) {
  const counts = new Map(db.prepare("SELECT role_id, COUNT(*) AS n FROM user_roles GROUP BY role_id").all().map((r) => [r.role_id, r.n]));
  return db.prepare("SELECT * FROM roles ORDER BY position DESC, id").all().map((row) => shape(row, counts.get(row.id) ?? 0));
}

export function getRole(db, id) {
  const row = db.prepare("SELECT * FROM roles WHERE id = ?").get(Number(id));
  return row ? shape(row, db.prepare("SELECT COUNT(*) AS n FROM user_roles WHERE role_id = ?").get(row.id).n) : null;
}

/** Check what an admin typed: { name, color, permissions, mentionable } with every field valid. */
export function cleanRole(input, current = null) {
  const name = Array.from(normalizeText(input?.name ?? current?.name ?? "").replace(/\s+/g, " ")).slice(0, LIMITS.name).join("").trim();
  if (!name) throw new AdminError(400, "Give the role a name.");
  const slug = slugOf(name);
  if (!slug) throw new AdminError(400, "A role name needs some letters or numbers.");
  if (RESERVED.has(slug)) throw new AdminError(400, `"${name}" is kept for pinging everyone.`);
  const color = String(input?.color ?? current?.color ?? "#99aab5");
  if (!HEX.test(color)) throw new AdminError(400, "Pick a colour.");
  let permissions = input?.permissions ?? current?.permissions ?? [];
  if (!Array.isArray(permissions) || permissions.some((p) => !PERMISSION_IDS.has(p))) throw new AdminError(400, "That isn't a permission.");
  permissions = [...new Set(permissions)];
  return { name, slug, color: color.toLowerCase(), permissions, mentionable: input?.mentionable === undefined ? (current?.mentionable ?? true) : Boolean(input.mentionable) };
}

function renumber(db) {
  const rows = db.prepare("SELECT id FROM roles ORDER BY position DESC, id").all();
  rows.forEach((row, i) => db.prepare("UPDATE roles SET position = ? WHERE id = ?").run(rows.length - i, row.id));
}

export function createRole(db, input) {
  if (db.prepare("SELECT COUNT(*) AS n FROM roles").get().n >= LIMITS.roles) throw new AdminError(400, `There can be ${LIMITS.roles} roles.`);
  const role = cleanRole(input);
  if (db.prepare("SELECT 1 FROM roles WHERE slug = ?").get(role.slug)) throw new AdminError(409, "There is already a role with that name.");
  const { lastInsertRowid } = db.prepare("INSERT INTO roles (name, slug, color, position, permissions, mentionable, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)")
    .run(role.name, role.slug, role.color, JSON.stringify(role.permissions), role.mentionable ? 1 : 0, Date.now());
  renumber(db); // new roles start at the bottom
  return getRole(db, Number(lastInsertRowid));
}

export function updateRole(db, id, input) {
  const current = getRole(db, id);
  if (!current) throw new AdminError(404, "There's no such role.");
  const role = cleanRole(input, current);
  if (db.prepare("SELECT 1 FROM roles WHERE slug = ? AND id <> ?").get(role.slug, current.id)) throw new AdminError(409, "There is already a role with that name.");
  db.prepare("UPDATE roles SET name = ?, slug = ?, color = ?, permissions = ?, mentionable = ? WHERE id = ?")
    .run(role.name, role.slug, role.color, JSON.stringify(role.permissions), role.mentionable ? 1 : 0, current.id);
  return getRole(db, current.id);
}

export function deleteRole(db, id) {
  const current = getRole(db, id);
  if (!current) throw new AdminError(404, "There's no such role.");
  db.prepare("DELETE FROM roles WHERE id = ?").run(current.id);
  renumber(db);
  return current;
}

/** Swap a role with its neighbour: direction -1 moves it up (more important), 1 down. */
export function moveRole(db, id, direction) {
  const rows = db.prepare("SELECT id FROM roles ORDER BY position DESC, id").all().map((r) => r.id);
  const at = rows.indexOf(Number(id));
  if (at === -1) throw new AdminError(404, "There's no such role.");
  const to = at + (direction < 0 ? -1 : 1);
  if (to < 0 || to >= rows.length) return;
  [rows[at], rows[to]] = [rows[to], rows[at]];
  rows.forEach((roleId, i) => db.prepare("UPDATE roles SET position = ? WHERE id = ?").run(rows.length - i, roleId));
}

export function membersOf(db, roleId) {
  return db.prepare(`SELECT users.username, users.avatar_version AS avatar FROM user_roles JOIN users ON users.id = user_roles.user_id
    WHERE user_roles.role_id = ? ORDER BY users.username COLLATE NOCASE LIMIT 500`).all(Number(roleId));
}

export function setMember(db, roleId, username, on) {
  const user = db.prepare("SELECT id, username FROM users WHERE username = ?").get(String(username ?? "").trim());
  if (!user) throw new AdminError(404, "There's no account with that name.");
  if (!getRole(db, roleId)) throw new AdminError(404, "There's no such role.");
  if (on) db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)").run(user.id, Number(roleId));
  else db.prepare("DELETE FROM user_roles WHERE user_id = ? AND role_id = ?").run(user.id, Number(roleId));
  return user;
}

/** The roles of several people: Map of user id to their roles, highest first. */
export function rolesOfUsers(db, ids) {
  const out = new Map();
  if (!ids.length) return out;
  const rows = db.prepare(`SELECT user_roles.user_id, roles.* FROM user_roles JOIN roles ON roles.id = user_roles.role_id
    WHERE user_roles.user_id IN (${ids.map(() => "?").join(",")}) ORDER BY roles.position DESC`).all(...ids);
  for (const row of rows) { if (!out.has(row.user_id)) out.set(row.user_id, []); out.get(row.user_id).push(shape(row)); }
  return out;
}

export const rolesOf = (db, userId) => rolesOfUsers(db, [userId]).get(userId) ?? [];

/** A person's highest role as chat shows it, or null. */
export function topRole(roleList) {
  const top = roleList?.[0];
  return top ? { name: top.name, slug: top.slug, color: top.color, position: top.position } : null;
}

/**
 * What someone may do: a Set of permission ids. Site admins may do everything.
 * `user` is { id, admin }.
 */
export function permissionsOf(db, user) {
  if (user.admin) return new Set(PERMISSION_IDS);
  const set = new Set();
  for (const role of rolesOf(db, user.id)) for (const p of role.permissions) set.add(p);
  return set;
}

export const can = (db, user, permission) => permissionsOf(db, user).has(permission);

/** How high someone stands, for moderation: site admins above every role, others by their highest role. */
export function rank(db, user) {
  if (user.admin) return Infinity;
  return rolesOf(db, user.id)[0]?.position ?? 0;
}

/** The slugs someone answers to when pinged: their roles, and "admin" for every site admin. */
export function mentionSlugs(db, user) {
  const slugs = new Set(rolesOf(db, user.id).map((r) => r.slug));
  if (user.admin && db.prepare("SELECT 1 FROM roles WHERE slug = 'admin'").get()) slugs.add("admin");
  return [...slugs];
}
