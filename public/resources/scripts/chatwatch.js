/*
 * Chat notifications on the desktop.
 *
 * This keeps a quiet connection to the chat (/api/chat/stream?quiet=1: not counted as being in
 * the chat) and shows a notification for a new message from somebody else: the sender's
 * picture and name, and what they said. All messages when "Messaging app" notifications are on
 * (Settings > Notifications, or the Chat's own settings); otherwise just the ones that @mention
 * you (by name, by one of your roles, or @everyone), which get a dotted turning ring. Nothing is shown
 * while the Chat window is in front and you are looking at it, and the connection is
 * closed whenever notifications are off, Do not disturb is on, or you are signed out.
 *
 * It also keeps the number on the Chat icon in the taskbar: how many messages from other people have come since
 * you last read the chat. The server remembers where you got to (per account), so signing in on another computer
 * shows what came while you were away, and reading on one computer clears it on all of them.
 *
 * Needs notify-core.js, notify.js and account.js. Plain script.
 */
(function (global) {
  "use strict";

  var core = global.SnNotifyCore;
  var APP = "Messaging app";

  var source = null;
  var me = null;      // { username, roles: [slugs you answer to] }
  var failures = 0;
  var retryTimer = null;
  var signedIn = null; // null: not asked yet
  var unread = 0;

  // The connection is kept whenever someone is signed in (the badge needs it); the notification settings only
  // decide whether a pop-up is shown.
  function wanted() {
    return signedIn === true;
  }

  /** The red number on the Chat icon (a CSS variable and an attribute: the icon can be rebuilt at any time). */
  function showBadge() {
    var root = document.documentElement;
    if (!document.getElementById("chat-badge-style") && typeof global.chatID === "number") {
      var style = document.createElement("style");
      style.id = "chat-badge-style";
      style.textContent = ".taskbaricon[type='" + global.chatID + "']::after{content:var(--chat-unread,'');display:none;position:absolute;top:0.3vw;right:0.55vw;min-width:1.15vw;height:1.15vw;padding:0 0.25vw;box-sizing:border-box;border-radius:0.6vw;background:#e5484d;color:#fff;font:700 0.72vw/1.15vw 'Segoe UI',system-ui,sans-serif;text-align:center;pointer-events:none}" +
        "html:not([data-chat-unread='0'])[data-chat-unread] .taskbaricon[type='" + global.chatID + "']::after{display:block}";
      document.head.appendChild(style);
    }
    root.style.setProperty("--chat-unread", "'" + (unread > 99 ? "99+" : String(unread)) + "'");
    root.setAttribute("data-chat-unread", String(unread));
  }

  function setUnread(count) {
    unread = Math.max(0, Number(count) || 0);
    showBadge();
  }

  /** Whether the Chat window is open, not minimised, at the front, and this page has focus. */
  function chatInFront() {
    var win = document.querySelector(".window[type='" + global.chatID + "']");
    return !!win && !win.classList.contains("closed") && win.getAttribute("active") === "true" && document.hasFocus();
  }

  /** Why this message is for you: "you", "role", "everyone", or "" when it doesn't ping you. */
  function pingKind(message) {
    var m = message.mentions;
    if (!m || !me) return "";
    if ((m.users || []).some(function (name) { return name.toLowerCase() === me.username.toLowerCase(); })) return "you";
    if ((m.roles || []).some(function (slug) { return (me.roles || []).indexOf(slug) !== -1; })) return "role";
    if (m.everyone || m.here) return "everyone";
    return "";
  }

  function onMessage(message) {
    if (!message || !message.user || !me || message.user.username === me.username) return;
    if (chatInFront()) return; // you are looking at it: nothing to count or show
    setUnread(unread + 1);
    var settings = core.settings();
    var ping = pingKind(message);
    if (!settings.chat && !(settings.mentions && ping)) return;
    var what = core.describeChat(message, settings.preview);
    var name = message.user.username;
    var title = what.title;
    if (ping) title = name + (ping === "you" ? " mentioned you" : ping === "role" ? " mentioned your role" : " mentioned everyone");
    global.SnNotify.show({
      app: APP,
      icon: "chat",
      title: title,
      text: ping && !settings.preview ? "Open the Chat to read it" : what.text,
      important: Boolean(ping),
      picture: { url: global.SnAccount.avatarUrl(name, message.user.avatar), letter: name.charAt(0).toUpperCase(), color: core.avatarColor(name) },
      onClick: function () { if (typeof global.openChat === "function") global.openChat(); },
    });
  }

  function stop() {
    clearTimeout(retryTimer);
    if (source) { source.close(); source = null; }
    me = null;
    setUnread(0);
  }

  function connect() {
    if (source) return;
    var stream = new EventSource("/api/chat/stream?quiet=1");
    source = stream;
    stream.addEventListener("ready", function (event) {
      failures = 0;
      try {
        var ready = JSON.parse(event.data);
        me = { username: ready.me.username, roles: ready.me.roles || [] };
        setUnread(ready.unread);
      } catch (e) { /* keep listening */ }
    });
    // You read the chat (here or on another computer).
    stream.addEventListener("read", function () { setUnread(0); });
    // Your roles changed (an admin gave or took one): pings for them follow.
    stream.addEventListener("me", function (event) {
      try { var about = JSON.parse(event.data); if (me) me.roles = about.roles || []; } catch (e) { /* keep the old ones */ }
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

  // The Chat window asks this to know whether it is being looked at (see apps/chat.js).
  global.SnChatWatch = { inFront: chatInFront };

  global.SnStore.onChange(function (key) {
    if (key === "*") { if (signedIn === null) check(); else sync(); }
  });

  check();
})(self);
