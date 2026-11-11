import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { samples } from "./images.js";

// The live chat: streaming, sending, spam rules, GIFs and moderation.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

const gifBytes = Buffer.from(samples.gif[0], "base64");
let server, dataDir, stub, stubRequests, boss;

before(async () => {
  if (!hasSqlite) return;
  // A stand-in for GIPHY: the server is pointed at it instead of the real one.
  stubRequests = [];
  stub = createServer((req, res) => {
    const url = new URL(req.url, "http://stub");
    stubRequests.push(req.url);
    if (url.pathname === "/v1/gifs/search" || url.pathname === "/v1/gifs/trending") {
      if (url.searchParams.get("api_key") !== "test-key") { res.writeHead(403).end(); return; }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "abc123XYZ", title: `result for ${url.searchParams.get("q") ?? "trending"}` }, { id: "not valid!", title: "dropped" }] }));
      return;
    }
    const media = url.pathname.match(/^\/media\/([A-Za-z0-9]+)\/(giphy|200w)\.gif$/);
    if (media && media[1] !== "missing000") { res.writeHead(200, { "content-type": "image/gif" }); res.end(gifBytes); return; }
    if (media && media[1] === "missing000") { res.writeHead(404).end(); return; }
    res.writeHead(404).end();
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${stub.address().port}`;

  dataDir = mkdtempSync(join(tmpdir(), "sn-chat-"));
  server = await startServer({
    ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1",
    GIPHY_API_KEY: "test-key", GIPHY_API_URL: base, GIPHY_MEDIA_URL: base,
  });
  boss = await person("Boss");
  // Slow mode off for the tests that aren't about it.
  assert.equal((await boss.post("/api/chat/admin/settings", { slowSeconds: 0 })).status, 200);
});
after(async () => {
  await server?.stop();
  await new Promise((resolve) => (stub ? stub.close(resolve) : resolve()));
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let clients = 0, names = 0;
/** A browser: its own session cookie and address. */
function browser() {
  let cookie = "";
  const ip = `192.0.2.${++clients}`;
  const headers = (body) => ({ "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) });
  async function call(method, path, body, raw = false) {
    const res = await fetch(server.url + path, { method, headers: headers(body), body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    if (raw) return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
    return { status: res.status, headers: res.headers, data: await res.json().catch(() => null) };
  }
  return {
    get: (path) => call("GET", path),
    raw: (path) => call("GET", path, undefined, true),
    post: (path, body = {}) => call("POST", path, body),
    async listen(query = "") {
      const controller = new AbortController();
      const res = await fetch(server.url + "/api/chat/stream" + query, { headers: headers(), signal: controller.signal });
      const events = [];
      let ended = false;
      (async () => {
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          for await (const chunk of res.body) {
            buffer += decoder.decode(chunk, { stream: true });
            let end;
            while ((end = buffer.indexOf("\n\n")) !== -1) {
              const block = buffer.slice(0, end);
              buffer = buffer.slice(end + 2);
              const event = block.match(/^event: (.+)$/m)?.[1];
              const data = block.match(/^data: (.+)$/m)?.[1];
              if (event) events.push({ event, data: JSON.parse(data) });
            }
          }
        } catch { /* aborted */ }
        ended = true;
      })();
      const listener = {
        status: res.status,
        res,
        events,
        get ended() { return ended; },
        async waitFor(name, test = () => true, ms = 4000) {
          const until = Date.now() + ms;
          while (Date.now() < until) {
            const found = events.find((item) => item.event === name && test(item.data));
            if (found) return found.data;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw new Error(`No "${name}" event arrived. Got: ${events.map((item) => item.event).join(", ")}`);
        },
        close: () => controller.abort(),
      };
      listeners.push(listener);
      return listener;
    },
    get cookie() { return cookie; },
  };
}
const listeners = [];
after(() => { for (const listener of listeners) listener.close(); });

async function person(name = `user${++names}`) {
  const b = browser();
  const result = await b.post("/api/account/register", { username: name, password: "password123" });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  b.username = name;
  return b;
}

const say = (b, text, extra = {}) => b.post("/api/chat/messages", { text, ...extra });

test("the chat needs you to be signed in", options, async () => {
  const stranger = browser();
  assert.equal((await stranger.get("/api/chat/messages")).status, 401);
  assert.equal((await say(stranger, "hi")).status, 401);
  assert.equal((await stranger.get("/api/chat/stream")).status, 401);
  assert.equal((await stranger.get("/api/chat/admin/settings")).status, 401);
});

test("a stranger's message is refused before its body is read", options, async () => {
  // Not valid JSON: if the server read the body first it would answer 400, not 401.
  const res = await fetch(server.url + "/api/chat/messages", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.248" }, body: `{"not json ${"A".repeat(2.5 * 1024 * 1024)}` });
  assert.equal(res.status, 401);
});

