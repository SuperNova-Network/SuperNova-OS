/*
 * Served by the server in place of a proxied page when a navigation reaches it
 * without the service worker in front (first visit, cleared site data, shared
 * deep link, ...). Start the worker, then reload so the worker handles the URL.
 */
(function () {
  "use strict";

  var MAX_ATTEMPTS = 3;
  var WINDOW_MS = 15000; // attempts older than this no longer count towards the loop guard
  var key = "sn.boot:" + location.pathname + location.search;

  function attempts() {
    try {
      var saved = JSON.parse(sessionStorage.getItem(key));
      return saved && Date.now() - saved.t < WINDOW_MS ? saved.n : 0;
    } catch (e) {
      return 0;
    }
  }

  function setAttempts(n) {
    try { sessionStorage.setItem(key, JSON.stringify({ n: n, t: Date.now() })); } catch (e) { /* storage unavailable */ }
  }

  function fail(err) {
    document.getElementById("spinner").style.display = "none";
    document.getElementById("status").style.display = "none";
    document.getElementById("error").style.display = "block";
    document.getElementById("error-detail").textContent =
      (err && err.message) || "Service workers appear to be unavailable in this browser.";
  }

  document.getElementById("retry").addEventListener("click", function () {
    setAttempts(0);
    location.reload();
  });

  if (attempts() >= MAX_ATTEMPTS) {
    // We already reloaded several times and still ended up here: the worker is not intercepting.
    fail(new Error("The service worker started but is not handling this address. Try a hard refresh, or clear this site's data."));
    return;
  }

  SnProxy.ready().then(function () {
    setAttempts(attempts() + 1);
    location.reload();
  }, fail);
})();
