/*
 * The stream hub: a SharedWorker that holds the desktop's live connections (the site's live channel and the chat's quiet
 * connection) ONCE for the whole browser, however many tabs of SuperNova are open, and passes what arrives to every tab.
 *
 * Why: a browser keeps at most six connections to one address over plain HTTP, and every one of these streams stays open for
 * as long as the page does. Each tab used two, so three tabs used them all and nothing else (not even the Chat window, or the
 * health check) could load. With the hub the browser holds two, whatever the number of tabs.
 *
 * Tabs talk to it through streams.js. They send { type: "open", id, url, events } to subscribe (only the site's own /api/
 * streams), { type: "events", id, events } to listen for more, { type: "close", id } and { type: "bye" } (a tab going away). The
 * hub answers { id, type: "event", event, data, readyState } for everything that arrives, including "open" and "error", and
 * { id, type: "unsupported" } when this browser can't run EventSource in a worker (the tab then connects by itself).
 *
 * When a tab joins a stream that is already open, the hub opens it again so that every tab, the new one included, gets the
 * server's start-up message (the current state), not just what comes after.
 */
"use strict";

var REOPEN_MS = 300;
var hubs = {}; // address -> { url, source, subs: [{ entry, id }], events: {}, listening: {}, timer }

function deliver(hub, name, data) {
  var state = hub.source ? hub.source.readyState : 2;
  hub.subs.forEach(function (sub) {
    try { sub.entry.port.postMessage({ id: sub.id, type: "event", event: name, data: data, readyState: state }); } catch (e) { /* that tab is gone */ }
  });
}

function listen(hub, name) {
  if (!hub.source || hub.listening[name]) return;
  hub.listening[name] = true;
  var source = hub.source;
  source.addEventListener(name, function (event) { if (hub.source === source) deliver(hub, name, event.data); }); // never from a connection that was replaced
}

function connect(hub) {
  if (hub.source) { try { hub.source.close(); } catch (e) { /* already closed */ } }
  hub.listening = {};
  var source = new EventSource(hub.url);
  hub.source = source;
  source.addEventListener("open", function () { if (hub.source === source) deliver(hub, "open", ""); });
  source.addEventListener("error", function () { if (hub.source === source) deliver(hub, "error", ""); });
  Object.keys(hub.events).forEach(function (name) { listen(hub, name); });
}

function subscribe(entry, message) {
  var url = String(message.url || "");
  if (typeof EventSource !== "function") { entry.port.postMessage({ id: message.id, type: "unsupported" }); return; }
  if (!/^\/api\/[A-Za-z0-9/_-]+(\?[A-Za-z0-9=&_.-]*)?$/.test(url)) return; // only the site's own streams
  var hub = hubs[url];
  var fresh = !hub;
  if (fresh) hub = hubs[url] = { url: url, source: null, subs: [], events: {}, listening: {}, timer: null };
  hub.subs.push({ entry: entry, id: message.id });
  (message.events || []).forEach(function (name) { hub.events[String(name)] = true; listen(hub, String(name)); });
  if (fresh) {
    connect(hub);
  } else {
    clearTimeout(hub.timer);
    hub.timer = setTimeout(function () { hub.timer = null; if (hub.subs.length) connect(hub); }, REOPEN_MS);
  }
}

function moreEvents(entry, message) {
  Object.keys(hubs).forEach(function (url) {
    var hub = hubs[url];
    var mine = hub.subs.some(function (sub) { return sub.entry === entry && sub.id === message.id; });
    if (!mine) return;
    (message.events || []).forEach(function (name) { hub.events[String(name)] = true; listen(hub, String(name)); });
  });
}

function unsubscribe(entry, id) {
  Object.keys(hubs).forEach(function (url) {
    var hub = hubs[url];
    hub.subs = hub.subs.filter(function (sub) { return !(sub.entry === entry && (id === undefined || sub.id === id)); });
    if (!hub.subs.length) {
      clearTimeout(hub.timer);
      if (hub.source) { try { hub.source.close(); } catch (e) { /* already closed */ } }
      delete hubs[url];
    }
  });
}

self.onconnect = function (event) {
  var port = event.ports[0];
  var entry = { port: port };
  port.onmessage = function (message) {
    var data = message.data || {};
    if (data.type === "open") subscribe(entry, data);
    else if (data.type === "events") moreEvents(entry, data);
    else if (data.type === "close") unsubscribe(entry, data.id);
    else if (data.type === "bye") unsubscribe(entry);
  };
  if (typeof port.start === "function") port.start();
};