test("a stream starts with the history, who you are and the settings, then delivers new messages live", options, async () => {
  const ann = await person();
  const bob = await person();
  assert.equal((await say(ann, "first message")).status, 201);

  const live = await bob.listen();
  const ready = await live.waitFor("ready");
  assert.equal(ready.me.username, bob.username);
  assert.equal(ready.me.sanction, null);
  assert.equal(ready.settings.enabled, true);
  assert.equal(ready.settings.giphy, true);
  assert.equal(ready.settings.words, undefined, "the blocked words are for admins only");
  assert.ok(ready.messages.some((m) => m.text === "first message" && m.user.username === ann.username));
  assert.ok(ready.online.some((u) => u.username === bob.username));

  await say(ann, "second message");
  const message = await live.waitFor("message", (m) => m.text === "second message");
  assert.equal(message.user.username, ann.username);
  assert.equal(message.user.avatar, 0);
  assert.equal(message.user.admin, undefined);
  assert.ok(message.id > 0 && message.at > 0);
  assert.equal(message.media, null);
});

test("who is online follows the open streams", options, async () => {
  const cat = await person();
  const dan = await person();
  const watching = await cat.listen();
  await watching.waitFor("ready");
  const joiner = await dan.listen();
  await watching.waitFor("presence", (p) => p.online.some((u) => u.username === dan.username));
  joiner.close();
  await watching.waitFor("presence", (p) => !p.online.some((u) => u.username === dan.username));
});

test("a quiet stream hears messages but isn't counted as being in the chat", options, async () => {
  const kai = await person();
  const sender = await person();
  const here = await (await person()).listen();
  await here.waitFor("ready");
  const quiet = await kai.listen("?quiet=1");
  const ready = await quiet.waitFor("ready");
  assert.equal(ready.me.username, kai.username);
  assert.deepEqual(ready.messages, [], "no history for a quiet stream");
  assert.deepEqual(ready.online, []);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(!here.events.some((e) => e.event === "presence" && e.data.online.some((u) => u.username === kai.username)), "a quiet stream is not in the online list");
  assert.ok(!(await sender.get("/api/chat/messages")).data.messages.some((m) => m.user.username === kai.username));

  await say(sender, "can you hear me");
  const heard = await quiet.waitFor("message", (m) => m.text === "can you hear me");
  assert.equal(heard.user.username, sender.username);

  // The same person with the chat open is in the list, and closing the quiet one changes nothing.
  const loud = await kai.listen();
  await here.waitFor("presence", (p) => p.online.some((u) => u.username === kai.username));
  quiet.close();
  loud.close();
  await here.waitFor("presence", (p) => !p.online.some((u) => u.username === kai.username));
});

test("a new profile picture reaches everyone's chat through the online list", options, async () => {
  const zed = await person();
  const watcher = await (await person()).listen();
  await watcher.waitFor("ready");
  const mine = await zed.listen();
  await mine.waitFor("ready");
  await watcher.waitFor("presence", (p) => p.online.some((u) => u.username === zed.username && u.avatar === 0));
  const { avatar } = (await zed.post("/api/account/avatar", { mime: samples.png[1], data: samples.png[0] })).data;
  await watcher.waitFor("presence", (p) => p.online.some((u) => u.username === zed.username && u.avatar === avatar));
  await zed.post("/api/account/avatar/remove");
  await watcher.waitFor("presence", (p) => p.online.some((u) => u.username === zed.username && u.avatar === 0));
});

