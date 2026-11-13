/*
 * Notification pop-ups on the desktop (the look is in notify.css, the settings and
 * rules are in notify-core.js).
 *
 *   SnNotify.show({ app, icon, title, text, picture, onClick })
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

    var body = node("div", "sn-toast-body");
    if (settings.pictures && options.picture) body.appendChild(picture(options, settings));
    var text = node("div", "sn-toast-text");
    text.appendChild(node("span", "sn-toast-title", options.title || ""));
    if (options.text) text.appendChild(node("span", "sn-toast-msg", options.text));
    body.appendChild(text);
    el.appendChild(body);
    return { el: el, close: close };
  }

  /**
   * Show a notification (unless notifications are off or Do not disturb is on). Returns
   * { dismiss() }, or null when nothing was shown.
   * options: { app, icon: "chat"|"bell", title, text, picture: { url, letter, color }, onClick,
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
    toast.timer = setTimeout(function () { leave(toast); }, settings.durationMs);
    trim();
    return { dismiss: function () { leave(toast); } };
  }

  global.SnNotify = {
    show: show,
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
