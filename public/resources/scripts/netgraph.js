/*
 * The network speed graph in the taskbar, like the ones in a Linux panel: a small line of how fast data
 * is moving through the proxy. The server counts the bytes that go through this person's proxy
 * connections (GET /api/traffic gives running totals) and this works out the speed every 2 seconds.
 * Two things add up to the download line: the proxy connections' bytes (counted by the server) and what the pages
 * themselves load (this page, and every app and proxied page open in a window, from the browser's own resource timings).
 * It only measures SuperNova's traffic, not the whole computer's.
 *
 * Plain script. Exposes SnNet.rates() -> { down, up } in bytes per second, for the status panel.
 */
(function (global) {
  "use strict";

  var EVERY = 2000, POINTS = 40;
  var down = [], up = [], last = null, canvas = null;
  for (var i = 0; i < POINTS; i++) { down.push(0); up.push(0); }

  function format(bytesPerSecond) {
    var n = bytesPerSecond;
    if (n < 1000) return Math.round(n) + " B/s";
    if (n < 1e6) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + " KB/s";
    return (n / 1e6).toFixed(1) + " MB/s";
  }

  function draw() {
    if (!canvas) return;
    var ratio = global.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * ratio)) { canvas.width = Math.round(w * ratio); canvas.height = Math.round(h * ratio); }
    var ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, w, h);
    var max = Math.max(8000, Math.max.apply(null, down), Math.max.apply(null, up)); // the scale never shrinks below 8 KB/s
    function line(values, stroke, fill, width) {
      ctx.beginPath();
      values.forEach(function (v, i) {
        var x = i * (w / (POINTS - 1)), y = h - 1 - (v / max) * (h - 3);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      if (fill) { ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.beginPath(); values.forEach(function (v, i) { var x = i * (w / (POINTS - 1)), y = h - 1 - (v / max) * (h - 3); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); }
      ctx.strokeStyle = stroke; ctx.lineWidth = width; ctx.stroke();
    }
    line(up, "rgba(140, 200, 255, 0.55)", null, 1);
    line(down, "#42a5f5", "rgba(66, 165, 245, 0.28)", 1.4);
  }

  // What the desktop and its open windows downloaded since the last look (each window keeps its own list of loads).
  // Windows inside windows count too: the browser app's page, and the site inside it.
  var seen = new WeakMap();
  function allWindows(win, found, depth) {
    found.push(win);
    if (depth > 4) return;
    var frames;
    try { frames = win.document.querySelectorAll("iframe"); } catch (e) { return; }
    for (var i = 0; i < frames.length; i++) {
      try { if (frames[i].contentWindow && frames[i].contentWindow.document) allWindows(frames[i].contentWindow, found, depth + 1); } catch (e) { /* another site: can't be read */ }
    }
  }
  function pageBytes() {
    var total = 0, windows = [];
    allWindows(global, windows, 0);
    windows.forEach(function (w) {
      try {
        var entries = w.performance.getEntriesByType("resource");
        var done = seen.get(w) || 0;
        for (var j = done; j < entries.length; j++) total += entries[j].transferSize || entries[j].encodedBodySize || 0;
        if (entries.length >= 200) { w.performance.clearResourceTimings(); seen.set(w, 0); } else { seen.set(w, entries.length); }
      } catch (e) { /* closed */ }
    });
    return total;
  }

  // The server's totals may be unavailable (an old server without /api/traffic): the page's own loads still show.
  function sample() {
    if (document.hidden) { last = null; return; }
    fetch("/api/traffic", { credentials: "same-origin", cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; }, function () { return null; })
      .then(function (now) {
        var loaded = pageBytes();
        var at = Date.now();
        var totals = now || (last ? { down: last.down, up: last.up } : { down: 0, up: 0 });
        if (last) {
          var seconds = Math.max(0.5, (at - last.at) / 1000);
          down.push(Math.max(0, (totals.down - last.down + loaded) / seconds));
          up.push(Math.max(0, (totals.up - last.up) / seconds));
          down.shift(); up.shift();
          if (canvas) canvas.title = "Proxy traffic\nDownload " + format(down[POINTS - 1]) + "\nUpload " + format(up[POINTS - 1]);
          draw();
        }
        last = { down: totals.down, up: totals.up, at: at };
      });
  }

  global.SnNet = { rates: function () { return { down: down[POINTS - 1], up: up[POINTS - 1] }; }, format: format };

  function start() {
    canvas = document.getElementById("netgraph");
    if (!canvas) return;
    draw();
    setInterval(sample, EVERY);
  }
  if (document.readyState === "complete") start(); else global.addEventListener("load", start);
})(self);
