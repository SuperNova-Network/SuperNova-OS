import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";

// ACCOUNTS=required: the account sign-in screen replaces HTTP Basic auth.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-signin-"));
  // AUTH_PASS, the old site password, becomes the invite code.
  server = await startServer({ ACCOUNTS: "required", AUTH_PASS: "letmein", DATA_DIR: dataDir, TRUST_PROXY: "1" });
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let ip = 0;
const page = (path, headers = {}) => fetch(server.url + path, { redirect: "manual", headers: { accept: "text/html", ...headers } });
const json = (path, body, headers = {}) => fetch(server.url + path, {
  method: "POST",
  headers: { "content-type": "application/json", "x-forwarded-for": `192.0.2.${++ip}`, ...headers },
  body: JSON.stringify(body),
});

async function signUp(username) {
  const res = await json("/api/account/register", { username, password: "password123", inviteCode: "letmein" });
  assert.equal(res.status, 201);
  return res.headers.get("set-cookie").split(";")[0];
}

function upgrade(headers) {
  return new Promise((resolve) => {
    const req = request(server.url + "/wisp/", {
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers },
    });
    req.once("upgrade", (res, socket) => { socket.destroy(); resolve({ status: res.statusCode }); });
    req.once("response", (res) => resolve({ status: res.statusCode, challenge: res.headers["www-authenticate"] }));
    req.once("error", () => resolve({ status: "closed" }));
    req.end();
  });
}

test("visitors are sent to the sign-in screen instead of a Basic auth prompt", options, async () => {
  const res = await page("/apps/settings.html");
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/signin?next=%2Fapps%2Fsettings.html");
  assert.equal(res.headers.get("www-authenticate"), null);
  const signin = await page("/signin");
  assert.equal(signin.status, 200);
  assert.match(await signin.text(), /id="form-login"/);
});

test("the sign-in screen's own files and the health check stay open", options, async () => {
  for (const path of ["/signin.css", "/signin.js", "/proxy/account.js", "/proxy/store.js", "/resources/css/tokens.css", "/resources/media/wallpapers/space.jpg", "/healthz", "/api/info"]) {
    assert.equal((await page(path)).status, 200, path);
  }
});

test("everything else needs an account: pages, APIs and the proxy itself", options, async () => {
  assert.equal((await page("/")).status, 303);
  assert.equal((await json("/api/verdict", { host: "example.com" })).status, 401);
  assert.equal((await page("/sw.js", { accept: "*/*" })).status, 401);
  const wisp = await upgrade({});
  assert.equal(wisp.status, 401);
  assert.equal(wisp.challenge, undefined, "no Basic auth challenge any more");
});

test("the status says sign-in is required and sign-up needs an invite code", options, async () => {
  const state = await (await page("/api/account")).json();
  assert.deepEqual(state, { mode: "required", enabled: true, required: true, signup: true, invite: true, setup: true, user: null });
});

test("creating an account needs the invite code", options, async () => {
  assert.equal((await json("/api/account/register", { username: "noinvite", password: "password123" })).status, 403);
  assert.equal((await json("/api/account/register", { username: "badinvite", password: "password123", inviteCode: "guess" })).status, 403);
  await signUp("invited");
});

test("signed in, the desktop, the APIs and the proxy open", options, async () => {
  const cookie = await signUp("member");
  assert.equal((await page("/", { cookie })).status, 200);
  assert.equal((await json("/api/verdict", { host: "example.com" }, { cookie })).status, 200);
  assert.equal((await upgrade({ cookie })).status, 101);
});

test("a signed-in visitor to /signin goes where they were headed, never off-site", options, async () => {
  const cookie = await signUp("returning");
  assert.equal((await page("/signin?next=%2Fapps%2Fbrowser.html", { cookie })).headers.get("location"), "/apps/browser.html");
  assert.equal((await page("/signin?next=%2F%2Fevil.example", { cookie })).headers.get("location"), "/");
  assert.equal((await page("/signin?next=https%3A%2F%2Fevil.example", { cookie })).headers.get("location"), "/");
});

test("signing out locks the site again", options, async () => {
  const cookie = await signUp("leaving");
  assert.equal((await page("/", { cookie })).status, 200);
  await json("/api/account/logout", {}, { cookie });
  assert.equal((await page("/", { cookie })).status, 303);
  assert.equal((await upgrade({ cookie })).status, 401);
});

test("INVITE_CODE takes precedence over AUTH_PASS, and optional accounts can use it too", options, async () => {
  const other = await startServer({ ACCOUNTS: "1", INVITE_CODE: "class-of-2026", AUTH_PASS: "", DATA_DIR: dataDir });
  try {
    const state = await (await fetch(other.url + "/api/account")).json();
    assert.equal(state.required, false);
    assert.equal(state.invite, true);
    assert.equal((await fetch(other.url + "/")).status, 200, "optional accounts do not lock the site");
    const register = (inviteCode) => fetch(other.url + "/api/account/register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: `opt${inviteCode.length}`, password: "password123", inviteCode }) });
    assert.equal((await register("nope")).status, 403);
    assert.equal((await register("class-of-2026")).status, 201);
  } finally {
    await other.stop();
  }
});
