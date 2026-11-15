import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { chatKit } from "./chatkit.js";

// Reports of chat messages and profiles, and the one inbox the admins read them in (apps come into it too).
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, kit, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-reports-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  kit = chatKit(() => server, "198.19.3");
  boss = await kit.person("Boss");
  await boss.post("/api/chat/admin/settings", { slowSeconds: 0 });
});
after(async () => {
  kit?.closeAll();
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

const say = async (who, text, extra = {}) => (await who.post("/api/chat/messages", { text, ...extra })).data.message;
const inbox = async () => (await boss.get("/api/admin/reports")).data;
const find = async (ref) => (await inbox()).items.find((i) => i.ref === ref);

test("people report a message, once each, and not their own or one they can't see", options, async () => {
  const [ann, bea, cy] = [await kit.person(), await kit.person(), await kit.person()];
  const message = await say(ann, "buy cheap followers at example dot com");
  assert.equal((await kit.browser().post(`/api/chat/messages/${message.id}/report`, { reason: "spam" })).status, 401);
  assert.equal((await ann.post(`/api/chat/messages/${message.id}/report`, { reason: "spam" })).status, 400, "your own");
  assert.equal((await bea.post(`/api/chat/messages/${message.id}/report`, { reason: "nonsense" })).status, 400, "a real reason");
  assert.equal((await bea.post(`/api/chat/messages/${message.id}/report`, { reason: "spam", note: "  looks   like a bot " })).status, 201);
  assert.equal((await bea.post(`/api/chat/messages/${message.id}/report`, { reason: "scam" })).status, 409, "once each");
  assert.equal((await cy.post(`/api/chat/messages/${message.id}/report`, { reason: "scam" })).status, 201);
  assert.equal((await bea.post("/api/chat/messages/999999/report", { reason: "spam" })).status, 404);
  // in a channel they can't read
  const staff = (await boss.post("/api/chat/admin/channels", { name: "reportstaff", readRoles: [(await boss.get("/api/admin/roles")).data.roles.find((r) => r.slug === "moderator").id] })).data.channel;
  const secret = await say(boss, "private", { channel: staff.id });
  assert.equal((await bea.post(`/api/chat/messages/${secret.id}/report`, { reason: "spam" })).status, 404);

  const item = await find(`m:${message.id}`);
  assert.equal(item.kind, "message");
  assert.equal(item.count, 2);
  assert.equal(item.user.username, ann.username);
  assert.equal(item.message.text, "buy cheap followers at example dot com");
  assert.equal(item.message.deleted, false);
  assert.deepEqual(item.reasons.map((r) => [r.reason, r.count]).sort(), [["scam", 1], ["spam", 1]]);
  assert.equal(item.reports.find((r) => r.reporter === bea.username).note, "looks like a bot");
});

test("deleting the message settles its reports, and the text stays for the record", options, async () => {
  const [ann, bea] = [await kit.person(), await kit.person()];
  const message = await say(ann, "something nasty");
  await bea.post(`/api/chat/messages/${message.id}/report`, { reason: "harassment" });
  assert.ok(await find(`m:${message.id}`));
  assert.equal((await boss.post(`/api/chat/admin/messages/${message.id}/delete`)).status, 200);
  assert.equal(await find(`m:${message.id}`), undefined, "handled by deleting it");
  // a message deleted while its reports are still open still shows what it said
  const other = await say(ann, "also nasty");
  await bea.post(`/api/chat/messages/${other.id}/report`, { reason: "inappropriate" });
  await boss.post("/api/chat/admin/clear");
  const item = await find(`m:${other.id}`);
  assert.equal(item.message.deleted, true);
  assert.equal(item.message.text, "also nasty");
});

test("profiles can be reported, and a bio cleared from the inbox", options, async () => {
  const [ann, bea] = [await kit.person(), await kit.person()];
  await ann.post("/api/account/bio", { bio: "not very nice words" });
  assert.equal((await ann.post(`/api/friends/profile/${ann.username}/report`, { reason: "other" })).status, 400, "not yourself");
  assert.equal((await bea.post(`/api/friends/profile/${ann.username}/report`, { reason: "spam" })).status, 400, "reasons are per kind");
  assert.equal((await bea.post(`/api/friends/profile/${ann.username}/report`, { reason: "inappropriate", note: "the bio" })).status, 201);
  assert.equal((await bea.post(`/api/friends/profile/${ann.username}/report`, { reason: "other" })).status, 409);
  assert.equal((await bea.post("/api/friends/profile/nobody-here/report", { reason: "other" })).status, 404);
  const item = (await inbox()).items.find((i) => i.kind === "profile" && i.user.username === ann.username);
  assert.equal(item.count, 1);
  assert.equal(item.user.username, ann.username);
  assert.equal((await boss.post(`/api/admin/users/${ann.username}/clear-bio`)).status, 200);
  assert.equal((await bea.get(`/api/friends/profile/${ann.username}`)).data.bio, "");
  assert.equal((await boss.post("/api/admin/reports/resolve", { ref: item.ref })).status, 200);
  assert.equal(await find(item.ref), undefined);
  assert.equal((await boss.post("/api/admin/reports/resolve", { ref: item.ref })).status, 404, "already dealt with");
  assert.equal((await boss.post("/api/admin/reports/resolve", { ref: "x:1" })).status, 400);
});

test("app reports are in the same inbox, and only admins read it", options, async () => {
  const [maker, ann] = [await kit.person(), await kit.person()];
  await boss.post("/api/admin/store/settings", { approval: "auto" });
  const app = await maker.post("/api/store/apps", { name: "Reported App", description: "A site that is not what it says", url: "https://example.org/", category: "other" });
  assert.equal(app.status, 201, JSON.stringify(app.data));
  const listed = app.data.app;
  assert.equal((await ann.post(`/api/store/apps/${listed.id}/report`, { reason: "misleading" })).status, 201);
  const item = await find(`a:${listed.id}`);
  assert.equal(item.kind, "app");
  assert.equal(item.app.name, "Reported App");
  assert.equal(item.app.owner, maker.username);
  assert.equal(item.count, 1);
  assert.ok((await inbox()).open >= 1);
  assert.equal((await ann.get("/api/admin/reports")).status, 403);
  assert.equal((await kit.browser().get("/api/admin/reports")).status, 401);
  assert.equal((await ann.post("/api/admin/reports/resolve", { ref: "m:1" })).status, 403);
  assert.ok((await boss.get("/api/admin/overview")).data.reports >= 1, "the dashboard counts them");
});
