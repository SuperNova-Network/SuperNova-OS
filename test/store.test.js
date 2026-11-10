import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScript } from "./helpers.js";

/** A minimal localStorage + window event surface for the sandbox. */
function makeEnv({ blocked = false, initial = {} } = {}) {
  const data = new Map(Object.entries(initial));
  const handlers = [];
  const localStorage = blocked
    ? new Proxy({}, { get() { throw new DOMException("denied", "SecurityError"); } })
    : {
        get length() { return data.size; },
        // Newest first, not insertion order: browsers make no promise about key
        // order, and Chrome reorders keys as items are added.
        key: (index) => [...data.keys()].reverse()[index] ?? null,
        getItem: (key) => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => data.set(key, String(value)),
        removeItem: (key) => data.delete(key),
        clear: () => data.clear(),
      };
  const env = {
    localStorage,
    addEventListener: (type, handler) => handlers.push({ type, handler }),
    /** Simulate another document changing storage. */
    storageEvent: (key, newValue) => handlers.filter((h) => h.type === "storage").forEach((h) => h.handler({ key, newValue })),
    data,
  };
  env.store = loadBrowserScript("public/proxy/store.js", env).SnStore;
  return env;
}

test("values round-trip through localStorage under the sn. prefix", () => {
  const { store, data } = makeEnv();
  store.set("engine", "uv");
  assert.equal(store.get("engine"), "uv");
  assert.equal(data.get("sn.engine"), "uv");
});

test("registered defaults apply until a value is set, and survive remove()", () => {
  const { store } = makeEnv();
  store.defaults({ engine: "sj" });
  assert.equal(store.get("engine"), "sj");
  store.set("engine", "uv");
  assert.equal(store.get("engine"), "uv");
  store.remove("engine");
  assert.equal(store.get("engine"), "sj");
  assert.equal(store.get("nothing"), undefined);
});

test("values are stored as strings, flags read back as booleans", () => {
  const { store } = makeEnv();
  store.set("anticlose", 1);
  assert.equal(store.get("anticlose"), "1");
  assert.equal(store.flag("anticlose"), true);
  store.set("anticlose", "0");
  assert.equal(store.flag("anticlose"), false);
  assert.equal(store.flag("unset"), false);
});

test("listeners hear local changes and can unsubscribe", () => {
  const { store } = makeEnv();
  const seen = [];
  const stop = store.onChange((key, value) => seen.push([key, value]));
  store.set("search", "google");
  store.defaults({ search: "brave" });
  store.remove("search");
  stop();
  store.set("search", "bing");
  assert.deepEqual(seen, [["search", "google"], ["search", "brave"]]);
});

test("changes from other tabs are announced and read through", () => {
  const env = makeEnv();
  const seen = [];
  env.store.onChange((key, value) => seen.push([key, value]));
  env.data.set("sn.cloak", "canvas");
  env.storageEvent("sn.cloak", "canvas");
  assert.deepEqual(seen, [["cloak", "canvas"]]);
  assert.equal(env.store.get("cloak"), "canvas");
});

test("a stale in-memory value does not shadow a change from another tab", () => {
  const env = makeEnv();
  env.store.set("cloak", "classroom");          // this tab remembers "classroom"
  env.data.set("sn.cloak", "canvas");           // another tab changes it
  env.storageEvent("sn.cloak", "canvas");
  env.data.delete("sn.cloak");                  // and storage then becomes unavailable for this key
  env.storageEvent("sn.cloak", null);
  assert.notEqual(env.store.get("cloak"), "classroom");
});

test("unrelated storage keys and clear() are handled", () => {
  const env = makeEnv();
  const seen = [];
  env.store.onChange((key) => seen.push(key));
  env.storageEvent("somethingElse", "x");
  env.storageEvent(null, null);
  assert.deepEqual(seen, ["*"]);
});

test("when storage is blocked the store still works in memory", () => {
  const { store } = makeEnv({ blocked: true });
  store.defaults({ engine: "sj" });
  assert.equal(store.get("engine"), "sj");
  store.set("engine", "uv");
  assert.equal(store.get("engine"), "uv");
});

test("a listener that throws does not break the others", () => {
  const { store } = makeEnv();
  const seen = [];
  const original = console.error;
  console.error = () => {};
  try {
    store.onChange(() => { throw new Error("boom"); });
    store.onChange((key) => seen.push(key));
    store.set("a", "1");
  } finally {
    console.error = original;
  }
  assert.deepEqual(seen, ["a"]);
});

test("desktop keys saved before the store existed move under the prefix once", () => {
  const { store, data } = makeEnv({
    initial: {
      taskArr: "0,2",
      backId: "7",
      customTitle3: "My game",
      "visited-before": "true",
      "sn.colId": "2",      // already migrated: the prefixed value wins
      colId: "5",
      unrelated: "keep",    // not ours: left alone
      "customTitleX": "no", // not a numbered title: left alone
    },
  });
  assert.equal(store.get("taskArr"), "0,2");
  assert.equal(store.get("backId"), "7");
  assert.equal(store.get("customTitle3"), "My game");
  assert.equal(store.get("visited-before"), "true");
  assert.equal(store.get("colId"), "2");
  for (const key of ["taskArr", "backId", "customTitle3", "visited-before", "colId"]) {
    assert.equal(data.has(key), false, `${key} should be removed after migrating`);
  }
  assert.equal(data.get("unrelated"), "keep");
  assert.equal(data.get("customTitleX"), "no");
});

test("clear() erases storage and memory and announces it", () => {
  const { store, data } = makeEnv({ initial: { other: "x" } });
  store.defaults({ engine: "sj" });
  store.set("engine", "uv");
  const seen = [];
  store.onChange((key) => seen.push(key));
  store.clear();
  assert.equal(data.size, 0);
  assert.equal(store.get("engine"), "sj");
  assert.deepEqual(seen, ["*"]);
});

test("clear() works when storage is blocked", () => {
  const { store } = makeEnv({ blocked: true });
  store.set("engine", "uv");
  store.clear();
  assert.equal(store.get("engine"), undefined);
});
