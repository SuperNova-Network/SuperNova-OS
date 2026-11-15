import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";

// Replying to a chat message.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-reply-"));
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
  const ip = `100.67.0.${++clients}`;
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
const say = (who, text, extra = {}) => who.post("/api/chat/messages", { text, ...extra });

test("a reply carries a preview of the message it answers", options, async () => {
  const ann = await person(), bea = await person();
  const original = (await say(ann, "what time is the game?")).data.message;
  const reply = await say(bea, "at 8", { replyTo: original.id });
  assert.equal(reply.status, 201, JSON.stringify(reply.data));
  assert.deepEqual(reply.data.message.reply, { id: original.id, user: { username: ann.username }, text: "what time is the game?", media: false });
  const again = (await bea.get("/api/chat/messages")).data.messages.find((m) => m.id === reply.data.message.id);
  assert.equal(again.reply.user.username, ann.username, "and in the history");
  assert.equal((await say(ann, "no reply here")).data.message.reply, undefined);
});

test("what a reply may point at is checked", options, async () => {
  const ann = await person();
  assert.equal((await say(ann, "hi", { replyTo: 999999 })).status, 404, "a message that doesn't exist");
  for (const bad of ["1", 1.5, [], {}, true]) assert.equal((await say(ann, "hi", { replyTo: bad })).status, 400, JSON.stringify(bad));
  const gone = (await say(ann, "to be deleted")).data.message;
  await boss.post(`/api/chat/admin/messages/${gone.id}/delete`);
  assert.equal((await say(ann, "too late", { replyTo: gone.id })).status, 404, "one that was deleted");
});

test("replying pings the person you answer, unless you turn it off, and never yourself", options, async () => {
  const ann = await person(), bea = await person();
  const original = (await say(ann, "question")).data.message;
  const pinged = (await say(bea, "answer", { replyTo: original.id })).data.message;
  assert.deepEqual(pinged.mentions.users, [ann.username], "the author is pinged");
  const quiet = (await say(bea, "quiet answer", { replyTo: original.id, pingReply: false })).data.message;
  assert.equal(quiet.mentions, undefined, "pingReply: false doesn't");
  const mine = (await say(ann, "my own follow up", { replyTo: original.id })).data.message;
  assert.equal(mine.mentions, undefined, "you aren't pinged for answering yourself");
  const both = (await say(bea, `also @${ann.username.toUpperCase()}`, { replyTo: original.id })).data.message;
  assert.deepEqual(both.mentions.users, [ann.username], "no double ping when you also typed the name");
});

test("a long original is cut short, and a deleted one shows as gone", options, async () => {
  const ann = await person(), bea = await person();
  const long = (await say(ann, Array.from({ length: 50 }, (_, i) => `word${i}`).join(" "))).data.message; // about 340 characters
  const preview = (await say(bea, "short answer", { replyTo: long.id })).data.message.reply;
  assert.ok(preview.text.length <= 141 && preview.text.endsWith("…"), "cut at 140 characters");
  const base = (await say(ann, "something to delete")).data.message;
  const reply = (await say(bea, "replying", { replyTo: base.id })).data.message;
  await boss.post(`/api/chat/admin/messages/${base.id}/delete`);
  const after = (await bea.get("/api/chat/messages")).data.messages.find((m) => m.id === reply.id);
  assert.deepEqual(after.reply, { id: base.id, gone: true });
});

test("the reply shows the original author's highest role", options, async () => {
  const mod = (await boss.get("/api/admin/roles")).data.roles.find((r) => r.name === "Moderator");
  const ann = await person(), bea = await person();
  await boss.post(`/api/admin/roles/${mod.id}/members`, { username: ann.username });
  const original = (await say(ann, "from a moderator")).data.message;
  const reply = (await say(bea, "ok", { replyTo: original.id })).data.message;
  assert.equal(reply.reply.user.role.name, "Moderator");
});