test("admins are marked, and text comes back exactly as typed (the page shows it as text)", options, async () => {
  const eve = await person();
  const listener = await eve.listen();
  await listener.waitFor("ready");
  const text = '<img src=x onerror=alert(1)> & "quotes"';
  await say(eve, text);
  const mine = await listener.waitFor("message", (m) => m.user.username === eve.username);
  assert.equal(mine.text, text);
  assert.equal(mine.user.admin, undefined);
  await say(boss, "official announcement");
  const theirs = await listener.waitFor("message", (m) => m.user.username === "Boss");
  assert.equal(theirs.user.admin, true);
});

test("spam rules: empty, too long, shouting, repeats and links are refused", options, async () => {
  const fay = await person();
  assert.equal((await say(fay, "   ")).status, 400);
  assert.equal((await say(fay, "x".repeat(501))).status, 400);
  assert.equal((await say(fay, "THIS IS ALL SHOUTING NOW")).status, 400);
  assert.equal((await say(fay, "aaaaaaaaaaaaaaaa")).status, 400);
  const link = await say(fay, "look at https://example.com/page");
  assert.equal(link.status, 400);
  assert.match(link.data.error, /Links/);
  assert.equal((await say(fay, "a normal message")).status, 201);
  assert.equal((await say(fay, { not: "text" })).status, 400);
});

test("admins can allow links and add blocked words, and the words apply at once", options, async () => {
  const gus = await person();
  assert.equal((await gus.post("/api/chat/admin/settings", { links: "allowed" })).status, 403);
  assert.equal((await boss.post("/api/chat/admin/settings", { links: "allowed", words: ["Banana*", "no way"] })).status, 200);
  try {
    assert.equal((await say(gus, "see https://example.com")).status, 201);
    const blocked = await say(gus, "I like bananas");
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.error, /word/);
    assert.equal((await say(gus, "n.o w a y")).status, 400, "spaced-out and disguised versions are caught");
    assert.equal((await say(gus, "bandana")).status, 201, "and words inside other words are fine");
    assert.deepEqual((await boss.get("/api/chat/admin/settings")).data.settings.words, ["banana*", "no way"]);
  } finally {
    await boss.post("/api/chat/admin/settings", { links: "blocked", words: [] });
  }
});

test("slow mode makes people wait between messages, but not admins", options, async () => {
  const hal = await person();
  await boss.post("/api/chat/admin/settings", { slowSeconds: 1 });
  try {
    assert.equal((await say(hal, "one")).status, 201);
    const early = await say(hal, "two");
    assert.equal(early.status, 429);
    assert.match(early.data.error, /Slow mode/);
    assert.ok(Number(early.headers.get("retry-after")) >= 1);
    assert.equal((await say(boss, "admin one")).status, 201);
    assert.equal((await say(boss, "admin two")).status, 201);
    await new Promise((resolve) => setTimeout(resolve, 1100));
    assert.equal((await say(hal, "two")).status, 201);
  } finally {
    await boss.post("/api/chat/admin/settings", { slowSeconds: 0 });
  }
});

test("flooding and repeating are stopped, and a spammer gets an automatic timeout", options, async () => {
  const ivy = await person();
  const listener = await ivy.listen();
  await listener.waitFor("ready");
  assert.equal((await say(ivy, "buy now")).status, 201);
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await say(ivy, "buy now"));
  assert.deepEqual(results.slice(0, 3).map((r) => r.status), [429, 429, 429]);
  assert.match(results[0].data.error, /repeat/);
  // The fourth strike is a timeout, and the message says so.
  assert.equal(results[3].status, 429);
  assert.match(results[3].data.error, /timed out/);
  assert.equal(results[3].data.sanction.kind, "timeout");

  const pushed = await listener.waitFor("sanction");
  assert.equal(pushed.kind, "timeout");
  assert.equal(pushed.by, "AutoMod");

  const after = await say(ivy, "i am back");
  assert.equal(after.status, 403);
  assert.match(after.data.error, /timed out/);
  assert.equal((await ivy.listen().then(async (l) => (await l.waitFor("ready")).me.sanction.kind)), "timeout");

  const log = (await boss.get("/api/chat/admin/log")).data.log;
  assert.ok(log.some((entry) => entry.actor === "AutoMod" && entry.action === "timeout" && entry.target === ivy.username));
  assert.ok((await boss.get("/api/chat/admin/sanctions")).data.sanctions.some((s) => s.username === ivy.username));
});

