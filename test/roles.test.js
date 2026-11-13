import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { parseMentions } from "../src/mentions.js";
import { slugOf } from "../src/roles.js";

// Roles, their permissions, and @mentions.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-roles-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  boss = await person("Boss");
  assert.equal((await boss.post("/api/chat/admin/settings", { slowSeconds: 0 })).status, 200);
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let clients = 0, names = 0;
function browser() {
  let cookie = "";
  const ip = `100.65.0.${++clients}`;
  async function call(method, path, body) {
    const res = await fetch(server.url + path, {
      method, redirect: "manual",
      headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data };
  }
  return { get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b) };
}
async function person(name = `pal${++names}`) {
  const b = browser();
  const r = await b.post("/api/account/register", { username: name, password: "password123" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  b.username = name;
  return b;
}
const A = "/api/admin";
const roleList = async () => (await boss.get(`${A}/roles`)).data.roles;
const roleNamed = async (name) => (await roleList()).find((r) => r.name === name);
const give = (role, user) => boss.post(`${A}/roles/${role.id}/members`, { username: user.username });
const say = (who, text) => who.post("/api/chat/messages", { text });

test("mentions are found, resolved and limited", () => {
  const person_ = (name) => ({ alex: "Alex", "sam.j": "Sam.J" })[name.toLowerCase()] ?? null;
  const role_ = (slug) => ({ admin: { slug: "admin", mentionable: true }, secret: { slug: "secret", mentionable: false }, "beta-testers": { slug: "beta-testers", mentionable: true } })[slug] ?? null;
  const parse = (text, extra = {}) => parseMentions(text, { person: person_, role: role_, ...extra });
  assert.deepEqual(parse("hi @alex, and @ALEX again"), { users: ["Alex"], roles: [], everyone: false, here: false });
  assert.deepEqual(parse("@admin please look. cc @beta-testers!").roles, ["admin", "beta-testers"]);
  assert.deepEqual(parse("thanks @sam.j.").users, ["Sam.J"], "a full stop after a name is punctuation");
  assert.deepEqual(parse("mail me at alex@example.com or a@alex").users, [], "an email address isn't a mention");
  assert.deepEqual(parse("@nobody @alexander").users, [], "only people who exist");
  assert.deepEqual(parse("(@alex) and \"@admin\"").users, ["Alex"]);
  assert.equal(parse("@everyone @here").everyone, false, "everyone needs permission");
  assert.deepEqual(parse("@everyone @here", { everyone: true }), { users: [], roles: [], everyone: true, here: true });
  assert.deepEqual(parse("@secret").roles, [], "a role that can't be pinged");
  assert.deepEqual(parse("@secret", { anyRole: true }).roles, ["secret"], "unless you may ping any role");
  const many = Array.from({ length: 30 }, (_, i) => `@u${i}`).join(" ");
  assert.ok(parseMentions(many, { person: (n) => n, role: () => null }).users.length <= 10, "at most ten count");
  assert.equal(slugOf("Beta Testers!"), "beta-testers");
});

test("the four default roles exist, in order, and existing admins hold Admin", options, async () => {
  const roles = await roleList();
  assert.deepEqual(roles.slice(0, 4).map((r) => r.name), ["Owner", "Admin", "Moderator", "Supporter"]);
  assert.ok(roles[0].position > roles[1].position && roles[2].position > roles[3].position);
  assert.deepEqual((await boss.get(`${A}/roles`)).data.permissions.map((p) => p.id).sort(), ["chat.bypass_limits", "chat.manage", "chat.mention_everyone", "chat.mention_roles", "chat.moderate", "store.instant_publish"]);
  const stranger = browser(), member = await person();
  assert.equal((await stranger.get(`${A}/roles`)).status, 401);
  assert.equal((await member.get(`${A}/roles`)).status, 403);
  assert.equal((await member.post(`${A}/roles`, { name: "Sneaky" })).status, 403);
});

test("admins create, change, order and delete roles, with checks on what they send", options, async () => {
  const made = await boss.post(`${A}/roles`, { name: "  Beta   Testers ", color: "#12AB34", permissions: ["chat.mention_roles", "chat.mention_roles"], mentionable: false });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const role = made.data.role;
  assert.deepEqual([role.name, role.slug, role.color, role.permissions, role.mentionable], ["Beta Testers", "beta-testers", "#12ab34", ["chat.mention_roles"], false]);
  assert.equal((await roleList()).at(-1).name, "Beta Testers", "new roles start at the bottom");
  for (const bad of [{}, { name: "x", color: "red" }, { name: "x", permissions: ["site.destroy"] }, { name: "x", permissions: "chat.moderate" }, { name: "Everyone" }, { name: "!!!" }, { name: "admin" }]) {
    assert.ok([400, 409].includes((await boss.post(`${A}/roles`, bad)).status), JSON.stringify(bad));
  }
  assert.equal((await boss.post(`${A}/roles/${role.id}`, { name: "Beta Crew", color: "#ffffff", permissions: [], mentionable: true })).data.role.slug, "beta-crew");
  assert.equal((await boss.post(`${A}/roles/${role.id}`, { name: "Moderator" })).status, 409, "no two roles with one name");
  await boss.post(`${A}/roles/${role.id}/move`, { direction: -1 });
  const order = (await roleList()).map((r) => r.name);
  assert.equal(order.indexOf("Beta Crew"), order.indexOf("Supporter") - 1, "moved up one place");
  assert.equal((await boss.post(`${A}/roles/${role.id}/delete`)).status, 200);
  assert.equal(await roleNamed("Beta Crew"), undefined);
  assert.equal((await boss.post(`${A}/roles/${role.id}/delete`)).status, 404);
  for (let i = 0; i < 60; i++) if ((await boss.post(`${A}/roles`, { name: `Filler ${i}` })).status !== 201) break;
  assert.equal((await boss.post(`${A}/roles`, { name: "One too many" })).status, 400, "there is a limit");
  for (const r of (await roleList()).filter((x) => x.name.startsWith("Filler"))) await boss.post(`${A}/roles/${r.id}/delete`);
});

test("members are given and taken away, and making someone an admin gives them the Admin role", options, async () => {
  const sup = await roleNamed("Supporter"), pal = await person();
  assert.equal((await give(sup, pal)).status, 200);
  assert.deepEqual((await boss.get(`${A}/roles/${sup.id}/members`)).data.members.map((m) => m.username), [pal.username]);
  assert.equal((await boss.post(`${A}/roles/${sup.id}/members`, { username: pal.username, add: false })).status, 200);
  assert.equal((await boss.get(`${A}/roles/${sup.id}/members`)).data.members.length, 0);
  assert.equal((await boss.post(`${A}/roles/${sup.id}/members`, { username: "nobody-at-all" })).status, 404);
  assert.equal((await boss.post(`/api/account/admin/users/${pal.username}/admin`)).status, 200);
  const admin = await roleNamed("Admin");
  assert.ok((await boss.get(`${A}/roles/${admin.id}/members`)).data.members.some((m) => m.username === pal.username));
  await boss.post(`/api/account/admin/users/${pal.username}/unadmin`);
  assert.ok(!(await boss.get(`${A}/roles/${admin.id}/members`)).data.members.some((m) => m.username === pal.username));
});

test("moderator permissions come from the role, and rank decides who can be moderated", options, async () => {
  const mod = await roleNamed("Moderator"), sup = await roleNamed("Supporter");
  const m = await person(), plain = await person(), other = await person(), s = await person();
  assert.equal((await m.post(`/api/chat/admin/users/${plain.username}/timeout`, { minutes: 5 })).status, 403, "no role, no power");
  await give(mod, m); await give(sup, s); await give(mod, other);
  const sent = await say(plain, "rude words");
  assert.equal((await m.post(`/api/chat/admin/messages/${sent.data.message.id}/delete`)).status, 200, "a moderator can delete");
  assert.equal((await m.post(`/api/chat/admin/users/${plain.username}/timeout`, { minutes: 5, reason: "calm down" })).status, 200);
  assert.equal((await m.post(`/api/chat/admin/users/${other.username}/timeout`, { minutes: 5 })).status, 403, "not someone as high as you");
  assert.equal((await m.post(`/api/chat/admin/users/Boss/timeout`, { minutes: 5 })).status, 403, "never a site admin");
  assert.equal((await m.post(`/api/chat/admin/users/${s.username}/timeout`, { minutes: 5 })).status, 200, "someone with a lower role can be");
  assert.equal((await s.post(`/api/chat/admin/users/${plain.username}/ban`)).status, 403, "and a supporter has no moderation permission");
});

test("managing the chat and skipping its limits are permissions too", options, async () => {
  const custom = (await boss.post(`${A}/roles`, { name: "Chat Boss", permissions: ["chat.manage"] })).data.role;
  const lim = (await boss.post(`${A}/roles`, { name: "Free Speech", permissions: ["chat.bypass_limits"] })).data.role;
  const c = await person(), f = await person(), plain = await person();
  assert.equal((await c.get("/api/chat/admin/settings")).status, 403);
  await give(custom, c);
  assert.equal((await c.get("/api/chat/admin/settings")).status, 200);
  assert.equal((await c.post("/api/chat/admin/settings", { links: "allowed" })).status, 200);
  assert.equal((await c.post("/api/chat/admin/settings", { links: "blocked" })).status, 200);
  assert.equal((await c.post("/api/chat/admin/messages/1/delete")).status, 403, "managing is not moderating");
  assert.equal((await plain.post("/api/chat/admin/settings", { links: "allowed" })).status, 403);
  // limits: slow mode and a locked chat don't stop the role that skips them
  await boss.post("/api/chat/admin/settings", { slowSeconds: 30, locked: true });
  try {
    assert.equal((await say(plain, "locked out")).status, 403);
    await give(lim, f);
    assert.equal((await say(f, "hello")).status, 201, "skips a locked chat");
    assert.equal((await say(f, "again right away")).status, 201, "and slow mode");
  } finally { await boss.post("/api/chat/admin/settings", { slowSeconds: 0, locked: false }); }
});

test("a message stores who it pinged, and only what the sender may ping", options, async () => {
  const mod = await roleNamed("Moderator");
  const a = await person(), target = await person(), m = await person();
  await give(mod, m);
  const secret = (await boss.post(`${A}/roles`, { name: "Staff Only", mentionable: false })).data.role;
  const msg = (await say(a, `hey @${target.username.toUpperCase()}, @moderator and @staff-only, mail a@${target.username} @nobody @everyone`)).data.message;
  assert.deepEqual(msg.mentions, { users: [target.username], roles: ["moderator"], everyone: false, here: false });
  const history = (await a.get("/api/chat/messages")).data.messages.find((x) => x.id === msg.id);
  assert.deepEqual(history.mentions, msg.mentions, "kept in the history");
  assert.equal((await say(a, "no pings at all")).data.message.mentions, undefined);
  // a role that allows pinging everyone and any role
  const loud = (await boss.post(`${A}/roles`, { name: "Loud", permissions: ["chat.mention_everyone", "chat.mention_roles"] })).data.role;
  await give(loud, m);
  const big = (await say(m, "@everyone @here and @staff-only")).data.message;
  assert.deepEqual([big.mentions.everyone, big.mentions.here, big.mentions.roles], [true, true, ["staff-only"]]);
  assert.equal((await say(boss, "@everyone from an admin")).data.message.mentions.everyone, true, "site admins can ping everyone");
  await boss.post(`${A}/roles/${secret.id}/delete`);
});

test("messages and the people online show each person's highest role", options, async () => {
  const sup = await roleNamed("Supporter"), mod = await roleNamed("Moderator");
  const p = await person();
  await give(sup, p); await give(mod, p);
  const msg = (await say(p, "who am I")).data.message;
  assert.deepEqual([msg.user.role.name, msg.user.role.color], ["Moderator", mod.color], "the highest of their roles");
  await boss.post(`${A}/roles/${mod.id}/members`, { username: p.username, add: false });
  assert.equal((await p.get("/api/chat/messages")).data.messages.find((x) => x.id === msg.id).user.role.name, "Supporter", "history follows the roles as they are now");
});

test("@ suggestions list people and the roles you may ping", options, async () => {
  const p = await person("zelda_" + Date.now().toString(36).slice(-4)), q = await person();
  const found = (await q.get(`/api/chat/mention-search?q=zeld`)).data;
  assert.deepEqual(found.users.map((u) => u.username), [p.username]);
  assert.deepEqual(found.special, [], "a member can't ping everyone");
  const roles = (await q.get("/api/chat/mention-search?q=mod")).data.roles;
  assert.deepEqual(roles.map((r) => r.slug), ["moderator"]);
  assert.deepEqual((await boss.get("/api/chat/mention-search?q=ev")).data.special, ["everyone"], "an admin can");
  assert.equal((await browser().get("/api/chat/mention-search?q=a")).status, 401);
  assert.deepEqual((await q.get("/api/chat/mention-search?q=_")).data.users, [], "an underscore is just a character, not a wildcard");
});

test("the Supporter role can publish apps without review", options, async () => {
  const sup = await roleNamed("Supporter");
  await boss.post("/api/admin/store/settings", { approval: "manual" });
  const s = await person(), plain = await person();
  await give(sup, s);
  const app = (n) => ({ name: `Role App ${n}`, description: "An app made to test roles in the store.", category: "tools", url: `https://role-${n}-${Date.now()}.example.com/` });
  assert.equal((await plain.post("/api/store/apps", app(1))).data.live, false, "normally it waits");
  assert.equal((await s.post("/api/store/apps", app(2))).data.live, true, "a supporter's goes live");
});
