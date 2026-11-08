import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { startServer } from "./helpers.js";

let server;
before(async () => { server = await startServer({ AUTH_USER: "teacher", AUTH_PASS: "s3cret" }); });
after(async () => { await server.stop(); });

const basic = (user, pass) => ({ authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` });

test("pages and APIs require credentials when AUTH_PASS is set", async () => {
  assert.equal((await fetch(server.url + "/")).status, 401);
  assert.equal((await fetch(server.url + "/api/verdict", { method: "POST" })).status, 401);
  assert.equal((await fetch(server.url + "/", { headers: basic("teacher", "wrong") })).status, 401);
  assert.equal((await fetch(server.url + "/", { headers: basic("teacher", "s3cret") })).status, 200);
});

test("...but the health check stays open so platforms can probe it", async () => {
  assert.equal((await fetch(server.url + "/healthz")).status, 200);
});

test("the Wisp WebSocket upgrade is protected too (Express middleware never sees it)", async () => {
  const upgrade = (headers) => new Promise((resolve) => {
    const req = request(server.url + "/wisp/", {
      headers: { Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13", "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==", ...headers },
    });
    req.once("upgrade", (res, socket) => { socket.destroy(); resolve(res.statusCode); });
    req.once("response", (res) => resolve(res.statusCode));
    req.once("error", () => resolve("closed"));
    req.end();
  });
  assert.equal(await upgrade({}), 401);
  assert.equal(await upgrade(basic("teacher", "wrong")), 401);
  assert.equal(await upgrade(basic("teacher", "s3cret")), 101);
});