test("six messages in a burst is flooding", options, async () => {
  const jon = await person();
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await say(jon, `message number ${i}`)).status);
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
});

test("only admins can moderate", options, async () => {
  const kim = await person();
  const lee = await person();
  const posted = (await say(lee, "hello there")).data.message;
  for (const [method, path, body] of [
    ["post", `/api/chat/admin/messages/${posted.id}/delete`, {}],
    ["post", "/api/chat/admin/clear", {}],
    ["post", `/api/chat/admin/users/${lee.username}/timeout`, { minutes: 5 }],
    ["post", `/api/chat/admin/users/${lee.username}/ban`, {}],
    ["post", `/api/chat/admin/users/${lee.username}/lift`, {}],
    ["get", "/api/chat/admin/sanctions"],
    ["get", "/api/chat/admin/log"],
    ["get", "/api/chat/admin/settings"],
    ["post", "/api/chat/admin/settings", { slowSeconds: 0 }],
  ]) {
    assert.equal((await kim[method](path, body)).status, 403, `${method} ${path}`);
  }
});

test("an admin deletes a message and everyone's chat drops it", options, async () => {
  const mo = await person();
  const watcher = await (await person()).listen();
  await watcher.waitFor("ready");
  const { message } = (await say(mo, "regrettable")).data;
  await watcher.waitFor("message", (m) => m.id === message.id);
  assert.equal((await boss.post(`/api/chat/admin/messages/${message.id}/delete`)).status, 200);
  await watcher.waitFor("delete", (d) => d.id === message.id);
  assert.equal((await boss.post(`/api/chat/admin/messages/${message.id}/delete`)).status, 404, "already gone");
  const history = (await mo.get("/api/chat/messages")).data.messages;
  assert.ok(!history.some((m) => m.id === message.id));
  assert.ok((await boss.get("/api/chat/admin/log")).data.log.some((e) => e.action === "delete message" && e.target === mo.username));
});

test("timeout and chat ban: the person can't post, their messages can be purged, and lifting restores them", options, async () => {
  const ned = await person();
  const listener = await ned.listen();
  await listener.waitFor("ready");
  const first = (await say(ned, "spam spam one")).data.message;
  const second = (await say(ned, "spam spam two")).data.message;
  const watcher = await (await person()).listen();
  await watcher.waitFor("ready");

  const timeout = await boss.post(`/api/chat/admin/users/${ned.username}/timeout`, { minutes: 30, reason: "cool off", purge: true });
  assert.equal(timeout.status, 200);
  assert.equal(timeout.data.removed, 2);
  await watcher.waitFor("delete", (d) => d.id === first.id);
  await watcher.waitFor("delete", (d) => d.id === second.id);
  const pushed = await listener.waitFor("sanction");
  assert.equal(pushed.kind, "timeout");
  assert.equal(pushed.reason, "cool off");

  const blocked = await say(ned, "hello?");
  assert.equal(blocked.status, 403);
  assert.match(blocked.data.error, /30 more minutes/);
  assert.match(blocked.data.error, /cool off/);

  assert.equal((await boss.post(`/api/chat/admin/users/${ned.username}/ban`, { reason: "repeat offender" })).status, 200);
  const banned = await say(ned, "hello?");
  assert.equal(banned.status, 403);
  assert.match(banned.data.error, /banned from the chat/);
  assert.equal((await ned.get("/api/chat/messages")).status, 200, "they can still read");
  assert.equal((await ned.get("/api/account")).data.user.username, ned.username, "and are still signed in to the site");

  assert.equal((await boss.post(`/api/chat/admin/users/${ned.username}/lift`)).status, 200);
  await listener.waitFor("sanction-lifted");
  assert.equal((await say(ned, "thanks")).status, 201);
  assert.equal((await boss.post(`/api/chat/admin/users/${ned.username}/lift`)).status, 404, "nothing left to lift");
});

