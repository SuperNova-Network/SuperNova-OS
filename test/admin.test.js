import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "./helpers.js";

// Invite codes made by admins, and bans.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };
const root = fileURLToPath(new URL("../", import.meta.url));

let server, dataDir, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-admin-"));
  server = await startServer({ ACCOUNTS: "required", AUTH_PASS: "letmein", ADMINS: "boss, Chief", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  boss = browser();
  // The first admin gets in with the old site password, the fixed invite code.
  assert.equal((await boss.signUp("Boss", "letmein")).status, 201);
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let ip = 0;
/** A browser with its own address and cookie. */
function browser() {
  let cookie = "";
  const address = `198.18.0.${++ip}`;
  async function call(method, path, body) {
    const res = await fetch(server.url + path, {
      method,
      redirect: "manual",
      headers: { "x-forwarded-for": address, accept: "application/json", ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  return {
    get: (path) => call("GET", path),
    post: (path, body = {}) => call("POST", path, body),
    get cookie() { return cookie; },
    signUp: (username, inviteCode) => call("POST", "/api/account/register", { username, password: "password123", inviteCode }),
    signIn: (username) => call("POST", "/api/account/login", { username, password: "password123" }),
  };
}

/** Open the proxy's WebSocket and resolve with a promise that settles when it closes. */
function openWisp(cookie) {
  return new Promise((resolve, reject) => {
    const req = request(server.url + "/wisp/", {
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", cookie },
    });
    req.once("upgrade", (_res, socket) => {
      socket.resume();
      resolve({ closed: new Promise((done) => socket.once("close", () => done(true))), socket });
    });
    req.once("response", (res) => reject(new Error(`no upgrade: ${res.statusCode}`)));
    req.end();
  });
}

const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(false), ms))]);


test("admins are marked as such; everyone else is kept out of admin requests", options, async () => {
  assert.deepEqual((await boss.get("/api/account")).data.user, { username: "Boss", admin: true, avatar: 0 });
  const someone = browser();
  assert.equal((await someone.get("/api/account/admin/users")).status, 401);
  await someone.signUp("someone", "letmein");
  assert.equal((await someone.get("/api/account")).data.user.admin, undefined);
  for (const [method, path] of [["get", "/api/account/admin/users"], ["get", "/api/account/admin/invites"], ["post", "/api/account/admin/invites"], ["post", "/api/account/admin/users/Boss/ban"]]) {
    assert.equal((await someone[method](path)).status, 403, `${method} ${path}`);
  }
});

test("an invite code works as many times as it allows, and is shown only once", options, async () => {
  const made = await boss.post("/api/account/admin/invites", { label: "Period 3", maxUses: 2, expiresInDays: 1 });
  assert.equal(made.status, 201);
  assert.match(made.data.code, /^[2-9A-Z]{5}-[2-9A-Z]{5}$/);
  assert.equal(made.data.invite.state, "active");

  assert.equal((await browser().signUp("first", made.data.code.toLowerCase())).status, 201, "case and dashes don't matter");
  // A failed sign-up (name taken) does not use the code up.
  assert.equal((await browser().signUp("first", made.data.code)).status, 409);
  assert.equal((await browser().signUp("second", made.data.code)).status, 201);
  const third = await browser().signUp("third", made.data.code);
  assert.equal(third.status, 403);
  assert.match(third.data.error, /used up/);

  const { invites } = (await boss.get("/api/account/admin/invites")).data;
  const listed = invites.find((invite) => invite.id === made.data.invite.id);
  assert.deepEqual({ uses: listed.uses, state: listed.state, hint: listed.hint }, { uses: 2, state: "used up", hint: made.data.code.slice(-4) });
  assert.ok(!JSON.stringify(invites).includes(made.data.code), "the list never contains a full code");

  const people = (await boss.get("/api/account/admin/users?q=first")).data.users;
  assert.deepEqual(people.map((p) => [p.username, p.invite]), [["first", "Period 3"]]);
});

test("invite codes can be revoked, and expire", options, async () => {
  const revoked = (await boss.post("/api/account/admin/invites", { maxUses: 5, expiresInDays: 7 })).data;
  assert.equal((await boss.post(`/api/account/admin/invites/${revoked.invite.id}/revoke`)).status, 200);
  assert.equal((await browser().signUp("late1", revoked.code)).status, 403);

  const brief = (await boss.post("/api/account/admin/invites", { maxUses: 5, expiresInDays: 0.00001 })).data; // under a second
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal((await browser().signUp("late2", brief.code)).status, 403);
  const state = (await boss.get("/api/account/admin/invites")).data.invites.find((invite) => invite.id === brief.invite.id).state;
  assert.equal(state, "expired");
});

test("invite settings are checked", options, async () => {
  for (const body of [{ maxUses: 0 }, { maxUses: 1001 }, { maxUses: 1.5 }, { expiresInDays: -1 }, { expiresInDays: 366 }, { maxUses: "lots" }]) {
    assert.equal((await boss.post("/api/account/admin/invites", { maxUses: 1, expiresInDays: 1, ...body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await boss.post("/api/account/admin/invites/99999/revoke")).status, 404);
  assert.equal((await browser().signUp("nocode")).status, 403, "sign-up without any code is refused");
});

test("a ban signs someone out everywhere, closes their proxy connection, and keeps them out", options, async () => {
  const kid = browser();
  await kid.signUp("kid", "letmein");
  const phone = browser();
  await phone.signIn("kid");
  const wisp = await openWisp(kid.cookie);

  const banned = await boss.post("/api/account/admin/users/kid/ban", { reason: "sharing the site" });
  assert.equal(banned.status, 200);
  assert.equal(await within(wisp.closed, 2000), true, "the open proxy connection was cut at once");
  assert.equal((await kid.get("/api/account")).data.user, null);
  assert.equal((await phone.get("/api/account")).data.user, null, "on every device");
  assert.equal((await kid.get("/")).status, 401);

  const again = await kid.signIn("kid");
  assert.equal(again.status, 403);
  assert.equal(again.data.error, "This account has been suspended. Reason: sharing the site");
  const wrongPassword = await kid.post("/api/account/login", { username: "kid", password: "not-the-password" });
  assert.equal(wrongPassword.status, 401, "a wrong password doesn't reveal the ban");

  const list = (await boss.get("/api/account/admin/users?q=kid")).data.users;
  assert.deepEqual([list[0].banned, list[0].banReason], [true, "sharing the site"]);

  assert.equal((await boss.post("/api/account/admin/users/kid/unban")).status, 200);
  assert.equal((await kid.signIn("kid")).status, 200);
  assert.equal((await kid.get("/")).status, 200);
});

test("admins can't be banned, not even by each other", options, async () => {
  assert.equal((await boss.post("/api/account/admin/users/Boss/ban")).status, 400);
  const chief = browser();
  await chief.signUp("chief", "letmein");
  assert.equal((await boss.post("/api/account/admin/users/chief/ban")).status, 403);
  assert.equal((await boss.post("/api/account/admin/users/nobody-here/ban")).status, 404);
});

test("the command line makes invite codes and bans while the server runs", options, async () => {
  const run = (...args) => promisify(execFile)(process.execPath, [join(root, "scripts/admin.js"), ...args], { env: { ...process.env, DATA_DIR: dataDir, ADMINS: "boss,chief" } });
  const { stdout } = await run("invite", "--uses", "1", "--label", "From the CLI");
  const code = stdout.trim();
  assert.match(code, /^[2-9A-Z]{5}-[2-9A-Z]{5}$/);
  const cli = browser();
  assert.equal((await cli.signUp("viacli", code)).status, 201);
  assert.match((await run("users", "viacli")).stdout, /viacli\s.*From the CLI/);

  await run("ban", "viacli", "spam");
  assert.equal((await cli.get("/api/account")).data.user, null, "the session ends straight away");
  assert.equal((await cli.signIn("viacli")).data.error, "This account has been suspended. Reason: spam");
  await assert.rejects(run("ban", "Boss"), /Admins can't be banned/);
  await run("unban", "viacli");
  assert.equal((await cli.signIn("viacli")).status, 200);
});

test("a database from before invite codes and bans is upgraded in place", options, async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { openDatabase } = await import("../src/accountsdb.js");
  const dir = mkdtempSync(join(tmpdir(), "sn-migrate-"));
  try {
    // The first version's schema, with one account in it.
    const old = new DatabaseSync(join(dir, "accounts.db"));
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
        recovery_hash TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}', revision INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      INSERT INTO users (username, password_hash, recovery_hash, settings, created_at, updated_at) VALUES ('early', 'x', 'y', '{"colId":"2"}', 1, 1);
      PRAGMA user_version = 1;
    `);
    old.close();

    const db = await openDatabase(dir);
    assert.equal(db.prepare("PRAGMA user_version").get().user_version, 10);
    const columns = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
    for (const name of ["banned_at", "ban_reason", "last_seen_at", "invite_id", "is_admin", "avatar_version"]) assert.ok(columns.includes(name), name);
    for (const table of ["invites", "site_settings", "avatars", "chat_messages", "chat_media", "chat_sanctions", "chat_settings", "chat_log", "admin_log", "admin_settings", "store_apps", "store_icons", "store_installs", "store_reports", "friendships", "user_status", "roles", "user_roles", "chat_reads"]) assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(table), table);
    assert.equal(db.prepare("SELECT settings FROM users WHERE username = 'early'").get().settings, '{"colId":"2"}', "data kept");
    db.close();
    // Opening again is a no-op.
    (await openDatabase(dir)).close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the last admin can't be removed just because ADMINS names someone without an account", options, async () => {
  const { openDatabase, setAdmin } = await import("../src/accountsdb.js");
  const dir = mkdtempSync(join(tmpdir(), "sn-lastadmin-"));
  try {
    const db = await openDatabase(dir);
    db.prepare("INSERT INTO users (username, password_hash, recovery_hash, created_at, updated_at, is_admin) VALUES ('only', 'x', 'y', 1, 1, 1)").run();
    assert.throws(() => setAdmin(db, "only", false, { serverAdmins: new Set(["ghost"]) }), /only admin/);
    db.prepare("INSERT INTO users (username, password_hash, recovery_hash, created_at, updated_at) VALUES ('Ghost', 'x', 'y', 1, 1)").run();
    setAdmin(db, "only", false, { serverAdmins: new Set(["ghost"]) }); // now ADMINS has a real account
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
