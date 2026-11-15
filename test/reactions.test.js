import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { chatKit } from "./chatkit.js";
import { isEmoji } from "../src/chatdb.js";

// Reactions on chat messages.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, kit, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-reactions-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  kit = chatKit(() => server, "198.19.1");
  boss = await kit.person("Boss");
  await boss.post("/api/chat/admin/settings", { slowSeconds: 0 });
});
after(async () => {
  kit?.closeAll();
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const say = async (who, text, extra = {}) => (await who.post("/api/chat/messages", { text, ...extra })).data.message;

test("only a single emoji counts as a reaction", () => {
  for (const ok of ["\u{1F44D}", "❤️", "\u{1F468}‍\u{1F469}‍\u{1F467}", "\u{1F44D}\u{1F3FD}", "\u{1F1FA}\u{1F1F8}", "1️⃣", "✅"]) assert.equal(isEmoji(ok), true, ok);
  for (const bad of ["", "a", "hello", "\u{1F44D}a", "\u{1F44D}\u{1F44D}", "<b>", "\u{1F600}́́́", 5, null, "\u{1F44D}".repeat(40)]) assert.equal(isEmoji(bad), false, String(bad));
});

test("people react, flip, and everyone sees the reactions live and in the history", options, async () => {
  const [ann, bea] = [await kit.person(), await kit.person()];
  const live = await bea.listen();
  await live.waitFor("ready");
  const message = await say(ann, "react to me");
  const first = await bea.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F44D}" });
  assert.equal(first.status, 200);
  assert.deepEqual(first.data.reactions, [{ emoji: "\u{1F44D}", count: 1, users: [bea.username] }]);
  assert.equal((await ann.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F44D}" })).data.reactions[0].count, 2);
  await ann.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F525}" });
  const heard = await live.waitFor("reaction", (r) => r.id === message.id && r.reactions.length === 2);
  assert.equal(heard.channel, message.channel);
  assert.deepEqual(heard.reactions.map((r) => r.emoji), ["\u{1F44D}", "\u{1F525}"], "in the order they were first used");
  // in the history
  const history = (await bea.get(`/api/chat/messages?channel=${message.channel}&limit=200`)).data.messages.find((m) => m.id === message.id);
  assert.deepEqual(history.reactions.map((r) => [r.emoji, r.count]), [["\u{1F44D}", 2], ["\u{1F525}", 1]]);
  // flipping takes it back, and explicit on/off is idempotent
  const off = await ann.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F525}" });
  assert.deepEqual(off.data.reactions.map((r) => r.emoji), ["\u{1F44D}"]);
  assert.equal((await ann.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F44D}", on: false })).data.reactions[0].count, 1);
  assert.equal((await ann.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F44D}", on: false })).data.reactions[0].count, 1);
});

test("what may be reacted to, and by whom", options, async () => {
  const [ann, bea] = [await kit.person(), await kit.person()];
  const message = await say(ann, "pick me");
  assert.equal((await bea.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "hello" })).status, 400);
  assert.equal((await bea.post(`/api/chat/messages/${message.id}/reactions`, {})).status, 400);
  assert.equal((await bea.post("/api/chat/messages/999999/reactions", { emoji: "\u{1F44D}" })).status, 404);
  assert.equal((await kit.browser().post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F44D}" })).status, 401);
  // a limit of ten per person
  for (const emoji of ["\u{1F600}", "\u{1F601}", "\u{1F602}", "\u{1F603}", "\u{1F604}", "\u{1F605}", "\u{1F606}", "\u{1F607}", "\u{1F608}", "\u{1F609}"]) assert.equal((await bea.post(`/api/chat/messages/${message.id}/reactions`, { emoji })).status, 200);
  assert.equal((await bea.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F60A}" })).status, 400);
  // a deleted message can't be reacted to
  const gone = await say(ann, "going away");
  await boss.post(`/api/chat/admin/messages/${gone.id}/delete`);
  assert.equal((await bea.post(`/api/chat/messages/${gone.id}/reactions`, { emoji: "\u{1F44D}" })).status, 404);
  // people timed out can't react
  const rude = await kit.person();
  await boss.post(`/api/chat/admin/users/${rude.username}/timeout`, { minutes: 5, reason: "test" });
  assert.equal((await rude.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F44D}" })).status, 403);
});

test("reactions follow the channel's rules: readers can react even where they can't post, others can't see it", options, async () => {
  const roles = (await boss.get("/api/admin/roles")).data.roles;
  const moderator = roles.find((r) => r.slug === "moderator").id;
  const news = (await boss.post("/api/chat/admin/channels", { name: "reactnews", postRoles: [moderator] })).data.channel;
  const staff = (await boss.post("/api/chat/admin/channels", { name: "reactstaff", readRoles: [moderator], postRoles: [moderator] })).data.channel;
  const reader = await kit.person();
  const post = (await boss.post("/api/chat/messages", { text: "headline", channel: news.id })).data.message;
  const secret = (await boss.post("/api/chat/messages", { text: "hush", channel: staff.id })).data.message;
  assert.equal((await reader.post(`/api/chat/messages/${post.id}/reactions`, { emoji: "\u{1F389}" })).status, 200, "can read it, can react");
  assert.equal((await reader.post(`/api/chat/messages/${secret.id}/reactions`, { emoji: "\u{1F389}" })).status, 404, "can't see it, can't react");
});

test("deleting an account takes its reactions away", options, async () => {
  const [ann, bea] = [await kit.person(), await kit.person()];
  const message = await say(ann, "bye bye");
  await bea.post(`/api/chat/messages/${message.id}/reactions`, { emoji: "\u{1F44D}" });
  assert.equal((await bea.post("/api/account/delete", { password: "password123" })).status, 200);
  const history = (await ann.get(`/api/chat/messages?channel=${message.channel}&limit=200`)).data.messages.find((m) => m.id === message.id);
  assert.equal(history.reactions, undefined);
});
