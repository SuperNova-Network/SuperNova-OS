import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";

// node:sqlite arrived in Node 22.13; on older versions accounts cannot be turned on.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-accounts-"));
  // Behind a (pretend) proxy, so each test client can have its own address and the
  // per-address rate limits stay out of the way of tests that are not about them.
  server = await startServer({ ACCOUNTS: "1", DATA_DIR: dataDir, TRUST_PROXY: "1" });
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let clients = 0;

/** A browser: remembers its session cookie between requests, and has its own address. */
function client(ip = `198.51.100.${++clients}`) {
  let cookie = "";
  async function call(method, path, body, headers = {}) {
    const res = await fetch(server.url + "/api/account" + path, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        "x-forwarded-for": ip,
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) {
      const [pair] = set.split(";");
      cookie = pair.endsWith("=") ? "" : pair;
    }
    const data = await res.json().catch(() => null);
    return { status: res.status, data, setCookie: set };
  }
  return {
    get: (path, headers) => call("GET", path, undefined, headers),
    post: (path, body, headers) => call("POST", path, body ?? {}, headers),
    patch: (path, body) => call("PATCH", path, body),
    get cookie() { return cookie; },
  };
}

let n = 0;
const unique = (base) => `${base}${++n}`;

test("accounts are off by default and say so", options, async () => {
  const plain = await startServer();
  try {
    const state = await (await fetch(plain.url + "/api/account")).json();
    assert.equal(state.mode, "off");
    assert.equal(state.enabled, false);
    assert.equal(state.signup, false);
    const register = await fetch(plain.url + "/api/account/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "someone", password: "password123" }) });
    assert.equal(register.status, 403);
  } finally {
    await plain.stop();
  }
});

test("sign up, get a recovery code and a secure session cookie", options, async () => {
  const browser = client();
  assert.deepEqual((await browser.get("/")).data, { mode: "optional", enabled: true, required: false, signup: true, invite: false, setup: true, user: null });
  const res = await browser.post("/register", { username: unique("Ada"), password: "correct horse" });
  assert.equal(res.status, 201);
  assert.match(res.data.recoveryCode, /^[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/);
  assert.match(res.setCookie, /HttpOnly/i);
  assert.match(res.setCookie, /SameSite=Strict/i);
  assert.equal((await browser.get("/")).data.user.username, `Ada${n}`);
  assert.ok(existsSync(join(dataDir, "accounts.db")));
});

test("usernames and passwords are checked", async (t) => {
  if (!hasSqlite) return t.skip();
  const browser = client();
  assert.equal((await browser.post("/register", { username: "x", password: "long enough" })).status, 400);
  assert.equal((await browser.post("/register", { username: "has space", password: "long enough" })).status, 400);
  assert.equal((await browser.post("/register", { username: unique("short"), password: "short" })).status, 400);
  const name = unique("Taken");
  assert.equal((await browser.post("/register", { username: name, password: "long enough" })).status, 201);
  assert.equal((await client().post("/register", { username: name.toLowerCase(), password: "long enough" })).status, 409, "names are case-insensitive");
});

test("sign in and out; wrong passwords and unknown names get the same answer", options, async () => {
  const name = unique("Grace");
  await client().post("/register", { username: name, password: "hunter2hunter2" });
  const browser = client();
  const wrong = await browser.post("/login", { username: name, password: "nope-nope" });
  const unknown = await browser.post("/login", { username: unique("nobody"), password: "nope-nope" });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.equal(wrong.data.error, unknown.data.error);
  assert.equal((await browser.post("/login", { username: name.toUpperCase(), password: "hunter2hunter2" })).status, 200);
  assert.equal((await browser.get("/")).data.user.username, name);
  const old = browser.cookie;
  await browser.post("/logout");
  assert.equal((await browser.get("/")).data.user, null);
  // The old token no longer works even if someone kept it.
  const replay = await fetch(server.url + "/api/account", { headers: { cookie: old } });
  assert.equal((await replay.json()).user, null);
});

test("settings are stored per account and merged key by key", options, async () => {
  const laptop = client();
  const name = unique("Lin");
  await laptop.post("/register", { username: name, password: "password123" });
  assert.deepEqual((await laptop.get("/settings")).data, { settings: {}, revision: 0 });
  assert.equal((await laptop.patch("/settings", { set: { colId: "2", backId: "5", cloak: "canvas" } })).data.revision, 1);

  const phone = client();
  await phone.post("/login", { username: name, password: "password123" });
  await phone.patch("/settings", { set: { colId: "3" }, remove: ["cloak"] });
  assert.deepEqual((await laptop.get("/settings")).data, { settings: { colId: "3", backId: "5" }, revision: 2 });

  // Another account sees none of it.
  const other = client();
  await other.post("/register", { username: unique("Other"), password: "password123" });
  assert.deepEqual((await other.get("/settings")).data.settings, {});
});

test("settings changes are validated, and history never reaches the server", options, async () => {
  const browser = client();
  await browser.post("/register", { username: unique("Val"), password: "password123" });
  assert.equal((await browser.patch("/settings", { set: { colId: 5 } })).status, 400);
  assert.equal((await browser.patch("/settings", { set: "nope" })).status, 400);
  assert.equal((await browser.patch("/settings", { set: { big: "a".repeat(200_001) } })).status, 400);
  await browser.patch("/settings", { set: { history: '["secret"]', "visited-before": "true", "bad key": "x", __proto__x: "y", ok: "1" } });
  assert.deepEqual((await browser.get("/settings")).data.settings, { ok: "1" });
  const tooBig = Object.fromEntries(Array.from({ length: 4 }, (_, i) => [`k${i}`, "a".repeat(150_000)]));
  assert.equal((await browser.patch("/settings", { set: tooBig })).status, 413);
});

test("signed-out requests and cross-site requests are refused", options, async () => {
  const browser = client();
  assert.equal((await browser.get("/settings")).status, 401);
  assert.equal((await browser.patch("/settings", { set: { a: "1" } })).status, 401);
  await browser.post("/register", { username: unique("Csrf"), password: "password123" });
  const evil = await browser.post("/logout", {}, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  const form = await fetch(server.url + "/api/account/logout", { method: "POST", headers: { cookie: browser.cookie, "content-type": "application/x-www-form-urlencoded" }, body: "a=1" });
  assert.equal(form.status, 415);
  assert.ok((await browser.get("/")).data.user, "still signed in");
});

test("the recovery code resets the password once, and signs out other browsers", options, async () => {
  const name = unique("Rec");
  const first = client();
  const { data } = await first.post("/register", { username: name, password: "forgotten1" });
  const second = client();
  const recovered = await second.post("/recover", { username: name, recoveryCode: data.recoveryCode.toLowerCase().replace(/-/g, " "), newPassword: "remembered1" });
  assert.equal(recovered.status, 200);
  assert.notEqual(recovered.data.recoveryCode, data.recoveryCode, "a new code replaces the used one");
  assert.equal((await first.get("/")).data.user, null, "other sessions end");
  assert.equal((await client().post("/login", { username: name, password: "remembered1" })).status, 200);
  assert.equal((await client().post("/recover", { username: name, recoveryCode: data.recoveryCode, newPassword: "again12345" })).status, 401, "the old code is spent");
});

test("changing the password needs the current one and ends other sessions", options, async () => {
  const name = unique("Pw");
  const here = client();
  await here.post("/register", { username: name, password: "old-password" });
  const elsewhere = client();
  await elsewhere.post("/login", { username: name, password: "old-password" });
  assert.equal((await here.post("/password", { currentPassword: "wrong-one", newPassword: "new-password" })).status, 401);
  assert.equal((await here.post("/password", { currentPassword: "old-password", newPassword: "new-password" })).status, 200);
  assert.ok((await here.get("/")).data.user, "this browser stays signed in");
  assert.equal((await elsewhere.get("/")).data.user, null);
});

test("deleting the account needs the password and removes everything", options, async () => {
  const name = unique("Del");
  const browser = client();
  await browser.post("/register", { username: name, password: "delete-me-1" });
  await browser.patch("/settings", { set: { colId: "1" } });
  assert.equal((await browser.post("/delete", { password: "wrong-pass" })).status, 401);
  assert.equal((await browser.post("/delete", { password: "delete-me-1" })).status, 200);
  assert.equal((await browser.get("/")).data.user, null);
  assert.equal((await client().post("/login", { username: name, password: "delete-me-1" })).status, 401);
  assert.equal((await client().post("/register", { username: name, password: "delete-me-1" })).status, 201, "the name is free again");
});

test("password guessing is rate limited", options, async () => {
  const name = unique("Brute");
  await client().post("/register", { username: name, password: "the-real-one" });
  const attacker = client();
  const statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await attacker.post("/login", { username: name, password: `guess-${i}` })).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.equal(statuses[10], 429);
});

test("one address can only create a few accounts an hour", options, async () => {
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await client("203.0.113.9").post("/register", { username: unique("Spam"), password: "password123" })).status);
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
  assert.equal((await client("203.0.113.10").post("/register", { username: unique("Fine"), password: "password123" })).status, 201, "other addresses are unaffected");
});

test("sign-up can be closed while sign-in keeps working", options, async () => {
  const closed = await startServer({ ACCOUNTS: "1", ACCOUNTS_SIGNUP: "0", DATA_DIR: dataDir });
  try {
    const status = await (await fetch(closed.url + "/api/account")).json();
    assert.equal(status.signup, false);
    const res = await fetch(closed.url + "/api/account/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: unique("Late"), password: "password123" }) });
    assert.equal(res.status, 403);
    const login = await fetch(closed.url + "/api/account/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "Ada1", password: "correct horse" }) });
    assert.equal(login.status, 200, "accounts from before still sign in");
  } finally {
    await closed.stop();
  }
});
