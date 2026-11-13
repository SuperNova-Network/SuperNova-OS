/*
 * Which version of SuperNova this is, in faint text in the taskbar: the release (and how many commits past it),
 * and the commit. The server knows it (GET /api/info, see src/buildinfo.js). Plain script.
 */
(function (global) {
  "use strict";

  function show(build) {
    var box = document.getElementById("buildinfo");
    if (!box || !build || (!build.tag && !build.commit)) return;
    var version = build.tag ? build.tag + (build.ahead ? "+" + build.ahead : "") : "";
    var commit = build.commit ? build.commit + (build.dirty ? "*" : "") : "";
    box.textContent = "";
    if (version) { box.appendChild(document.createTextNode(version)); box.appendChild(document.createElement("br")); }
    box.appendChild(document.createTextNode(commit || ""));
  }

  fetch("/api/info", { cache: "no-store" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (info) { if (info) show(info.build); })
    .catch(function () { /* offline: nothing to show */ });
})(self);
