/*
 * Shared live connections: SnStreams.create(url) is used like `new EventSource(url)` (addEventListener, close, readyState), but
 * the connection is held by a SharedWorker (streamhub.js) that every open tab of SuperNova shares, so a lot of tabs don't use up
 * the browser's six connections to one address and leave nothing for loading pages. Where a browser can't do that (no
 * SharedWorker, or no EventSource in a worker) it simply opens its own connection, exactly as before.
 *
 * Plain script; attaches `SnStreams` to the global object.
 */
(function (global) {
  "use strict";

  var HUB_URL = "/resources/scripts/streamhub.js?v=1"; // bump the version with the hub's messages: old tabs keep their old hub
  var worker = null;
  var usable = typeof global.SharedWorker === "function" && typeof global.EventSource === "function";
  var live = {};   // id -> the Shared objects waiting for the hub's messages
  var nextId = 1;

  function degrade() {
    usable = false;
    worker = null;
    Object.keys(live).forEach(function (id) { var shared = live[id]; if (shared) shared._fallback(); });
  }

  function hub() {
    if (!usable) return null;
    if (worker) return worker;
    try {
      worker = new global.SharedWorker(HUB_URL, { name: "sn-streams-v1" });
      worker.port.onmessage = function (event) {
        var message = event.data || {};
        var shared = live[message.id];
        if (shared) shared._receive(message);
      };
      worker.onerror = degrade;
      worker.port.start();
      global.addEventListener("pagehide", function () { try { if (worker) worker.port.postMessage({ type: "bye" }); } catch (e) { /* closing anyway */ } });
    } catch (e) {
      degrade();
    }
    return worker;
  }

  function Shared(url) {
    this.url = url;
    this.id = nextId++;
    this._state = 0;          // 0 connecting, 1 open, 2 closed (the same numbers as EventSource)
    this._listeners = {};
    this._native = null;
    this._opened = false;
    this._closed = false;
    live[this.id] = this;
    var self = this;
    // One tick later, so the caller can add all its listeners first and we can say which events we want.
    setTimeout(function () { self._open(); }, 0);
  }

  Object.defineProperty(Shared.prototype, "readyState", {
    get: function () { return this._native ? this._native.readyState : this._state; }
  });

  Shared.prototype.addEventListener = function (name, listener) {
    if (this._native) { this._native.addEventListener(name, listener); return; }
    (this._listeners[name] = this._listeners[name] || []).push(listener);
    if (this._opened && worker) worker.port.postMessage({ type: "events", id: this.id, events: [name] });
  };

  Shared.prototype._open = function () {
    if (this._closed || this._opened) return;
    var connection = hub();
    if (!connection) { this._fallback(); return; }
    this._opened = true;
    connection.port.postMessage({ type: "open", id: this.id, url: this.url, events: Object.keys(this._listeners) });
  };

  /** This browser can't share: open an ordinary connection and hand it the listeners already added. */
  Shared.prototype._fallback = function () {
    if (this._native || this._closed) return;
    var native = new global.EventSource(this.url);
    this._native = native;
    delete live[this.id];
    var listeners = this._listeners;
    Object.keys(listeners).forEach(function (name) { listeners[name].forEach(function (listener) { native.addEventListener(name, listener); }); });
  };

  Shared.prototype._receive = function (message) {
    if (message.type === "unsupported") { this._fallback(); return; }
    if (message.type !== "event") return;
    if (typeof message.readyState === "number") this._state = message.readyState;
    var listeners = this._listeners[message.event] || [];
    var event = { type: message.event, data: message.data };
    listeners.slice().forEach(function (listener) {
      try { listener(event); } catch (error) { if (global.console) global.console.error(error); }
    });
  };

  Shared.prototype.close = function () {
    this._closed = true;
    this._state = 2;
    delete live[this.id];
    if (this._native) { this._native.close(); return; }
    if (this._opened && worker) { try { worker.port.postMessage({ type: "close", id: this.id }); } catch (e) { /* the hub is gone */ } }
  };

  global.SnStreams = {
    /** A live connection that behaves like an EventSource. */
    create: function (url) {
      if (!usable) return new global.EventSource(url);
      return new Shared(url);
    },
    /** Whether connections are being shared (for tests and the console). */
    get shared() { return usable; }
  };
})(self);
