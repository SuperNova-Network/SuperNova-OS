/*
 * Chat notifications on the desktop.
 *
 * When "Messaging app" notifications are on (Settings > Notifications, or the Chat's own
 * settings), this keeps a quiet connection to the chat (/api/chat/stream?quiet=1: not
 * counted as being in the chat) and shows a notification for each new message from
 * somebody else: the sender's picture and name, and what they said. Nothing is shown
 * while the Chat window is in front and you are looking at it, and the connection is
 * closed whenever notifications are off, Do not disturb is on, or you are signed out.
 *
 * Needs notify-core.js, notify.js and account.js. Plain script.
 */
(function (global) {
  "use strict";

  var core = global.SnNotifyCore;
  var APP = "Messaging app";

  var source = null;
  var me = null;
  var failures = 0;
  var retryTimer = null;
  var signedIn = null; // null: not asked yet

  function wanted() {
    var settings = core.settings();
    return settings.chat && settings.enabled && !settings.dnd && signedIn === true;
  }

  /** Whether the Chat window is open, not minimised, at the front, and this page has focus. */
  function chatInFront() {
    var win = document.querySelector(".window[type='" + global.chatID + "']");
    return !!win && !win.classList.contains("closed") && win.getAttribute("active") === "true" && document.hasFocus();
  }

  function onMessage(message) {
    if (!message || !message.user || message.user.username === me) return;
    if (chatInFront()) return;
    var settings = core.settings();
    var what = core.describeChat(message, settings.preview);
    var name = message.user.username;
    global.SnNotify.show({
      app: APP,
      icon: "chat",
      title: what.title,
      text: what.text,
      picture: { url: global.SnAccount.avatarUrl(name, message.user.avatar), letter: name.charAt(0).toUpperCase(), color: core.avatarColor(name) },
      onClick: function () { if (typeof global.openChat === "function") global.openChat(); },
    });
  }

  function stop() {
    clearTimeout(retryTimer);
    if (source) { source.close(); source = null; }
    me = null;
  }

  function connect() {
    if (source) return;
    var stream = new EventSource("/api/chat/stream?quiet=1");
    source = stream;
    stream.addEventListener("ready", function (event) {
      failures = 0;
      try { me = JSON.parse(event.data).me.username; } catch (e) { /* keep listening */ }
    });
    stream.addEventListener("message", function (event) {
      try { onMessage(JSON.parse(event.data)); } catch (e) { console.warn("Chat notifications:", e); }
    });
    stream.addEventListener("closed", function (event) {
      var reason = "";
      try { reason = JSON.parse(event.data).reason; } catch (e) { /* unknown */ }
      stop();
      // Signed out or banned from the site: check again before trying to listen again.
      if (reason !== "another-tab") { signedIn = null; retryTimer = setTimeout(check, 10000); }
    });
    stream.addEventListener("error", function () {
      if (source !== stream) return;
      // The browser retries by itself, except after a refusal (signed out, accounts off).
      if (stream.readyState === 2) {
        stop();
        retryTimer = setTimeout(check, Math.min(60000, 2000 * Math.pow(2, failures++)));
      }
    });
  }

  function sync() {
    if (wanted()) connect(); else stop();
  }

  /** Ask the server whether anyone is signed in, then connect if notifications are wanted. */
  function check() {
    if (!global.SnAccount) return;
    global.SnAccount.status().then(function (state) {
      signedIn = Boolean(state && state.user && state.enabled !== false);
      sync();
    }, function () {
      signedIn = false;
      retryTimer = setTimeout(check, 30000);
    });
  }

  global.SnStore.onChange(function (key) {
    if (key === "notifyChat" || key === "notifyEnabled" || key === "notifyDnd" || key === "*") {
      if (signedIn === null) check(); else sync();
    }
  });

  // Only ask the server when there is something to listen for.
  if (core.settings().chat) check();
})(self);
