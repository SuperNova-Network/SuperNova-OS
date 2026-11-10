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

// Site settings in Settings > Admin: no environment variables for accounts at all.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };
const root = fileURLToPath(new URL("../", import.meta.url));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let server, dataDir, owner;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-site-"));
  // AUTH_PASS is set to show that the Basic auth prompt and accounts take turns.
  server = await startServer({ DATA_DIR: dataDir, TRUST_PROXY: "1", AUTH_PASS: "sitepass" });
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let ip = 0;
const basic = { authorization: `Basic ${Buffer.from("admin:sitepass").toString("base64")}` };
function browser({ auth = true } = {}) {
  let cookie = "";
  const address = `203.0.113.${++ip}`;
  async function call(method, path, body, extra = {}) {
    const res = await fetch(server.url + path, {
      method,
      redirect: "manual",
      headers: { "x-forwarded-for": address, accept: "application/json", ...(auth ? basic : {}), ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  }
  return {
    get: (path, extra) => call("GET", path, undefined, extra),
    post: (path, body = {}) => call("POST", path, body),
    get cookie() { return cookie; },
  };
}

function upgrade(headers) {
  return new Promise((resolve) => {
    const req = request(server.url + "/wisp/", {
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers },
    });
    req.once("upgrade", (_res, socket) => {
      socket.resume();
      resolve({ status: 101, closed: new Promise((done) => socket.once("close", () => done(true))) });
    });
    req.once("response", (res) => resolve({ status: res.statusCode }));
    req.end();
  });
}
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => false)]);
const setupCode = () => server.output.match(/with the code\s+([2-9A-Z]{5}-[2-9A-Z]{5})/)?.[1];

test("a fresh site has accounts off and prints a one-time setup link", options, async () => {
  const state = (await browser().get("/api/account")).data;
  assert.equal(state.mode, "off");
  assert.equal(state.setup, true);
  assert.ok(setupCode(), "the code is in the server's log");
  assert.match(server.output, /\/setup/);
  assert.equal((await browser().get("/setup", { accept: "text/html" })).status, 200);
});

test("only the code from the log creates the first admin, and only once", options, async () => {
  const stranger = browser();
  const wrong = await stranger.post("/api/account/setup", { code: "AAAAA-BBBBB", username: "intruder", password: "password123" });
  assert.equal(wrong.status, 403);

  owner = browser();
  const made = await owner.post("/api/account/setup", { code: setupCode().toLowerCase(), username: "owner", password: "password123" });
  assert.equal(made.status, 201);
  assert.deepEqual(made.data.user, { username: "owner", admin: true });
  assert.ok(made.data.recoveryCode);

  assert.equal((await browser().post("/api/account/setup", { code: setupCode(), username: "second", password: "password123" })).status, 409, "only once");
  assert.equal((await browser().get("/api/account")).data.setup, false);
  assert.equal((await browser().get("/setup", { accept: "text/html" })).status, 303, "the setup page is gone");
});

test("with accounts off, the admin is signed in and sees the site settings", options, async () => {
  const state = (await owner.get("/api/account")).data;
  assert.equal(state.mode, "off");
  assert.deepEqual(state.user, { username: "owner", admin: true });
  assert.deepEqual((await owner.get("/api/account/admin/site")).data, { mode: "off", signup: "invite", locked: { mode: false, signup: false } });
  assert.equal((await browser().post("/api/account/register", { username: "early", password: "password123" })).status, 403, "nobody else can sign up yet");
});

test("turning accounts on lets people sign up, live", options, async () => {
  const changed = await owner.post("/api/account/admin/site", { mode: "optional", signup: "open" });
  assert.deepEqual(changed.data, { mode: "optional", signup: "open", locked: { mode: false, signup: false } });
  const person = browser();
  assert.equal((await person.post("/api/account/register", { username: "pat", password: "password123" })).status, 201);
  assert.equal((await person.get("/api/account")).data.user.username, "pat");
  assert.equal((await browser().get("/", { accept: "text/html" })).status, 200, "the site itself stays open");
  assert.equal((await person.get("/api/account/admin/site")).status, 403, "only admins change it");
  assert.equal((await owner.post("/api/account/admin/site", { mode: "sometimes" })).status, 400);
});

