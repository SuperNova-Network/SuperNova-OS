import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { SITES, createSiteCheck } from "../src/sitecheck.js";

// Which popular sites work right now.
const sites = [
  { id: "fine", name: "Fine", url: "https://fine.example/" },
  { id: "walled", name: "Walled", url: "https://walled.example/" },
  { id: "broken", name: "Broken", url: "https://broken.example/" },
  { id: "gone", name: "Gone", url: "https://gone.example/" },
  { id: "late", name: "Late", url: "https://late.example/" },
  { id: "hidden", name: "Hidden", url: "https://hidden.example/" },
];
const respond = (status) => ({ status, body: { cancel: async () => {} } });
const fakeFetch = async (url) => {
  const host = new URL(url).hostname;
  if (host === "fine.example") return respond(200);
  if (host === "walled.example") return respond(403); // a bot check still means it is reachable
  if (host === "broken.example") return respond(503);
  if (host === "gone.example") throw new Error("getaddrinfo ENOTFOUND");
  if (host === "late.example") { await new Promise((resolve) => setTimeout(resolve, 60)); return respond(200); }
  throw new Error(`asked for ${host}, which should have been skipped`);
};

test("each site is up, slow, down or blocked, and a blocked one is never asked", async () => {
  const check = createSiteCheck({ sites, fetch: fakeFetch, blocked: (host) => host === "hidden.example", slowMs: 30 });
  assert.deepEqual(check.results().sites.map((s) => s.state), Array(6).fill("unknown"), "unknown until the first check");
  assert.equal(check.results().checkedAt, 0);
  await check.checkNow();
  const by = Object.fromEntries(check.results().sites.map((s) => [s.id, s]));
  assert.deepEqual(Object.entries(by).map(([id, s]) => [id, s.state]), [["fine", "up"], ["walled", "up"], ["broken", "down"], ["gone", "down"], ["late", "slow"], ["hidden", "blocked"]]);
  assert.equal(typeof by.fine.ms, "number");
  assert.equal(by.gone.ms, null);
  assert.equal(by.hidden.ms, null);
  assert.ok(Math.abs(check.results().checkedAt - Date.now()) < 5000);
});

test("only one run at a time, and a timeout counts as down", async () => {
  let asked = 0;
  const slow = createSiteCheck({
    sites: [{ id: "a", name: "A", url: "https://a.example/" }],
    fetch: (url, { signal }) => { asked++; return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("timed out")))); },
    timeoutMs: 40,
  });
  await Promise.all([slow.checkNow(), slow.checkNow(), slow.checkNow()]);
  assert.equal(asked, 1);
  assert.equal(slow.results().sites[0].state, "down");
});

test("the real list is a dozen well-formed sites", () => {
  assert.ok(SITES.length >= 8);
  assert.equal(new Set(SITES.map((s) => s.id)).size, SITES.length);
  for (const site of SITES) assert.match(site.url, /^https:\/\/[a-z0-9.-]+\/$/);
});

let server, dataDir;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "sn-sites-"));
  server = await startServer({ DATA_DIR: dataDir });
});
after(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

test("the list is public, and 'unknown' while the check is off", async () => {
  const res = await fetch(`${server.url}/api/sites`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.checkedAt, 0);
  assert.ok(body.sites.length >= 8);
  assert.ok(body.sites.every((s) => s.state === "unknown" && s.ms === null && s.id && s.name));
});
