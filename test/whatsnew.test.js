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
  assert.deepEqual(items.map((i) => i.title), ["Chat channels", "Change your username", "A bullet with no bold title at all", "Links and code"]);
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

test("the real changelog gives a readable list, at most twelve, with no stray markup", () => {
  const items = parseWhatsNew(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
  assert.ok(items.length >= 5 && items.length <= 12);
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
