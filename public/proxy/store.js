/*
 * Settings store shared by every SuperNova page.
 *
 * Values live in localStorage under "sn.<key>", with an in-memory fallback for
 * browsers that block storage (private mode, strict cookie settings). Changes are
 * announced to listeners both in this document and, via the "storage" event, in
 * every other open document of the origin, so a Settings window can retune the
 * desktop and the cloak live without any direct wiring between them.
 *
 * Plain script; attaches `SnStore` to the global object.
 */
(function (global) {
  "use strict";

  var PREFIX = "sn.";
  var memory = {};
  var defaults = {};
  var listeners = [];

  function read(key) {
    try {
      var value = localStorage.getItem(PREFIX + key);
      if (value !== null) return value;
    } catch (e) { /* storage blocked */ }
    return key in memory ? memory[key] : defaults[key];
  }

  // Keys the desktop stored before it used this store, without the prefix. They are
  // moved under "sn." once so nobody loses their pinned apps, wallpaper or names.
  var LEGACY_KEYS = [
    "taskArr", "oftenUsed", "colId", "backId", "backgroundUrl", "lockTaskbar",
    "viewmode", "winW", "winH", "tzIndex", "tzOffset", "visited-before", "welcome-popup",
  ];

  function isLegacyKey(key) {
    return LEGACY_KEYS.indexOf(key) !== -1 || /^customTitle\d+$/.test(key);
  }

  function migrateLegacy() {
    try {
      // Collect the keys first: adding and removing items reorders localStorage.key(i).
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
      keys.forEach(function (key) {
        if (key === null || !isLegacyKey(key)) return;
        // A value already under the prefix is newer; keep it.
        if (localStorage.getItem(PREFIX + key) === null) {
          localStorage.setItem(PREFIX + key, localStorage.getItem(key));
        }
        localStorage.removeItem(key);
      });
    } catch (e) { /* storage blocked or unavailable (workers) */ }
  }

  migrateLegacy();

  function notify(key, value) {
    listeners.slice().forEach(function (listener) {
      try { listener(key, value); } catch (e) { console.error(e); }
    });
  }

  global.SnStore = {
    /** Register default values. Later registrations win; existing user values are untouched. */
    defaults: function (map) {
      Object.keys(map).forEach(function (key) { defaults[key] = map[key]; });
    },

    /** The stored string, or its registered default (undefined if neither exists). */
    get: read,

    /** Boolean settings are stored as "1"/"0". */
    flag: function (key) {
      return read(key) === "1";
    },

    set: function (key, value) {
      value = String(value);
      memory[key] = value;
      try { localStorage.setItem(PREFIX + key, value); } catch (e) { /* storage blocked */ }
      notify(key, value);
    },

    remove: function (key) {
      delete memory[key];
      try { localStorage.removeItem(PREFIX + key); } catch (e) { /* storage blocked */ }
      notify(key, defaults[key]);
    },

    /**
     * Factory reset: erase everything this origin keeps in localStorage (settings,
     * and the proxied sites' saved data too), then announce it as "*".
     */
    clear: function () {
      memory = {};
      try { localStorage.clear(); } catch (e) { /* storage blocked */ }
      notify("*", undefined);
    },

    /** Subscribe to changes made here or in another tab/window. Returns an unsubscribe function. */
    onChange: function (listener) {
      listeners.push(listener);
      return function () {
        var index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    },
  };

  // Changes made by other documents of this origin (the storage event never fires in
  // the document that made the change).
  if (typeof global.addEventListener === "function") {
    global.addEventListener("storage", function (event) {
      if (event.key === null) return notify("*", undefined); // localStorage.clear()
      if (event.key.indexOf(PREFIX) !== 0) return;
      var key = event.key.slice(PREFIX.length);
      delete memory[key];
      notify(key, event.newValue === null ? defaults[key] : event.newValue);
    });
  }
})(typeof self !== "undefined" ? self : globalThis);
