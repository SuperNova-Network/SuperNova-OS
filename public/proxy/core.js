/*
 * SuperNova proxy client core.
 *
 * Exposes `window.SnProxy`. The important guarantee is `SnProxy.ready()`: it
 * resolves only once the service worker is *activated*, the transport is
 * connected and the selected engine is initialised. Navigating to a proxied URL
 * before that point sends the request to the server instead of the worker, which
 * is what used to produce a 404 the first time the proxy was used.
 *
 * Two engines are available and can be switched at any time:
 *   sj  Scramjet     newer and the best compatibility with modern sites
 *   uv  Ultraviolet  older, lighter, and a good fallback
 *
 * Expects /proxy/config.js, /assets/uv/uv.bundle.js, /proxy/uv.config.js,
 * /proxy/store.js and /proxy/resolve.js to be loaded first. Scramjet is loaded on demand.
 */
(function () {
  "use strict";

  var cfg = self.__sn$config;
  var SW_URL = "/sw.js";
  var READY_TIMEOUT_MS = 10000;

  var ENGINES = {
    sj: { name: "Scramjet", prefix: function () { return cfg.prefixes.scramjet; } },
    uv: { name: "Ultraviolet", prefix: function () { return cfg.prefixes.uv; } },
  };

  var TRANSPORTS = {
    epoxy: { name: "Epoxy", path: "/epoxy/index.mjs", options: function (wisp) { return [{ wisp: wisp }]; } },
    libcurl: { name: "libcurl", path: "/libcurl/index.mjs", options: function (wisp) { return [{ websocket: wisp }]; } },
  };

  var DEFAULTS = { engine: "sj", transport: "libcurl", wisp: "", search: "brave", safesearch: "1" };

  // --- settings (shared store, see store.js) ----------------------------------

  SnStore.defaults(DEFAULTS);
  var get = SnStore.get;
  var set = SnStore.set;

  function engineKey() {
    var key = get("engine");
    return key in ENGINES ? key : DEFAULTS.engine;
  }

  function transportKey() {
    var key = get("transport");
    return key in TRANSPORTS ? key : DEFAULTS.transport;
  }

  // --- helpers ----------------------------------------------------------------

  function timeout(ms, message) {
    return new Promise(function (_, reject) {
      setTimeout(function () { reject(new Error(message)); }, ms);
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = function () { reject(new Error("Could not load " + src)); };
      document.head.appendChild(el);
    });
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

  // The user's own server (Settings) beats the operator's (WISP_URL), which beats this site's.
  function wispUrl() {
    var custom = get("wisp").trim();
    if (/^wss?:\/\//i.test(custom)) return custom;
    if (cfg.wispUrl) return cfg.wispUrl;
    return (location.protocol === "https:" ? "wss://" : "ws://") + location.host + cfg.wisp;
  }

  /*
   * bare-mux's worker calls transport.init() for every request until `ready` is true,
   * and libcurl's init() has two problems with that:
   *
   *  1. It is not safe to re-enter. A second request arriving while the first is still
   *     starting up begins a second initialisation.
   *  2. It builds its session *before* waiting for the WebAssembly module, so if the
   *     first request of a visit beats the wasm download it throws "wasm not loaded
   *     yet". About one fresh visit in five hit this.
   *
   * The wrapper below runs one shared initialisation, retries that specific transient
   * error until the wasm arrives, and never caches a failure.
   */
  var TRANSIENT_INIT_ERROR = "wasm not loaded";

  function sharedInitTransport(path) {
    return [
      "const { default: Transport } = await import(" + JSON.stringify(path) + ");",
      "class SharedInit extends Transport {",
      "  init() {",
      "    if (!this.__sharedInit) {",
      "      this.__sharedInit = (async () => {",
      "        for (let attempt = 0; ; attempt++) {",
      "          try {",
      "            return await super.init();",
      "          } catch (error) {",
      "            const transient = String((error && error.message) || error).indexOf(" + JSON.stringify(TRANSIENT_INIT_ERROR) + ") !== -1;",
      "            if (!transient || attempt >= 100) { this.__sharedInit = null; throw error; }",
      "            await new Promise((resolve) => setTimeout(resolve, 100));",
      "          }",
      "        }",
      "      })();",
      "    }",
      "    return this.__sharedInit;",
      "  }",
      "}",
      "return [SharedInit, " + JSON.stringify(path) + "];",
    ].join("\n");
  }

  function applyTransport() {
    var transport = TRANSPORTS[transportKey()];
    var wisp = wispUrl();
    var signature = transport.path + "|" + wisp;

    return import("/baremux/index.mjs").then(function (mux) {
      connection = connection || new mux.BareMuxConnection("/baremux/worker.js");
      return Promise.resolve(connection.getTransport()).catch(function () { return ""; }).then(function (current) {
        // The shared worker outlives page loads, so only reconfigure on change.
        if (current === transport.path && appliedSignature === signature) return;
        return connection.setManualTransport(sharedInitTransport(transport.path), transport.options(wisp)).then(function () {
          appliedSignature = signature;
        });
      });
    });
  }

  // --- scramjet (loaded on demand) --------------------------------------------

  var scramjet = null;
  var scramjetPromise = null;

  function initScramjet() {
    if (!scramjetPromise) {
      scramjetPromise = Promise.all([
        loadScript("/assets/scramjet/scramjet.all.js"),
        loadScript("/proxy/scramjet.config.js"),
        loadScript("/proxy/scramjet-db.js"),
      ])
        .then(function () { return self.snEnsureScramjetDb(); })
        .then(function () {
          var api = self.$scramjetLoadController();
          scramjet = new api.ScramjetController(self.__scramjet$config);
          return scramjet.init();
        })
        .catch(function (err) {
          scramjetPromise = null; // allow a retry
          throw err;
        });
    }
    return scramjetPromise;
  }

  /**
   * Register an iframe with Scramjet's frame manager (it names the frame, which
   * Scramjet's frame and top-window logic relies on). Without it, pages nested
   * inside other frames log "YOU NEED TO USE ScramjetFrame" and some of that logic
   * fails. A no-op until Scramjet is initialised, and for frames already registered.
   */
  var registeredFrames = typeof WeakSet === "function" ? new WeakSet() : null;

  function registerFrame(frame) {
    if (scramjet && registeredFrames && !registeredFrames.has(frame)) {
      registeredFrames.add(frame);
      scramjet.createFrame(frame);
    }
    return frame;
  }

  // --- public API -------------------------------------------------------------

  var baseReady = null;

  /**
   * Resolve once the proxy is usable for `engine` (defaults to the selected one):
   * worker active, transport connected, engine initialised.
   */
  function ready(engine) {
    engine = engine || engineKey();
    if (!baseReady) {
      baseReady = Promise.all([registerWorker(), applyTransport()]).then(function () {}, function (err) {
        baseReady = null; // allow a retry
        throw err;
      });
    }
    return baseReady.then(function () { return engine === "sj" ? initScramjet() : undefined; });
  }

  /** Real URL -> proxied path (e.g. /service/abc...). Call after ready(engine). */
  function encode(url, engine) {
    engine = engine || engineKey();
    if (engine === "sj") {
      if (!scramjet) throw new Error("Scramjet is not initialised yet; wait for SnProxy.ready() first");
      return scramjet.encodeUrl(url);
    }
    return self.__uv$config.prefix + self.__uv$config.encodeUrl(url);
  }

  /** Proxied href or path -> real URL (or null when it is not a proxied address). */
  function decode(href) {
    try {
      var parsed = new URL(href, location.href);
      var path = parsed.pathname + parsed.search + parsed.hash;
      var uv = cfg.prefixes.uv;
      var sj = cfg.prefixes.scramjet;
      if (path.indexOf(uv) === 0) return self.__uv$config.decodeUrl(path.slice(uv.length));
      if (path.indexOf(sj) === 0) return scramjet ? scramjet.decodeUrl(parsed.href) : decodeURIComponent(path.slice(sj.length));
    } catch (e) { /* fall through */ }
    return null;
  }

  /** Which engine owns this path ("uv", "sj") or null. */
  function engineForPath(path) {
    return Object.keys(ENGINES).filter(function (key) { return path.indexOf(ENGINES[key].prefix()) === 0; })[0] || null;
  }

  /** Wait until the proxy is usable, then return the proxied path for a real URL. */
  function go(url, engine) {
    engine = engine || engineKey();
    return ready(engine).then(function () { return encode(url, engine); });
  }

  /** Ask the server whether the content filter blocks this destination or search. */
  function verdict(host, query) {
    return fetch("/api/verdict", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ host: host, query: query }),
    }).then(function (res) { return res.ok ? res.json() : { blocked: false }; })
      // Failing open is safe: the Wisp server enforces the policy regardless.
      .catch(function () { return { blocked: false }; });
  }

  function blockedError(reason) {
    var error = new Error(reason === "query"
      ? "That search is blocked by the content filter."
      : "That site is blocked by the content filter.");
    error.blocked = true;
    error.reason = reason;
    return error;
  }

  /**
   * Address-bar text (a URL or search words) -> proxied path, or null when empty.
   * Uses the selected search engine for anything that is not an address, and
   * rejects with an error whose `blocked` flag is set when the filter refuses it.
   */
  function open(input, engine) {
    var target = self.SnResolve.resolve(input, get("search"), { safe: get("safesearch") !== "0" });
    if (!target) return Promise.resolve(null);
    var host = new URL(target.url).hostname;
    var check = target.kind === "search" ? verdict(host, String(input).trim()) : verdict(host);
    return check.then(function (result) {
      if (result.blocked) throw blockedError(result.reason);
      return go(target.url, engine);
    });
  }

  window.SnProxy = {
    ready: ready,
    go: go,
    open: open,
    verdict: verdict,
    encode: encode,
    decode: decode,
    engineForPath: engineForPath,
    registerFrame: registerFrame,
    isProxyPath: function (path) { return engineForPath(path) !== null; },
    get: get,
    set: set,
    wispUrl: wispUrl,
    engine: engineKey,
    engines: ENGINES,
    transports: TRANSPORTS,
    /** Re-read the transport/Wisp settings and reconnect. */
    reconnect: function () { appliedSignature = ""; baseReady = null; return ready(); },
  };
})();
