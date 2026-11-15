import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { chatKit } from "./chatkit.js";

// Profile cards and bios.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, kit, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-profile-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  kit = chatKit(() => server, "198.19.2");
  boss = await kit.person("Boss");
});
after(async () => {
  kit?.closeAll();
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const card = (who, name) => who.get(`/api/friends/profile/${encodeURIComponent(name)}`);
const befriend = async (a, b) => { await a.post("/api/friends/request", { username: b.username }); await b.post("/api/friends/accept", { username: a.username }); };

test("a card shows who someone is, and needs a sign-in", options, async () => {
  const [ann, bea] = [await kit.person(), await kit.person()];
  assert.equal((await card(kit.browser(), ann.username)).status, 401);
  const seen = (await card(bea, ann.username)).data;
  assert.equal(seen.username, ann.username);
  assert.equal(seen.self, false);
  assert.equal(seen.bio, "");
  assert.ok(Math.abs(seen.joinedAt - Date.now()) < 60_000);
  assert.deepEqual(seen.relation, { friends: false, pending: null, blockedByMe: false });
  assert.equal(seen.status, undefined, "a stranger's status stays private");
  assert.deepEqual(seen.mutual, { count: 0, people: [] });
  assert.equal((await card(ann, ann.username)).data.self, true);
  assert.equal((await card(bea, "nobody-here")).status, 404);
  // roles show: an admin has the Admin role
  assert.ok((await card(bea, "Boss")).data.admin);
});

test("a bio is a line or two of plain text, kept to length and run through the blocked words", options, async () => {
  const ann = await kit.person();
  const saved = await ann.post("/api/account/bio", { bio: "  I like   maps\nand tea  " });
  assert.equal(saved.data.bio, "I like maps and tea");
  assert.equal((await card(await kit.person(), ann.username)).data.bio, "I like maps and tea");
  assert.equal((await ann.get("/api/account")).data.user.bio, "I like maps and tea");
  const long = await ann.post("/api/account/bio", { bio: "x".repeat(300) });
  assert.equal(long.data.bio.length, 160);
  assert.equal((await ann.post("/api/account/bio", { bio: "" })).data.bio, "");
  await boss.post("/api/chat/admin/settings", { words: ["badword"] });
  assert.equal((await ann.post("/api/account/bio", { bio: "this is a Badword here" })).status, 400);
  assert.equal((await kit.browser().post("/api/account/bio", { bio: "hi" })).status, 401);
});

test("mutual friends and the relation are shown, status only to friends, and blocking hides you", options, async () => {
  const [ann, bea, cy, dee] = [await kit.person(), await kit.person(), await kit.person(), await kit.person()];
  await befriend(ann, cy);
  await befriend(bea, cy);
  const view = (await card(ann, bea.username)).data;
  assert.deepEqual(view.mutual.people.map((p) => p.username), [cy.username]);
  assert.equal(view.mutual.count, 1);
  assert.equal(view.relation.friends, false);
  await ann.post("/api/friends/request", { username: bea.username });
  assert.equal((await card(ann, bea.username)).data.relation.pending, "out");
  assert.equal((await card(bea, ann.username)).data.relation.pending, "in");
  await bea.post("/api/friends/accept", { username: ann.username });
  const friends = (await card(ann, bea.username)).data;
  assert.equal(friends.relation.friends, true);
  assert.ok(["online", "away", "offline"].includes(friends.status));
  // invisible friends read as offline
  await bea.post("/api/friends/status", { mode: "invisible" });
  assert.equal((await card(ann, bea.username)).data.status, "offline");
  // blocked: they can't see you at all; you still see them, with the way to unblock
  await dee.post("/api/friends/block", { username: ann.username });
  assert.equal((await card(ann, dee.username)).status, 404);
  assert.equal((await card(dee, ann.username)).data.relation.blockedByMe, true);
});
