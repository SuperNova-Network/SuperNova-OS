import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScript } from "./helpers.js";

/** cloak.js touches the DOM only after DOMContentLoaded; a loading-state stub keeps it inert. */
function loadCloak(settings = {}) {
  const data = new Map(Object.entries(settings).map(([k, v]) => [`sn.${k}`, v]));
  const env = {
    localStorage: { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) },
    document: { readyState: "loading", addEventListener() {} },
    EventTarget: { prototype: { addEventListener() {} } },
    addEventListener() {},
  };
  const store = loadBrowserScript("public/proxy/store.js", env);
  env.SnStore = store.SnStore;
  return loadBrowserScript("public/resources/scripts/cloak.js", env).SnCloak;
}

const key = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("every preset has a title and a usable icon", () => {
  const { presets } = loadCloak();
  assert.ok(presets.length >= 10);
  const ids = new Set();
  for (const preset of presets) {
    assert.ok(preset.title, `${preset.id} title`);
    assert.match(preset.icon, /^(https:\/\/|\/)/, `${preset.id} icon`);
    assert.ok(!ids.has(preset.id), `duplicate id ${preset.id}`);
    ids.add(preset.id);
  }
});

test("the default look is Google Classroom, and settings select presets", () => {
  assert.equal(loadCloak().current().id, "classroom");
  assert.equal(loadCloak({ cloak: "canvas" }).current().title, "Dashboard");
  assert.equal(loadCloak({ cloak: "no-such-preset" }).current().id, "classroom", "unknown ids fall back");
});

test("a custom cloak uses the supplied title and a safe icon only", () => {
  const custom = (extra) => loadCloak({ cloak: "custom", ...extra }).current();
  assert.equal(custom({ cloakTitle: "Math homework", cloakIcon: "https://example.com/i.png" }).title, "Math homework");
  assert.equal(custom({ cloakTitle: "Math homework", cloakIcon: "https://example.com/i.png" }).icon, "https://example.com/i.png");
  assert.equal(custom({ cloakTitle: "x", cloakIcon: "/resources/media/app_icons/SuperNova.png" }).icon, "/resources/media/app_icons/SuperNova.png");
  for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "//evil.example/i.png", "file:///etc/passwd", "ftp://x/i.png"]) {
    assert.equal(custom({ cloakTitle: "x", cloakIcon: bad }).icon, "", bad);
  }
  assert.equal(custom({}).title, "SuperNova OS", "empty custom title falls back");
});

test("key combos are built from event.code so they survive keyboard layouts", () => {
  const { comboFromEvent } = loadCloak();
  assert.equal(comboFromEvent(key("KeyP", { ctrlKey: true, altKey: true })), "Ctrl+Alt+KeyP");
  assert.equal(comboFromEvent(key("Backquote")), "Backquote");
  assert.equal(comboFromEvent(key("Escape", { shiftKey: true, metaKey: true })), "Shift+Meta+Escape");
});

test("pressing only a modifier is not a combo", () => {
  const { comboFromEvent } = loadCloak();
  for (const code of ["ControlLeft", "ShiftRight", "AltLeft", "MetaLeft"]) assert.equal(comboFromEvent(key(code, { ctrlKey: true })), "", code);
  assert.equal(comboFromEvent({}), "");
});

test("combos are shown in a friendly form", () => {
  const { formatCombo } = loadCloak();
  assert.equal(formatCombo("Ctrl+Alt+KeyP"), "Ctrl + Alt + P");
  assert.equal(formatCombo("Shift+Digit1"), "Shift + 1");
  assert.equal(formatCombo("Backquote"), "`");
  assert.equal(formatCombo("Ctrl+ArrowUp"), "Ctrl + Up");
  assert.equal(formatCombo(""), "Not set");
});

test("the panic URL can only ever be an http(s) address", () => {
  const { safeNavigationUrl } = loadCloak();
  assert.equal(safeNavigationUrl("https://classroom.google.com"), "https://classroom.google.com");
  assert.equal(safeNavigationUrl("classroom.google.com/h"), "https://classroom.google.com/h", "scheme is added");
  assert.equal(safeNavigationUrl("http://example.com"), "http://example.com");
  for (const bad of ["javascript:alert(1)", "data:text/html,hi", "file:///x", "", "   ", null]) {
    assert.equal(safeNavigationUrl(bad), "https://classroom.google.com", String(bad));
  }
});
