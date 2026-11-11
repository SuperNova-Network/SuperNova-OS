import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { samples } from "./images.js";
import { checkSubmission, normalizeUrl } from "../src/storedb.js";

// The App Store API, and the approval queue behind the Admin Panel.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-appstore-"));
  server = await startServer({ ACCOUNTS: "optional", ACCOUNTS_SIGNUP: "open", ADMINS: "Boss", DATA_DIR: dataDir, TRUST_PROXY: "1" });
  boss = await person("Boss");
});
after(async () => {
  await server?.stop();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

let clients = 0, names = 0;
function browser() {
  let cookie = "";
  const ip = `203.0.113.${++clients}`;
  async function call(method, path, body, raw = false) {
    const res = await fetch(server.url + path, {
      method,
      redirect: "manual",
      headers: { "x-forwarded-for": ip, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    if (raw) return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, headers: res.headers, data, text };
  }
  return { get: (p) => call("GET", p), raw: (p) => call("GET", p, undefined, true), post: (p, b = {}) => call("POST", p, b) };
}
async function person(name = `maker${++names}`) {
  const b = browser();
  const r = await b.post("/api/account/register", { username: name, password: "password123" });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  b.username = name;
  return b;
}
let sites = 0;
const submission = (extra = {}) => ({ name: `Cool App ${++sites}`, description: "A small app that does a useful thing.", category: "tools", url: `https://app${sites}.example.com/`, ...extra });
const setApproval = (approval) => boss.post("/api/admin/store/settings", { approval });

test("the address, name and description of an app are checked", () => {
  assert.equal(normalizeUrl("example.com/play/").url, "https://example.com/play/");
  assert.equal(normalizeUrl("https://Example.com/a/#top").key, "example.com/a");
  assert.equal(normalizeUrl("https://example.com/a/").key, normalizeUrl("https://example.com/a").key);
  for (const bad of ["", "javascript:alert(1)", "data:text/html,hi", "ftp://example.com", "http://localhost:3000", "http://127.0.0.1", "https://192.168.1.1/x", "https://user:pw@example.com", "https://has space.com", "https://intranet", "https://x.internal"]) {
    assert.throws(() => normalizeUrl(bad), `${bad}`);
  }
  assert.throws(() => checkSubmission({ ...submission(), name: "x" }), /name/);
  assert.throws(() => checkSubmission({ ...submission(), description: "short" }), /sentence/);
  assert.throws(() => checkSubmission({ ...submission(), category: "weapons" }), /category/);
  const ok = checkSubmission({ ...submission(), name: "  Zalgo​  App ", description: "Line one\n\n\n\nLine two\nthree\nfour\nfive" });
  assert.equal(ok.name, "Zalgo App");
  assert.equal(ok.description.split("\n").length, 4);
});

test("the store needs an account, and only your own apps can be edited", options, async () => {
  assert.equal((await browser().get("/api/store/apps")).status, 401);
  assert.equal((await browser().post("/api/store/apps", submission())).status, 401);
  const maker = await person(), other = await person();
  await setApproval("auto");
  const made = await maker.post("/api/store/apps", submission());
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const id = made.data.app.id;
  assert.equal((await other.post(`/api/store/apps/${id}`, submission())).status, 403);
  assert.equal((await other.post(`/api/store/apps/${id}/delete`)).status, 403);
  assert.equal((await maker.post(`/api/store/apps/${id}`, { ...submission(), name: "Renamed" })).data.app.name, "Renamed");
  assert.equal((await maker.post(`/api/store/apps/${id}/delete`)).status, 200);
  assert.equal((await other.get("/api/store/apps")).data.apps.some((a) => a.id === id), false);
});

test("manual approval: new apps wait for an admin, and only then appear", options, async () => {
  await setApproval("manual");
  const maker = await person(), reader = await person();
  const made = await maker.post("/api/store/apps", submission({ icon: samples.png[0] }));
  assert.equal(made.status, 201);
  assert.equal(made.data.live, false);
  assert.equal(made.data.app.status, "pending");
  const id = made.data.app.id;

  assert.equal((await reader.get("/api/store/apps")).data.apps.some((a) => a.id === id), false, "hidden from others");
  assert.equal((await reader.post(`/api/store/apps/${id}/install`)).status, 404, "can't install what isn't approved");
  assert.equal((await reader.raw(`/api/store/icon/${id}`)).status, 404, "its icon is private too");
  assert.equal((await maker.raw(`/api/store/icon/${id}`)).status, 200, "but the owner sees it");
  assert.equal((await maker.get("/api/store/mine")).data.apps[0].status, "pending");

  const queue = (await boss.get("/api/admin/store?status=pending")).data;
  assert.ok(queue.apps.some((a) => a.id === id));
  assert.ok(queue.counts.pending >= 1);
  assert.ok((await boss.get("/api/admin/overview")).data.store.pending >= 1);

  assert.equal((await boss.post(`/api/admin/store/apps/${id}/approve`)).status, 200);
  const listed = (await reader.get("/api/store/apps")).data.apps.find((a) => a.id === id);
  assert.ok(listed, "visible once approved");
  assert.equal(listed.owner, maker.username);
  assert.equal(listed.icon, 1);
  assert.equal((await reader.raw(`/api/store/icon/${id}`)).status, 200);
  assert.equal((await boss.get("/api/admin/audit")).data.entries.some((e) => e.action === "approved a store app"), true);
});

test("a rejected app shows its reason to the owner, and an edit sends it back to review", options, async () => {
  await setApproval("manual");
  const maker = await person();
  const id = (await maker.post("/api/store/apps", submission())).data.app.id;
  assert.equal((await boss.post(`/api/admin/store/apps/${id}/reject`, { reason: "Please add a real description." })).status, 200);
  const mine = (await maker.get("/api/store/mine")).data.apps.find((a) => a.id === id);
  assert.deepEqual([mine.status, mine.reason], ["rejected", "Please add a real description."]);
  const fixed = await maker.post(`/api/store/apps/${id}`, { ...submission(), name: "Better App", url: mine.url });
  assert.equal(fixed.data.app.status, "pending");
  assert.equal(fixed.data.app.reason, null);
});

test("automatic approval puts apps straight in the store, and editing an approved app keeps it live", options, async () => {
  await setApproval("auto");
  const maker = await person();
  const made = await maker.post("/api/store/apps", submission());
  assert.equal(made.data.live, true);
  assert.equal(made.data.app.status, "approved");
  assert.equal((await maker.post(`/api/store/apps/${made.data.app.id}`, { ...submission(), url: made.data.app.url })).data.app.status, "approved");
  // With manual approval an edit to a live app goes back to the queue.
  await setApproval("manual");
  assert.equal((await maker.post(`/api/store/apps/${made.data.app.id}`, { ...submission(), name: "New name", url: made.data.app.url })).data.app.status, "pending");
  await setApproval("auto");
});

test("an admin's own apps always go live", options, async () => {
  await setApproval("manual");
  const made = await boss.post("/api/store/apps", submission());
  assert.equal(made.data.app.status, "approved");
});

test("duplicates, limits, paused publishing and blocked sites are refused", options, async () => {
  await setApproval("auto");
  const maker = await person();
  const first = submission();
  assert.equal((await maker.post("/api/store/apps", first)).status, 201);
  assert.equal((await (await person()).post("/api/store/apps", { ...submission(), url: first.url.replace("https://", "HTTPS://") + "#again" })).status, 409, "same address");

  await boss.post("/api/admin/store/settings", { maxPerUser: 2 });
  assert.equal((await maker.post("/api/store/apps", submission())).status, 201);
  assert.equal((await maker.post("/api/store/apps", submission())).status, 400, "over the limit");
  await boss.post("/api/admin/store/settings", { maxPerUser: 5, publishing: false });
  assert.equal((await (await person()).post("/api/store/apps", submission())).status, 403, "publishing paused");
  assert.equal((await boss.post("/api/store/apps", submission())).status, 201, "admins can still publish");
  await boss.post("/api/admin/store/settings", { publishing: true });

  await boss.post("/api/admin/blocklist", { hosts: ["blocked-example.com"], keywords: [], queryWords: ["forbiddenword"] });
  const other = await person();
  assert.equal((await other.post("/api/store/apps", submission({ url: "https://www.blocked-example.com/x" }))).status, 400);
  assert.equal((await other.post("/api/store/apps", submission({ description: "This has a forbiddenword in it." }))).status, 400);
  await boss.post("/api/admin/blocklist", { hosts: [], keywords: [], queryWords: [] });
});

test("icons are checked by what they really are", options, async () => {
  await setApproval("auto");
  const maker = await person();
  assert.equal((await maker.post("/api/store/apps", submission({ icon: samples.gif[0] }))).status, 400, "no GIFs");
  assert.equal((await maker.post("/api/store/apps", submission({ icon: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>").toString("base64") }))).status, 400, "no SVG");
  assert.equal((await maker.post("/api/store/apps", submission({ icon: "not base64!" }))).status, 400);
  const good = await maker.post("/api/store/apps", submission({ icon: samples.jpeg[0] }));
  assert.equal(good.status, 201);
  const served = await maker.raw(`/api/store/icon/${good.data.app.id}`);
  assert.equal(served.headers.get("content-type"), "image/jpeg");
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");
  const removed = await maker.post(`/api/store/apps/${good.data.app.id}`, { ...submission(), url: good.data.app.url, icon: null });
  assert.equal(removed.data.app.icon, 0);
  assert.equal((await maker.raw(`/api/store/icon/${good.data.app.id}`)).status, 404);
});

test("installing counts each person once, and apps can be searched and sorted", options, async () => {
  await setApproval("auto");
  const maker = await person(), fan = await person(), fan2 = await person();
  const tag = `Zebra${Date.now()}`;
  const a = (await maker.post("/api/store/apps", submission({ name: `${tag} Alpha`, category: "games" }))).data.app.id;
  const b = (await maker.post("/api/store/apps", submission({ name: `${tag} Beta`, category: "media" }))).data.app.id;
  await fan.post(`/api/store/apps/${b}/install`);
  await fan.post(`/api/store/apps/${b}/install`);
  await fan2.post(`/api/store/apps/${b}/install`);
  const found = (await fan.get(`/api/store/apps?q=${tag}`)).data.apps;
  assert.deepEqual(found.map((x) => [x.id, x.installs, x.installed]), [[b, 2, true], [a, 0, false]], "most installed first");
  assert.deepEqual((await fan.get(`/api/store/apps?q=${tag}&category=games`)).data.apps.map((x) => x.id), [a]);
  assert.deepEqual((await fan.get(`/api/store/apps?q=${tag}&sort=name`)).data.apps.map((x) => x.id), [a, b]);
  await fan.post(`/api/store/apps/${b}/uninstall`);
  assert.equal((await fan2.get(`/api/store/apps?q=${tag}`)).data.apps.find((x) => x.id === b).installs, 1);
  // "%" in a search is a letter, not a wildcard.
  assert.equal((await fan.get("/api/store/apps?q=%25")).data.apps.length, 0);
});

test("every store admin endpoint refuses strangers and ordinary accounts", options, async () => {
  const stranger = browser(), member = await person();
  for (const path of ["/store"]) {
    assert.equal((await stranger.get(`/api/admin${path}`)).status, 401);
    assert.equal((await member.get(`/api/admin${path}`)).status, 403);
  }
  for (const path of ["/store/settings", "/store/apps/1/approve", "/store/apps/1/reject", "/store/apps/1/delete"]) {
    assert.equal((await stranger.post(`/api/admin${path}`, {})).status, 401, path);
    assert.equal((await member.post(`/api/admin${path}`, {})).status, 403, path);
  }
  assert.equal((await boss.post("/api/admin/store/settings", { approval: "sometimes" })).status, 400);
  assert.equal((await boss.post("/api/admin/store/settings", { maxPerUser: 0 })).status, 400);
});

test("deleting an app as an admin removes it for everyone", options, async () => {
  await setApproval("auto");
  const maker = await person(), reader = await person();
  const id = (await maker.post("/api/store/apps", submission())).data.app.id;
  assert.equal((await boss.post(`/api/admin/store/apps/${id}/delete`)).status, 200);
  assert.equal((await reader.get("/api/store/apps")).data.apps.some((a) => a.id === id), false);
  assert.equal((await boss.post(`/api/admin/store/apps/${id}/delete`)).status, 404);
});
