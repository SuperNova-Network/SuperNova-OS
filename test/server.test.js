import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { startServer } from "./helpers.js";

let server;
before(async () => { server = await startServer({ BLOCKED_HOSTS: "blocked.example" }); });
after(async () => { await server.stop(); });

const get = (path, headers = {}) => fetch(server.url + path, { headers, redirect: "manual" });
const verdict = (body) => fetch(server.url + "/api/verdict", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

test("the desktop is served without any login by default", async () => {
  const res = await get("/");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<title>Home<\/title>/);
});

test("unknown paths get the 404 page with a 404 status", async () => {
  const res = await get("/definitely/not/here");
  assert.equal(res.status, 404);
});

test("client config is generated from config.js", async () => {
  const sn = await (await get("/proxy/config.js")).text();
  assert.match(sn, /"uv":"\/service\/"/);
  assert.match(sn, /"scramjet":"\/scram\/"/);
  const uv = await (await get("/proxy/uv.config.js")).text();
  assert.match(uv, /prefix: "\/service\/"/);
  const sj = await (await get("/proxy/scramjet.config.js")).text();
  assert.match(sj, /prefix: "\/scram\/"/);
});

test("proxy engine assets come from node_modules", async () => {
  for (const path of ["/assets/uv/uv.bundle.js", "/assets/scramjet/scramjet.all.js", "/assets/scramjet/scramjet.wasm.wasm", "/baremux/index.mjs", "/baremux/worker.js", "/epoxy/index.mjs", "/libcurl/index.mjs"]) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    await res.arrayBuffer();
  }
  assert.equal((await get("/assets/scramjet/scramjet.wasm.wasm")).headers.get("content-type"), "application/wasm");
});

test("the service worker is never cached and may control the whole origin", async () => {
  const res = await get("/sw.js");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-cache");
  assert.equal(res.headers.get("service-worker-allowed"), "/");
});

test("a navigation under a proxy prefix gets the boot page, not a 404", async () => {
  for (const prefix of ["/service/", "/scram/"]) {
    const res = await get(`${prefix}anything`, { "sec-fetch-dest": "document" });
    assert.equal(res.status, 200, prefix);
    assert.match(await res.text(), /Starting proxy/);
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
});

test("subresources under a proxy prefix are 404, so HTML is never served as a script", async () => {
  const res = await get("/service/anything", { "sec-fetch-dest": "script" });
  assert.equal(res.status, 404);
});

test("old /supernova/ links redirect to the new prefix", async () => {
  const res = await get("/supernova/abc%2Fdef?x=1");
  assert.equal(res.status, 308);
  assert.equal(res.headers.get("location"), "/service/abc%2Fdef?x=1");
});

test("verdicts: listed, operator-added and innocent hosts", async () => {
  assert.deepEqual(await verdict({ host: "www.pornhub.com" }), { blocked: true, reason: "host" });
  assert.deepEqual(await verdict({ host: "blocked.example" }), { blocked: true, reason: "host" });
  assert.deepEqual(await verdict({ host: "essex.ac.uk" }), { blocked: false, reason: null });
});

test("verdicts: searches", async () => {
  assert.equal((await verdict({ host: "search.brave.com", query: "free porn" })).blocked, true);
  assert.equal((await verdict({ host: "search.brave.com", query: "sex education" })).blocked, false);
});

test("malformed verdict requests are rejected cleanly, not with a server error", async () => {
  const res = await fetch(server.url + "/api/verdict", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: "Bad request" });
  assert.equal((await verdict({ host: 42, query: ["x"] })).blocked, false);
});

test("the Wisp endpoint upgrades WebSocket connections and nothing else does", async () => {
  const upgrade = (path) => new Promise((resolve) => {
    const req = request(server.url + path, {
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==" },
    });
    req.once("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.once("response", (res) => resolve(res.statusCode));
    req.once("error", () => resolve("closed"));
    req.end();
  });
  assert.equal(await upgrade("/wisp/"), 101);
  assert.equal(await upgrade("/not-wisp/"), "closed");
});
