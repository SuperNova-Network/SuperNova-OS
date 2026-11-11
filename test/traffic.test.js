import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer } from "./helpers.js";

let server;
before(async () => { server = await startServer({}); });
after(async () => { await server?.stop(); });

test("the traffic totals are numbers that only ever go up", async () => {
  const a = await (await fetch(server.url + "/api/traffic")).json();
  assert.equal(typeof a.down, "number");
  assert.equal(typeof a.up, "number");
  assert.ok(a.at > 0);
  const b = await (await fetch(server.url + "/api/traffic")).json();
  assert.ok(b.down >= a.down && b.up >= a.up);
});