test("admins can't be sanctioned, nor can you sanction yourself, and bad input is refused", options, async () => {
  const ola = await person();
  assert.equal((await boss.post(`/api/chat/admin/users/${ola.username}/timeout`, { minutes: 0 })).status, 400);
  assert.equal((await boss.post(`/api/chat/admin/users/${ola.username}/timeout`, { minutes: "soon" })).status, 400);
  assert.equal((await boss.post(`/api/chat/admin/users/${ola.username}/timeout`, { minutes: 99999999 })).status, 400);
  assert.equal((await boss.post("/api/chat/admin/users/Boss/ban")).status, 400, "yourself");
  assert.equal((await boss.post("/api/chat/admin/users/nobody-by-that-name/ban")).status, 404);
  assert.equal((await boss.post("/api/account/admin/users/" + ola.username + "/admin")).status, 200);
  assert.equal((await boss.post(`/api/chat/admin/users/${ola.username}/ban`)).status, 403, "another admin");
  assert.equal((await ola.post(`/api/chat/admin/users/${ola.username}/ban`)).status, 400);
  await boss.post("/api/account/admin/users/" + ola.username + "/unadmin");
});

test("locking the chat, minimum account age and turning it off", options, async () => {
  const pam = await person();
  const listener = await pam.listen();
  await listener.waitFor("ready");

  await boss.post("/api/chat/admin/settings", { locked: true });
  try {
    await listener.waitFor("settings", (s) => s.locked === true);
    const refused = await say(pam, "hello");
    assert.equal(refused.status, 403);
    assert.match(refused.data.error, /locked/);
    assert.equal((await say(boss, "admins can still talk")).status, 201);
  } finally { await boss.post("/api/chat/admin/settings", { locked: false }); }

  await boss.post("/api/chat/admin/settings", { minAccountMinutes: 5 });
  try {
    assert.equal((await say(pam, "too new")).status, 403);
    assert.equal((await say(boss, "admins are not affected")).status, 201);
  } finally { await boss.post("/api/chat/admin/settings", { minAccountMinutes: 0 }); }

  await boss.post("/api/chat/admin/settings", { enabled: false });
  try {
    await listener.waitFor("clear");
    assert.equal((await say(pam, "hello")).status, 403);
    assert.deepEqual((await pam.get("/api/chat/messages")).data.messages, []);
  } finally { await boss.post("/api/chat/admin/settings", { enabled: true }); }
  assert.equal((await say(pam, "we are back")).status, 201);
});

test("settings are validated", options, async () => {
  for (const bad of [{ slowSeconds: -1 }, { slowSeconds: 301 }, { slowSeconds: 1.5 }, { links: "maybe" }, { enabled: "yes" }, { words: "bad" }, { nonsense: 1 }, { minAccountMinutes: 100000 }]) {
    assert.equal((await boss.post("/api/chat/admin/settings", bad)).status, 400, JSON.stringify(bad));
  }
  assert.equal((await boss.post("/api/chat/admin/settings", [])).status, 400);
});

test("clearing the chat removes everything for everyone", options, async () => {
  const quin = await person();
  const watcher = await (await person()).listen();
  await watcher.waitFor("ready");
  await say(quin, "this will vanish");
  assert.equal((await boss.post("/api/chat/admin/clear")).status, 200);
  await watcher.waitFor("clear");
  assert.deepEqual((await quin.get("/api/chat/messages")).data.messages, []);
});

