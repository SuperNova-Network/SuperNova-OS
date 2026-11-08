/*
 * SuperNova proxy client core.
 *
 * Exposes `window.SnProxy`. The important guarantee is `SnProxy.ready()`: it
 * resolves only once the service worker is *activated*. Navigating to a proxied
 * URL before that point sends the request to the server instead of the worker,
 * which is what used to produce a 404 the first time the proxy was used.
 */
(function () {
  "use strict";

  var SW_URL = "/sw.js";
  var READY_TIMEOUT_MS = 10000;

  function scope() {
    return (self.__uv$config && self.__uv$config.prefix) || "/supernova/";
  }

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

  var readyPromise = null;

  function register() {
    if (!("serviceWorker" in navigator)) {
      return Promise.reject(new Error("This browser does not support service workers (private mode or an outdated browser?)"));
    }
    return navigator.serviceWorker
      .register(SW_URL, { scope: scope(), updateViaCache: "none" })
      .then(function (registration) {
        var worker = registration.installing || registration.waiting || registration.active;
        return Promise.race([
          activated(worker),
          timeout(READY_TIMEOUT_MS, "Timed out waiting for the service worker to start"),
        ]).then(function () { return registration; });
      });
  }

  window.SnProxy = {
    /** Register the service worker (once) and wait until it is active. */
    ready: function () {
      if (!readyPromise) {
        readyPromise = register().catch(function (err) {
          readyPromise = null; // allow a retry
          throw err;
        });
      }
      return readyPromise;
    },
    scope: scope,
  };
})();
