/*
 * Notification pop-ups on the desktop (the look is in notify.css, the settings and
 * rules are in notify-core.js).
 *
 *   SnNotify.show({ app, icon, title, text, picture, onClick, important, large, slowRing, durationMs, pauseWhenHidden,
 *                   actions: [{ label, primary, onClick(handle) }] })
 *   SnNotify.friendRequest({ username, avatar })   a friend request with Accept and Decline
 *   SnNotify.test()          a sample, for Settings > Notifications
 *
 * Notifications stack at the chosen corner, newest nearest the corner. They disappear
 * after the chosen time, and when the stack would reach more than three quarters of the
 * way up the lower half of the screen the oldest ones fade away first. Settings and
 * the Chat (windows of this page) reach it as `parent.SnNotify`.
 *
 * Plain script; attaches `SnNotify` to the global object.
 */
(function (global) {
  "use strict";

  var core = global.SnNotifyCore;
  var GAP = 6;
  var FADE_MS = 300;
  var NS = "http://www.w3.org/2000/svg";

  var containers = {}; // one stack per corner: the one the person chose, and any corner an announcement asks for
  var toasts = []; // oldest first: { el, timer, leaving }

  var ICONS = {
    chat: "M3 5h18v12H10l-5 4v-4H3z",
    bell: "M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4",
    friends: "M9 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M17 6a2.6 2.6 0 0 1 0 5M17.5 14.7c2 .6 3.5 2.3 3.5 5.3",
  };

  function reducedMotion() {
    return !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function node(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function icon(name) {
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS(NS, "path");
    path.setAttribute("d", ICONS[name] || ICONS.bell);
    svg.appendChild(path);
    return svg;
  }

  // --- sound: two short notes, like a chime, made here so there is nothing to download ---------

  var audio = null;
  function ding() {
    try {
      var Context = global.AudioContext || global.webkitAudioContext;
      if (!Context) return;
      audio = audio || new Context();
      if (audio.state === "suspended") audio.resume();
      var start = audio.currentTime;
      [[880, 0], [1175, 0.11]].forEach(function (note) {
        var oscillator = audio.createOscillator();
        var gain = audio.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = note[0];
        gain.gain.setValueAtTime(0.0001, start + note[1]);
        gain.gain.exponentialRampToValueAtTime(0.09, start + note[1] + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + note[1] + 0.22);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start(start + note[1]);
        oscillator.stop(start + note[1] + 0.25);
      });
    } catch (e) { /* no audio, or not allowed yet: the pop-up is enough */ }
  }

  // --- the stack ----------------------------------------------------------------------------------

  function taskbarOffset() {
    var taskbar = document.getElementById("taskbar");
    return (taskbar ? taskbar.offsetHeight : 40) + 8;
  }

  /** The stack for a corner (made when first needed), above the taskbar when at the bottom. */
  function place(position, settings) {
    var container = containers[position];
    if (!container) {
      container = node("div");
      container.className = "sn-toasts";
      container.setAttribute("role", "region");
      container.setAttribute("aria-label", "Notifications");
      container.addEventListener("mousedown", function (event) { event.stopPropagation(); });
      document.body.appendChild(container);
      containers[position] = container;
    }
    var bottom = position.indexOf("bottom") === 0;
    container.dataset.pos = position;
    container.dataset.size = settings.size;
    container.style.top = bottom ? "auto" : "8px";
    container.style.bottom = bottom ? taskbarOffset() + "px" : "auto";
    container.style.left = position.indexOf("left") !== -1 ? "8px" : "auto";
    container.style.right = position.indexOf("right") !== -1 ? "8px" : "auto";
    return container;
  }

  function leave(toast) {
    if (toast.leaving) return;
    toast.leaving = true;
    clearTimeout(toast.timer);
    var done = function () {
      var index = toasts.indexOf(toast);
      if (index !== -1) toasts.splice(index, 1);
      if (toast.el.parentNode) toast.el.parentNode.removeChild(toast.el);
    };
    if (reducedMotion()) return done();
    toast.el.setAttribute("data-leaving", "");
    setTimeout(done, FADE_MS);
  }

  /** Fade away the oldest notifications in each stack until it is no taller than allowed. */
  function trim() {
    Object.keys(containers).forEach(function (position) {
      var box = containers[position];
      var live = toasts.filter(function (toast) { return !toast.leaving && toast.box === box; });
      var offset = position.indexOf("bottom") === 0 ? taskbarOffset() : 8;
      var room = Math.max(60, core.stackLimit(global.innerHeight) - offset);
      var drop = core.overflow(live.map(function (toast) { return toast.el.offsetHeight; }), GAP, room);
      live.slice(0, drop).forEach(leave);
    });
  }

  function picture(options, settings) {
    var box = node("span", "sn-toast-pic");
    var pic = options.picture || {};
    var letter = function () {
      box.textContent = "";
      box.style.background = pic.color || "#6d7b8a";
      box.appendChild(document.createTextNode(pic.letter || ""));
    };
    if (pic.url) {
      var img = node("img");
      img.alt = "";
      img.addEventListener("error", letter, { once: true });
      img.src = pic.url;
      box.appendChild(img);
    } else {
      letter();
    }
    return box;
  }

  function build(options, settings) {
    var el = node("div", "sn-toast");
    el.setAttribute("role", "status");
    el.dataset.theme = settings.theme;
    el.style.setProperty("--sn-accent", (global.SnStore && global.SnStore.get("accent")) || "#6b5cff");

    var head = node("div", "sn-toast-head");
    head.appendChild(icon(options.icon || "bell"));
    head.appendChild(node("span", "sn-toast-app", options.app || "SuperNova OS"));
    var close = node("button", "sn-toast-close", "✕");
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    head.appendChild(close);
    el.appendChild(head);

    // Something important (a mention) gets a dotted ring turning around its edge, so it stands out.
    if (options.important) {
      el.classList.add("sn-toast-important");
      var ring = document.createElementNS(NS, "svg");
      ring.setAttribute("class", "sn-ring");
      ring.setAttribute("aria-hidden", "true");
      var rect = document.createElementNS(NS, "rect");
      rect.setAttribute("x", "0"); rect.setAttribute("y", "0");
      rect.setAttribute("width", "100%"); rect.setAttribute("height", "100%");
      ring.appendChild(rect);
      el.appendChild(ring);
    }

    var body = node("div", "sn-toast-body");
    if (settings.pictures && options.picture) body.appendChild(picture(options, settings));
    var text = node("div", "sn-toast-text");
    text.appendChild(node("span", "sn-toast-title", options.title || ""));
    if (options.text) text.appendChild(node("span", "sn-toast-msg", options.text));
    body.appendChild(text);
    el.appendChild(body);

    // Buttons under the text (Accept / Decline), when the notification asks for them.
    var buttons = [];
    if (options.actions && options.actions.length) {
      var row = node("div", "sn-toast-actions");
      options.actions.forEach(function (action) {
        var button = node("button", "sn-toast-btn" + (action.primary ? " primary" : ""), action.label);
        button.type = "button";
        row.appendChild(button);
        buttons.push(button);
      });
      el.appendChild(row);
    }
    if (options.large) el.classList.add("sn-toast-large");
    if (options.slowRing) el.classList.add("sn-toast-slowring");
    return { el: el, close: close, buttons: buttons, text: text, body: body };
  }

  /**
   * Show a notification (unless notifications are off or Do not disturb is on). Returns
   * { dismiss() }, or null when nothing was shown.
   * options: { app, icon: "chat"|"bell", title, text, picture: { url, letter, color }, onClick,
   *   important: true gives it the dotted turning ring (used for mentions),
   *   position: a corner to use instead of the person's own choice ("bottom-left") }
   */
  function show(options) {
    var settings = core.settings();
    if (!settings.enabled || settings.dnd) return null;
    if (settings.sound) ding();
    if (!settings.banners) return null;

    var position = core.POSITIONS.indexOf(options.position) !== -1 ? options.position : settings.position;
    var container = place(position, settings);
    var built = build(options, settings);
    var toast = { el: built.el, box: container, timer: null, leaving: false };
    toasts.push(toast);
    // Newest nearest the corner: at the bottom corners that is the end of the list, at the top the start.
    if (position.indexOf("top") === 0 && container.firstChild) container.insertBefore(toast.el, container.firstChild);
    else container.appendChild(toast.el);

    built.close.addEventListener("click", function (event) { event.stopPropagation(); leave(toast); });
    toast.el.addEventListener("click", function () {
      leave(toast);
      if (typeof options.onClick === "function") { try { options.onClick(); } catch (e) { console.error(e); } }
    });
    var duration = typeof options.durationMs === "number" ? options.durationMs : settings.durationMs;
    if (options.pauseWhenHidden) {
      // The time only runs while this tab is the one you are looking at: tab away and it waits for you.
      toast.remaining = duration;
      toast.timer = setInterval(function () {
        if (document.hidden) return;
        toast.remaining -= 1000;
        if (toast.remaining <= 0) leave(toast);
      }, 1000);
    } else {
      toast.timer = setTimeout(function () { leave(toast); }, duration);
    }
    var handle = {
      dismiss: function () { leave(toast); },
      /** Replace the text (and drop the buttons): for telling someone what happened when they pressed one. */
      setText: function (message) {
        var msg = built.text.querySelector(".sn-toast-msg") || built.text.appendChild(node("span", "sn-toast-msg"));
        msg.textContent = message;
        var actions = toast.el.querySelector(".sn-toast-actions");
        if (actions) actions.remove();
      },
    };
    // Each button runs its action. An action may return a promise: the notification closes when it finishes well.
    built.buttons.forEach(function (button, index) {
      button.addEventListener("click", function (event) {
        event.stopPropagation();
        var action = options.actions[index];
        button.disabled = true;
        Promise.resolve().then(function () { return action.onClick(handle); }).then(function () { leave(toast); }, function (error) {
          button.disabled = false;
          handle.setText(error && error.message ? error.message : "That didn't work.");
        });
      });
    });
    trim();
    return handle;
  }

  // --- friend requests ----------------------------------------------------------------------------

  var REQUEST_MS = 3 * 60 * 1000;  // stays for three minutes of you looking at the page
  var REQUESTS_KEY = "snFriendReqSeen";
  var requestToasts = {};          // username -> the notification being shown

  function seenRequests() { try { return JSON.parse(global.localStorage.getItem(REQUESTS_KEY) || "[]") || []; } catch (e) { return []; } }
  function saveSeen(list) { try { global.localStorage.setItem(REQUESTS_KEY, JSON.stringify(list.slice(-50))); } catch (e) { /* storage blocked */ } }

  function answerRequest(path, username) {
    return fetch("/api/friends/" + path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: username }) })
      .then(function (res) { return res.json().catch(function () { return {}; }).then(function (data) { if (!res.ok) throw new Error(data.error || "That didn't work."); }); });
  }

  /**
   * "Someone wants to be friends", with Accept and Decline right on it. Important-looking: bigger, with a slow dotted
   * ring, and it stays three minutes (only counting while this tab is in front). Each request is announced once per
   * device by the slower check (quiet: true); the live push always shows it.
   */
  function friendRequest(person, quiet) {
    if (!person || !person.username) return null;
    var name = String(person.username);
    if (requestToasts[name]) return requestToasts[name];
    var seen = seenRequests();
    if (quiet && seen.indexOf(name) !== -1) return null;
    var url = global.SnAccount && global.SnAccount.avatarUrl ? global.SnAccount.avatarUrl(name, person.avatar) : "";
    var forget = function () { delete requestToasts[name]; saveSeen(seenRequests().filter(function (n) { return n !== name; })); };
    var handle = show({
      app: "Friends",
      icon: "friends",
      title: name + " wants to be friends",
      text: "Accept to add them to your friends.",
      picture: { url: url, letter: name.charAt(0).toUpperCase(), color: core.avatarColor(name) },
      important: true,
      large: true,
      slowRing: true,
      durationMs: REQUEST_MS,
      pauseWhenHidden: true,
      onClick: function () { if (typeof global.openFriends === "function") global.openFriends(); },
      actions: [
        { label: "Accept", primary: true, onClick: function () { return answerRequest("accept", name).then(function () { forget(); show({ app: "Friends", icon: "friends", title: "You and " + name + " are friends", text: "They can see when you are online." }); }); } },
        { label: "Decline", onClick: function () { return answerRequest("decline", name).then(forget); } },
      ],
    });
    if (!handle) return null;
    requestToasts[name] = handle;
    if (seen.indexOf(name) === -1) { seen.push(name); saveSeen(seen); }
    var dismiss = handle.dismiss;
    handle.dismiss = function () { delete requestToasts[name]; dismiss(); };
    return handle;
  }

  /** Forget the requests that are no longer waiting (answered, or taken back), so a new one from the same person is announced. */
  function pruneRequests(stillWaiting) {
    saveSeen(seenRequests().filter(function (name) { return stillWaiting.indexOf(name) !== -1; }));
  }

  global.SnNotify = {
    show: show,
    friendRequest: friendRequest,
    pruneRequests: pruneRequests,
    /** A sample notification, to try the settings. */
    test: function () {
      return show({
        app: "SuperNova OS",
        icon: "bell",
        title: "This is a test notification",
        text: "It looks like this with your settings.",
        picture: { letter: "S", color: "#6b5cff" },
      });
    },
    /** Remove every notification now. */
    clear: function () { toasts.slice().forEach(leave); },
  };
})(self);