test("GIF upload: a real GIF is stored and served, anything else is refused", options, async () => {
  const rae = await person();
  const listener = await rae.listen();
  await listener.waitFor("ready");
  const sent = await say(rae, "", { gif: { data: samples.gif[0] } });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.equal(sent.data.message.media.kind, "upload");
  assert.equal(sent.data.message.text, "");
  await listener.waitFor("message", (m) => m.media?.kind === "upload");

  const viewer = await person();
  const media = await viewer.raw(`/api/chat/media/${sent.data.message.media.id}`);
  assert.equal(media.status, 200);
  assert.equal(media.headers.get("content-type"), "image/gif");
  assert.equal(media.headers.get("x-content-type-options"), "nosniff");
  assert.match(media.headers.get("content-security-policy"), /sandbox/);
  assert.deepEqual(media.bytes, gifBytes);
  assert.equal((await browser().raw(`/api/chat/media/${sent.data.message.media.id}`)).status, 401);
  assert.equal((await viewer.raw("/api/chat/media/ffffffffffffffffffffffff")).status, 404);
  assert.equal((await viewer.raw("/api/chat/media/not-an-id")).status, 404);

  await new Promise((resolve) => setTimeout(resolve, 1)); // distinct fingerprints are enough; no wait needed
  assert.equal((await say(rae, "caption", { gif: { data: samples.png[0] } })).status, 400, "a PNG is not a GIF");
  assert.equal((await say(rae, "x", { gif: { data: '<svg onload="alert(1)"/>' } })).status, 400);
  assert.equal((await say(rae, "x", { gif: { data: "!!!" } })).status, 400);
  assert.equal((await say(rae, "x", { gif: "nope" })).status, 400);
  const huge = Buffer.from(gifBytes);
  huge.writeUInt16LE(30000, 6);
  huge.writeUInt16LE(30000, 8);
  assert.equal((await say(rae, "huge", { gif: { data: huge.toString("base64") } })).status, 400, "pixel size is checked");
  const heavy = Buffer.concat([gifBytes, Buffer.alloc(2.1 * 1024 * 1024)]);
  assert.equal((await say(rae, "heavy", { gif: { data: heavy.toString("base64") } })).status, 413);
});

test("deleting a GIF message deletes the uploaded picture", options, async () => {
  const sid = await person();
  const { message } = (await say(sid, "", { gif: { data: samples.gif[0] } })).data;
  assert.equal((await sid.raw(`/api/chat/media/${message.media.id}`)).status, 200);
  await boss.post(`/api/chat/admin/messages/${message.id}/delete`);
  assert.equal((await sid.raw(`/api/chat/media/${message.media.id}`)).status, 404);
});

test("GIFs can be turned off, and uploads are rate limited", options, async () => {
  const tia = await person();
  await boss.post("/api/chat/admin/settings", { gifs: false });
  try {
    assert.equal((await say(tia, "", { gif: { data: samples.gif[0] } })).status, 403);
    assert.equal((await tia.get("/api/chat/gifs?q=cat")).status, 403);
  } finally { await boss.post("/api/chat/admin/settings", { gifs: true }); }
  const statuses = [];
  for (let i = 0; i < 7; i++) {
    const gif = Buffer.from(gifBytes);
    gif[gif.length - 1] = i; // different each time
    statuses.push((await say(tia, `gif ${i}`, { gif: { data: gif.toString("base64") } })).status);
    if (i === 3) await new Promise((resolve) => setTimeout(resolve, 10_100)); // out of the burst window
  }
  assert.equal(statuses.filter((s) => s === 201).length, 6);
  assert.equal(statuses.at(-1), 429);
});

