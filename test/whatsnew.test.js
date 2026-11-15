import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./helpers.js";
import { parseWhatsNew } from "../src/whatsnew.js";

// The "what's new" list, written from the changelog.
const SAMPLE = `# Changelog

## Unreleased

Intro text.

### Fixed

- **Not this one.** It is a fix.

### Added

- **Chat channels.** The chat now has #general, #help and #off-topic, and admins can add more (Admin Panel > Chat). Each can be limited by role.
- **Change your username** (Settings > Account, once a week). Admins see the old ones. More words here.
- A bullet with no bold title at all. It still gets a title from its first sentence.
- **Links and \`code\`.** See [the docs](https://example.com/docs) for \`npm test\`.

### Changed

- **Nor this.** Changed.

## 3.0.0

### Added

- **Old release.** Should not show.
`;

test("the newest section's Added list becomes titles and first sentences, without markdown", () => {
  const items = parseWhatsNew(SAMPLE);
  assert.deepEqual(items.map((i) => i.title), ["Chat channels", "Change your username", "A bullet with no bold title at all", "Links and code", "Not this one"]);
  assert.equal(items[0].text, "The chat now has #general, #help and #off-topic, and admins can add more (Admin Panel > Chat).");
  assert.equal(items[1].text, "Admins see the old ones.", "a signpost in brackets doesn't stand in for the sentence");
  assert.equal(items[2].text, "");
  assert.equal(items[3].text, "See the docs for npm test.");
  assert.ok(items.every((i) => /^[0-9a-f]{10}$/.test(i.id)));
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, "ids differ");
  assert.equal(parseWhatsNew(SAMPLE)[0].id, items[0].id, "and are stable");
  assert.deepEqual(parseWhatsNew(""), []);
  assert.deepEqual(parseWhatsNew("# Changelog\n\n## Unreleased\n\nNothing added yet.\n"), []);
});

test("the real changelog gives a readable list, at most forty, with no stray markup", () => {
  const items = parseWhatsNew(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
  assert.ok(items.length >= 5 && items.length <= 40);
  for (const item of items) {
    assert.ok(item.title.length > 2 && item.title.length < 90, item.title);
    assert.doesNotMatch(`${item.title} ${item.text}`, /[`*]|\]\(/, item.title);
    assert.ok(Array.from(item.text).length <= 220);
  }
});

let server, dataDir;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "sn-whatsnew-"));
  server = await startServer({ ACCOUNTS: "off", DATA_DIR: dataDir });
});
after(async () => {
  await server?.stop();
  rmSync(dataDir, { recursive: true, force: true });
});

test("anyone can fetch the list", async () => {
  const res = await fetch(`${server.url}/api/whatsnew`);
  assert.equal(res.status, 200);
  const { items } = await res.json();
  assert.ok(items.length >= 5);
  assert.ok(items[0].id && items[0].title);
});

test("each item is dated by the commit that added its line to the changelog", async () => {
  const { execFileSync } = await import("node:child_process");
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { datesOf, createWhatsNew } = await import("../src/whatsnew.js");
  const dir = mkdtempSync(join(tmpdir(), "sn-wn-dates-"));
  try {
    const file = join(dir, "CHANGELOG.md");
    const git = (date, ...args) => execFileSync("git", args, { cwd: dir, env: { ...process.env, GIT_COMMITTER_DATE: date, GIT_AUTHOR_DATE: date, GIT_CONFIG_GLOBAL: "/dev/null" }, stdio: "ignore" });
    const head = "# Changelog\n\n## Unreleased\n\n### Added\n\n";
    git("2026-11-02T12:00:00", "init", "-q");
    git("2026-11-02T12:00:00", "config", "user.email", "t@example.org");
    git("2026-11-02T12:00:00", "config", "user.name", "t");
    writeFileSync(file, `${head}- **Old thing.** It is old.\n`);
    git("2026-11-02T12:00:00", "add", "."); git("2026-11-02T12:00:00", "commit", "-q", "-m", "one");
    writeFileSync(file, `${head}- **New thing.** It is new.\n- **Old thing.** It is old.\n`);
    git("2026-11-12T12:00:00", "add", "."); git("2026-11-12T12:00:00", "commit", "-q", "-m", "two");
    const items = createWhatsNew(file)();
    assert.deepEqual(items.map((i) => [i.title, i.date]), [["New thing", "2026-11-12"], ["Old thing", "2026-11-02"]]);
    assert.deepEqual(Object.values(datesOf(items, file)).sort(), ["2026-11-02", "2026-11-12"]);
    // with a dates file (a deploy, with no .git) it is used as it is
    const written = join(dir, "dates.json");
    writeFileSync(written, JSON.stringify({ [items[0].id]: "2026-01-01" }));
    assert.equal(createWhatsNew(file, written)()[0].date, "2026-01-01");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
