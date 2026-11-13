/*
 * Notification settings and the rules that don't need a page: shared by the desktop
 * (which shows the notifications, see notify.js), Settings (where they are customised)
 * and the Chat (which turns its own notifications on and off).
 *
 * The settings are ordinary SnStore values, so they sync with the account:
 *   notifyEnabled   "Get notifications from apps and other senders"          1
 *   notifyDnd       Do not disturb: no banners, no sounds                     0
 *   notifyChat      notifications from the Messaging app (the Chat)           0 (off until turned on)
 *   notifyMentions  notifications when someone @mentions you in the Chat      1 (on)
 *   notifyBanners   show the pop-up                                           1
 *   notifySound     play a sound when one arrives                             1
 *   notifyPreview   show what the message says                                1
 *   notifyPictures  show the sender's picture                                 1
 *   notifyDuration  seconds a notification stays: 5, 7, 15, 30, 60 or 300     5
 *   notifyTheme     dark, light or accent (the desktop's colour scheme)       dark
 *   notifySize      small or standard                                         small
 *   notifyPosition  bottom-right, bottom-left, top-right or top-left          bottom-right
 *
 * Plain script; attaches `SnNotifyCore` to the global object.
 */
(function (global) {
  "use strict";

  var DEFAULTS = {
    notifyEnabled: "1", notifyDnd: "0", notifyChat: "0", notifyMentions: "1", notifyBanners: "1", notifySound: "1",
    notifyPreview: "1", notifyPictures: "1", notifyDuration: "5", notifyTheme: "dark",
    notifySize: "small", notifyPosition: "bottom-right",
  };
  var DURATIONS = [5, 7, 15, 30, 60, 300];
  var THEMES = ["dark", "light", "accent"];
  var SIZES = ["small", "standard"];
  var POSITIONS = ["bottom-right", "bottom-left", "top-right", "top-left"];

  function oneOf(list, value, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback;
  }

  /**
   * The settings as the display uses them, from a `read(key)` that returns the stored
   * string (or the default). Anything unexpected, such as a value from an older version
   * or an imported backup, falls back to the default.
   */
  function parse(read) {
    var flag = function (key) { return String(read(key) == null ? DEFAULTS[key] : read(key)) === "1"; };
    var seconds = Number(read("notifyDuration"));
    return {
      enabled: flag("notifyEnabled"),
      dnd: flag("notifyDnd"),
      chat: flag("notifyChat"),
      mentions: flag("notifyMentions"),
      banners: flag("notifyBanners"),
      sound: flag("notifySound"),
      preview: flag("notifyPreview"),
      pictures: flag("notifyPictures"),
      durationMs: (DURATIONS.indexOf(seconds) !== -1 ? seconds : 5) * 1000,
      theme: oneOf(THEMES, read("notifyTheme"), "dark"),
      size: oneOf(SIZES, read("notifySize"), "small"),
      position: oneOf(POSITIONS, read("notifyPosition"), "bottom-right"),
    };
  }

  /**
   * How tall the stack of notifications may be: three quarters of the way up the lower
   * half of the screen, which is 3/8 of its height. Anything older than that fades away.
   */
  function stackLimit(viewportHeight) {
    return Math.floor(viewportHeight * 0.375);
  }

  /**
   * Which of the stack's notifications must go. `heights` are the visible ones, oldest
   * first; `gap` is the space between them. Returns how many of the oldest to remove so
   * the rest fit in `limit`. The newest is never removed.
   */
  function overflow(heights, gap, limit) {
    var total = 0;
    for (var i = 0; i < heights.length; i++) total += heights[i] + (i ? gap : 0);
    var remove = 0;
    while (total > limit && remove < heights.length - 1) {
      total -= heights[remove] + gap;
      remove++;
    }
    return remove;
  }

  /** What a chat message looks like as a notification: { title, text }. */
  function describeChat(message, preview) {
    var name = String(message && message.user && message.user.username || "Someone");
    if (!preview) return { title: name, text: "Sent a message" };
    var text = String(message.text || "").replace(/\s+/g, " ").trim();
    if (message.media) text = text ? text + " (GIF)" : "Sent a GIF";
    return { title: name, text: text || "Sent a message" };
  }

  var COLORS = ["#d9534f", "#e8892e", "#c9a227", "#43a047", "#16a085", "#2b8cd6", "#5c6bc0", "#8e44ad", "#d6457a", "#6d7b8a"];
  /** The colour behind someone's initial when they have no picture. */
  function avatarColor(name) {
    var hash = 0;
    String(name).split("").forEach(function (char) { hash = (hash * 31 + char.charCodeAt(0)) >>> 0; });
    return COLORS[hash % COLORS.length];
  }

  global.SnNotifyCore = {
    DEFAULTS: DEFAULTS, DURATIONS: DURATIONS, THEMES: THEMES, SIZES: SIZES, POSITIONS: POSITIONS,
    parse: parse, stackLimit: stackLimit, overflow: overflow, describeChat: describeChat, avatarColor: avatarColor,
    /** The current settings. */
    settings: function () { return parse(function (key) { return global.SnStore ? global.SnStore.get(key) : undefined; }); },
  };

  if (global.SnStore) global.SnStore.defaults(DEFAULTS);
})(typeof self !== "undefined" ? self : globalThis);
