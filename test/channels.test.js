import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";

// Chat channels: who can read and post in each, and that what is said in one stays in it.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-channels-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  boss = await person("Boss");
  assert.equal((await boss.post("/api/chat/admin/settings", { slowSeconds: 0 })).status, 200);
});
after(async () => {
  for (const listener of listeners) listener.close();
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let clients = 0, names = 0;
const listeners = [];
function browser() {
  let cookie = "";
  const ip = `198.18.0.${++clients}`;
  const headers = (body) => ({ "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) });
  async function call(method, path, body) {
    const res = await fetch(server.url + path, { method, headers: headers(body), body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return { status: res.status, data: await res.json().catch(() => null) };
  }
  return {
    get: (path) => call("GET", path),
    post: (path, body = {}) => call("POST", path, body),
    async listen(query = "") {
      const controller = new AbortController();
      const res = await fetch(server.url + "/api/chat/stream" + query, { headers: headers(), signal: controller.signal });
      const events = [];
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
      })();
      const listener = {
        events,
        async waitFor(name, test = () => true, ms = 3000) {
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
  };
}
async function person(name = `chan${++names}`) {
  const b = browser();
  assert.equal((await b.post("/api/account/register", { username: name, password: "password123" })).status, 201);
  b.username = name;
  return b;
}
const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
const channelIdOf = async (who, name) => (await who.get("/api/chat/admin/channels")).data.channels.find((c) => c.name === name).id;
const roleIdOf = async (slug) => (await boss.get("/api/admin/roles")).data.roles.find((r) => r.slug === slug).id;

test("a site starts with #general, #help and #off-topic, and old messages are in #general", options, async () => {
  const pat = await person();
  const live = await pat.listen();
  const ready = await live.waitFor("ready");
  assert.deepEqual(ready.channels.map((c) => c.name), ["general", "help", "off-topic"]);
  assert.equal(ready.channel, ready.channels[0].id);
  assert.ok(ready.channels.every((c) => c.canPost));
  // no channel named: it goes to the first one, as it did before channels existed
  const sent = await pat.post("/api/chat/messages", { text: "hello there" });
  assert.equal(sent.status, 201);
  assert.equal(sent.data.message.channel, ready.channel);
});

test("what is said in a channel stays in it, live and in the history", options, async () => {
  const [ann, bea] = [await person(), await person()];
  const [help, off] = [await channelIdOf(boss, "help"), await channelIdOf(boss, "off-topic")];
  const live = await bea.listen();
  await live.waitFor("ready");
  assert.equal((await ann.post("/api/chat/messages", { text: "anyone about?", channel: help })).status, 201);
  const heard = await live.waitFor("message", (m) => m.text === "anyone about?");
  assert.equal(heard.channel, help);
  const history = (channel) => bea.get(`/api/chat/messages?channel=${channel}&limit=200`).then((r) => r.data.messages.map((m) => m.text));
  assert.ok((await history(help)).includes("anyone about?"));
  assert.ok(!(await history(off)).includes("anyone about?"));
  // a stream opened on a channel starts with that channel's history
  const there = await bea.listen(`?channel=${help}`);
  const ready = await there.waitFor("ready");
  assert.equal(ready.channel, help);
  assert.ok(ready.messages.some((m) => m.text === "anyone about?"));
  // a reply has to stay in its own channel
  const original = (await bea.get(`/api/chat/messages?channel=${help}`)).data.messages.at(-1);
  assert.equal((await ann.post("/api/chat/messages", { text: "wrong place", channel: off, replyTo: original.id })).status, 404);
  assert.equal((await ann.post("/api/chat/messages", { text: "right place", channel: help, replyTo: original.id })).status, 201);
  // an unknown channel
  assert.equal((await ann.post("/api/chat/messages", { text: "x", channel: 99999 })).status, 404);
  assert.equal((await ann.get("/api/chat/messages?channel=99999")).status, 404);
});

test("roles decide who reads and who posts, and doors open and close at once", options, async () => {
  const moderator = await roleIdOf("moderator");
  const made = await boss.post("/api/chat/admin/channels", { name: "Staff Room", description: "mods only", readRoles: [moderator], postRoles: [moderator] });
  assert.equal(made.status, 201);
  assert.equal(made.data.channel.name, "staff-room");
  const notice = await boss.post("/api/chat/admin/channels", { name: "announcements", readRoles: [], postRoles: [moderator] });
  const staff = made.data.channel.id, news = notice.data.channel.id;

  const member = await person(), newcomer = await person();
  assert.equal((await boss.post(`/api/admin/roles/${moderator}/members`, { username: member.username })).status, 200);
  const [memberLive, newcomerLive] = [await member.listen(), await newcomer.listen()];
  const [memberReady, newcomerReady] = [await memberLive.waitFor("ready"), await newcomerLive.waitFor("ready")];
  assert.ok(memberReady.channels.some((c) => c.id === staff));
  assert.ok(!newcomerReady.channels.some((c) => c.id === staff), "not even listed");
  assert.equal(newcomerReady.channels.find((c) => c.id === news).canPost, false, "can read the announcements, can't post");

  // no way in by number
  assert.equal((await newcomer.get(`/api/chat/messages?channel=${staff}`)).status, 404);
  assert.equal((await newcomer.post("/api/chat/messages", { text: "let me in", channel: staff })).status, 404);
  assert.equal((await newcomer.post("/api/chat/messages", { text: "hello", channel: news })).status, 403);
  assert.equal((await newcomer.post("/api/chat/read", { channel: staff })).status, 200); // changes nothing, tells nothing

  // the members talk; the newcomer hears nothing of it
  assert.equal((await member.post("/api/chat/messages", { text: "secret plans", channel: staff })).status, 201);
  assert.equal((await member.post("/api/chat/messages", { text: "big news", channel: news })).status, 201);
  await memberLive.waitFor("message", (m) => m.text === "secret plans");
  await newcomerLive.waitFor("message", (m) => m.text === "big news");
  await settle();
  assert.ok(!newcomerLive.events.some((e) => e.event === "message" && e.data.text === "secret plans"));
  // admins can go anywhere
  assert.equal((await boss.post("/api/chat/messages", { text: "boss was here", channel: staff })).status, 201);

  // giving the role opens the door at once; taking it away shuts it
  assert.equal((await boss.post(`/api/admin/roles/${moderator}/members`, { username: newcomer.username })).status, 200);
  const opened = await newcomerLive.waitFor("channels", (c) => c.channels.some((x) => x.id === staff));
  assert.equal(opened.channels.find((c) => c.id === news).canPost, true);
  assert.equal((await newcomer.get(`/api/chat/messages?channel=${staff}`)).status, 200);
  assert.equal((await boss.post(`/api/admin/roles/${moderator}/members`, { username: newcomer.username, add: false })).status, 200);
  await newcomerLive.waitFor("channels", (c) => !c.channels.some((x) => x.id === staff));
  assert.equal((await newcomer.get(`/api/chat/messages?channel=${staff}`)).status, 404);

  // deleting the role never opens a restricted channel to everybody
  const spare = (await boss.post("/api/admin/roles", { name: "Spare", color: "#123456", permissions: [] })).data.role;
  const vip = (await boss.post("/api/chat/admin/channels", { name: "vip", readRoles: [spare.id] })).data.channel;
  assert.equal((await boss.post(`/api/admin/roles/${spare.id}/delete`)).status, 200);
  assert.equal((await newcomer.get(`/api/chat/messages?channel=${vip.id}`)).status, 404, "admins only now");
  assert.equal((await boss.get(`/api/chat/messages?channel=${vip.id}`)).status, 200);
});

test("each channel has its own unread count, and reading one leaves the others", options, async () => {
  const [ann, bea] = [await person(), await person()];
  const [general, help] = [await channelIdOf(boss, "general"), await channelIdOf(boss, "help")];
  const first = await bea.listen();
  assert.equal((await first.waitFor("ready")).unread, 0, "a new account starts with nothing unread");
  await ann.post("/api/chat/messages", { text: "one", channel: general });
  await ann.post("/api/chat/messages", { text: "two", channel: help });
  await ann.post("/api/chat/messages", { text: "three", channel: help });
  const again = await bea.listen();
  const ready = await again.waitFor("ready");
  const unread = Object.fromEntries(ready.channels.map((c) => [c.id, c.unread]));
  assert.deepEqual([unread[general], unread[help], ready.unread], [1, 2, 3]);
  const read = await bea.post("/api/chat/read", { channel: help });
  assert.deepEqual([read.data.total, read.data.unread[general], read.data.unread[help]], [1, 1, 0]);
  const everything = await bea.post("/api/chat/read");
  assert.equal(everything.data.total, 0);
  await again.waitFor("read", (r) => r.total === 0);
});

test("managing channels: names are checked, they can be moved, cleared and deleted", options, async () => {
  const stranger = await person();
  assert.equal((await stranger.post("/api/chat/admin/channels", { name: "mine" })).status, 403);
  assert.equal((await boss.post("/api/chat/admin/channels", { name: "x" })).status, 400, "too short");
  assert.equal((await boss.post("/api/chat/admin/channels", { name: "!!!" })).status, 400);
  assert.equal((await boss.post("/api/chat/admin/channels", { name: "Help" })).status, 409, "already there");
  assert.equal((await boss.post("/api/chat/admin/channels", { name: "fine", readRoles: [123456] })).status, 400, "roles have to exist");
  const made = (await boss.post("/api/chat/admin/channels", { name: "games", description: "  play   things " })).data.channel;
  assert.equal(made.description, "play things");
  const order = async () => (await boss.get("/api/chat/admin/channels")).data.channels.map((c) => c.name);
  assert.equal((await order()).at(-1), "games");
  await boss.post(`/api/chat/admin/channels/${made.id}/move`, { direction: -1 });
  assert.ok((await order()).indexOf("games") < (await order()).length - 1);
  // clearing one channel leaves the rest
  const general = await channelIdOf(boss, "general");
  await boss.post("/api/chat/messages", { text: "stays", channel: general });
  await boss.post("/api/chat/messages", { text: "goes", channel: made.id });
  assert.equal((await boss.post("/api/chat/admin/clear", { channel: made.id })).status, 200);
  assert.ok(!(await boss.get(`/api/chat/messages?channel=${made.id}`)).data.messages.length);
  assert.ok((await boss.get(`/api/chat/messages?channel=${general}&limit=200`)).data.messages.some((m) => m.text === "stays"));
  // deleting takes its messages along, but not the last channel
  await boss.post("/api/chat/messages", { text: "bye", channel: made.id });
  assert.equal((await boss.post(`/api/chat/admin/channels/${made.id}/delete`)).status, 200);
  assert.equal((await boss.get(`/api/chat/messages?channel=${made.id}`)).status, 404);
  const rest = (await boss.get("/api/chat/admin/channels")).data.channels;
  for (const c of rest.slice(1)) await boss.post(`/api/chat/admin/channels/${c.id}/delete`);
  assert.equal((await boss.post(`/api/chat/admin/channels/${rest[0].id}/delete`)).status, 400, "the last one stays");
});
