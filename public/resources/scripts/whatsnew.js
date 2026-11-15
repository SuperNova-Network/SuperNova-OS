/*
 * "What's new": after an update, a window lists the new things (written from the changelog, GET /api/whatsnew), once
 * each per person. Someone who has used SuperNova before sees the newest few the first time; a device that has never
 * opened SuperNova sees none (it has the welcome message, and everything is new). Click the version in the taskbar to read it again.
 *
 * What a person has seen is the `whatsNewSeen` setting, so it follows their account. Needs account.js. Plain script.
 */
(function (global) {
  "use strict";

  var SEEN = "whatsNewSeen";
  var SHOWN = 30;     // everything new since they last looked (the window scrolls)
  var KEEP = 80;      // how many seen ids are remembered
  var items = [];

  // A device that has never opened SuperNova (this runs before main.js marks it as visited): remember that, because the
  // page may reload once while the proxy's worker starts. Kept outside the synced settings so it never reaches an account.
  var BASELINE = "snWhatsNewBaseline";
  try { if (!global.SnStore.get("visited-before")) global.localStorage.setItem(BASELINE, "1"); } catch (e) { /* storage blocked */ }

  function seen() {
    try { var list = JSON.parse(global.SnStore.get(SEEN) || "null"); return Array.isArray(list) ? list : null; } catch (e) { return null; }
  }
  function remember(ids) {
    var all = (seen() || []).concat(ids).filter(function (id, i, a) { return a.indexOf(id) === i; });
    try { global.SnStore.set(SEEN, JSON.stringify(all.slice(-KEEP))); } catch (e) { /* storage blocked */ }
  }

  function close() {
    var old = document.getElementById("whatsnew");
    if (old) old.parentNode.removeChild(old);
  }

  /** Open the window with these items. `others` says how many more there are that this one doesn't list. */
  function show(list, others) {
    close();
    var overlay = document.createElement("div");
    overlay.id = "whatsnew";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "What's new");
    var box = document.createElement("div");
    box.className = "wn-box";
    var bar = document.createElement("div");
    bar.className = "wn-bar";
    var title = document.createElement("span");
    title.textContent = "What\u2019s new";
    var x = document.createElement("span");
    x.className = "wn-x";
    x.textContent = "\u2715";
    x.title = "Close";
    bar.appendChild(title); bar.appendChild(x);
    var body = document.createElement("div");
    body.className = "wn-body";
    list.forEach(function (item) {
      var row = document.createElement("div");
      row.className = "wn-item";
      var name = document.createElement("strong");
      name.textContent = item.title;
      row.appendChild(name);
      if (item.text) { var text = document.createElement("p"); text.textContent = item.text; row.appendChild(text); }
      body.appendChild(row);
    });
    if (others > 0) {
      var more = document.createElement("p");
      more.className = "wn-more";
      more.textContent = "And " + others + " more. Click the version in the taskbar to see them again.";
      body.appendChild(more);
    }
    var foot = document.createElement("div");
    foot.className = "wn-foot";
    var ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "Got it";
    foot.appendChild(ok);
    box.appendChild(bar); box.appendChild(body); box.appendChild(foot);
    overlay.appendChild(box);
    var done = function () {
      close();
      document.removeEventListener("keydown", onKey);
      try { if (global.SnAchieve) global.SnAchieve.event("whatsnew"); } catch (e) { /* optional */ }
    };
    var onKey = function (event) { if (event.key === "Escape" || event.key === "Enter") done(); };
    x.addEventListener("click", done);
    ok.addEventListener("click", done);
    overlay.addEventListener("mousedown", function (event) { if (event.target === overlay) done(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    ok.focus();
  }

  function load() {
    return fetch("/api/whatsnew", { cache: "no-cache" })
      .then(function (res) { return res.ok ? res.json() : { items: [] }; })
      .then(function (data) { items = Array.isArray(data.items) ? data.items : []; return items; })
      .catch(function () { return []; });
  }

  /** After the page has settled: show what this person hasn't seen yet. */
  function check() {
    load().then(function (all) {
      if (!all.length) return;
      var known = seen();
      var brandNew = false;
      try { brandNew = global.localStorage.getItem(BASELINE) === "1"; global.localStorage.removeItem(BASELINE); } catch (e) { /* storage blocked */ }
      if (known === null) {
        // The first time here: a new visitor starts with everything seen; someone who has been here before sees the newest few.
        if (brandNew) { remember(all.map(function (i) { return i.id; })); return; }
        known = [];
      }
      var fresh = all.filter(function (item) { return known.indexOf(item.id) === -1; });
      if (!fresh.length) return;
      var shown = fresh.slice(0, SHOWN);
      show(shown, fresh.length - shown.length);
      remember(all.map(function (i) { return i.id; })); // everything counts as seen once the window has been shown
    });
  }

  global.SnWhatsNew = {
    /** Open the window on demand with the newest items, whether or not they were seen. */
    open: function () { load().then(function (all) { if (all.length) show(all, 0); }); },
  };

  // Not while a full-screen notice or a sign-in is in the way, and not over the welcome message.
  function ready() {
    if (global.SnAccount) {
      global.SnAccount.status().then(function (state) {
        if (state && state.required && !state.user) return; // the lock screen: they will see it next time
        check();
      }, check);
    } else {
      check();
    }
  }
  setTimeout(ready, 4500);
})(self);
