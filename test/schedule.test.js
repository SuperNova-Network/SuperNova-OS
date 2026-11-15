import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { chatKit, settle } from "./chatkit.js";
import { openDatabase } from "../src/accountsdb.js";
import { cancelScheduled, liveAnnouncement, saveAnnouncement, scheduleAnnouncement, takeDueAnnouncement, listScheduled } from "../src/admindb.js";

// Announcements written ahead of time, and ones that come down by themselves.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

test("scheduling is checked, listed soonest first, and can be cancelled before it goes out", options, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-schedule-"));
  try {
    const db = await openDatabase(dir);
    const now = 1_000_000_000_000;
    const hour = 3_600_000;
    assert.throws(() => scheduleAnnouncement(db, { text: "", startsAt: now + hour }, "me", now), /Write the announcement/);
    assert.throws(() => scheduleAnnouncement(db, { text: "x" }, "me", now), /when it should go out/);
    assert.throws(() => scheduleAnnouncement(db, { text: "x", startsAt: "soon" }, "me", now), /isn't a time/);
    assert.throws(() => scheduleAnnouncement(db, { text: "x", startsAt: now - 2 * hour }, "me", now), /already passed/);
    assert.throws(() => scheduleAnnouncement(db, { text: "x", startsAt: now + 400 * 24 * hour }, "me", now), /within a year/);
    assert.throws(() => scheduleAnnouncement(db, { text: "x", startsAt: now + hour, endsAt: now + hour }, "me", now), /come down after/);
    const later = scheduleAnnouncement(db, { text: "  Restart   at six ", level: "warning", startsAt: now + 3 * hour }, "boss", now);
    const sooner = scheduleAnnouncement(db, { text: "Maintenance soon", level: "nonsense", startsAt: now + hour, endsAt: now + 2 * hour }, "boss", now);
    assert.equal(later.text, "Restart at six");
    assert.equal(sooner.level, "info");
    assert.deepEqual(listScheduled(db).map((i) => i.text), ["Maintenance soon", "Restart at six"]);
    cancelScheduled(db, later.id);
    assert.throws(() => cancelScheduled(db, later.id), /already gone out|isn't there/);
    assert.deepEqual(listScheduled(db).map((i) => i.id), [sooner.id]);
    // 20 waiting at most
    for (let i = 0; i < 19; i++) scheduleAnnouncement(db, { text: `n${i}`, startsAt: now + (i + 5) * hour }, "boss", now);
    assert.throws(() => scheduleAnnouncement(db, { text: "one too many", startsAt: now + 100 * hour }, "boss", now), /20 waiting/);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("when the time comes the latest due one goes out, an expired one is skipped, and endsAt ends the live one", options, async () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-schedule2-"));
  try {
    const db = await openDatabase(dir);
    const now = 2_000_000_000_000;
    const minute = 60_000;
    scheduleAnnouncement(db, { text: "first", startsAt: now + minute }, "a", now);
    scheduleAnnouncement(db, { text: "second", level: "danger", startsAt: now + 2 * minute, endsAt: now + 10 * minute }, "a", now);
    scheduleAnnouncement(db, { text: "already over", startsAt: now + 3 * minute, endsAt: now + 4 * minute }, "a", now);
    assert.equal(takeDueAnnouncement(db, now + 30_000), null, "nothing yet");
    const out = takeDueAnnouncement(db, now + 2 * minute + 1000);
    assert.deepEqual([out.text, out.level, out.endsAt], ["second", "danger", now + 10 * minute], "the latest due one; the earlier one is skipped");
    assert.equal(takeDueAnnouncement(db, now + 2 * minute + 2000), null, "each goes out once");
    assert.equal(takeDueAnnouncement(db, now + 9 * minute), null, "one that is already over is marked sent and not shown");
    assert.deepEqual(listScheduled(db).filter((i) => i.sentAt === null), []);
    // an announcement with an end time
    assert.throws(() => saveAnnouncement(db, { text: "x", active: true, endsAt: now - 1 }, "a", now), /in the future/);
    const saved = saveAnnouncement(db, { text: "temporary", active: true, endsAt: now + minute }, "a", now);
    assert.equal(liveAnnouncement(saved, now + 30_000).active, true);
    assert.equal(liveAnnouncement(saved, now + 2 * minute).active, false);
    db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

let server, dataDir, kit, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-schedule-live-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  kit = chatKit(() => server, "198.19.5");
  boss = await kit.person("Boss");
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test("over the API: only admins schedule, and a scheduled announcement really goes out on its own", options, async () => {
  const pat = await kit.person();
  assert.equal((await pat.post("/api/admin/announcement/schedule", { text: "x", startsAt: Date.now() + 60_000 })).status, 403);
  assert.equal((await kit.browser().post("/api/admin/announcement/schedule", { text: "x", startsAt: Date.now() + 60_000 })).status, 401);
  assert.equal((await boss.post("/api/admin/announcement/schedule", { text: "nope", startsAt: Date.now() - 3_600_000 })).status, 400);
  const waiting = await boss.post("/api/admin/announcement/schedule", { text: "Goes out soon", level: "info", startsAt: Date.now() + 1200, endsAt: Date.now() + 9000 });
  assert.equal(waiting.status, 201);
  const listed = (await boss.get("/api/admin/announcement")).data;
  assert.equal(listed.active, false, "not yet");
  assert.equal(listed.scheduled.length, 1);
  assert.equal((await pat.get("/api/announcement")).data.announcement, null);
  // the server checks every few seconds
  let seen = null;
  for (let i = 0; i < 40 && !seen; i++) { await settle(500); seen = (await pat.get("/api/announcement")).data.announcement; }
  assert.equal(seen?.text, "Goes out soon");
  assert.equal((await boss.get("/api/admin/announcement")).data.scheduled.filter((s) => s.sentAt === null).length, 0);
  const log = (await boss.get("/api/admin/audit?q=scheduled")).data.entries;
  assert.ok(log.some((e) => e.action === "a scheduled announcement went out"));
  // and it comes down by itself at its end time
  let gone = false;
  for (let i = 0; i < 40 && !gone; i++) { await settle(500); gone = (await pat.get("/api/announcement")).data.announcement === null; }
  assert.equal(gone, true, "came down at its end time");
  // cancelling over the API
  const second = (await boss.post("/api/admin/announcement/schedule", { text: "Never mind", startsAt: Date.now() + 3_600_000 })).data.item;
  assert.equal((await boss.post(`/api/admin/announcement/schedule/${second.id}/delete`)).status, 200);
  assert.equal((await boss.post(`/api/admin/announcement/schedule/${second.id}/delete`)).status, 404);
});
