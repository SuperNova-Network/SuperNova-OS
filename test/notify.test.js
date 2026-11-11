import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScript } from "./helpers.js";

const load = (store) => loadBrowserScript("public/resources/scripts/notify-core.js", store ? { SnStore: store } : {}).SnNotifyCore;
const core = load();
const read = (values) => (key) => values[key];
// Objects made inside the script's sandbox have another Object prototype; compare plain copies.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("defaults: notifications are on in general, but the Chat's are off until turned on", () => {
  const s = core.parse(read({}));
  assert.deepEqual(plain(s), {
    enabled: true, dnd: false, chat: false, banners: true, sound: true, preview: true, pictures: true,
    durationMs: 5000, theme: "dark", size: "small", position: "bottom-right",
  });
});

test("stored values are read, and odd ones fall back to the default", () => {
  const s = core.parse(read({ notifyChat: "1", notifyDnd: "1", notifySound: "0", notifyDuration: "30", notifyTheme: "accent", notifySize: "standard", notifyPosition: "top-left" }));
  assert.equal(s.chat, true);
  assert.equal(s.dnd, true);
  assert.equal(s.sound, false);
  assert.equal(s.durationMs, 30_000);
  assert.equal(s.theme, "accent");
  assert.equal(s.size, "standard");
  assert.equal(s.position, "top-left");
  const odd = core.parse(read({ notifyDuration: "99", notifyTheme: "neon", notifySize: "huge", notifyPosition: "middle", notifyChat: "yes" }));
  assert.equal(odd.durationMs, 5000);
  assert.equal(odd.theme, "dark");
  assert.equal(odd.size, "small");
  assert.equal(odd.position, "bottom-right");
  assert.equal(odd.chat, false);
  for (const seconds of core.DURATIONS) assert.equal(core.parse(read({ notifyDuration: String(seconds) })).durationMs, seconds * 1000);
});

test("it registers its defaults in the store, so Settings shows them", () => {
  const registered = {};
  load({ defaults: (map) => Object.assign(registered, map), get: () => undefined });
  assert.equal(registered.notifyChat, "0");
  assert.equal(registered.notifyTheme, "dark");
  assert.equal(registered.notifyPosition, "bottom-right");
});

test("the stack may reach three quarters of the way up the lower half of the screen", () => {
  assert.equal(core.stackLimit(1000), 375);
  assert.equal(core.stackLimit(800), 300);
});

test("overflow removes the oldest notifications until the rest fit, but never the newest", () => {
  assert.equal(core.overflow([80, 80, 80], 6, 400), 0, "fits");
  assert.equal(core.overflow([80, 80, 80], 6, 252), 0, "exactly fits");
  assert.equal(core.overflow([80, 80, 80], 6, 251), 1, "one too many");
  assert.equal(core.overflow([80, 80, 80, 80], 6, 170), 2);
  assert.equal(core.overflow([80, 80, 80], 6, 10), 2, "the newest always stays");
  assert.equal(core.overflow([], 6, 100), 0);
  assert.equal(core.overflow([500], 6, 100), 0);
  assert.equal(core.overflow([60, 90, 60], 4, 160), 1, "mixed heights");
});

test("a chat message becomes a title and a short text", () => {
  const message = { user: { username: "alice" }, text: "  hi   there \n you ", media: null };
  assert.deepEqual(plain(core.describeChat(message, true)), { title: "alice", text: "hi there you" });
  assert.deepEqual(plain(core.describeChat(message, false)), { title: "alice", text: "Sent a message" }, "no preview: the text stays private");
  assert.deepEqual(plain(core.describeChat({ user: { username: "bo" }, text: "", media: { kind: "upload", id: "x" } }, true)), { title: "bo", text: "Sent a GIF" });
  assert.deepEqual(plain(core.describeChat({ user: { username: "bo" }, text: "look", media: { kind: "giphy", id: "x" } }, true)), { title: "bo", text: "look (GIF)" });
  assert.deepEqual(plain(core.describeChat({}, true)), { title: "Someone", text: "Sent a message" });
});

test("a person's colour is stable", () => {
  assert.equal(core.avatarColor("alice"), core.avatarColor("alice"));
  assert.match(core.avatarColor("bob"), /^#[0-9a-f]{6}$/);
});
