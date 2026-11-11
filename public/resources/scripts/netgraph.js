/*
 * The network speed graph in the taskbar, like the ones in a Linux panel: a small line of how fast data
 * is moving through the proxy. The server counts the bytes that go through this person's proxy
 * connections (GET /api/traffic gives running totals) and this works out the speed every 2 seconds.
 * It only measures SuperNova's own proxy traffic, not the whole computer's.
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
    var max = Math.max(20000, Math.max.apply(null, down), Math.max.apply(null, up)); // the scale never shrinks below 20 KB/s
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

  function sample() {
    if (document.hidden) { last = null; return; }
    fetch("/api/traffic", { credentials: "same-origin", cache: "no-store" }).then(function (res) { return res.ok ? res.json() : null; }).then(function (now) {
      if (!now) return;
      if (last && now.at > last.at) {
        var seconds = (now.at - last.at) / 1000;
        down.push(Math.max(0, (now.down - last.down) / seconds)); up.push(Math.max(0, (now.up - last.up) / seconds));
        down.shift(); up.shift();
        if (canvas) canvas.title = "Proxy traffic\nDownload " + format(down[POINTS - 1]) + "\nUpload " + format(up[POINTS - 1]);
        draw();
      }
      last = now;
    }).catch(function () { last = null; });
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
