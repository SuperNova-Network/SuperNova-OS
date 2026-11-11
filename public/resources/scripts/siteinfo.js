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
      box.textContent = user.username.charAt(0).toUpperCase();
      box.style.background = global.SnNotifyCore ? global.SnNotifyCore.avatarColor(user.username) : "#6d7b8a";
    };
    box.textContent = "";
    if (!url) { letter(); return; }
    var img = document.createElement("img");
    img.alt = "";
    img.onerror = letter;
    img.src = url;
    box.appendChild(img);
  }

  if (global.SnAccount) {
    global.SnAccount.status().then(function (state) {
      var user = state && state.user;
      if (!user) return;
      // Your profile and, for admins, the Admin Panel, join the start menu's rail.
      document.getElementById("start-profile").setAttribute("data-show", "1");
      document.getElementById("start-username").textContent = user.username;
      document.getElementById("pm-name").textContent = user.username;
      paintAvatar(document.getElementById("start-avatar"), user);
      paintAvatar(document.getElementById("pm-avatar"), user);
      if (user.admin) document.getElementById("start-admin").setAttribute("data-show", "1");
      if (global.layoutStartRail) global.layoutStartRail();
    }, function () { /* not signed in */ });
  }

  setTimeout(check, 4000);        // after the desktop has settled
  setInterval(check, 90000);
})(self);
