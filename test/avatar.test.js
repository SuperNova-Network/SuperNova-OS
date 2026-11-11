import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { samples } from "./images.js";

// Profile pictures.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-avatar-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", DATA_DIR: dataDir, TRUST_PROXY: "1" });
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let clients = 0, names = 0;
function client() {
  let cookie = "";
  const ip = `203.0.113.${++clients}`;
  async function call(method, path, body, raw = false) {
    const res = await fetch(server.url + "/api/account" + path, {
      method,
      headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    if (raw) return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  return { get: (path) => call("GET", path), raw: (path) => call("GET", path, undefined, true), post: (path, body = {}) => call("POST", path, body) };
}

async function signedIn() {
  const c = client();
  const username = `pic${++names}`;
  const result = await c.post("/register", { username, password: "password123" });
  assert.equal(result.status, 201);
  return { c, username };
}

const png = samples.png;

test("a new account has no picture; setting one gives a version and serves the bytes", options, async () => {
  const { c, username } = await signedIn();
  assert.equal((await c.get("/")).data.user.avatar, 0);
  const set = await c.post("/avatar", { mime: png[1], data: png[0] });
  assert.equal(set.status, 200);
  assert.ok(set.data.avatar > 0);
  assert.equal((await c.get("/")).data.user.avatar, set.data.avatar, "the account state carries the version");

  const got = await c.raw(`/avatar/${username}?v=${set.data.avatar}`);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.match(got.headers.get("content-security-policy"), /sandbox/);
  assert.match(got.headers.get("cache-control"), /immutable/);
  assert.deepEqual(got.bytes, Buffer.from(png[0], "base64"));
});

test("another signed-in person can see a picture; someone signed out cannot", options, async () => {
  const { c, username } = await signedIn();
  await c.post("/avatar", { mime: png[1], data: png[0] });
  const { c: other } = await signedIn();
  assert.equal((await other.raw(`/avatar/${username}`)).status, 200);
  assert.equal((await client().raw(`/avatar/${username}`)).status, 401);
  assert.equal((await other.raw("/avatar/nobody-here")).status, 404);
});

test("a new picture gets a new version, and removing it clears it", options, async () => {
  const { c, username } = await signedIn();
  const first = (await c.post("/avatar", { mime: png[1], data: png[0] })).data.avatar;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const jpeg = samples.jpeg;
  const second = (await c.post("/avatar", { mime: jpeg[1], data: jpeg[0] })).data.avatar;
  assert.ok(second > first);
  assert.equal((await c.raw(`/avatar/${username}`)).headers.get("content-type"), "image/jpeg");
  assert.equal((await c.post("/avatar/remove")).data.avatar, 0);
  assert.equal((await c.raw(`/avatar/${username}`)).status, 404);
  assert.equal((await c.get("/")).data.user.avatar, 0);
});

test("only real PNG, JPEG and WebP pictures are accepted", options, async () => {
  const { c } = await signedIn();
  const post = (mime, bytes) => c.post("/avatar", { mime, data: Buffer.from(bytes).toString("base64") });
  assert.equal((await post("image/png", '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')).status, 400, "SVG");
  assert.equal((await post("image/png", "<html><script>alert(1)</script></html>")).status, 400, "HTML");
  assert.equal((await c.post("/avatar", { mime: samples.gif[1], data: samples.gif[0] })).status, 400, "GIF is not allowed as a picture");
  assert.equal((await c.post("/avatar", { mime: "image/jpeg", data: png[0] })).status, 400, "the claimed type must match the bytes");
  assert.equal((await c.post("/avatar", { data: "not base64!!" })).status, 400);
  assert.equal((await c.post("/avatar", {})).status, 400);
  assert.equal((await c.post("/avatar", { mime: samples["lossy webp"][1], data: samples["lossy webp"][0] })).status, 200, "WebP is fine");
});

test("pictures that are too big in bytes or pixels are refused", options, async () => {
  const { c } = await signedIn();
  const wide = Buffer.from(png[0], "base64");
  wide.writeUInt32BE(30000, 16);
  wide.writeUInt32BE(30000, 20);
  assert.equal((await c.post("/avatar", { data: wide.toString("base64") })).status, 400, "a tiny file that decodes to a huge picture");
  const heavy = Buffer.concat([Buffer.from(png[0], "base64"), Buffer.alloc(130 * 1024)]);
  assert.equal((await c.post("/avatar", { data: heavy.toString("base64") })).status, 413);
});

test("you must be signed in to set or remove a picture, and changes are rate limited per person", options, async () => {
  assert.equal((await client().post("/avatar", { mime: png[1], data: png[0] })).status, 401);
  assert.equal((await client().post("/avatar/remove")).status, 401);
  const { c } = await signedIn();
  let last;
  for (let i = 0; i < 11; i++) last = await c.post("/avatar", { mime: png[1], data: png[0] });
  assert.equal(last.status, 429);
});

test("deleting the account deletes the picture", options, async () => {
  const { c, username } = await signedIn();
  await c.post("/avatar", { mime: png[1], data: png[0] });
  const { c: watcher } = await signedIn();
  assert.equal((await c.post("/delete", { password: "password123" })).status, 200);
  assert.equal((await watcher.raw(`/avatar/${username}`)).status, 404);
});
