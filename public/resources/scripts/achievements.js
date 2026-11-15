/*
 * Achievements on the desktop: the trophy beside the battery opens a window above it listing every achievement, what is
 * unlocked, how far along the rest are, and your points and streak. New ones are announced with a notification, and the
 * trophy gets a gold dot until you have looked.
 *
 * Most achievements come from the server (it knows your messages, friends, apps); the desktop reports a few things only it can see
 * (opened the Browser, changed the wallpaper) with SnAchieve.event(name), once per device, and says it is here once a day to
 * keep the streak. The server sends "achievement" over the chat's quiet connection (chatwatch.js hands them to onUnlocked).
 *
 * Needs account.js and notify.js. Plain script.
 */
(function (global) {
  "use strict";

  // Pictures: line drawings on a 24 by 24 grid.
  var GLYPHS = {
    trophy: "M8 4h8v5a4 4 0 0 1-8 0z M8 6H5a3 3 0 0 0 3 4 M16 6h3a3 3 0 0 1-3 4 M12 13v4 M9 20h6 M10 17h4",
    star: "M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z",
    chat: "M4 5h16v11H9l-4 4v-4H4z",
    user: "M12 4.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M5 20c0-4 3-6 7-6s7 2 7 6",
    heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z",
    bolt: "M13 3L5 13h6l-1 8 8-10h-6z",
    flag: "M6 21V4 M6 4h11l-2 4 2 4H6",
    globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18",
    pin: "M9 4h6l-1 7 3 3H7l3-3z M12 14v7",
    palette: "M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.6-1-2.6 1-1.4 2-1.4h2a4 4 0 0 0 4-4C21 6.5 17 3 12 3z M8 11h.01 M12 8h.01 M16 10h.01",
    compass: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M15.5 8.5l-2 5-5 2 2-5z",
    calendar: "M5 6h14v14H5z M5 10h14 M9 3v4 M15 3v4",
    camera: "M4 8h4l1.5-2.5h5L16 8h4v11H4z M12 10.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z",
    pencil: "M5 19l1-4L16 5l3 3L9 18z M14 7l3 3",
    tag: "M4 12V4h8l8 8-8 8z M8 8h.01",
    store: "M5 8h14l-1 12H6z M9 8a3 3 0 0 1 6 0",
    download: "M12 4v10 M8 10l4 4 4-4 M5 19h14",
    terminal: "M4 5h16v14H4z M7 9l3 3-3 3 M12 15h5",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    fire: "M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 3-6 1 2 1 2 2 2 0-3-1-4 0-6z"
  };

  var SEEN_KEY = "snAchieveSeen";   // when this device last looked (a time): newer unlocks get the gold dot
  var SENT_KEY = "snAchieveSent";   // events already reported from this device
  var DAY_KEY = "snAchieveDay";     // the last day "daily" was sent
  var data = null;                  // the last list from the server
  var filter = "all";
  var panel = null;
  var told = {};                    // ids already announced, so two routes can't announce one twice

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function svg(name, className) {
    var ns = "http://www.w3.org/2000/svg";
    var node = document.createElementNS(ns, "svg");
    node.setAttribute("viewBox", "0 0 24 24");
    node.setAttribute("aria-hidden", "true");
    if (className) node.setAttribute("class", className);
    if (GLYPHS[name]) {
      GLYPHS[name].split(" M").forEach(function (d, i) {
        var path = document.createElementNS(ns, "path");
        path.setAttribute("d", i ? "M" + d : d);
        node.appendChild(path);
      });
    }
    return node;
  }

  // Ranks by points: what you are called, and how far to the next.
  var RANKS = [[0, "Newcomer"], [40, "Explorer"], [110, "Regular"], [220, "Veteran"], [380, "Master"], [560, "Legend"]];
  function rankOf(points) {
    var index = 0;
    RANKS.forEach(function (r, i) { if (points >= r[0]) index = i; });
    var next = RANKS[index + 1] || null;
    return { name: RANKS[index][1], index: index, next: next ? next[1] : null, from: RANKS[index][0], to: next ? next[0] : RANKS[index][0], fraction: next ? (points - RANKS[index][0]) / (next[0] - RANKS[index][0]) : 1 };
  }

  var CONFETTI = ["#ffc83d", "#7fe0ff", "#ff6b78", "#8be28b", "#c9a0ff", "#ffffff"];
  /** A little burst of confetti from the middle of an element, inside the window. */
  function burst(target, count) {
    if (reduced() || !panel || !target) return;
    var layer = panel.querySelector(".ach-fx");
    if (!layer) return;
    var box = target.getBoundingClientRect(), base = panel.getBoundingClientRect();
    var x = box.left - base.left + box.width / 2, y = box.top - base.top + box.height / 2;
    for (var i = 0; i < (count || 18); i++) {
      var bit = el("span", "ach-bit");
      var angle = Math.random() * Math.PI * 2, force = 40 + Math.random() * 90;
      bit.style.left = x + "px";
      bit.style.top = y + "px";
      bit.style.setProperty("--dx", Math.round(Math.cos(angle) * force) + "px");
      bit.style.setProperty("--dy", Math.round(Math.sin(angle) * force - 30) + "px");
      bit.style.setProperty("--r", Math.round(Math.random() * 720 - 360) + "deg");
      bit.style.background = CONFETTI[i % CONFETTI.length];
      layer.appendChild(bit);
      setTimeout(function (node) { node.remove(); }.bind(null, bit), 1100);
    }
  }

  /** Tiles tilt toward the pointer, with a light that follows it. */
  function tilt(node) {
    if (reduced() || !global.matchMedia || !global.matchMedia("(pointer: fine)").matches) return;
    node.addEventListener("pointermove", function (event) {
      var box = node.getBoundingClientRect();
      var px = (event.clientX - box.left) / box.width, py = (event.clientY - box.top) / box.height;
      node.style.setProperty("--mx", Math.round(px * 100) + "%");
      node.style.setProperty("--my", Math.round(py * 100) + "%");
      node.style.setProperty("--rx", ((0.5 - py) * 7).toFixed(2) + "deg");
      node.style.setProperty("--ry", ((px - 0.5) * 9).toFixed(2) + "deg");
      node.setAttribute("data-hot", "");
    });
    node.addEventListener("pointerleave", function () {
      node.style.setProperty("--rx", "0deg");
      node.style.setProperty("--ry", "0deg");
      node.removeAttribute("data-hot");
    });
  }

  function tierOf(points) { return points >= 50 ? "platinum" : points >= 25 ? "gold" : points >= 10 ? "silver" : "bronze"; }
  function reduced() { return global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function seenTime() { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch (e) { return 0; } }
  function markSeen() { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch (e) { /* storage blocked */ } }

  function api(method, path, body) {
    return fetch("/api/achievements" + path, {
      method: method,
      credentials: "same-origin",
      headers: body ? { "content-type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) { return res.ok ? res.json() : null; }, function () { return null; });
  }

  // --- the trophy ---------------------------------------------------------------------------------------

  function tray() { return document.getElementById("achieve"); }

  function paintTray() {
    var icon = tray();
    if (!icon || !data) return;
    var since = seenTime();
    var fresh = data.achievements.some(function (a) { return a.unlockedAt && a.unlockedAt > since; });
    if (fresh && !panel) icon.setAttribute("data-new", ""); else icon.removeAttribute("data-new");
    icon.title = "Achievements: " + data.totals.unlocked + " of " + data.totals.total;
  }

  function load() {
    return api("GET", "").then(function (list) {
      if (list) { data = list; paintTray(); }
      return data;
    });
  }

  // --- announcing one ----------------------------------------------------------------------------------------

  /** Something was just unlocked (the server told us). */
  function onUnlocked(achievement) {
    if (!achievement || told[achievement.id]) return;
    told[achievement.id] = true;
    if (global.SnNotify) {
      global.SnNotify.show({ app: "Achievements", icon: "bell", title: "Achievement unlocked: " + achievement.name, text: achievement.description + " (+" + achievement.points + ")" });
    }
    if (data) {
      data.achievements.forEach(function (a) { if (a.id === achievement.id) { a.unlockedAt = achievement.unlockedAt; a.progress = a.goal; } });
      data.totals.unlocked = data.achievements.filter(function (a) { return a.unlockedAt; }).length;
      data.totals.points = data.achievements.reduce(function (sum, a) { return sum + (a.unlockedAt ? a.points : 0); }, 0);
      paintTray();
      if (panel) {
        render("still");
        var shown = panel.querySelector('.ach[data-id="' + achievement.id + '"]');
        if (shown) { shown.setAttribute("data-just", ""); burst(shown.querySelector(".ach-badge"), 30); shown.scrollIntoView({ block: "nearest" }); }
      }
    } else {
      load();
    }
  }

  // --- reporting what the desktop sees ----------------------------------------------------------------------

  function sentBefore() { try { return JSON.parse(localStorage.getItem(SENT_KEY) || "{}") || {}; } catch (e) { return {}; } }

  /** Report something that happened (once per device). The server only counts what is on its list. */
  function event(name) {
    if (!global.SnAccount || !global.SnAccount.user) return;
    var sent = sentBefore();
    if (sent[name]) return;
    sent[name] = 1;
    try { localStorage.setItem(SENT_KEY, JSON.stringify(sent)); } catch (e) { /* storage blocked */ }
    api("POST", "/event", { event: name }).then(function (reply) {
      // The server also announces over the chat connection; either one tells the person, once.
      if (reply && reply.unlocked) reply.unlocked.forEach(onUnlocked);
    });
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2);
  }

  /** "I'm here today" keeps the streak: sent once per day. */
  function daily() {
    var day = today();
    try { if (localStorage.getItem(DAY_KEY) === day) return; } catch (e) { /* send anyway */ }
    api("POST", "/event", { event: "daily", day: day }).then(function (reply) {
      if (!reply) return;
      try { localStorage.setItem(DAY_KEY, day); } catch (e) { /* storage blocked */ }
      if (reply.unlocked) reply.unlocked.forEach(onUnlocked);
    });
  }

  // --- the window --------------------------------------------------------------------------------------------

  function countUp(node, to, ms) {
    if (reduced() || !to) { node.textContent = String(to); return; }
    var start = performance.now();
    node.textContent = "0";
    (function step(now) {
      var t = Math.min(1, (now - start) / ms);
      node.textContent = String(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1 && panel) global.requestAnimationFrame(step);
    })(start);
  }

  function dateLabel(ms) {
    try { return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return ""; }
  }

  function tile(a, index, isNew) {
    var node = el("div", "ach");
    node.setAttribute("data-id", a.id);
    node.style.setProperty("--i", String(index));
    node.setAttribute("data-tier", tierOf(a.points));
    node.setAttribute("data-state", a.unlockedAt ? "unlocked" : "locked");
    if (isNew) node.setAttribute("data-new", "");
    var badge = el("div", "ach-badge");
    badge.appendChild(svg(a.glyph));
    node.appendChild(badge);
    var text = el("div", "ach-text");
    var title = el("strong", "", a.name);
    if (isNew) title.appendChild(el("em", "ach-newtag", "NEW"));
    text.appendChild(title);
    text.appendChild(el("span", "ach-desc", a.description));
    if (a.unlockedAt) {
      text.appendChild(el("small", "ach-when", "Unlocked " + dateLabel(a.unlockedAt)));
    } else {
      var bar = el("div", "ach-prog");
      var fill = el("i");
      fill.style.setProperty("--p", Math.round((a.progress / a.goal) * 100) + "%");
      bar.appendChild(fill);
      text.appendChild(bar);
      text.appendChild(el("small", "ach-count", a.goal > 1 ? a.progress + " / " + a.goal : "Not yet"));
    }
    node.appendChild(text);
    node.appendChild(el("span", "ach-pts", "+" + a.points));
    node.appendChild(el("span", "ach-glare"));
    if (!a.unlockedAt) badge.appendChild(el("span", "ach-lock"));
    tilt(node);
    return node;
  }

  /**
   * Draw (or redraw) everything in the open window. mode: "open" plays the whole opening animation, "tiles" only
   * brings the tiles in again (a new filter), "still" redraws without any (something changed while you look).
   */
  function render(mode) {
    if (!panel || !data) return;
    var since = panel.getAttribute("data-since") ? Number(panel.getAttribute("data-since")) : 0;
    var t = data.totals;
    var scroll = panel.querySelector(".ach-scroll");
    var keep = scroll ? scroll.scrollTop : 0;
    panel.textContent = "";
    panel.appendChild(el("div", "ach-sweep"));
    panel.appendChild(el("div", "ach-fx"));
    var rank = rankOf(t.points);
    panel.setAttribute("data-rank", String(rank.index));

    var head = el("div", "ach-head");
    var aurora = el("div", "ach-aurora");
    aurora.appendChild(el("i")); aurora.appendChild(el("i")); aurora.appendChild(el("i"));
    head.appendChild(aurora);
    var ringWrap = el("div", "ach-ring");
    var NS = "http://www.w3.org/2000/svg";
    var ring = document.createElementNS(NS, "svg");
    ring.setAttribute("viewBox", "0 0 80 80");
    var track = document.createElementNS(NS, "circle");
    var arc = document.createElementNS(NS, "circle");
    [track, arc].forEach(function (c) { c.setAttribute("cx", "40"); c.setAttribute("cy", "40"); c.setAttribute("r", "34"); c.setAttribute("fill", "none"); c.setAttribute("stroke-width", "6"); });
    track.setAttribute("class", "ach-track");
    arc.setAttribute("class", "ach-arc");
    var circumference = 2 * Math.PI * 34;
    arc.style.setProperty("--c", circumference.toFixed(1));
    arc.style.setProperty("--off", (circumference * (1 - (t.total ? t.unlocked / t.total : 0))).toFixed(1));
    var defs = document.createElementNS(NS, "defs");
    var grad = document.createElementNS(NS, "linearGradient");
    grad.setAttribute("id", "ach-grad"); grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0"); grad.setAttribute("x2", "1"); grad.setAttribute("y2", "1");
    [["0", "#ffc83d"], ["0.55", "#ff8a5c"], ["1", "#ff5c9a"]].forEach(function (s) { var stop = document.createElementNS(NS, "stop"); stop.setAttribute("offset", s[0]); stop.setAttribute("stop-color", s[1]); grad.appendChild(stop); });
    defs.appendChild(grad);
    ring.appendChild(defs);
    arc.setAttribute("stroke", "url(#ach-grad)");
    ring.appendChild(track); ring.appendChild(arc);
    ringWrap.appendChild(ring);
    var inner = el("div", "ach-ringtext");
    var number = el("strong", "", String(t.unlocked));
    inner.appendChild(number);
    inner.appendChild(el("span", "", "of " + t.total));
    ringWrap.appendChild(inner);
    head.appendChild(ringWrap);

    var info = el("div", "ach-info");
    var title = el("div", "ach-title");
    title.appendChild(svg("trophy", "ach-trophy"));
    title.appendChild(el("strong", "", "Achievements"));
    info.appendChild(title);
    var rankLine = el("div", "ach-rank");
    rankLine.appendChild(el("b", "", rank.name));
    var pointsText = el("span", "ach-points", t.points + " pts");
    rankLine.appendChild(pointsText);
    info.appendChild(rankLine);
    if (rank.next) {
      var nextBar = el("div", "ach-next");
      var nextFill = el("i");
      nextFill.style.setProperty("--p", Math.round(rank.fraction * 100) + "%");
      nextBar.appendChild(nextFill);
      info.appendChild(nextBar);
      info.appendChild(el("span", "ach-nexttext", (rank.to - t.points) + " points to " + rank.next));
    } else {
      info.appendChild(el("span", "ach-nexttext", "Top rank reached"));
    }
    var streak = data.streak && data.streak.current;
    info.appendChild(el("span", "ach-streak", streak ? "Streak: " + streak + " day" + (streak === 1 ? "" : "s") + (data.streak.best > streak ? " (best " + data.streak.best + ")" : "") : "Visit again tomorrow to start a streak"));
    head.appendChild(info);
    var close = el("button", "ach-close", "✕");
    close.type = "button";
    close.title = "Close";
    close.addEventListener("click", hide);
    head.appendChild(close);
    panel.appendChild(head);

    var tabs = el("div", "ach-tabs");
    [["all", "All"], ["unlocked", "Unlocked"], ["locked", "Locked"]].forEach(function (pair) {
      var button = el("button", "ach-tab", pair[1]);
      button.type = "button";
      button.setAttribute("aria-pressed", String(filter === pair[0]));
      button.addEventListener("click", function () { filter = pair[0]; render("tiles"); });
      tabs.appendChild(button);
    });
    var which = ["all", "unlocked", "locked"].indexOf(filter);
    tabs.style.setProperty("--tab", String(which));
    tabs.appendChild(el("span", "ach-tabbar"));
    panel.appendChild(tabs);

    var list = el("div", "ach-scroll");
    var index = 0;
    data.groups.forEach(function (group) {
      var items = data.achievements.filter(function (a) {
        return a.group === group && (filter === "all" || (filter === "unlocked") === Boolean(a.unlockedAt));
      });
      if (!items.length) return;
      var done = data.achievements.filter(function (a) { return a.group === group && a.unlockedAt; }).length;
      var total = data.achievements.filter(function (a) { return a.group === group; }).length;
      var heading = el("h4", "ach-group", group);
      heading.appendChild(el("small", "", done + "/" + total));
      var mini = el("span", "ach-mini");
      var miniFill = el("i");
      miniFill.style.setProperty("--p", Math.round((done / total) * 100) + "%");
      mini.appendChild(miniFill);
      heading.insertBefore(mini, heading.lastChild);
      list.appendChild(heading);
      var grid = el("div", "ach-grid");
      items.forEach(function (a) { grid.appendChild(tile(a, index++, Boolean(a.unlockedAt && a.unlockedAt > since))); });
      list.appendChild(grid);
    });
    if (!index) list.appendChild(el("p", "ach-empty", filter === "unlocked" ? "Nothing unlocked yet. Go and do something." : "You have unlocked everything. Wow."));
    panel.appendChild(list);
    list.scrollTop = keep;

    if (mode === "still") panel.setAttribute("data-still", ""); else panel.removeAttribute("data-still");
    if (mode === "open") {
      panel.removeAttribute("data-open");
      void panel.offsetWidth; // so the opening animation plays again
    }
    panel.setAttribute("data-open", "");
    if (mode === "still") number.textContent = String(t.unlocked); else countUp(number, t.unlocked, 1000);
    if (mode !== "still") {
      // What is new gets a burst of confetti as the tiles arrive.
      var fresh = panel.querySelectorAll(".ach[data-new] .ach-badge");
      for (var i = 0; i < fresh.length && i < 4; i++) setTimeout(burst.bind(null, fresh[i], 16), 900 + i * 260);
    }
  }

  function place() {
    var icon = tray();
    var taskbar = document.getElementById("taskbar");
    if (!icon || !panel) return;
    var rect = icon.getBoundingClientRect();
    var bar = taskbar ? taskbar.getBoundingClientRect() : { top: rect.top };
    panel.style.bottom = Math.round(global.innerHeight - bar.top + 6) + "px";
    var right = global.innerWidth - rect.right - 8;
    var width = panel.offsetWidth || 400;
    panel.style.right = Math.max(4, Math.min(right, global.innerWidth - width - 4)) + "px";
    panel.style.transformOrigin = "calc(100% - " + Math.max(8, Math.round(right + rect.width / 2 - Math.max(4, right) + 8)) + "px) 100%";
  }

  function show() {
    if (panel) return;
    panel = el("div");
    panel.id = "achievepanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Achievements");
    panel.setAttribute("data-since", String(seenTime()));
    document.body.appendChild(panel);
    place();
    var hadData = Boolean(data);
    if (hadData) { render("open"); place(); }
    else panel.appendChild(el("p", "ach-empty", "Loading…"));
    var wasSeen = seenTime();
    load().then(function () {
      if (!panel) return;
      panel.setAttribute("data-since", String(wasSeen));
      render(hadData ? "still" : "open");
      place();
      markSeen();
      paintTray();
    });
    markSeen();
    paintTray();
  }

  function hide() {
    if (!panel) return;
    var closing = panel;
    panel = null;
    if (reduced()) { closing.remove(); paintTray(); return; }
    closing.setAttribute("data-closing", "");
    setTimeout(function () { closing.remove(); }, 230);
    paintTray();
  }

  function toggle(evt) {
    if (evt) evt.stopPropagation();
    if (panel) hide(); else show();
  }

  document.addEventListener("mousedown", function (event) {
    if (panel && !event.target.closest("#achievepanel, #achieve")) hide();
  }, true);
  document.addEventListener("keydown", function (event) { if (event.key === "Escape" && panel) hide(); });
  global.addEventListener("resize", function () { if (panel) place(); });

  global.SnAchieve = { toggle: toggle, event: event, onUnlocked: onUnlocked, load: load, hide: hide };

  // The trophy shows for people who are signed in; their list loads quietly so the dot can show.
  function start() {
    if (!global.SnAccount) return;
    global.SnAccount.status().then(function (state) {
      if (!state || !state.user || state.enabled === false) return;
      var icon = tray();
      if (icon) icon.style.display = "";
      load();
      daily();
    }, function () { /* offline: nothing to show */ });
  }
  setTimeout(start, 2500);
})(self);
