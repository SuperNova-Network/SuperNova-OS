/*
 * SuperNova proxy client core.
 *
 * Exposes `window.SnProxy`. The important guarantee is `SnProxy.ready()`: it
 * resolves only once the service worker is *activated* and the transport is
 * connected. Navigating to a proxied URL before that point sends the request to
 * the server instead of the worker, which is what used to produce a 404 the
 * first time the proxy was used.
 *
 * Expects /proxy/config.js, /assets/uv/uv.bundle.js and /proxy/uv.config.js to
 * be loaded first.
 */
(function () {
  "use strict";

  var cfg = self.__sn$config;
  var SW_URL = "/sw.js";
  var READY_TIMEOUT_MS = 10000;

  var TRANSPORTS = {
    epoxy: { name: "Epoxy", path: "/epoxy/index.mjs", options: function (wisp) { return [{ wisp: wisp }]; } },
    libcurl: { name: "libcurl", path: "/libcurl/index.mjs", options: function (wisp) { return [{ websocket: wisp }]; } },
  };

  var DEFAULTS = { transport: "epoxy", wisp: "" };

  // --- settings (localStorage, with an in-memory fallback when it is blocked) ---

  var memory = {};

  function get(key) {
    try {
      var value = localStorage.getItem("sn." + key);
      if (value !== null) return value;
    } catch (e) { /* storage blocked */ }
    return key in memory ? memory[key] : DEFAULTS[key];
  }

  function set(key, value) {
    memory[key] = value;
    try { localStorage.setItem("sn." + key, value); } catch (e) { /* storage blocked */ }
    window.dispatchEvent(new CustomEvent("snproxy:settings", { detail: { key: key, value: value } }));
  }

  // --- service worker ---------------------------------------------------------

  // Resolves once `worker` reaches "activated"; rejects if it is discarded.
  function activated(worker) {
    return new Promise(function (resolve, reject) {
      function check() {
        if (worker.state === "activated") resolve();
        else if (worker.state === "redundant") reject(new Error("Service worker was discarded"));
        else return false;
        worker.removeEventListener("statechange", check);
        return true;
      }
      if (!check()) worker.addEventListener("statechange", check);
    });
  }

  function timeout(ms, message) {
    return new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(message)); }, ms);
    });
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) {
      return Promise.reject(new Error("This browser does not support service workers (private mode or an outdated browser?)"));
    }
    return navigator.serviceWorker
      .register(SW_URL, { scope: "/", updateViaCache: "none" })
      .then(function (registration) {
        var worker = registration.installing || registration.waiting || registration.active;
        return Promise.race([
          activated(worker),
          timeout(READY_TIMEOUT_MS, "Timed out waiting for the service worker to start"),
        ]);
      });
  }

  // --- transport (bare-mux -> epoxy / libcurl -> wisp) ------------------------

  var connection = null;
  var appliedSignature = "";

  function wispUrl() {
    var custom = get("wisp").trim();
    if (/^wss?:\/\//i.test(custom)) return custom;
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + cfg.wisp;
  }

  function transportKind() {
    var kind = get("transport");
    return kind in TRANSPORTS ? kind : DEFAULTS.transport;
  }

  function applyTransport() {
    var transport = TRANSPORTS[transportKind()];
    var wisp = wispUrl();
    var signature = transport.path + "|" + wisp;

    return import("/baremux/index.mjs").then(function (mux) {
      connection = connection || new mux.BareMuxConnection("/baremux/worker.js");
      return Promise.resolve(connection.getTransport()).catch(function () { return ""; }).then(function (current) {
        // The shared worker outlives page loads, so only reconfigure on change.
        if (current === transport.path && appliedSignature === signature) return;
        return connection.setTransport(transport.path, transport.options(wisp)).then(function () {
          appliedSignature = signature;
        });
      });
    });
  }

  // --- public API -------------------------------------------------------------

  var readyPromise = null;

  function ready() {
    if (!readyPromise) {
      readyPromise = Promise.all([registerWorker(), applyTransport()]).then(function () {}, function (err) {
        readyPromise = null; // allow a retry
        throw err;
      });
    }
    return readyPromise;
  }

  /** Real URL -> proxied path (e.g. /service/abc...). */
  function encode(url) {
    return self.__uv$config.prefix + self.__uv$config.encodeUrl(url);
  }

  /** Proxied href or path -> real URL (or null when it is not a proxied address). */
  function decode(href) {
    try {
      var path = new URL(href, location.href).pathname + new URL(href, location.href).search;
      var prefix = self.__uv$config.prefix;
      if (path.indexOf(prefix) !== 0) return null;
      return self.__uv$config.decodeUrl(path.slice(prefix.length));
    } catch (e) {
      return null;
    }
  }

  /** Does this path belong to a proxy prefix? */
  function isProxyPath(path) {
    var prefixes = cfg.prefixes;
    return Object.keys(prefixes).some(function (key) { return path.indexOf(prefixes[key]) === 0; });
  }

  /** Wait until the proxy is usable, then return the proxied path for a real URL. */
  function go(url) {
    return ready().then(function () { return encode(url); });
  }

  window.SnProxy = {
    ready: ready,
    go: go,
    encode: encode,
    decode: decode,
    isProxyPath: isProxyPath,
    scope: function () { return self.__uv$config.prefix; },
    get: get,
    set: set,
    transports: TRANSPORTS,
    /** Re-read the transport/Wisp settings and reconnect. */
    reconnect: function () { appliedSignature = ""; readyPromise = null; return ready(); },
  };
})();
