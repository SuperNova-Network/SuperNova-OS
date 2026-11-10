/*
 * Settings backups: everything SnStore holds (apps, bookmarks, wallpaper, proxy and
 * cloak preferences) as one JSON file the user can save and load again, on this
 * device or another instance.
 *
 * A file looks like:
 *   { "format": "supernova-settings", "version": 1, "exported": "<ISO date>",
 *     "settings": { "<key>": "<string value>", ... } }
 *
 * Imported values are only checked for shape here (string values, sane keys and
 * sizes); whatever reads a setting validates its meaning, as it must for values
 * left behind by older versions anyway.
 *
 * Plain script; attaches `SnBackup` to the global object.
 */
(function (global) {
  "use strict";

  var FORMAT = "supernova-settings";
  var VERSION = 1;
  var MAX_FILE = 1000000;   // characters
  var MAX_KEYS = 500;
  var MAX_VALUE = 200000;   // characters per value
  var KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/; // every real setting name starts with a letter

  // Stay on this device: browsing history is private and not a setting, and the
  // first-visit flags describe this browser, not the person.
  var DEVICE_ONLY = ["history", "visited-before", "welcome-popup"];

  function deviceOnly(key) {
    return DEVICE_ONLY.indexOf(key) !== -1;
  }

  function fail(message) {
    var error = new Error(message);
    error.backup = true;
    return error;
  }

  /** The backup object for everything in `store` (an SnStore). */
  function create(store, now) {
    var all = store.entries();
    var settings = {};
    Object.keys(all).sort().forEach(function (key) {
      if (!deviceOnly(key)) settings[key] = all[key];
    });
    return { format: FORMAT, version: VERSION, exported: (now || new Date()).toISOString(), settings: settings };
  }

  /**
   * Check a backup file's text. Returns { settings, count, skipped, exported, warnings }
   * or throws an Error whose message can be shown to the user as is.
   */
  function parse(text) {
    if (typeof text !== "string" || text.length > MAX_FILE) {
      throw fail("That file is too large to be a SuperNova backup.");
    }
    var data;
    try { data = JSON.parse(text); } catch (e) {
      throw fail("That file is not a SuperNova backup (it isn't valid JSON).");
    }
    if (!data || typeof data !== "object" || data.format !== FORMAT) {
      throw fail("That file is not a SuperNova settings backup.");
    }
    if (typeof data.version === "number" && data.version > VERSION) {
      throw fail("This backup was made by a newer version of SuperNova OS. Update this site first.");
    }
    if (data.version !== VERSION) {
      throw fail("That backup's version isn't supported.");
    }
    var source = data.settings;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw fail("That backup has no settings in it.");
    }
    var keys = Object.keys(source);
    if (keys.length > MAX_KEYS) {
      throw fail("That backup has too many entries to be genuine.");
    }

    // No prototype: a key such as "__proto__" stays an ordinary (and ignored) entry.
    var settings = Object.create(null);
    var skipped = 0;
    keys.forEach(function (key) {
      var value = source[key];
      if (!KEY.test(key) || deviceOnly(key) || typeof value !== "string" || value.length > MAX_VALUE) {
        skipped++;
        return;
      }
      settings[key] = value;
    });

    var warnings = [];
    var wisp = (settings.wisp || "").trim();
    if (wisp) {
      warnings.push("It sends all proxied traffic through another server (" + wisp + "). Only continue if you trust that server.");
    }

    return {
      settings: settings,
      count: Object.keys(settings).length,
      skipped: skipped,
      exported: typeof data.exported === "string" && !isNaN(Date.parse(data.exported)) ? data.exported : null,
      warnings: warnings,
    };
  }

  /** Replace what `store` holds with `settings` (from parse), keeping device-only keys. */
  function apply(store, settings) {
    var current = store.entries();
    Object.keys(current).forEach(function (key) {
      if (!deviceOnly(key) && !(key in settings)) store.remove(key);
    });
    Object.keys(settings).forEach(function (key) {
      store.set(key, settings[key]);
    });
  }

  global.SnBackup = {
    FORMAT: FORMAT,
    VERSION: VERSION,
    DEVICE_ONLY: DEVICE_ONLY.slice(),
    create: create,
    parse: parse,
    apply: apply,
  };
})(typeof self !== "undefined" ? self : globalThis);
