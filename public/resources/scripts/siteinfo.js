/*
 * What the admins tell the desktop, as it happens (the live channel, src/live.js): their announcement (an
 * Important one is a window to close, any other a notification at the bottom left, each shown once), maintenance
 * mode (everyone but admins goes to the "back soon" page at once), and the Admin item in the start menu for admins.
 *
 * Needs notify.js and account.js. Plain script.
 */
(function (global) {
  "use strict";

  var SEEN = "announceSeen";
  var LEVELS = { info: "Announcement", warning: "Warning", danger: "Important" };
  var CORNER = "bottom-left";   // where announcements and maintenance notes appear, whatever corner is set for other notifications
  var who = global.SnAccount
    ? global.SnAccount.status().then(function (state) { return Boolean(state && state.user && state.user.admin); }, function () { return false; })
    : Promise.resolve(false);

  // An Important announcement is a window in the middle of the screen that has to be closed.
  function closePopup() {
    var old = document.getElementById("announcepop");
    if (old) old.parentNode.removeChild(old);
  }

  function popup(a) {
    closePopup();
    var overlay = document.createElement("div");
    overlay.id = "announcepop";
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("data-id", String(a.id));
    var box = document.createElement("div");
    box.className = "ap-box";
    var bar = document.createElement("div");
    bar.className = "ap-bar";
    var title = document.createElement("span");
    title.textContent = LEVELS[a.level] || "Announcement";
    var x = document.createElement("span");
    x.className = "ap-x";
    x.textContent = "\u2715";
    x.title = "Close";
    bar.appendChild(title); bar.appendChild(x);
    var body = document.createElement("div");
    body.className = "ap-body";
    body.textContent = a.text;
    var foot = document.createElement("div");
    foot.className = "ap-foot";
    var ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = "OK";
    foot.appendChild(ok);
    box.appendChild(bar); box.appendChild(body); box.appendChild(foot);
    overlay.appendChild(box);
    var done = function () { closePopup(); document.removeEventListener("keydown", onKey); };
    var onKey = function (event) { if (event.key === "Escape" || event.key === "Enter") done(); };
    x.addEventListener("click", done);
    ok.addEventListener("click", done);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    ok.focus();
  }

  // An announcement, from the live channel or from the slower check. Each one is shown once per person.
  function showAnnouncement(a) {
    if (!a || !a.id) return;
    // Taken down (there is only ever one announcement): a window still open for it closes.
    if (!a.active || !a.text) { closePopup(); return; }
    if (String(a.id) === global.SnStore.get(SEEN)) return;
    if (a.level === "danger") {
      popup(a);
      global.SnStore.set(SEEN, String(a.id));
      return;
    }
    // Only counts as seen once it was really shown (notifications may be off, or on Do not disturb).
    if (global.SnNotify.show({ app: "SuperNova OS", icon: "bell", title: LEVELS[a.level] || "Announcement", text: a.text, position: CORNER })) {
      global.SnStore.set(SEEN, String(a.id));
    }
  }

  // Maintenance mode. Everyone but admins is taken to the "back soon" page at once (the server sends it);
  // admins keep working and are told.
  function maintenanceChanged(m, announce) {
    who.then(function (isAdmin) {
      if (m.on && !isAdmin) { global.location.reload(); return; }
      if (isAdmin && announce) {
        global.SnNotify.show({ app: "SuperNova OS", icon: "bell", title: m.on ? "Maintenance mode is on" : "Maintenance mode is off", text: m.on ? "Everyone but admins is on the \"back soon\" page." : "The site is open to everyone again.", position: CORNER });
      }
    });
  }

  // The live channel: the server pushes what admins change. It reconnects by itself, and each connection starts
  // with "hello", so a change made while it was down is caught up.
  function listen() {
    if (!global.EventSource) return;
    var source = new global.EventSource("/api/live");
    function on(name, handler) { source.addEventListener(name, function (event) { try { handler(JSON.parse(event.data)); } catch (e) { /* ignore a bad message */ } }); }
    on("hello", function (data) { showAnnouncement(data.announcement); if (data.maintenance) maintenanceChanged(data.maintenance, false); });
    on("announcement", showAnnouncement);
    on("maintenance", function (m) { maintenanceChanged(m, true); });
  }

  // The slower check: a fallback if the live channel can't connect (some networks cut long connections).
  function check() {
    if (document.hidden) return;
    fetch("/api/announcement", { credentials: "same-origin", cache: "no-store" }).then(function (res) {
      if (res.status === 503) return res.json().then(function (data) { if (data && data.maintenance) maintenanceChanged({ on: true }, false); });
      if (!res.ok) return null;
      return res.json().then(function (data) { showAnnouncement(data && data.announcement); });
    }).catch(function () { /* offline: try again later */ });
  }

  // Fill a round avatar: the picture, or the initial on a colour when there is none.
  function paintAvatar(box, user) {
    var url = global.SnAccount.avatarUrl(user.username, user.avatar);
    var letter = function () {
      // Without a picture: Windows' grey circle with a person in it.
      box.textContent = "";
      box.classList.add("plain");
      box.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.6" r="4.3"></circle><path d="M3.6 21.5c.5-4.6 4-7.3 8.4-7.3s7.9 2.7 8.4 7.3z"></path></svg>';
    };
    box.textContent = "";
    if (!url) { letter(); return; }
    var img = document.createElement("img");
    img.alt = "";
    img.onerror = letter;
    img.src = url;
    box.appendChild(img);
  }

  // The desktop's own script (main.js) is the last on the page; the account answer can arrive before
  // it has run, so wait for the page to finish loading before touching anything it defines.
  function whenLoaded(fn) {
    if (document.readyState === "complete") fn(); else global.addEventListener("load", fn);
  }

  // Friends: this open desktop tells the server "I'm here" every minute (that is what makes you show as online to your
  // friends), and hears back how many friend requests are waiting: a new one is shown as a notification.
  var requests = null, beating = false;
  function beat() {
    fetch("/api/friends/ping", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "content-type": "application/json" }, body: "{}" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (data) {
        if (!data) return;
        if (requests !== null && data.requests > requests) {
          global.SnNotify.show({ app: "Friends", icon: "bell", title: "New friend request", text: "Open Friends to answer it." });
        }
        requests = data.requests;
      })
      .catch(function () { /* offline: the next beat will do */ });
  }
  function startHeartbeat() {
    if (beating) return;
    beating = true;
    beat();
    setInterval(beat, 60000);
  }

  // The App Store is pinned to the taskbar for everyone (new visitors get it by default), once for people who
  // already had pins of their own. After that it is yours to unpin: a flag remembers it was offered. It runs
  // after sign-in is known so it lands in the account's settings, not in a page that is about to be replaced.
  function offerStore() {
    if (global.SnStore.get("storePinned") === "1") return;
    global.SnStore.set("storePinned", "1");
    if (global.essentialIds().indexOf(global.storeID) === -1) global.pinEssential(global.storeID);
  }

  if (global.SnAccount) {
    global.SnAccount.status().then(
      function (state) { whenLoaded(function () { offerStore(); setupForUser(state); }); },
      function () { whenLoaded(offerStore); }
    );
  } else {
    whenLoaded(offerStore);
  }

  function setupForUser(state) {
    {
      var user = state && state.user;
      if (!user) return;
      // Your profile and, for admins, the Admin Panel, join the start menu's rail.
      document.getElementById("start-profile").setAttribute("data-show", "1");
      startHeartbeat();
      document.getElementById("start-username").textContent = user.username;
      paintAvatar(document.getElementById("start-avatar"), user);
      if (user.admin) {
        document.getElementById("start-admin").setAttribute("data-show", "1");
        // Findable by searching ("admin", "ban", "users", "audit"...).
        global.programData[global.adminID].keywords = "admin,administration,admin panel,moderation,accounts,users,ban,unban,invites,sessions,audit,announcement,maintenance,filter,blocklist,chat moderation";
        global.adminSearchable = true;
        // Pinned to the taskbar by default, once. After that it is yours to unpin (a flag remembers it was offered).
        if (global.SnStore.get("adminPinned") !== "1") {
          global.SnStore.set("adminPinned", "1");
          if (global.essentialIds().indexOf(global.adminID) === -1) global.pinEssential(global.adminID);
        }
      }
      if (global.layoutStartRail) global.layoutStartRail();
    }
  }

  whenLoaded(function () { setTimeout(listen, 1500); });   // after the desktop has settled
  setTimeout(check, 6000);
  setInterval(check, 90000);
})(self);
