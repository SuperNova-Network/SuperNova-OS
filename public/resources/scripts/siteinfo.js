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

  if (global.SnAccount) {
    global.SnAccount.status().then(function (state) {
      if (state && state.user && state.user.admin) {
        var item = document.getElementById("start-admin");
        if (item) item.style.display = "block";
      }
    }, function () { /* not signed in */ });
  }

  setTimeout(check, 4000);        // after the desktop has settled
  setInterval(check, 90000);
})(self);
