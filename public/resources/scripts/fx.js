/*
 * Click ripple.
 *
 * Any element matching RIPPLE_SELECTOR gets a soft ripple from the pointer
 * position on press. One delegated listener, so elements created later (windows,
 * search results, tabs) work without any wiring. Plain script.
 */
(function (global) {
  "use strict";

  var RIPPLE_SELECTOR = [
    ".btn",
    "[data-ripple]",
    ".taskbaricon",
    "#home",
    ".sbbitem",
    ".sbbitem2",
    ".pbitem",
    ".result",
    ".poweritem",
    ".coloroption",
    ".backoption",
    ".histbtn",
  ].join(",");

  if (global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  global.addEventListener(
    "pointerdown",
    function (event) {
      if (event.button !== 0 || !event.target.closest) return;
      var host = event.target.closest(RIPPLE_SELECTOR);
      if (!host) return;

      var rect = host.getBoundingClientRect();
      var size = Math.max(rect.width, rect.height) * 2.2;

      // A dedicated layer does the clipping, so the host's own overflow (tooltips,
      // dropdowns) is never touched. It only needs the host to be a positioning context.
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      var layer = host.querySelector(":scope > .sn-ripple-layer");
      if (!layer) {
        layer = document.createElement("span");
        layer.className = "sn-ripple-layer";
        host.appendChild(layer);
      }

      var ripple = document.createElement("span");
      ripple.className = "sn-ripple";
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = event.clientX - rect.left - size / 2 + "px";
      ripple.style.top = event.clientY - rect.top - size / 2 + "px";
      layer.appendChild(ripple);
      ripple.addEventListener("animationend", function () {
        if (ripple.parentNode) ripple.parentNode.removeChild(ripple);
      });
    },
    true
  );
})(self);
