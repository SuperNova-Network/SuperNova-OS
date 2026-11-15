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

  // --- grouping by day ----------------------------------------------------------------------------------

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  function parseDay(text) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text || ""); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; }
  // A week starts on Saturday: the weekend already belongs to the coming week, the way people talk ("see you Monday" is
  // the next one, and on a Sunday "Thursday" was last week).
  function mondayOf(date) { var d = startOfDay(date); d.setDate(d.getDate() - ((d.getDay() + 1) % 7)); return d; }
  function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }

  /** The items as days, newest first: [{ key, label, sub, items }]. Items with no date go last, as "All updates". */
  function weeksOf(list) {
    var map = {}, order = [];
    list.forEach(function (item) {
      var day = parseDay(item.date), key = day ? startOfDay(day).getTime() : 0;
      if (!map[key]) { map[key] = { key: key, items: [] }; order.push(key); }
      map[key].items.push(item);
    });
    order.sort(function (a, b) { return (b || -1) - (a || -1); });
    var now = new Date(), today = startOfDay(now).getTime(), thisMonday = mondayOf(now).getTime();
    return order.map(function (key) {
      var group = map[key];
      var count = group.items.length + (group.items.length === 1 ? " update" : " updates");
      if (!key) { group.label = "All updates"; group.sub = count; return group; }
      var date = new Date(key);
      var short = MONTHS[date.getMonth()] + " " + date.getDate() + (date.getFullYear() !== now.getFullYear() ? ", " + date.getFullYear() : "");
      var full = WEEKDAYS[date.getDay()] + ", " + short;
      var days = Math.round((today - key) / 86400000);
      var weeks = Math.round((thisMonday - mondayOf(date).getTime()) / (7 * 86400000));
      if (days === 0) { group.label = "Today"; group.sub = full + " \u00b7 " + count; }
      else if (days === 1) { group.label = "Yesterday"; group.sub = full + " \u00b7 " + count; }
      else if (weeks === 0) { group.label = full; group.sub = count; }                                  // this week: the day and its date
      else if (weeks === 1) { group.label = "Last " + WEEKDAYS[date.getDay()]; group.sub = short + " \u00b7 " + count; } // last week: "Last Thursday"
      else { group.label = short; group.sub = count; }                                                  // before that: just the date
      return group;
    });
  }

  function itemRow(item) {
    var row = document.createElement("div");
    row.className = "wn-item";
    var name = document.createElement("strong");
    name.textContent = item.title;
    row.appendChild(name);
    var text = document.createElement("p");
    text.textContent = item.text || "";
    if (item.text || item.full) row.appendChild(text);
    if (item.full) {
      // Click an item to read all of it.
      row.className += " wn-more-info";
      row.tabIndex = 0;
      row.setAttribute("role", "button");
      row.setAttribute("aria-expanded", "false");
      var hint = document.createElement("small");
      hint.className = "wn-hint";
      hint.textContent = "Click for details";
      row.appendChild(hint);
      var toggle = function () {
        var open = row.getAttribute("aria-expanded") === "true";
        row.setAttribute("aria-expanded", String(!open));
        text.textContent = open ? item.text : item.full;
        hint.textContent = open ? "Click for details" : "Click to show less";
      };
      row.addEventListener("click", toggle);
      row.addEventListener("keydown", function (event) { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); toggle(); } });
    }
    return row;
  }

  /**
   * Open the window: first the days (the newest marked LATEST, any with things you haven't seen marked NEW), then, on
   * clicking one, its updates. `unseen` is a list of ids the person hasn't seen yet.
   */
  function show(list, unseen) {
    close();
    unseen = unseen || [];
    var weeks = weeksOf(list);
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
    var x = document.createElement("span");
    x.className = "wn-x";
    x.textContent = "\u2715";
    x.title = "Close";
    bar.appendChild(title); bar.appendChild(x);
    var body = document.createElement("div");
    body.className = "wn-body";
    var foot = document.createElement("div");
    foot.className = "wn-foot";
    var back = document.createElement("button");
    back.type = "button";
    back.className = "wn-back";
    back.textContent = "\u2039 All days";
    var ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "Got it";
    foot.appendChild(back); foot.appendChild(ok);
    box.appendChild(bar); box.appendChild(body); box.appendChild(foot);
    overlay.appendChild(box);

    function showWeeks() {
      title.textContent = "What\u2019s new";
      back.hidden = true;
      body.textContent = "";
      body.scrollTop = 0;
      weeks.forEach(function (week, index) {
        var row = document.createElement("button");
        row.type = "button";
        row.className = "wn-week";
        var left = document.createElement("span");
        left.className = "wn-week-text";
        var name = document.createElement("strong");
        name.textContent = week.label;
        var sub = document.createElement("small");
        sub.textContent = week.sub;
        left.appendChild(name); left.appendChild(sub);
        row.appendChild(left);
        var tags = document.createElement("span");
        tags.className = "wn-tags";
        if (index === 0 && week.key) { var latest = document.createElement("em"); latest.className = "wn-tag wn-latest"; latest.textContent = "LATEST"; tags.appendChild(latest); }
        var fresh = week.items.filter(function (i) { return unseen.indexOf(i.id) !== -1; }).length;
        if (fresh) { var tag = document.createElement("em"); tag.className = "wn-tag wn-new"; tag.textContent = fresh + " NEW"; tags.appendChild(tag); }
        var arrow = document.createElement("span");
        arrow.className = "wn-arrow";
        arrow.textContent = "\u203a";
        tags.appendChild(arrow);
        row.appendChild(tags);
        if (index === 0) row.className += " wn-top";
        row.addEventListener("click", function () { showWeek(week); });
        body.appendChild(row);
      });
    }

    function showWeek(week) {
      title.textContent = "What\u2019s new \u00b7 " + week.label;
      back.hidden = false;
      body.textContent = "";
      body.scrollTop = 0;
      week.items.forEach(function (item) { body.appendChild(itemRow(item)); });
    }

    back.addEventListener("click", showWeeks);
    showWeeks();
    var done = function () {
      close();
      document.removeEventListener("keydown", onKey);
      try { if (global.SnAchieve) global.SnAchieve.event("whatsnew"); } catch (e) { /* optional */ }
    };
    var onKey = function (event) { if (event.key === "Escape") done(); else if (event.key === "Enter" && document.activeElement === ok) done(); };
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
      show(all, fresh.map(function (item) { return item.id; }));
      remember(all.map(function (i) { return i.id; })); // everything counts as seen once the window has been shown
    });
  }

  global.SnWhatsNew = {
    /** Open the window on demand with the newest items, whether or not they were seen. */
    open: function () { load().then(function (all) { if (all.length) show(all, []); }); },
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
