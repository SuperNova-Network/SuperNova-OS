import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScript } from "./helpers.js";

// The shared live connections: one connection for every open tab (streamhub.js), reached through streams.js.

/** A stand-in for EventSource that remembers what it was asked and lets a test make things arrive. */
function fakeEventSource() {
  const made = [];
  class FakeEventSource {
    constructor(url) { this.url = url; this.listeners = {}; this.readyState = 0; this.closed = false; made.push(this); }
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
    close() { this.closed = true; this.readyState = 2; }
    emit(name, data = "") { for (const fn of this.listeners[name] || []) fn({ data }); }
  }
  return { FakeEventSource, made };
}

/** A hub running in its own sandbox, and a way to connect a "tab" (a port) to it. */
function hubWorld() {
  const { FakeEventSource, made } = fakeEventSource();
  const timers = [];
  const sandbox = loadBrowserScript("public/resources/scripts/streamhub.js", {
    EventSource: FakeEventSource,
    setTimeout: (fn, ms) => { const timer = { fn, ms, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cleared = true; },
  });
  const flush = () => { for (const timer of timers.splice(0)) if (!timer.cleared) timer.fn(); };
  function tab() {
    const received = [];
    const hubSide = { onmessage: null, postMessage: (message) => received.push(message), start() {} };
    sandbox.onconnect({ ports: [hubSide] });
    return { received, send: (message) => hubSide.onmessage({ data: message }) };
  }
  return { made, flush, tab };
}

test("the first tab opens the connection and gets every event, with the connection's state", () => {
  const { made, tab } = hubWorld();
  const one = tab();
  one.send({ type: "open", id: 1, url: "/api/live", events: ["hello", "announcement"] });
  assert.equal(made.length, 1);
  assert.equal(made[0].url, "/api/live");
  made[0].readyState = 1;
  made[0].emit("open");
  made[0].emit("hello", '{"announcement":null}');
  made[0].emit("announcement", '{"id":7}');
  assert.deepEqual(one.received.map((m) => [m.id, m.type, m.event, m.data, m.readyState]), [
    [1, "event", "open", "", 1],
    [1, "event", "hello", '{"announcement":null}', 1],
    [1, "event", "announcement", '{"id":7}', 1],
  ]);
  made[0].readyState = 2;
  made[0].emit("error");
  assert.equal(one.received.at(-1).readyState, 2, "a refusal reaches the tab with the connection closed");
});

test("a second tab shares it: one connection open at a time, started again so the new tab gets the start-up message", () => {
  const { made, flush, tab } = hubWorld();
  const [one, two] = [tab(), tab()];
  one.send({ type: "open", id: 1, url: "/api/chat/stream?quiet=1", events: ["ready", "message"] });
  two.send({ type: "open", id: 5, url: "/api/chat/stream?quiet=1", events: ["ready", "message"] });
  assert.equal(made.length, 1, "no second connection while the new tab waits a moment");
  flush();
  assert.equal(made.length, 2);
  assert.equal(made[0].closed, true, "the old one is closed when the new one opens");
  assert.equal(made[1].closed, false);
  made[1].emit("ready", '{"unread":3}');
  made[1].emit("message", '{"text":"hi"}');
  for (const [t, id] of [[one, 1], [two, 5]]) {
    assert.deepEqual(t.received.filter((m) => m.event === "ready" || m.event === "message").map((m) => [m.id, m.event]), [[id, "ready"], [id, "message"]], "each tab hears it once, under its own id");
  }
  // events from the connection that was replaced never arrive
  made[0].emit("message", '{"text":"stale"}');
  assert.equal(one.received.filter((m) => m.data === '{"text":"stale"}').length, 0);
});

test("leaving: other tabs keep it, the last one out closes it, and a tab that goes away takes all of its own", () => {
  const { made, flush, tab } = hubWorld();
  const [one, two] = [tab(), tab()];
  one.send({ type: "open", id: 1, url: "/api/live", events: ["hello"] });
  two.send({ type: "open", id: 1, url: "/api/live", events: ["hello"] });
  flush();
  const current = made.at(-1);
  one.send({ type: "close", id: 1 });
  assert.equal(current.closed, false, "the other tab still needs it");
  current.emit("hello", "{}");
  assert.equal(one.received.filter((m) => m.event === "hello").length, 0, "the tab that left hears nothing more");
  assert.equal(two.received.filter((m) => m.event === "hello").length, 1);
  two.send({ type: "bye" });
  assert.equal(current.closed, true, "nobody is left");
  // and it can be opened afresh afterwards
  const three = tab();
  three.send({ type: "open", id: 2, url: "/api/live", events: ["hello"] });
  assert.equal(made.at(-1).closed, false);
  assert.notEqual(made.at(-1), current);
});

test("a tab can ask for more events later, and only the site's own streams are opened", () => {
  const { made, tab } = hubWorld();
  const one = tab();
  one.send({ type: "open", id: 1, url: "/api/live", events: ["hello"] });
  one.send({ type: "events", id: 1, events: ["maintenance"] });
  made[0].emit("maintenance", '{"on":true}');
  assert.equal(one.received.filter((m) => m.event === "maintenance").length, 1);
  for (const url of ["https://example.com/api/live", "//evil.example/api/live", "/healthz", "/api/../secret", "/api/live#x", "http://127.0.0.1/api/live"]) {
    one.send({ type: "open", id: 9, url, events: ["x"] });
  }
  assert.equal(made.length, 1, "nothing else was opened");
});

test("a browser that can't run EventSource in a worker is told, so the tab connects by itself", () => {
  const sandbox = loadBrowserScript("public/resources/scripts/streamhub.js", { setTimeout, clearTimeout });
  const received = [];
  sandbox.onconnect({ ports: [{ onmessage: null, postMessage: (m) => received.push(m), start() {} }] });
});

// --- the tab's side: streams.js ----------------------------------------------------------------------------

/** A tab: streams.js loaded with a SharedWorker that is wired to the given hub, or with none. */
function tabWith({ hub, shared = true }) {
  const { FakeEventSource, made } = fakeEventSource();
  const ticks = [];
  const globals = { EventSource: FakeEventSource, setTimeout: (fn) => { ticks.push(fn); return ticks.length; }, addEventListener() {}, console };
  if (shared) {
    globals.SharedWorker = class {
      constructor() {
        const toTab = (message) => this.port.onmessage?.({ data: message });
        const hubPort = { onmessage: null, postMessage: toTab, start() {} };
        this.port = { onmessage: null, postMessage: (message) => hubPort.onmessage({ data: message }), start() {} };
        hub.sandbox.onconnect({ ports: [hubPort] });
      }
    };
  }
  const sandbox = loadBrowserScript("public/resources/scripts/streams.js", globals);
  return { sandbox, nativeMade: made, tick: () => { for (const fn of ticks.splice(0)) fn(); } };
}

function realHub() {
  const { FakeEventSource, made } = fakeEventSource();
  const timers = [];
  const sandbox = loadBrowserScript("public/resources/scripts/streamhub.js", {
    EventSource: FakeEventSource,
    setTimeout: (fn) => { const timer = { fn, cleared: false }; timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cleared = true; },
  });
  return { sandbox, made, flush: () => { for (const timer of timers.splice(0)) if (!timer.cleared) timer.fn(); } };
}

test("two tabs create() the same stream and share one connection; each hears what arrives", () => {
  const hub = realHub();
  const [a, b] = [tabWith({ hub }), tabWith({ hub })];
  assert.equal(a.sandbox.SnStreams.shared, true);
  const heardA = [], heardB = [];
  const one = a.sandbox.SnStreams.create("/api/live");
  one.addEventListener("hello", (event) => heardA.push(event.data));
  a.tick();
  const two = b.sandbox.SnStreams.create("/api/live");
  two.addEventListener("hello", (event) => heardB.push(JSON.parse(event.data)));
  b.tick();
  hub.flush();
  assert.equal(hub.made.filter((s) => !s.closed).length, 1, "one connection for both tabs");
  hub.made.find((s) => !s.closed).emit("hello", '{"ok":true}');
  assert.deepEqual(heardA, ['{"ok":true}']);
  assert.deepEqual(heardB, [{ ok: true }]);
  assert.equal(one.readyState, 0);
  hub.made.find((s) => !s.closed).readyState = 2;
  hub.made.find((s) => !s.closed).emit("error");
  assert.equal(one.readyState, 2, "readyState follows the connection, so a refusal can be told from a hiccup");
  one.close();
  assert.equal(one.readyState, 2);
  hub.made.find((s) => !s.closed)?.emit("hello", '{"later":1}');
  assert.equal(heardA.length, 1, "a closed stream hears nothing more");
  two.close();
  assert.equal(hub.made.filter((s) => !s.closed).length, 0, "the last tab out closes the connection");
});

test("without SharedWorker it is an ordinary connection, with the same listeners", () => {
  const tab = tabWith({ hub: null, shared: false });
  assert.equal(tab.sandbox.SnStreams.shared, false);
  const stream = tab.sandbox.SnStreams.create("/api/chat/stream?quiet=1");
  assert.equal(tab.nativeMade.length, 1);
  assert.equal(tab.nativeMade[0].url, "/api/chat/stream?quiet=1");
  let heard = null;
  stream.addEventListener("ready", (event) => { heard = event.data; });
  tab.nativeMade[0].emit("ready", "x");
  assert.equal(heard, "x");
});

test("when the hub says it can't, the tab opens its own connection with the listeners it already added", () => {
  const sandbox = loadBrowserScript("public/resources/scripts/streamhub.js", { setTimeout, clearTimeout }); // no EventSource in this worker
  const { FakeEventSource, made } = fakeEventSource();
  const ticks = [];
  const tabSandbox = loadBrowserScript("public/resources/scripts/streams.js", {
    EventSource: FakeEventSource,
    setTimeout: (fn) => { ticks.push(fn); return 1; },
    addEventListener() {},
    console,
    SharedWorker: class {
      constructor() {
        const hubPort = { onmessage: null, postMessage: (message) => this.port.onmessage?.({ data: message }), start() {} };
        this.port = { onmessage: null, postMessage: (message) => hubPort.onmessage({ data: message }), start() {} };
        sandbox.onconnect({ ports: [hubPort] });
      }
    },
  });
  let heard = null;
  const stream = tabSandbox.SnStreams.create("/api/live");
  stream.addEventListener("hello", (event) => { heard = event.data; });
  for (const fn of ticks.splice(0)) fn();
  assert.equal(made.length, 1, "it connected by itself");
  made[0].emit("hello", "{}");
  assert.equal(heard, "{}");
});

test("a SharedWorker that fails to start sends every tab back to its own connection", () => {
  const { FakeEventSource, made } = fakeEventSource();
  const ticks = [];
  let worker;
  const sandbox = loadBrowserScript("public/resources/scripts/streams.js", {
    EventSource: FakeEventSource,
    setTimeout: (fn) => { ticks.push(fn); return 1; },
    addEventListener() {},
    console,
    SharedWorker: class { constructor() { worker = this; this.port = { onmessage: null, postMessage() {}, start() {} }; } },
  });
  const stream = sandbox.SnStreams.create("/api/live");
  let heard = false;
  stream.addEventListener("hello", () => { heard = true; });
  for (const fn of ticks.splice(0)) fn();
  assert.equal(made.length, 0, "waiting on the hub");
  worker.onerror(); // the script was missing, or blocked
  assert.equal(made.length, 1, "now it connects by itself");
  made[0].emit("hello", "{}");
  assert.equal(heard, true);
  assert.equal(sandbox.SnStreams.shared, false);
});
