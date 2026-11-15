/*
 * The friends indicator in the taskbar (beside the trophy): a people icon with a green number for how many friends are
 * online, and a menu above it, opened by clicking, listing them (with who is away) and a button that opens the Friends app.
 * The list comes from GET /api/friends/ and is refreshed about every 45 seconds while the page is visible, and each
 * time the menu opens. Needs account.js. Plain script.
 */
(function (global) {
  "use strict";

  var COLORS = ["#d9534f", "#e8892e", "#c9a227", "#43a047", "#16a085", "#2b8cd6", "#5c6bc0", "#8e44ad", "#d6457a", "#6d7b8a"];
  var data = null;   // { friends: [{ username, avatar, status }], incoming: [...] }
  var menu = null;
  var timer = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function color(name) {
    var hash = 0;
    String(name).split("").forEach(function (c) { hash = (hash * 31 + c.charCodeAt(0)) >>> 0; });
    return COLORS[hash % COLORS.length];
  }

  function picture(person) {
    var box = el("span", "fm-pic");
    var letter = function () { box.textContent = ""; box.style.background = color(person.username); box.appendChild(document.createTextNode(person.username.charAt(0).toUpperCase())); };
    var url = global.SnAccount && global.SnAccount.avatarUrl ? global.SnAccount.avatarUrl(person.username, person.avatar) : "";
    if (!url || !person.avatar) { letter(); return box; }
    var img = document.createElement("img");
    img.alt = "";
    img.addEventListener("error", letter, { once: true });
    img.src = url;
    box.appendChild(img);
    return box;
  }

  function online() {
    return data ? data.friends.filter(function (f) { return f.status !== "offline"; }) : [];
  }

  function icon() { return document.getElementById("friendsbtn"); }

  function paint() {
    var button = icon();
    if (!button) return;
    var n = online().length;
    if (n) button.setAttribute("data-online", n > 99 ? "99+" : String(n)); else button.removeAttribute("data-online");
    var waiting = data ? data.incoming.length : 0;
    button.title = n + " friend" + (n === 1 ? "" : "s") + " online" + (waiting ? ", " + waiting + " request" + (waiting === 1 ? "" : "s") + " waiting" : "");
    if (menu) render();
  }

  function load() {
    return fetch("/api/friends/", { credentials: "same-origin", cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (list) { if (list && Array.isArray(list.friends)) { data = list; paint(); } return data; })
      .catch(function () { return data; });
  }

  function openApp() {
    hide();
    if (typeof global.openFriends === "function") global.openFriends();
  }

  function render() {
    if (!menu) return;
    menu.textContent = "";
    var list = online();
    var head = el("div", "fm-head");
    head.appendChild(el("strong", "", "Friends online"));
    head.appendChild(el("span", "fm-count", String(list.length)));
    menu.appendChild(head);

    var body = el("div", "fm-list");
    if (!data) {
      body.appendChild(el("p", "fm-empty", "Loading…"));
    } else if (!list.length) {
      body.appendChild(el("p", "fm-empty", data.friends.length ? "None of your friends are online right now." : "You haven't added any friends yet."));
    } else {
      list.forEach(function (friend) {
        var row = el("button", "fm-row");
        row.type = "button";
        var pic = picture(friend);
        pic.setAttribute("data-status", friend.status);
        row.appendChild(pic);
        row.appendChild(el("span", "fm-name", friend.username));
        row.appendChild(el("span", "fm-state", friend.status === "away" ? "Away" : "Online"));
        row.addEventListener("click", openApp);
        body.appendChild(row);
      });
    }
    menu.appendChild(body);

    var waiting = data ? data.incoming.length : 0;
    if (waiting) {
      var requests = el("button", "fm-requests", waiting + " friend request" + (waiting === 1 ? "" : "s") + " waiting");
      requests.type = "button";
      requests.addEventListener("click", openApp);
      menu.appendChild(requests);
    }
    var open = el("button", "fm-open", "Open Friends");
    open.type = "button";
    open.addEventListener("click", openApp);
    menu.appendChild(open);
  }

  function place() {
    var button = icon();
    var taskbar = document.getElementById("taskbar");
    if (!button || !menu) return;
    var rect = button.getBoundingClientRect();
    var bar = taskbar ? taskbar.getBoundingClientRect() : { top: rect.top };
    menu.style.bottom = Math.round(global.innerHeight - bar.top + 6) + "px";
    var right = global.innerWidth - rect.right - 8;
    var width = menu.offsetWidth || 300;
    menu.style.right = Math.max(4, Math.min(right, global.innerWidth - width - 4)) + "px";
  }

  function show() {
    if (menu) return;
    menu = el("div");
    menu.id = "friendsmenu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Friends online");
    document.body.appendChild(menu);
    render();
    place();
    load().then(function () { place(); });
  }

  function hide() {
    if (!menu) return;
    menu.remove();
    menu = null;
  }

  function toggle(event) {
    if (event) event.stopPropagation();
    if (menu) hide(); else show();
  }

  document.addEventListener("mousedown", function (event) { if (menu && !event.target.closest("#friendsmenu, #friendsbtn")) hide(); }, true);
  document.addEventListener("keydown", function (event) { if (event.key === "Escape") hide(); });
  global.addEventListener("resize", place);

  global.SnFriendsMenu = { toggle: toggle, refresh: load };

  function start() {
    if (!global.SnAccount) return;
    global.SnAccount.status().then(function (state) {
      if (!state || !state.user || state.enabled === false) return;
      var button = icon();
      if (button) button.style.display = "";
      load();
      timer = setInterval(function () { if (!document.hidden) load(); }, 45000);
    }, function () { /* offline: nothing to show */ });
  }
  setTimeout(start, 2200);
})(self);
