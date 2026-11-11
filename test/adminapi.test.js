import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { toCsv } from "../src/admindb.js";

// The admin API behind the Admin Panel app.
const hasSqlite = await import("node:sqlite").then(() => true, () => false);
const options = { skip: !hasSqlite && "needs node:sqlite (Node 22.13+)" };

let server, dataDir, boss;
before(async () => {
  if (!hasSqlite) return;
  dataDir = mkdtempSync(join(tmpdir(), "sn-adminapi-"));
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
  const ip = `198.51.100.${++clients}`;
  async function call(method, path, body, raw = false, extra = {}) {
    const res = await fetch(server.url + path, {
      method,
      redirect: "manual",
      headers: { "x-forwarded-for": ip, "user-agent": "TestBrowser/1.0", ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...extra },
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
  return { get: (p, extra) => call("GET", p, undefined, false, extra), raw: (p) => call("GET", p, undefined, true), post: (p, b = {}) => call("POST", p, b), get cookie() { return cookie; } };
}
async function person(name = `user${++names}`, password = "password123") {
  const b = browser();
  const r = await b.post("/api/account/register", { username: name, password });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  b.username = name;
  return b;
}
const api = (b, p) => b.get(`/api/admin${p}`);

test("every admin endpoint refuses strangers and ordinary accounts", options, async () => {
  const stranger = browser();
  const member = await person();
  const gets = ["/overview", "/users", "/users/Boss", "/sessions", "/chat/messages", "/announcement", "/maintenance", "/blocklist", "/audit", "/system", "/system/backup", "/export/users.csv", "/export/audit.csv", "/export/chat.csv"];
  const posts = [["/users/Boss/signout"], ["/users/Boss/password", { password: "longenough1" }], ["/users/Boss/delete", { confirm: "Boss" }], ["/users/bulk", { action: "signout", usernames: ["Boss"] }],
    ["/sessions/1/revoke"], ["/invites/bulk", { count: 1 }], ["/announcement", { text: "x", active: true }], ["/maintenance", { on: true }], ["/blocklist", { hosts: [] }], ["/system/prune"]];
  for (const path of gets) {
    assert.equal((await api(stranger, path)).status, 401, `stranger GET ${path}`);
    assert.equal((await api(member, path)).status, 403, `member GET ${path}`);
  }
  for (const [path, body] of posts) {
    assert.equal((await stranger.post(`/api/admin${path}`, body)).status, 401, `stranger POST ${path}`);
    assert.equal((await member.post(`/api/admin${path}`, body)).status, 403, `member POST ${path}`);
  }
  assert.equal((await boss.post("/api/admin/announcement", { text: "x", active: false })).status, 200, "an admin gets through");
});

test("cross-site and non-JSON writes are refused", options, async () => {
  const res = await fetch(server.url + "/api/admin/maintenance", { method: "POST", headers: { "content-type": "application/json", cookie: boss.cookie, origin: "https://evil.example" }, body: JSON.stringify({ on: true }) });
  assert.equal(res.status, 403);
  const plain = await fetch(server.url + "/api/admin/maintenance", { method: "POST", headers: { "content-type": "text/plain", cookie: boss.cookie }, body: "{}" });
  assert.equal(plain.status, 415);
});

test("the dashboard counts people, sessions, invites and chat", options, async () => {
  const a = await person(), b = await person();
  await a.post("/api/chat/messages", { text: "hello dashboard" });
  const { data } = await api(boss, "/overview");
  assert.ok(data.users.total >= 3);
  assert.ok(data.users.admins >= 1, "Boss counts as an admin through ADMINS");
  assert.ok(data.users.today >= 3);
  assert.ok(data.sessions >= 3);
  assert.equal(data.signups.length, 14);
  assert.ok(data.signups.at(-1) >= 3, "today is the last day of the chart");
  assert.ok(data.chat.messages >= 1 && data.messages.at(-1) >= 1);
  assert.ok(Array.isArray(data.recent));
  assert.equal(typeof data.runtime.wisp, "number");
  assert.equal(data.runtime.config.accounts.mode, "optional");
  assert.equal(data.runtime.filter.enabled, true);
  assert.ok(b);
});

test("accounts: searching, filtering, sorting and paging", options, async () => {
  const tag = `pg${Date.now().toString(36)}`;
  for (let i = 1; i <= 5; i++) await person(`${tag}${i}`);
  const found = (await api(boss, `/users?q=${tag}&sort=name&order=asc&pageSize=2&page=2`)).data;
  assert.equal(found.total, 5);
  assert.deepEqual(found.users.map((u) => u.username), [`${tag}3`, `${tag}4`]);
  assert.equal(found.page, 2);
  assert.equal((await api(boss, `/users?q=${tag}&sort=name&order=desc&pageSize=1`)).data.users[0].username, `${tag}5`);
  const admins = (await api(boss, "/users?filter=admins")).data;
  assert.ok(admins.users.some((u) => u.username === "Boss" && u.admin && u.serverAdmin));
  assert.ok(admins.users.every((u) => u.admin));
  assert.ok((await api(boss, "/users?filter=new")).data.total >= 5);
  assert.equal((await api(boss, "/users?filter=banned")).data.users.every((u) => u.banned), true);
  assert.equal((await api(boss, "/users?q=%25")).data.total, 0, "a % in the search is just a character");
  const bad = await api(boss, "/users?sort=password_hash%3B--&order=sideways&pageSize=9999&page=-3");
  assert.equal(bad.status, 200, "odd values are ignored, never run as SQL");
  assert.ok(bad.data.pageSize <= 100);
});

test("account details: sessions with where they came from, messages, history", options, async () => {
  const sam = await person();
  await sam.post("/api/chat/messages", { text: "sam says hi" });
  const detail = (await api(boss, `/users/${sam.username}`)).data;
  assert.equal(detail.username, sam.username);
  assert.equal(detail.messages, 1);
  assert.equal(detail.sessionList.length, 1);
  assert.equal(detail.sessionList[0].userAgent, "TestBrowser/1.0");
  assert.match(detail.sessionList[0].ip, /^198\.51\.100\./);
  assert.equal(detail.recentMessages[0].text, "sam says hi");
  assert.ok(detail.settingsBytes >= 2);
  assert.equal((await api(boss, "/users/nobody-by-this-name")).status, 404);
});

test("signing someone out ends their sessions and is logged", options, async () => {
  const sue = await person();
  assert.equal((await sue.get("/api/account")).data.user.username, sue.username);
  const res = await boss.post(`/api/admin/users/${sue.username}/signout`);
  assert.equal(res.status, 200);
  assert.equal(res.data.ended, 1);
  assert.equal((await sue.get("/api/account")).data.user, null);
  assert.equal((await boss.post("/api/admin/users/nobody-here/signout")).status, 404);
  const log = (await api(boss, `/audit?q=${sue.username}`)).data.entries;
  assert.ok(log.some((e) => e.action === "signed out" && e.actor === "Boss" && e.source === "site"));
});

test("setting a password: it works, signs them out, and is checked", options, async () => {
  const pat = await person(undefined, "oldpassword1");
  assert.equal((await boss.post(`/api/admin/users/${pat.username}/password`, { password: "short" })).status, 400);
  assert.equal((await boss.post(`/api/admin/users/${pat.username}/password`, { password: "brandnewpass1" })).status, 200);
  assert.equal((await pat.get("/api/account")).data.user, null, "signed out everywhere");
  const login = (password) => browser().post("/api/account/login", { username: pat.username, password });
  assert.equal((await login("oldpassword1")).status, 401);
  assert.equal((await login("brandnewpass1")).status, 200);
  // another admin's password is not yours to set
  const other = await person();
  await boss.post(`/api/account/admin/users/${other.username}/admin`);
  assert.equal((await boss.post(`/api/admin/users/${other.username}/password`, { password: "brandnewpass1" })).status, 403);
  await boss.post(`/api/account/admin/users/${other.username}/unadmin`);
  assert.equal((await boss.post("/api/admin/users/nobody-here/password", { password: "brandnewpass1" })).status, 404);
});

test("deleting an account needs the name typed, and spares admins and yourself", options, async () => {
  const del = await person();
  await del.post("/api/chat/messages", { text: "going away" });
  assert.equal((await boss.post(`/api/admin/users/${del.username}/delete`, {})).status, 400);
  assert.equal((await boss.post(`/api/admin/users/${del.username}/delete`, { confirm: "wrong" })).status, 400);
  assert.equal((await boss.post("/api/admin/users/Boss/delete", { confirm: "Boss" })).status, 400, "not yourself");
  const keep = await person();
  await boss.post(`/api/account/admin/users/${keep.username}/admin`);
  assert.equal((await boss.post(`/api/admin/users/${keep.username}/delete`, { confirm: keep.username })).status, 403, "not an admin");
  await boss.post(`/api/account/admin/users/${keep.username}/unadmin`);
  assert.equal((await boss.post(`/api/admin/users/${del.username}/delete`, { confirm: del.username })).status, 200);
  assert.equal((await api(boss, `/users/${del.username}`)).status, 404);
  assert.equal((await del.get("/api/account")).data.user, null);
  assert.ok(!(await api(boss, "/chat/messages?q=going%20away")).data.messages.length);
});

test("bulk actions report each account on its own", options, async () => {
  const one = await person(), two = await person();
  const r = await boss.post("/api/admin/users/bulk", { action: "ban", usernames: [one.username, two.username, "Boss", "ghost-account"], reason: "spam wave" });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.data.results.map((x) => [x.username, x]));
  assert.equal(by[one.username].ok, true);
  assert.equal(by[two.username].ok, true);
  assert.equal(by.Boss.ok, false, "you can't ban yourself");
  assert.equal(by["ghost-account"].ok, false);
  assert.equal((await one.get("/api/account")).data.user, null, "banned people are signed out");
  assert.equal((await api(boss, `/users/${one.username}`)).data.banned, true);
  assert.equal((await api(boss, `/users/${one.username}`)).data.banReason, "spam wave");
  const u = await boss.post("/api/admin/users/bulk", { action: "unban", usernames: [one.username, two.username] });
  assert.ok(u.data.results.every((x) => x.ok));
  assert.equal((await api(boss, `/users/${one.username}`)).data.banned, false);
  const s = await boss.post("/api/admin/users/bulk", { action: "signout", usernames: [one.username] });
  assert.equal(s.data.results[0].ok, true);
  assert.equal((await boss.post("/api/admin/users/bulk", { action: "explode", usernames: ["x"] })).status, 400);
  assert.equal((await boss.post("/api/admin/users/bulk", { action: "ban", usernames: [] })).status, 400);
  assert.equal((await boss.post("/api/admin/users/bulk", { action: "ban", usernames: Array(101).fill("a") })).status, 400);
});

test("sessions: listed with their origin, the current one marked, and any can be ended", options, async () => {
  const kim = await person();
  const list = (await api(boss, `/sessions?q=${kim.username}`)).data;
  assert.equal(list.total, 1);
  assert.equal(list.sessions[0].username, kim.username);
  assert.equal(list.sessions[0].current, false);
  const mine = (await api(boss, "/sessions?q=Boss")).data.sessions;
  assert.ok(mine.some((s) => s.current), "your own session is marked");
  assert.equal((await boss.post(`/api/admin/sessions/${list.sessions[0].id}/revoke`)).status, 200);
  assert.equal((await kim.get("/api/account")).data.user, null);
  assert.equal((await boss.post(`/api/admin/sessions/${list.sessions[0].id}/revoke`)).status, 404, "already ended");
});

test("making many invite codes at once, and they work", options, async () => {
  const bulk = await boss.post("/api/admin/invites/bulk", { count: 3, label: "Period 5", maxUses: 2, expiresInDays: 7 });
  assert.equal(bulk.status, 201);
  assert.equal(bulk.data.codes.length, 3);
  assert.equal(new Set(bulk.data.codes).size, 3);
  assert.equal((await boss.post("/api/admin/invites/bulk", { count: 0 })).status, 400);
  assert.equal((await boss.post("/api/admin/invites/bulk", { count: 51 })).status, 400);
  assert.equal((await boss.post("/api/admin/invites/bulk", { count: 1, maxUses: 0 })).status, 400);
  const invites = (await boss.get("/api/account/admin/invites")).data.invites;
  assert.equal(invites.filter((i) => i.label === "Period 5").length, 3);
});

test("the chat message browser searches, including deleted messages", options, async () => {
  const lee = await person();
  const sent = (await lee.post("/api/chat/messages", { text: "needle in a haystack" })).data.message;
  await lee.post("/api/chat/messages", { text: "another message entirely" }).catch(() => {});
  const hit = (await api(boss, "/chat/messages?q=needle")).data.messages;
  assert.equal(hit.length, 1);
  assert.equal(hit[0].username, lee.username);
  assert.equal((await api(boss, `/chat/messages?username=${lee.username}`)).data.messages.length >= 1, true);
  await boss.post(`/api/chat/admin/messages/${sent.id}/delete`);
  assert.equal((await api(boss, "/chat/messages?q=needle")).data.messages.length, 0, "deleted ones are hidden...");
  const withDeleted = (await api(boss, "/chat/messages?q=needle&deleted=1")).data.messages;
  assert.equal(withDeleted.length, 1);
  assert.equal(withDeleted[0].deleted, true);
  assert.equal(withDeleted[0].deletedBy, "Boss");
});

test("announcements: validated, shown to everyone signed in, and clearable", options, async () => {
  const reader = await person();
  assert.equal((await reader.get("/api/announcement")).data.announcement, null);
  assert.equal((await boss.post("/api/admin/announcement", { text: "   ", active: true })).status, 400);
  const posted = (await boss.post("/api/admin/announcement", { text: "  Server restarts   at 3pm  ", level: "warning", active: true })).data;
  assert.equal(posted.text, "Server restarts at 3pm");
  const seen = (await reader.get("/api/announcement")).data.announcement;
  assert.equal(seen.text, "Server restarts at 3pm");
  assert.equal(seen.level, "warning");
  assert.ok(seen.id > 0);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await boss.post("/api/admin/announcement", { text: "Changed text", level: "nonsense", active: true });
  await new Promise((resolve) => setTimeout(resolve, 3100)); // the setting is cached for a few seconds
  const again = (await reader.get("/api/announcement")).data.announcement;
  assert.equal(again.level, "info", "unknown levels become info");
  assert.ok(again.id > seen.id, "every change is a new announcement, so people see it again");
  await boss.post("/api/admin/announcement", { text: "", active: false });
  await new Promise((resolve) => setTimeout(resolve, 3100));
  assert.equal((await reader.get("/api/announcement")).data.announcement, null);
});

test("maintenance mode closes the site to everyone but admins", options, async () => {
  const user = await person();
  const set = await boss.post("/api/admin/maintenance", { on: true, message: "Back at <3pm>" });
  assert.equal(set.data.on, true);
  await new Promise((resolve) => setTimeout(resolve, 3100));
  try {
    const page = await user.get("/", { accept: "text/html" });
    assert.equal(page.status, 503);
    assert.match(page.text, /Back at &lt;3pm&gt;/, "the message is escaped");
    assert.ok(page.headers.get("retry-after"));
    assert.match(page.text, /<img src="\/resources\/media\/app_icons\/SuperNova\.png"[^>]*><h1>/, "the logo sits above the title");
    assert.match(page.text, /overflow:hidden/, "and the page never scrolls");
    assert.equal((await user.get("/resources/media/app_icons/SuperNova.png")).status, 200, "the logo itself stays reachable");
    const json = await user.post("/api/chat/messages", { text: "hi" });
    assert.equal(json.status, 503);
    assert.equal(json.data.maintenance, true);
    assert.equal((await user.get("/api/account")).status, 200, "sign-in itself stays open");
    assert.equal((await user.get("/healthz")).status, 200);
    assert.equal((await browser().get("/signin", { accept: "text/html" })).status, 200, "the sign-in page stays open");
    assert.equal((await user.get("/resources/css/tokens.css")).status, 200);
    assert.equal((await boss.get("/", { accept: "text/html" })).status, 200, "admins carry on");
    assert.equal((await api(boss, "/overview")).status, 200);
  } finally {
    await boss.post("/api/admin/maintenance", { on: false });
  }
  await new Promise((resolve) => setTimeout(resolve, 3100));
  assert.equal((await user.get("/", { accept: "text/html" })).status, 200, "and it opens again");
});

test("extra blocked sites take effect at once, and bad entries are refused", options, async () => {
  const verdict = (host, query) => browser().post("/api/verdict", { host, query }).then((r) => r.data);
  assert.equal((await verdict("blocked-by-admin.example")).blocked, false);
  const saved = await boss.post("/api/admin/blocklist", { hosts: ["https://www.Blocked-By-Admin.example/page", "  evil.test  "], keywords: ["Scamword"], queryWords: ["cheatsheet"] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.custom.hosts, ["blocked-by-admin.example", "evil.test"], "cleaned up: scheme, www, path and case removed");
  assert.equal((await verdict("blocked-by-admin.example")).blocked, true);
  assert.equal((await verdict("sub.evil.test")).blocked, true, "subdomains too");
  assert.equal((await verdict("my-scamword-site.com")).blocked, true);
  assert.equal((await verdict("fine.example", "free cheatsheet")).blocked, true);
  assert.equal((await verdict("fine.example", "cheatsheets")).blocked, false, "whole words only");
  assert.equal((await verdict("fine.example")).blocked, false);
  for (const bad of [{ hosts: ["not a host"] }, { hosts: ["localhost"] }, { hosts: "x.com" }, { keywords: ["a"] }, { hosts: Array.from({ length: 501 }, (_, i) => `h${i}.example`) }]) {
    assert.equal((await boss.post("/api/admin/blocklist", bad)).status, 400, JSON.stringify(bad).slice(0, 60));
  }
  const info = (await api(boss, "/blocklist")).data;
  assert.equal(info.custom.hosts.length, 2);
  assert.ok(info.builtin.hosts > 5, "the built-in list is summarised");
  await boss.post("/api/admin/blocklist", { hosts: [], keywords: [], queryWords: [] });
  assert.equal((await verdict("blocked-by-admin.example")).blocked, false, "removing them frees the site again");
  assert.equal((await verdict("pornhub.com")).blocked, true, "the built-in list is untouched");
});

test("the audit log records admin actions and the chat's moderation, and can be filtered", options, async () => {
  const lou = await person();
  await boss.post(`/api/account/admin/users/${lou.username}/ban`, { reason: "audit test" });
  await boss.post(`/api/account/admin/users/${lou.username}/unban`);
  const mod = await person();
  await boss.post(`/api/chat/admin/users/${mod.username}/timeout`, { minutes: 5, reason: "cool off" });
  const all = (await api(boss, "/audit?limit=500")).data.entries;
  assert.ok(all.some((e) => e.action === "banned" && e.target === lou.username && e.detail === "audit test" && e.source === "site"));
  assert.ok(all.some((e) => e.action === "unbanned" && e.target === lou.username));
  assert.ok(all.some((e) => e.action === "timeout" && e.target === mod.username && e.source === "chat"));
  const site = (await api(boss, "/audit?source=site&limit=500")).data.entries;
  assert.ok(site.length && site.every((e) => e.source === "site"));
  const chat = (await api(boss, "/audit?source=chat&limit=500")).data.entries;
  assert.ok(chat.length && chat.every((e) => e.source === "chat"));
  const mine = (await api(boss, `/audit?actor=boss&q=${lou.username}`)).data.entries;
  assert.ok(mine.length >= 2 && mine.every((e) => e.actor === "Boss" && (e.target === lou.username)));
  assert.ok(all.every((e, i) => i === 0 || all[i - 1].at >= e.at), "newest first");
  const older = (await api(boss, `/audit?before=${all[2].at}&limit=500`)).data.entries;
  assert.ok(older.every((e) => e.at < all[2].at));
  assert.equal((await api(boss, "/audit?q=%25%25")).data.entries.length, 0, "wildcards in the search are literal");
});

test("server health, tidying and a database backup", options, async () => {
  const sys = (await api(boss, "/system")).data;
  assert.ok(sys.process.uptimeSeconds >= 0 && sys.process.rss > 1e6);
  assert.match(sys.process.node, /^v\d+/);
  assert.ok(sys.database.counts.users >= 1);
  assert.ok(sys.database.bytes.database > 0);
  assert.equal(sys.database.schemaVersion, 7);
  assert.equal(sys.host.fly, null, "not on Fly here");
  const pruned = await boss.post("/api/admin/system/prune");
  assert.equal(pruned.status, 200);
  assert.equal(typeof pruned.data.sessions, "number");
  const backup = await boss.raw("/api/admin/system/backup");
  assert.equal(backup.status, 200);
  assert.match(backup.headers.get("content-disposition"), /supernova-\d{4}-\d{2}-\d{2}\.db/);
  assert.equal(backup.bytes.subarray(0, 15).toString("latin1"), "SQLite format 3", "a real SQLite database");
  assert.ok(backup.bytes.length > 4096);
  const log = (await api(boss, "/audit?q=backup")).data.entries;
  assert.ok(log.some((e) => e.action === "downloaded a database backup"));
  assert.ok(log.length >= 1);
});

test("CSV exports: the right columns, and nothing a spreadsheet would run as a formula", options, async () => {
  const csvUser = await person();
  await csvUser.post("/api/chat/messages", { text: '=SUM(1,2), with "quotes"' });
  const users = (await boss.raw("/api/admin/export/users.csv"));
  assert.equal(users.status, 200);
  assert.match(users.headers.get("content-type"), /text\/csv/);
  const text = users.bytes.toString();
  assert.match(text.split("\r\n")[0], /^username,created,last seen,admin,banned/);
  assert.ok(text.includes(csvUser.username));
  const chat = (await boss.raw("/api/admin/export/chat.csv")).bytes.toString();
  assert.ok(chat.includes(`"'=SUM(1,2), with ""quotes"""`), "formula neutralised and quotes escaped");
  const audit = (await boss.raw("/api/admin/export/audit.csv")).bytes.toString();
  assert.match(audit.split("\r\n")[0], /^time,source,who,action,target,details/);
  assert.ok((await api(boss, "/audit?q=exported")).data.entries.length >= 2, "exports are logged");
});

test("toCsv quotes commas, quotes and newlines, and defuses formulas", () => {
  const out = toCsv([{ label: "a", value: "a" }, { label: "b", value: "b" }], [{ a: "x,y", b: 'say "hi"\nthere' }, { a: "=1+1", b: "@cmd" }, { a: "-5", b: null }]);
  assert.equal(out, 'a,b\r\n"x,y","say ""hi""\nthere"\r\n\'=1+1,\'@cmd\r\n\'-5,\r\n');
});

test("a user who is signed in elsewhere keeps working after an admin changes someone else", options, async () => {
  const stay = await person();
  const gone = await person();
  await boss.post(`/api/admin/users/${gone.username}/signout`);
  assert.equal((await stay.get("/api/account")).data.user.username, stay.username);
});
