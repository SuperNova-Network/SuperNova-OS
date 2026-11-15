import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";

// Owner above admins above roles: who may change whom.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };
const accountsdb = hasSqlite ? await import("../src/accountsdb.js") : null;

let server, dataDir, crown, ada, bob, cy, direct;
let clients = 100;
function browser() {
  let cookie = "";
  const ip = `203.0.113.${++clients}`;
  const call = async (method, path, body) => {
    const res = await fetch(server.url + path, {
      method,
      headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, data, text };
  };
  return { get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b) };
}
async function person(name, password = "password123") {
  const b = browser();
  assert.equal((await b.post("/api/account/register", { username: name, password })).status, 201);
  b.username = name;
  return b;
}
const admin = (who, path, body) => who.post(`/api/admin${path}`, body);

before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-hierarchy-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  [crown, ada, bob, cy] = [await person("Crown"), await person("Ada"), await person("Bob"), await person("Cyd")];
  direct = await accountsdb.openDatabase(dataDir);
  accountsdb.giveOwnership(direct, direct.prepare("SELECT id FROM users WHERE username = 'Crown'").get().id);
  for (const name of ["Ada", "Bob"]) assert.equal((await crown.post(`/api/account/admin/users/${name}/admin`)).status, 200);
});
after(async () => {
  direct?.close();
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const roleId = async (who, slug) => (await who.get("/api/admin/roles")).data.roles.find((r) => r.slug === slug).id;

test("the owner is marked, holds the Owner role alone, and admins don't", options, async () => {
  assert.equal((await crown.get("/api/account")).data.user.owner, true);
  assert.equal((await ada.get("/api/account")).data.user.owner, undefined);
  const owners = (await crown.get(`/api/admin/roles/${await roleId(crown, "owner")}/members`)).data.members;
  assert.deepEqual(owners.map((m) => m.username), ["Crown"]);
});

test("an admin can't make, remove or crown admins, or change the site's settings", options, async () => {
  assert.equal((await ada.post("/api/account/admin/users/Cyd/admin")).status, 403);
  assert.equal((await ada.post("/api/account/admin/users/Bob/unadmin")).status, 403);
  assert.equal((await ada.post("/api/account/admin/users/Crown/unadmin")).status, 403);
  assert.equal((await ada.post("/api/account/admin/users/Ada/unadmin")).status, 403);
  assert.equal((await ada.post("/api/account/admin/site", { signup: "closed" })).status, 403);
  assert.equal((await ada.get("/api/admin/system/backup")).status, 403, "the backup holds every password hash");
  assert.equal((await ada.post("/api/account/admin/owner", { username: "Ada", password: "password123" })).status, 403, "can't take the site");
  assert.equal((await crown.post("/api/account/admin/users/Crown/unadmin")).status, 403, "the owner can't drop their own power either");
});

test("nobody gives themselves the Owner or Admin role", options, async () => {
  for (const slug of ["owner", "admin"]) {
    const id = await roleId(ada, slug);
    for (const who of [ada, crown]) {
      assert.equal((await admin(who, `/roles/${id}/members`, { username: "Cyd", add: true })).status, 403, `${slug} by hand`);
      assert.equal((await admin(who, `/roles/${id}/members`, { username: "Ada", add: false })).status, 403);
    }
    assert.equal((await admin(ada, `/roles/${id}/delete`)).status, 403, "can't be deleted");
    assert.equal((await admin(ada, `/roles/${id}/move`, { direction: 1 })).status, 403, "stay at the top");
  }
  const id = await roleId(ada, "owner");
  const renamed = await admin(ada, `/roles/${id}`, { name: "Boss", color: "#112233", permissions: [] });
  assert.equal(renamed.data.role.name, "Owner", "the name and permissions of a system role stay");
  assert.ok(renamed.data.role.permissions.length > 0);
});

test("an admin runs everything below them, and no admin touches another or the owner", options, async () => {
  // below: fine
  const moderator = await roleId(ada, "moderator");
  assert.equal((await admin(ada, `/roles/${moderator}/members`, { username: "Cyd", add: true })).status, 200);
  assert.equal((await admin(ada, "/users/Cyd/rename", { username: "Cydrus" })).status, 200);
  assert.equal((await admin(ada, "/users/Cydrus/password", { password: "brandnewpass1" })).status, 200);
  assert.equal((await admin(ada, "/users/Cydrus/rename", { username: "Cyd" })).status, 200);
  // sideways and up: refused, every way
  for (const target of ["Bob", "Crown"]) {
    assert.equal((await admin(ada, `/users/${target}/password`, { password: "hijacked123" })).status, 403, `password ${target}`);
    assert.equal((await admin(ada, `/users/${target}/rename`, { username: `${target}2` })).status, 403, `rename ${target}`);
    assert.equal((await admin(ada, `/users/${target}/signout`)).status, 403, `signout ${target}`);
    assert.equal((await admin(ada, `/users/${target}/delete`, { confirm: target })).status, 403, `delete ${target}`);
    assert.equal((await ada.post(`/api/account/admin/users/${target}/ban`)).status, 403, `ban ${target}`);
    assert.equal((await admin(ada, `/roles/${moderator}/members`, { username: target, add: true })).status, 403, `role to ${target}`);
    const bulk = await admin(ada, "/users/bulk", { action: "signout", usernames: [target] });
    assert.equal(bulk.data.results[0].ok, false, `bulk ${target}`);
  }
  const detail = (await ada.get("/api/admin/users/Bob")).data;
  assert.equal(detail.canManage, false);
  assert.equal((await ada.get("/api/admin/users/Cyd")).data.canManage, true);
  assert.equal((await ada.get("/api/admin/users/Crown")).data.owner, true);
  // their own account stays theirs
  assert.equal((await admin(ada, "/users/Ada/password", { password: "adaspassword1" })).status, 200);
  assert.equal((await ada.get("/api/account")).data.user, null, "that signs everyone out, themselves too");
  assert.equal((await ada.post("/api/account/login", { username: "Ada", password: "adaspassword1" })).status, 200);
});

test("an admin can't end the owner's session, and the owner can't be banned or deleted by anyone", options, async () => {
  const list = (await ada.get("/api/admin/sessions?q=Crown")).data.sessions;
  assert.ok(list.length);
  assert.equal((await admin(ada, `/sessions/${list[0].id}/revoke`)).status, 403);
  assert.equal((await crown.get("/api/account")).data.user.username, "Crown", "still signed in");
  assert.equal((await crown.post("/api/account/delete", { password: "password123" })).status, 403, "the owner hands the site over before leaving");
  assert.equal((await crown.post("/api/account/admin/users/Crown/ban")).status, 400);
});

test("the owner makes admins, manages them, and can hand the site over with their password", options, async () => {
  assert.equal((await crown.post("/api/account/admin/users/Cyd/admin")).status, 200);
  assert.equal((await admin(crown, "/users/Cyd/password", { password: "ownersreset1" })).status, 200, "the owner may reset an admin's password");
  assert.equal((await crown.post("/api/account/admin/users/Cyd/unadmin")).status, 200);
  assert.equal((await crown.post("/api/account/admin/owner", { username: "Ada", password: "wrong-password" })).status, 401);
  assert.equal((await crown.post("/api/account/admin/owner", { username: "nobody-here", password: "password123" })).status, 404);
  assert.equal((await crown.post("/api/account/admin/owner", { username: "Crown", password: "password123" })).status, 400);
  assert.equal((await ada.post("/api/account/admin/owner", { username: "Ada", password: "adaspassword1" })).status, 403);
  assert.equal((await crown.post("/api/account/admin/owner", { username: "Ada", password: "password123" })).status, 200);
  assert.equal((await ada.get("/api/account")).data.user.owner, true);
  const now = (await crown.get("/api/account")).data.user;
  assert.deepEqual([now.admin, now.owner], [true, undefined], "the old owner stays an admin");
  const holders = (await ada.get(`/api/admin/roles/${await roleId(ada, "owner")}/members`)).data.members;
  assert.deepEqual(holders.map((m) => m.username), ["Ada"]);
  assert.equal((await crown.post("/api/account/admin/users/Ada/unadmin")).status, 403, "and is now below them");
  assert.equal((await ada.post("/api/account/admin/users/Crown/unadmin")).status, 200);
});

test("a site without an owner lets any admin do the owner's jobs, so nobody is locked out", options, async () => {
  direct.exec("UPDATE users SET is_owner = 0");
  assert.equal((await ada.post("/api/account/admin/users/Bob/admin")).status, 200);
  assert.equal((await ada.post("/api/account/admin/users/Bob/unadmin")).status, 200);
});

test("migration 14 picks the account that did the setup, else the oldest admin, and leaves one Owner", options, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-owner-migrate-"));
  try {
    const first = await accountsdb.openDatabase(dir);
    const add = first.prepare("INSERT INTO users (username, password_hash, recovery_hash, created_at, updated_at, last_seen_at, is_admin) VALUES (?, 'x', 'y', ?, ?, ?, 1)");
    add.run("older", 1, 1, 1);
    add.run("setupper", 2, 2, 2);
    first.prepare("INSERT INTO admin_log (at, actor, action) VALUES (1, 'setupper', 'setup')").run();
    const owner = first.prepare("SELECT id FROM roles WHERE slug = 'owner'").get().id;
    first.prepare("INSERT INTO user_roles (user_id, role_id) SELECT id, ? FROM users").run(owner); // everyone held it by hand
    first.exec("UPDATE users SET is_owner = 0; PRAGMA user_version = 13");
    first.close();
    const db = await accountsdb.openDatabase(dir);
    assert.deepEqual(db.prepare("SELECT username FROM users WHERE is_owner = 1").all().map((r) => r.username), ["setupper"]);
    assert.deepEqual(db.prepare("SELECT users.username FROM user_roles JOIN users ON users.id = user_roles.user_id WHERE role_id = ?").all(owner).map((r) => r.username), ["setupper"]);
    db.exec("UPDATE users SET is_owner = 0; DELETE FROM admin_log; PRAGMA user_version = 13");
    db.close();
    const again = await accountsdb.openDatabase(dir);
    assert.deepEqual(again.prepare("SELECT username FROM users WHERE is_owner = 1").all().map((r) => r.username), ["older"], "no setup on record: the oldest admin");
    again.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