test("GIF search goes through the server, which also relays the pictures", options, async () => {
  const uma = await person();
  stubRequests.length = 0;
  const trending = await uma.get("/api/chat/gifs");
  assert.equal(trending.status, 200);
  assert.deepEqual(trending.data.gifs, [{ id: "abc123XYZ", title: "result for trending" }], "invalid ids are dropped");
  const found = await uma.get("/api/chat/gifs?q=funny%20cat");
  assert.equal(found.data.gifs[0].title, "result for funny cat");
  assert.ok(stubRequests.some((url) => url.includes("rating=pg") && url.includes("api_key=test-key")));
  await uma.get("/api/chat/gifs?q=funny%20cat");
  assert.equal(stubRequests.filter((url) => url.includes("search")).length, 1, "repeat searches are cached");
  assert.equal((await browser().get("/api/chat/gifs")).status, 401);

  for (const size of ["thumb", "full"]) {
    const gif = await uma.raw(`/api/chat/giphy/abc123XYZ/${size}`);
    assert.equal(gif.status, 200);
    assert.equal(gif.headers.get("content-type"), "image/gif");
    assert.deepEqual(gif.bytes, gifBytes);
  }
  assert.equal((await uma.raw("/api/chat/giphy/abc123XYZ/huge")).status, 404);
  assert.equal((await uma.raw("/api/chat/giphy/bad%20id/full")).status, 404);
  assert.equal((await uma.raw("/api/chat/giphy/missing000/full")).status, 404);
  assert.equal((await browser().raw("/api/chat/giphy/abc123XYZ/full")).status, 401);

  const sent = await say(uma, "look", { gif: { giphy: "abc123XYZ" } });
  assert.equal(sent.status, 201);
  assert.deepEqual(sent.data.message.media, { kind: "giphy", id: "abc123XYZ" });
  assert.equal((await say(uma, "bad", { gif: { giphy: "../../etc" } })).status, 400);
});

test("without a GIPHY key there is no search, but uploads still work", options, async () => {
  const plain = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", TRUST_PROXY: "1" });
  try {
    const call = (method, path, body, cookie = "") => fetch(plain.url + path, { method, headers: { "x-forwarded-for": "192.0.2.250", ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const signup = await call("POST", "/api/account/register", { username: "solo", password: "password123" });
    const cookie = signup.headers.get("set-cookie").split(";")[0];
    assert.equal((await call("GET", "/api/chat/gifs", undefined, cookie)).status, 404);
    assert.equal((await call("POST", "/api/chat/messages", { text: "hi", gif: { giphy: "abc123XYZ" } }, cookie)).status, 400);
    const slowDefault = await call("POST", "/api/chat/messages", { text: "", gif: { data: samples.gif[0] } }, cookie);
    assert.equal(slowDefault.status, 201);
  } finally { await plain.stop(); }
});

test("a site ban closes the person's chat stream and ends their session", options, async () => {
  const vic = await person();
  const listener = await vic.listen();
  await listener.waitFor("ready");
  assert.equal((await boss.post(`/api/account/admin/users/${vic.username}/ban`, { reason: "bye" })).status, 200);
  const closed = await listener.waitFor("closed");
  assert.equal(closed.reason, "banned");
  assert.equal((await vic.get("/api/chat/messages")).status, 401);
});

test("deleting your account removes your messages", options, async () => {
  const wes = await person();
  const { message } = (await say(wes, "gone with the account")).data;
  assert.equal((await wes.post("/api/account/delete", { password: "password123" })).status, 200);
  const history = (await boss.get("/api/chat/messages?limit=200")).data.messages;
  assert.ok(!history.some((m) => m.id === message.id));
});

test("older messages load in pages", options, async () => {
  const xan = await person();
  await say(boss, "page marker");
  const all = (await xan.get("/api/chat/messages?limit=200")).data.messages;
  assert.ok(all.length > 3);
  const newest = all.at(-1).id;
  const older = (await xan.get(`/api/chat/messages?before=${newest}&limit=2`)).data.messages;
  assert.equal(older.length, 2);
  assert.ok(older.every((m) => m.id < newest));
  assert.ok(older[0].id < older[1].id, "oldest first");
});

test("a cross-site request can't post", options, async () => {
  const yan = await person();
  const res = await fetch(server.url + "/api/chat/messages", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: yan.cookie, origin: "https://evil.example", "x-forwarded-for": "192.0.2.249" },
    body: JSON.stringify({ text: "forged" }),
  });
  assert.equal(res.status, 403);
  const plain = await fetch(server.url + "/api/chat/messages", {
    method: "POST",
    headers: { "content-type": "text/plain", cookie: yan.cookie, "x-forwarded-for": "192.0.2.249" },
    body: JSON.stringify({ text: "forged" }),
  });
  assert.equal(plain.status, 415);
});
