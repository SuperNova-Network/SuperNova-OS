import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";

// The number on the Chat icon: messages since you last read the chat, on any computer.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-unread-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  boss = await person("Boss");
  assert.equal((await boss.post("/api/chat/admin/settings", { slowSeconds: 0 })).status, 200);
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let clients = 0, names = 0;
function browser() {
  let cookie = "";
  const ip = `100.66.0.${++clients}`;
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
  return { get: (p) => call("GET", p), post: (p, b = {}) => call("POST", p, b), get ip() { return ip; }, get cookie() { return cookie; } };
}
async function person(name = `pal${++names}`) {
  const b = browser();
  const r = await b.post("/api/account/register", { username: name, password: "password123" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  b.username = name;
  return b;
}
const say = (who, text) => who.post("/api/chat/messages", { text });

/** The quiet stream a desktop keeps: resolves with its "ready" data, and collects later events. */
async function quiet(who) {
  const controller = new AbortController();
  const res = await fetch(`${server.url}/api/chat/stream?quiet=1`, { headers: { cookie: who.cookie, "x-forwarded-for": `${who.ip}` }, signal: controller.signal });
  const events = [];
  let wake;
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
          if (name) { events.push({ name, data: JSON.parse(data) }); wake?.(); }
        }
      }
    } catch { /* aborted */ }
  })();
  const wait = (name) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${name}`)), 3000);
    const look = () => { const e = events.find((x) => x.name === name && !x.taken); if (e) { e.taken = true; clearTimeout(timer); resolve(e.data); } else wake = look; };
    look();
  });
  return { wait, close: () => controller.abort() };
}

test("a new account starts with nothing unread, and messages since it last read count", options, async () => {
  const ann = await person(), bea = await person();
  await say(bea, "before ann ever looked");
  const first = await quiet(ann);
  assert.equal((await first.wait("ready")).unread, 0, "the history before you is not unread");
  first.close();
  await say(bea, "one"); await say(bea, "two");
  await say(ann, "my own message doesn't count");
  const later = await quiet(ann);
  assert.equal((await later.wait("ready")).unread, 2, "what was sent while you were away");
  later.close();
});

test("reading clears it for every computer at once", options, async () => {
  const ann = await person(), bea = await person();
  const laptop = await quiet(ann), desktop = await quiet(ann);
  await laptop.wait("ready"); await desktop.wait("ready");
  await say(bea, "ping"); await say(bea, "pong");
  assert.equal((await ann.post("/api/chat/read")).status, 200);
  await laptop.wait("read"); await desktop.wait("read");
  const again = await quiet(ann);
  assert.equal((await again.wait("ready")).unread, 0);
  await say(bea, "after reading");
  const next = await quiet(ann);
  assert.equal((await next.wait("ready")).unread, 1, "only what came after");
  for (const s of [laptop, desktop, again, next]) s.close();
  assert.equal((await browser().post("/api/chat/read")).status, 401);
});

test("deleted messages and cleared chats aren't counted", options, async () => {
  const ann = await person(), bea = await person();
  const open = await quiet(ann); await open.wait("ready"); open.close();
  const gone = (await say(bea, "to be deleted")).data.message;
  await say(bea, "stays");
  await boss.post(`/api/chat/admin/messages/${gone.id}/delete`);
  const again = await quiet(ann);
  assert.equal((await again.wait("ready")).unread, 1);
  again.close();
});
