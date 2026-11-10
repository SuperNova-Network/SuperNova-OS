import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScript } from "./helpers.js";

/** A real SnStore over an in-memory localStorage, plus SnBackup, in one sandbox. */
function makeEnv(initial = {}) {
  const data = new Map(Object.entries(initial));
  const localStorage = {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    clear: () => data.clear(),
  };
  const { SnStore } = loadBrowserScript("public/proxy/store.js", { localStorage, addEventListener() {} });
  const { SnBackup } = loadBrowserScript("public/proxy/backup.js");
  return { store: SnStore, backup: SnBackup, data };
}

// Objects made in the sandbox have its prototypes; compare them as plain data.
const plain = (value) => JSON.parse(JSON.stringify(value));

const file = (settings, extra = {}) => JSON.stringify({ format: "supernova-settings", version: 1, exported: "2026-11-09T12:00:00.000Z", settings, ...extra });

test("an export holds every setting except the device-only ones", () => {
  const { store, backup } = makeEnv({
    "sn.backId": "4",
    "sn.customApps": '[{"name":"Wiki","url":"https://wikipedia.org/"}]',
    "sn.history": '[{"url":"https://example.com/"}]',
    "sn.visited-before": "true",
    "unrelated": "not ours",
  });
  store.set("engine", "uv");
  const out = plain(backup.create(store, new Date("2026-11-09T12:00:00Z")));
  assert.deepEqual(out, {
    format: "supernova-settings",
    version: 1,
    exported: "2026-11-09T12:00:00.000Z",
    settings: { backId: "4", customApps: '[{"name":"Wiki","url":"https://wikipedia.org/"}]', engine: "uv" },
  });
});

test("an export can be imported again", () => {
  const source = makeEnv({ "sn.colId": "2", "sn.bookmarks": "[]", "sn.cloak": "canvas" });
  const text = JSON.stringify(source.backup.create(source.store));
  const target = makeEnv();
  const parsed = target.backup.parse(text);
  assert.equal(parsed.count, 3);
  assert.equal(parsed.skipped, 0);
  target.backup.apply(target.store, parsed.settings);
  assert.equal(target.store.get("colId"), "2");
  assert.equal(target.store.get("cloak"), "canvas");
});

test("importing replaces settings but keeps history and first-visit flags", () => {
  const { store, backup, data } = makeEnv({
    "sn.colId": "1",
    "sn.panicKey": "Ctrl+Q",
    "sn.history": "[1]",
    "sn.visited-before": "true",
    "other-site-data": "x",
  });
  const parsed = backup.parse(file({ colId: "3", history: "[2]", "visited-before": "false" }));
  backup.apply(store, parsed.settings);
  assert.equal(store.get("colId"), "3");
  assert.equal(store.get("panicKey"), undefined, "settings missing from the backup are removed");
  assert.equal(store.get("history"), "[1]", "history in a backup is ignored");
  assert.equal(store.get("visited-before"), "true");
  assert.equal(data.get("other-site-data"), "x", "storage that is not ours is left alone");
});

test("files that are not backups are refused with a readable message", () => {
  const { backup } = makeEnv();
  const refused = (text) => assert.throws(() => backup.parse(text), (err) => err.backup === true && typeof err.message === "string");
  refused("not json");
  refused("null");
  refused("[]");
  refused(JSON.stringify({ format: "something-else", version: 1, settings: {} }));
  refused(file([]));
  refused(file("x"));
  refused(file({}, { version: 0 }));
  refused("x".repeat(1_000_001));
  refused(file(Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`k${i}`, "v"]))));
  assert.throws(() => backup.parse(file({}, { version: 2 })), /newer version/);
});

test("odd entries are skipped, not trusted", () => {
  const { backup } = makeEnv();
  const parsed = backup.parse(JSON.stringify({
    format: "supernova-settings",
    version: 1,
    settings: JSON.parse('{"colId":"2","n":5,"obj":{},"bad key":"x","__proto__":"polluted","big":"' + "a".repeat(200_001) + '"}'),
  }));
  assert.deepEqual(Object.keys(parsed.settings), ["colId"]);
  assert.equal(parsed.skipped, 5);
  assert.equal(Object.getPrototypeOf(parsed.settings), null);
  assert.equal(parsed.exported, null);
});

test("a backup that changes the Wisp server comes with a warning", () => {
  const { backup } = makeEnv();
  assert.equal(backup.parse(file({ wisp: "" })).warnings.length, 0);
  const { warnings } = backup.parse(file({ wisp: "wss://someone-else.example/wisp/" }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /someone-else\.example/);
});

test("entries() lists set values without defaults, also when storage is blocked", () => {
  const { store } = makeEnv({ "sn.a": "1", "plain": "2" });
  store.defaults({ b: "default" });
  store.set("c", "3");
  assert.deepEqual(plain(store.entries()), { a: "1", c: "3" });

  const blocked = loadBrowserScript("public/proxy/store.js", {
    localStorage: new Proxy({}, { get() { throw new Error("denied"); } }),
    addEventListener() {},
  }).SnStore;
  blocked.set("x", "1");
  assert.deepEqual(plain(blocked.entries()), { x: "1" });
});
