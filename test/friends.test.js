import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";

// Friends, online status and blocking.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-friends-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", DATA_DIR: dataDir, TRUST_PROXY: "1" });
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let clients = 0, names = 0;
function browser() {
  let cookie = "";
  const ip = `100.64.0.${++clients}`;
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
const F = "/api/friends";
const list = async (b) => (await b.get(F)).data;
const befriend = async (a, b) => { await a.post(`${F}/request`, { username: b.username }); await b.post(`${F}/accept`, { username: a.username }); };

test("friends need an account", options, async () => {
  assert.equal((await browser().get(F)).status, 401);
  assert.equal((await browser().post(`${F}/ping`)).status, 401);
  assert.equal((await browser().post(`${F}/request`, { username: "x" })).status, 401);
});

test("ask, accept, and see each other", options, async () => {
  const ann = await person(), ben = await person();
  assert.equal((await ann.post(`${F}/request`, { username: ben.username.toUpperCase() })).status, 201, "names aren't case sensitive");
  assert.deepEqual((await list(ann)).outgoing.map((p) => p.username), [ben.username]);
  assert.deepEqual((await list(ben)).incoming.map((p) => p.username), [ann.username]);
  assert.equal((await ben.post(`${F}/ping`)).data.requests, 1, "the ping says there is a request");
  assert.equal((await ann.post(`${F}/request`, { username: ben.username })).status, 409, "no asking twice");
  assert.equal((await ann.post(`${F}/accept`, { username: ben.username })).status, 404, "you can't accept your own request");
  assert.equal((await ben.post(`${F}/accept`, { username: ann.username })).status, 200);
  assert.deepEqual((await list(ann)).friends.map((p) => p.username), [ben.username]);
  assert.deepEqual((await list(ben)).friends.map((p) => p.username), [ann.username]);
  assert.equal((await list(ben)).incoming.length, 0);
  assert.equal((await ann.post(`${F}/request`, { username: ben.username })).status, 409, "already friends");
});

test("asking someone who already asked you makes you friends", options, async () => {
  const ann = await person(), ben = await person();
  await ann.post(`${F}/request`, { username: ben.username });
  const r = await ben.post(`${F}/request`, { username: ann.username });
  assert.equal(r.data.result, "accepted");
  assert.equal((await list(ann)).friends.length, 1);
});

test("you can't ask yourself, or someone who isn't there", options, async () => {
  const ann = await person();
  assert.equal((await ann.post(`${F}/request`, { username: ann.username })).status, 400);
  assert.equal((await ann.post(`${F}/request`, { username: "nobody-here" })).status, 404);
  assert.equal((await ann.post(`${F}/request`, {})).status, 404);
});

test("declining, cancelling and removing tell nobody and clear the row", options, async () => {
  const ann = await person(), ben = await person(), cy = await person();
  await ann.post(`${F}/request`, { username: ben.username });
  await ben.post(`${F}/decline`, { username: ann.username });
  assert.equal((await list(ann)).outgoing.length, 0);
  await ann.post(`${F}/request`, { username: cy.username });
  await ann.post(`${F}/cancel`, { username: cy.username });
  assert.equal((await list(cy)).incoming.length, 0);
  await befriend(ann, ben);
  await ben.post(`${F}/remove`, { username: ann.username });
  assert.equal((await list(ann)).friends.length, 0);
  assert.equal((await ann.post(`${F}/request`, { username: ben.username })).status, 201, "they can become friends again");
});

test("online status: only friends see it, away and invisible are honoured, and it fades", options, async () => {
  const ann = await person(), ben = await person(), stranger = await person();
  await befriend(ann, ben);
  assert.equal((await list(ann)).friends[0].status, "offline", "no ping yet");
  await ben.post(`${F}/ping`);
  assert.equal((await list(ann)).friends[0].status, "online");
  assert.equal((await ben.post(`${F}/status`, { mode: "away" })).data.mode, "away");
  assert.equal((await list(ann)).friends[0].status, "away");
  await ben.post(`${F}/status`, { mode: "invisible" });
  assert.equal((await list(ann)).friends[0].status, "offline", "invisible looks offline");
  assert.equal((await list(ben)).me.mode, "invisible", "but you know your own mode");
  assert.equal((await ben.post(`${F}/status`, { mode: "busy" })).status, 400);
  assert.equal((await list(stranger)).friends.length, 0, "strangers see nothing");
  await ben.post(`${F}/status`, { mode: "online" });
  assert.equal((await ann.post(`${F}/ping`)).data.online, 1, "the ping counts friends online");
});

test("blocking ends everything, and the blocked person can't ask again or find out", options, async () => {
  const ann = await person(), ben = await person();
  await befriend(ann, ben);
  assert.equal((await ann.post(`${F}/block`, { username: ben.username })).status, 200);
  assert.equal((await list(ann)).friends.length, 0);
  assert.equal((await list(ben)).friends.length, 0);
  assert.deepEqual((await list(ann)).blocked.map((p) => p.username), [ben.username]);
  const asked = await ben.post(`${F}/request`, { username: ann.username });
  assert.equal(asked.status, 404);
  assert.doesNotMatch(asked.data.error, /block/i, "it doesn't say they were blocked");
  assert.equal((await ann.post(`${F}/request`, { username: ben.username })).status, 400, "you can't ask someone you blocked");
  await ann.post(`${F}/unblock`, { username: ben.username });
  assert.equal((await ben.post(`${F}/request`, { username: ann.username })).status, 201);
});

test("a request can't be blocked into limbo: blocking someone who asked clears their request", options, async () => {
  const ann = await person(), ben = await person();
  await ann.post(`${F}/request`, { username: ben.username });
  await ben.post(`${F}/block`, { username: ann.username });
  assert.equal((await list(ben)).incoming.length, 0);
  assert.equal((await list(ann)).outgoing.length, 0);
});

test("deleting an account removes its friendships", options, async () => {
  const ann = await person(), ben = await person();
  await befriend(ann, ben);
  assert.equal((await ben.post("/api/account/delete", { password: "password123" })).status, 200);
  assert.equal((await list(ann)).friends.length, 0);
});
