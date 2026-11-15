import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { chatKit, settle } from "./chatkit.js";
import { openDatabase } from "../src/accountsdb.js";
import { DEFINITIONS, EVENTS, GROUPS, TOTAL_POINTS, createAchievements } from "../src/achievements.js";

// Achievements: worked out from what people do, unlocked once, told to them, and never taken away.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

test("the list is well formed", () => {
  assert.equal(new Set(DEFINITIONS.map((d) => d.id)).size, DEFINITIONS.length, "unique ids");
  for (const def of DEFINITIONS) {
    assert.ok(def.name && def.description && def.glyph, def.id);
    assert.ok(GROUPS.includes(def.group), `${def.id}: group ${def.group}`);
    assert.ok(Number.isInteger(def.goal) && def.goal >= 1 && def.points >= 1, def.id);
    if (def.stat.startsWith("ev_")) assert.ok(EVENTS.has(def.stat.slice(3)), `${def.id} watches an event the desktop can't send`);
  }
  assert.ok(DEFINITIONS.length >= 30);
  assert.equal(TOTAL_POINTS, DEFINITIONS.reduce((sum, d) => sum + d.points, 0));
});

test("streaks count days in a row, once a day, and a gap starts again", options, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-streak-"));
  try {
    const db = await openDatabase(dir);
    db.prepare("INSERT INTO users (username, password_hash, recovery_hash, created_at, updated_at, last_seen_at) VALUES ('streaky', 'x', 'y', 1, 1, 1)").run();
    const id = db.prepare("SELECT id FROM users").get().id;
    const ach = createAchievements({ db });
    const day = (n) => `2026-11-${String(n).padStart(2, "0")}`;
    const at = (n) => Date.UTC(2026, 10, n, 12);
    const streak = () => ach.list(id).streak;
    ach.record(id, "daily", { day: day(10), now: at(10) });
    assert.deepEqual(streak(), { current: 1, best: 1 });
    ach.record(id, "daily", { day: day(10), now: at(10) });
    assert.equal(streak().current, 1, "twice in a day is one day");
    ach.record(id, "daily", { day: day(11), now: at(11) });
    ach.record(id, "daily", { day: day(12), now: at(12) });
    assert.deepEqual(streak(), { current: 3, best: 3 });
    assert.ok(ach.evaluate(id, at(12)).some((a) => a.id === "on_a_roll"), "three days unlocks On a roll");
    ach.record(id, "daily", { day: day(15), now: at(15) });
    assert.deepEqual(streak(), { current: 1, best: 3 }, "a missed day starts again, the best is kept");
    ach.record(id, "daily", { day: day(14), now: at(15) }); // a clock that went backwards changes nothing
    assert.equal(streak().current, 1);
    assert.throws(() => ach.record(id, "daily", { day: "yesterday", now: at(15) }), /today's date/);
    assert.throws(() => ach.record(id, "daily", { day: day(25), now: at(15) }), /isn't today/);
    assert.throws(() => ach.record(id, "unlock_everything"), /isn't something that counts/);
    // milestones follow from unlocks, in the same pass
    for (const def of DEFINITIONS.slice(0, 9)) db.prepare("INSERT OR IGNORE INTO user_achievements (user_id, achievement, unlocked_at) VALUES (?, ?, 1)").run(id, def.id);
    const more = ach.evaluate(id, at(15)).map((a) => a.id);
    assert.ok(more.includes("getting_good"), "the tenth achievement earns a milestone");
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

let server, dataDir, kit, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-achievements-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  kit = chatKit(() => server, "198.19.6");
  boss = await kit.person("Boss");
  await boss.post("/api/chat/admin/settings", { slowSeconds: 0 });
  await boss.post("/api/admin/store/settings", { approval: "auto" });
});
after(async () => {
  kit?.closeAll();
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const mine = async (who) => (await who.get("/api/achievements")).data;
const unlocked = async (who) => (await mine(who)).achievements.filter((a) => a.unlockedAt).map((a) => a.id);
async function until(check, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const value = await check(); if (value) return value; await settle(100); }
  return check();
}

test("signing in earns the first one, and the list says what is left", options, async () => {
  const ann = await kit.person();
  assert.equal((await kit.browser().get("/api/achievements")).status, 401);
  const data = await mine(ann);
  assert.equal(data.achievements.length, DEFINITIONS.length);
  assert.deepEqual(data.achievements.filter((a) => a.unlockedAt).map((a) => a.id), ["welcome"]);
  assert.equal(data.totals.unlocked, 1);
  assert.equal(data.totals.points, 5);
  assert.equal(data.totals.total, DEFINITIONS.length);
  const chatty = data.achievements.find((a) => a.id === "chatterbox");
  assert.deepEqual([chatty.goal, chatty.progress, chatty.unlockedAt], [25, 0, null]);
  assert.ok(data.groups.length >= 5);
});

test("doing things unlocks them, and the person is told on their open connection", options, async () => {
  const [ann, bea] = [await kit.person(), await kit.person()];
  const quiet = await ann.listen("?quiet=1");
  await quiet.waitFor("ready");
  const sent = await ann.post("/api/chat/messages", { text: "hello achievements" });
  assert.equal(sent.status, 201);
  const told = await quiet.waitFor("achievement", (a) => a.id === "first_words", 4000);
  assert.deepEqual([told.name, told.points], ["First words", 5]);
  assert.ok(told.unlockedAt > 0);
  // reply, react, friend, bio, rename, picture-less things
  await bea.post("/api/chat/messages", { text: "answer me" });
  const theirs = (await bea.get(`/api/chat/messages?limit=5`)).data.messages.at(-1);
  await ann.post("/api/chat/messages", { text: "an answer", replyTo: theirs.id });
  // ten different reactions on one message (a person may give ten), so she is reacted to ten times and bea reacts ten times
  const liked = (await ann.post("/api/chat/messages", { text: "react to this one" })).data.message;
  for (const emoji of ["\u{1F600}", "\u{1F601}", "\u{1F602}", "\u{1F603}", "\u{1F604}", "\u{1F605}", "\u{1F606}", "\u{1F607}", "\u{1F608}", "\u{1F609}"]) await bea.post(`/api/chat/messages/${liked.id}/reactions`, { emoji });
  await ann.post("/api/friends/request", { username: bea.username });
  await bea.post("/api/friends/accept", { username: ann.username });
  await ann.post("/api/account/bio", { bio: "I like achievements" });
  assert.equal((await ann.post("/api/account/rename", { username: `${ann.username}x`, password: "password123" })).status, 200);
  const earned = await until(async () => { const list = await unlocked(ann); return ["replier", "loved", "friendly", "bio", "renamed"].every((id) => list.includes(id)) && list; });
  for (const id of ["welcome", "first_words", "replier", "loved", "friendly", "bio", "renamed"]) assert.ok(earned.includes(id), `${id} in ${earned}`);
  assert.ok(!earned.includes("popular"), "one friend is not five");
  // the other person earned for what they did too
  const theirList = await until(async () => { const list = await unlocked(bea); return ["friendly", "reactor"].every((id) => list.includes(id)) && list; });
  assert.ok(theirList.includes("friendly") && theirList.includes("reactor"));
  // each is told once: the list has no repeats and totals add up
  const data = await mine(ann);
  assert.equal(data.totals.unlocked, data.achievements.filter((a) => a.unlockedAt).length);
  assert.equal(data.totals.points, data.achievements.filter((a) => a.unlockedAt).reduce((sum, a) => sum + a.points, 0));
});

test("the App Store counts: publishing, installing, rating, and being installed", options, async () => {
  const [maker, fan] = [await kit.person(), await kit.person()];
  const made = await maker.post("/api/store/apps", { name: "Achievement App", description: "A test app for the achievements", url: "https://achieve.example.org/", category: "other" });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.ok((await until(async () => (await unlocked(maker)).includes("maker"))), "publishing earns Maker");
  await fan.post(`/api/store/apps/${made.data.app.id}/install`);
  await fan.post(`/api/store/apps/${made.data.app.id}/rate`, { stars: 5 });
  const list = await until(async () => { const l = await unlocked(fan); return l.includes("welcome") && l; });
  const progress = (await mine(fan)).achievements.find((a) => a.id === "critic");
  assert.deepEqual([progress.progress, progress.goal], [1, 3]);
  assert.ok(list);
});

test("the desktop reports only what is on the list, and a daily visit keeps the streak", options, async () => {
  const ann = await kit.person();
  assert.equal((await ann.post("/api/achievements/event", { event: "browser_opened" })).status, 200);
  assert.ok((await unlocked(ann)).includes("web_surfer"));
  const reply = await ann.post("/api/achievements/event", { event: "terminal" });
  assert.deepEqual(reply.data.unlocked.map((a) => a.id), ["hackerman"]);
  assert.equal((await ann.post("/api/achievements/event", { event: "terminal" })).data.unlocked.length, 0, "only once");
  assert.equal((await ann.post("/api/achievements/event", { event: "make_me_rich" })).status, 400);
  assert.equal((await ann.post("/api/achievements/event", {})).status, 400);
  assert.equal((await kit.browser().post("/api/achievements/event", { event: "pin" })).status, 401);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  assert.equal((await ann.post("/api/achievements/event", { event: "daily", day: today })).status, 200);
  assert.equal((await mine(ann)).streak.current, 1);
  assert.equal((await ann.post("/api/achievements/event", { event: "daily", day: "2020-01-01" })).status, 400, "not today");
});

test("nothing is taken away: deleting what earned it leaves it earned", options, async () => {
  const ann = await kit.person();
  const m = await ann.post("/api/chat/messages", { text: "i will be deleted" });
  assert.ok(await until(async () => (await unlocked(ann)).includes("first_words")));
  await boss.post(`/api/chat/admin/messages/${m.data.message.id}/delete`);
  await boss.post("/api/chat/admin/clear");
  assert.ok((await unlocked(ann)).includes("first_words"));
  void settle;
});