test("requiring sign-in replaces the Basic auth prompt and closes anonymous proxy connections", options, async () => {
  // Before: Basic auth guards the site and the proxy.
  assert.equal((await browser({ auth: false }).get("/", { accept: "text/html" })).status, 401);
  const anonymous = await upgrade(basic);
  assert.equal(anonymous.status, 101);
  const pat = browser();
  await pat.post("/api/account/login", { username: "pat", password: "password123" });
  const signedIn = await upgrade({ cookie: pat.cookie, ...basic }); // the site password still applies here
  assert.equal(signedIn.status, 101);

  await owner.post("/api/account/admin/site", { mode: "required", signup: "invite" });
  assert.equal(await within(anonymous.closed, 2000), true, "the anonymous connection is closed at once");
  assert.equal(await within(signedIn.closed, 500), false, "the signed-in one stays");

  const visitor = await browser({ auth: false }).get("/", { accept: "text/html" });
  assert.equal(visitor.status, 303, "visitors get the sign-in screen, not a Basic auth prompt");
  assert.equal(visitor.headers.get("www-authenticate"), null);
  assert.equal((await upgrade(basic)).status, 401, "the old site password no longer opens the proxy");
  assert.equal((await pat.get("/", { accept: "text/html" })).status, 200);

  // And back: Basic auth returns.
  await owner.post("/api/account/admin/site", { mode: "optional" });
  assert.equal((await browser({ auth: false }).get("/", { accept: "text/html" })).status, 401);
});

test("with accounts off again, only admins stay signed in", options, async () => {
  const pat = browser();
  await pat.post("/api/account/login", { username: "pat", password: "password123" });
  await owner.post("/api/account/admin/site", { mode: "off" });
  assert.equal((await pat.get("/api/account")).data.user, null);
  const again = await browser().post("/api/account/login", { username: "pat", password: "password123" });
  assert.equal(again.status, 403);
  assert.equal(again.data.error, "Accounts are turned off on this site.");
  assert.equal((await owner.get("/api/account")).data.user.username, "owner");
  await owner.post("/api/account/admin/site", { mode: "optional" });
  assert.equal((await pat.get("/api/account")).data.user.username, "pat", "and come back when it is on again");
});

test("admins make other admins, and the last one can't be removed", options, async () => {
  assert.equal((await owner.post("/api/account/admin/users/owner/unadmin")).status, 400, "the only admin");
  assert.equal((await owner.post("/api/account/admin/users/pat/admin")).status, 200);
  const pat = browser();
  await pat.post("/api/account/login", { username: "pat", password: "password123" });
  assert.deepEqual((await pat.get("/api/account")).data.user, { username: "pat", admin: true });
  assert.equal((await pat.get("/api/account/admin/site")).status, 200);
  const people = (await owner.get("/api/account/admin/users")).data.users;
  assert.deepEqual(people.filter((p) => p.admin).map((p) => p.username).sort(), ["owner", "pat"]);
  assert.equal((await owner.post("/api/account/admin/users/pat/ban")).status, 403, "admins can't be banned");
  assert.equal((await owner.post("/api/account/admin/users/pat/unadmin")).status, 200);
  assert.equal((await pat.get("/api/account/admin/site")).status, 403);
});

test("the command line changes a running server's settings", options, async () => {
  const run = (...args) => promisify(execFile)(process.execPath, [join(root, "scripts/admin.js"), ...args], { env: { ...process.env, DATA_DIR: dataDir, ACCOUNTS: "", ACCOUNTS_SIGNUP: "", ADMINS: "" } });
  await run("accounts", "required");
  await sleep(5500); // the server re-reads site settings every few seconds
  assert.equal((await browser({ auth: false }).get("/", { accept: "text/html" })).status, 303);
  await run("make-admin", "pat");
  assert.match((await run("status")).stdout, /accounts: required[\s\S]*admins:\s+.*pat/);
  await assert.rejects(run("accounts", "maybe"), /mode must be one of/);
  await run("accounts", "optional");
});

test("settings fixed on the server are shown locked and can't be changed", options, async () => {
  const fixedDir = mkdtempSync(join(tmpdir(), "sn-fixed-"));
  const fixed = await startServer({ DATA_DIR: fixedDir, ACCOUNTS: "required", ADMINS: "boss", INVITE_CODE: "letmein" });
  try {
    const post = (path, body, cookie) => fetch(fixed.url + path, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
    const made = await post("/api/account/register", { username: "boss", password: "password123", inviteCode: "letmein" });
    const cookie = made.headers.get("set-cookie").split(";")[0];
    const site = await (await fetch(fixed.url + "/api/account/admin/site", { headers: { cookie } })).json();
    assert.deepEqual(site, { mode: "required", signup: "invite", locked: { mode: true, signup: false } });
    const change = await post("/api/account/admin/site", { mode: "off" }, cookie);
    assert.equal(change.status, 409);
    assert.match((await change.json()).error, /ACCOUNTS is set on the server/);
    assert.equal((await post("/api/account/admin/site", { signup: "closed" }, cookie)).status, 200, "what isn't fixed can still change");
    // The setup link was printed (nobody could manage the site yet), but closes as soon
    // as an ADMINS user exists.
    const state = await (await fetch(fixed.url + "/api/account")).json();
    assert.equal(state.setup, false);
    assert.equal((await fetch(fixed.url + "/setup", { redirect: "manual" })).status, 303);
  } finally {
    await fixed.stop();
    rmSync(fixedDir, { recursive: true, force: true });
  }
});
