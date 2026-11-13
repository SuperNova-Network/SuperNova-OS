import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDescribe, readBuildInfo } from "../src/buildinfo.js";

test("git describe output is understood", () => {
  assert.deepEqual(parseDescribe("v3.4.0-12-gb4a455e"), { tag: "v3.4.0", ahead: 12, commit: "b4a455e", dirty: false });
  assert.deepEqual(parseDescribe("v3.4.0-12-gb4a455e-dirty"), { tag: "v3.4.0", ahead: 12, commit: "b4a455e", dirty: true });
  assert.deepEqual(parseDescribe("b4a455e"), { tag: null, ahead: 0, commit: "b4a455e", dirty: false }, "no tags yet");
  assert.deepEqual(parseDescribe("v3.4.0"), { tag: "v3.4.0", ahead: 0, commit: null, dirty: false }, "exactly on a tag");
  assert.deepEqual(parseDescribe("release-2-final-5-gabcdef0"), { tag: "release-2-final", ahead: 5, commit: "abcdef0", dirty: false }, "dashes in a tag name");
  assert.equal(parseDescribe(""), null);
});

test("build-info.json wins, and a folder with neither falls back to the package version", () => {
  const dir = mkdtempSync(join(tmpdir(), "sn-build-"));
  try {
    assert.deepEqual(readBuildInfo(dir, "1.2.3"), { tag: "v1.2.3", ahead: 0, commit: null, dirty: false, date: null });
    writeFileSync(join(dir, "build-info.json"), JSON.stringify({ tag: "v9.9.9", ahead: 3, commit: "abc1234", dirty: false, date: "2026-11-13T00:00:00Z" }));
    assert.deepEqual(readBuildInfo(dir, "1.2.3"), { tag: "v9.9.9", ahead: 3, commit: "abc1234", dirty: false, date: "2026-11-13T00:00:00Z" });
    writeFileSync(join(dir, "build-info.json"), "not json");
    assert.equal(readBuildInfo(dir, "1.2.3").tag, "v1.2.3", "a damaged file is ignored");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the repository itself reports its commit", () => {
  const info = readBuildInfo(new URL("../", import.meta.url).pathname, "0.0.0");
  assert.ok(info.commit === null || /^[0-9a-f]{4,40}$/.test(info.commit));
});
