import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";

// The live channel: announcements and maintenance mode reach every open page at once.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-live-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  boss = await browser();
  assert.equal((await boss.post("/api/account/register", { username: "Boss", password: "password123" })).status, 201);
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let clients = 0;
function browser() {
  let cookie = "";
  const ip = `198.19.0.${++clients}`;
  async function call(method, path, body) {
    const res = await fetch(server.url + path, {
      method, redirect: "manual",
      headers: { "x-forwarded-for": ip, accept: "application/json", ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  return { post: (p, b = {}) => call("POST", p, b), get: (p) => call("GET", p), get ip() { return ip; } };
}

/** Listen to /api/live: events() gives what has arrived, until(name) waits for one more of that kind. */
async function listen(ip = "198.19.1.1") {
  const controller = new AbortController();
  const res = await fetch(server.url + "/api/live", { headers: { "x-forwarded-for": ip }, signal: controller.signal });
  const received = [];
  const waiters = [];
  (async () => {
    const reader = res.body.getReader();
    let text = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString();
        let at;
        while ((at = text.indexOf("\n\n")) !== -1) {
          const block = text.slice(0, at); text = text.slice(at + 2);
          const name = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
          if (!name) continue;
          const event = { name, data: JSON.parse(data) };
          received.push(event);
          for (const w of waiters.splice(0)) w(event);
        }
      }
    } catch { /* aborted */ }
  })();
  const until = (name) => new Promise((resolve, reject) => {
    const found = received.find((e) => e.name === name && !e.taken);
    if (found) { found.taken = true; return resolve(found.data); }
    const timer = setTimeout(() => reject(new Error(`no ${name} event`)), 3000);
    const check = (event) => { if (event.name === name) { clearTimeout(timer); event.taken = true; resolve(event.data); } else waiters.push(check); };
    waiters.push(check);
  });
  return { res, received, until, close: () => controller.abort() };
}

test("a page that connects is told what is true right now", options, async () => {
  const live = await listen();
  assert.equal(live.res.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const hello = await live.until("hello");
  assert.equal(hello.maintenance.on, false);
  assert.equal(hello.announcement.active, false);
  live.close();
});

test("an announcement reaches every open page the moment it is posted, and when it is taken down", options, async () => {
  const a = await listen("198.19.1.2"), b = await listen("198.19.1.3");
  await a.until("hello"); await b.until("hello");
  const posted = await boss.post("/api/admin/announcement", { text: "Server update at 5", level: "danger", active: true });
  assert.equal(posted.status, 200);
  for (const page of [a, b]) {
    const got = await page.until("announcement");
    assert.deepEqual([got.text, got.level, got.active], ["Server update at 5", "danger", true]);
    assert.equal(got.id, posted.data.id);
  }
  await boss.post("/api/admin/announcement", { text: "Server update at 5", level: "danger", active: false });
  assert.equal((await a.until("announcement")).active, false);
  a.close(); b.close();
});

test("a page that connects later hears the announcement in its hello", options, async () => {
  await boss.post("/api/admin/announcement", { text: "Hello latecomers", level: "info", active: true });
  const late = await listen("198.19.1.4");
  const hello = await late.until("hello");
  assert.equal(hello.announcement.text, "Hello latecomers");
  late.close();
  await boss.post("/api/admin/announcement", { text: "x", active: false });
});

test("maintenance mode is announced at once, stays reachable during maintenance, and ends the same way", options, async () => {
  const page = await listen("198.19.1.5");
  await page.until("hello");
  assert.equal((await boss.post("/api/admin/maintenance", { on: true, message: "Back at 6" })).status, 200);
  const on = await page.until("maintenance");
  assert.deepEqual(on, { on: true, message: "Back at 6" });
  // someone connecting now (the "back soon" page) still gets through, and hears it is on
  const visitor = await listen("198.19.1.6");
  assert.equal((await visitor.until("hello")).maintenance.on, true);
  // and a page that is open when it ends hears that too
  await boss.post("/api/admin/maintenance", { on: false, message: "Back at 6" });
  assert.equal((await visitor.until("maintenance")).on, false);
  page.close(); visitor.close();
});

test("only admins can change what the live channel says", options, async () => {
  const stranger = browser();
  assert.equal((await stranger.post("/api/admin/announcement", { text: "gotcha", level: "danger", active: true })).status, 401);
  assert.equal((await stranger.post("/api/admin/maintenance", { on: true })).status, 401);
});
