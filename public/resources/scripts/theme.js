/*
 * Applies the accent colour chosen with the desktop's colour scheme (sn.accent)
 * to --accent, in every page that includes it, live. Plain script.
 */
(function () {
  "use strict";

  SnStore.defaults({ accent: "" });

  function apply() {
    var accent = SnStore.get("accent");
    if (accent) document.documentElement.style.setProperty("--accent", accent);
    else document.documentElement.style.removeProperty("--accent");
  }

  apply();
  SnStore.onChange(function (key) {
    if (key === "accent" || key === "*") apply();
  });
})();
