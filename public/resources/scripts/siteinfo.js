/*
 * What the admins tell the desktop: their announcement (shown as a notification, once per
 * announcement), a note when the site goes into maintenance mode, and the Admin item in the
 * start menu for people who are admins.
 *
 * Needs notify.js and account.js. Plain script.
 */
(function (global) {
  "use strict";

  var SEEN = "announceSeen";
  var LEVELS = { info: "Announcement", warning: "Warning", danger: "Important" };
  var told = "";      // the maintenance message already shown, so it isn't repeated every check

  function check() {
    if (document.hidden) return;
    fetch("/api/announcement", { credentials: "same-origin", cache: "no-store" }).then(function (res) {
      if (res.status === 503) {
        return res.json().then(function (data) {
          if (data && data.maintenance && told !== data.error) {
            told = data.error;
            global.SnNotify.show({ app: "SuperNova OS", icon: "bell", title: "Down for maintenance", text: data.error });
          }
        });
      }
      if (!res.ok) return null;
      return res.json().then(function (data) {
        var a = data && data.announcement;
        if (!a || String(a.id) === global.SnStore.get(SEEN)) return;
        // Only counts as seen once it was really shown (notifications may be off, or on Do not disturb).
        if (global.SnNotify.show({ app: "SuperNova OS", icon: "bell", title: LEVELS[a.level] || "Announcement", text: a.text })) {
          global.SnStore.set(SEEN, String(a.id));
        }
      });
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
        var label = document.getElementById("start-friends-count");
        if (label) label.textContent = data.requests ? " (" + data.requests + ")" : "";
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
      document.getElementById("start-friends").setAttribute("data-show", "1");
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

  setTimeout(check, 4000);        // after the desktop has settled
  setInterval(check, 90000);
})(self);
