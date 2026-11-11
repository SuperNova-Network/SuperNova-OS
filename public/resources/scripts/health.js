/*
 * Site health: the network icon in the taskbar tells the truth. Every 30 seconds (while the page is
 * visible) it checks that the server answers and that the proxy's connection (Wisp) opens, and
 * clicking it shows what it found. Nothing here loads a site or sends anything but the checks.
 *
 * Levels (the icon's bars): 3 all good, 2 slow, 1 the proxy connection fails, 0 the server can't be reached.
 * Plain script; needs SnProxy (for the Wisp address) but works without it.
 */
(function (global) {
  "use strict";

  var INTERVAL = 30000, SLOW_SERVER = 1500, SLOW_PROXY = 3000, TIMEOUT = 7000;
  var result = { server: null, proxy: null, engine: null, at: 0 };
  var running = null;

  function ms(start) { return Math.round(performance.now() - start); }

  function checkServer() {
    var start = performance.now();
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, TIMEOUT);
    return fetch("/healthz", { cache: "no-store", signal: controller.signal }).then(function (res) {
      return res.ok ? { state: "ok", ms: ms(start) } : { state: "bad", note: "The server answered with an error (" + res.status + ")." };
    }, function () {
      return { state: "bad", note: "Can't reach the server." };
    }).then(function (r) { clearTimeout(timer); return r; });
  }

  function checkProxy() {
    return new Promise(function (resolve) {
      var url;
      try { url = global.SnProxy && global.SnProxy.wispUrl(); } catch (e) { url = null; }
      if (!url) { resolve({ state: "unknown", note: "The proxy isn't set up on this page." }); return; }
      var start = performance.now(), done = false, socket;
      function finish(r) { if (done) return; done = true; clearTimeout(timer); try { socket.close(); } catch (e) { /* closed */ } resolve(r); }
      var timer = setTimeout(function () { finish({ state: "bad", note: "The proxy connection timed out." }); }, TIMEOUT);
      try { socket = new WebSocket(url); } catch (e) { finish({ state: "bad", note: "The proxy address isn't valid." }); return; }
      socket.onopen = function () { finish({ state: "ok", ms: ms(start) }); };
      socket.onerror = function () { finish({ state: "bad", note: "The proxy connection failed." }); };
      socket.onclose = function () { finish({ state: "bad", note: "The proxy connection closed at once." }); };
    });
  }

  function checkEngine() {
    var sw = navigator.serviceWorker;
    if (!sw) return { state: "bad", note: "This browser can't run the proxy (no service workers)." };
    return sw.controller ? { state: "ok" } : { state: "idle", note: "Starts the first time you open a site." };
  }

  function level() {
    if (!navigator.onLine || !result.server || result.server.state === "bad") return 0;
    if (result.proxy && result.proxy.state === "bad") return 1;
    if ((result.server.ms || 0) > SLOW_SERVER || (result.proxy && result.proxy.ms > SLOW_PROXY)) return 2;
    return 3;
  }

  function paint() {
    var icon = document.getElementById("wifi");
    if (!icon) return;
    var l = level();
    icon.setAttribute("level", String(l));
    icon.setAttribute("data-health", l === 3 ? "ok" : l === 2 ? "slow" : "bad");
    icon.title = l === 3 ? "SuperNova is working" : l === 2 ? "SuperNova is slow right now" : l === 1 ? "The proxy connection is failing" : "No connection to the server";
    render();
  }

  function check() {
    if (running) return running;
    running = Promise.all([checkServer(), checkProxy()]).then(function (r) {
      result = { server: r[0], proxy: r[1], engine: checkEngine(), at: Date.now() };
      running = null;
      paint();
    });
    return running;
  }

  // --- the flyout -------------------------------------------------------------------------------

  var LABEL = { ok: "Working", slow: "Slow", bad: "Not working", idle: "Ready when needed", unknown: "Unknown" };

  function row(name, r) {
    var line = document.createElement("div");
    line.className = "hm-row";
    var dot = document.createElement("span");
    dot.className = "hm-dot";
    dot.setAttribute("data-state", r ? r.state : "unknown");
    var text = document.createElement("span");
    text.className = "hm-name";
    text.textContent = name;
    var detail = document.createElement("span");
    detail.className = "hm-detail";
    detail.textContent = !r ? "Checking…" : r.state === "ok" ? "Working" + (r.ms ? ", " + r.ms + " ms" : "") : (r.note || LABEL[r.state]);
    line.appendChild(dot); line.appendChild(text); line.appendChild(detail);
    return line;
  }

  function render() {
    var box = document.getElementById("hm-rows");
    if (!box || document.getElementById("healthmenu").style.display !== "block") return;
    box.textContent = "";
    var offline = !navigator.onLine;
    box.appendChild(row("Your connection", { state: offline ? "bad" : "ok", note: "You're offline." }));
    box.appendChild(row("SuperNova server", offline ? { state: "bad", note: "You're offline." } : result.server));
    box.appendChild(row("Proxy connection", offline ? { state: "bad", note: "You're offline." } : result.proxy));
    box.appendChild(row("Proxy engine", result.engine));
    var when = document.getElementById("hm-when");
    when.textContent = result.at ? "Checked " + Math.max(0, Math.round((Date.now() - result.at) / 1000)) + " s ago" : "Checking…";
  }

  function hide() { var m = document.getElementById("healthmenu"); if (m) m.style.display = "none"; }

  function toggle(evt) {
    var menu = document.getElementById("healthmenu");
    if (menu.style.display === "block") { hide(); } else {
      var rect = document.getElementById("wifi").getBoundingClientRect();
      menu.style.bottom = (global.innerHeight - rect.top + 6) + "px";
      menu.style.right = Math.max(4, global.innerWidth - rect.right - 8) + "px";
      menu.style.display = "block";
      render();
      check();
    }
    if (evt) evt.stopPropagation();
  }

  document.addEventListener("mousedown", function (event) {
    if (!event.target.closest("#healthmenu, #wifi")) hide();
  }, true);
  global.addEventListener("online", check);
  global.addEventListener("offline", paint);

  global.SnHealth = {
    toggle: toggle,
    check: check,
    again: function () { result.at = 0; render(); return check(); },
    level: level,
    full: function () { hide(); if (global.openSettings) global.openSettings("proxy"); },
  };

  setTimeout(check, 3000);
  setInterval(function () { if (!document.hidden) check(); }, INTERVAL);
})(self);
