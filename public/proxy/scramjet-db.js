/*
 * Make sure Scramjet's IndexedDB database has its object stores.
 *
 * Scramjet's service worker opens "$scramjet" (version 1) in its constructor
 * WITHOUT a schema upgrade handler, while the page-side controller creates the
 * stores in its own upgrade handler. If the worker happens to win the race, it
 * creates an empty version-1 database, the controller's upgrade handler never
 * runs, and every later access fails with "One of the specified object stores
 * was not found".
 *
 * Loaded by both the service worker (before it constructs Scramjet) and the page
 * (before it initialises the controller). IndexedDB open requests for the same
 * database are processed in order, so calling this first wins the race.
 */
(function (global) {
  "use strict";

  var DB_NAME = "$scramjet";
  var DB_VERSION = 1;
  var STORES = ["config", "cookies", "redirectTrackers", "referrerPolicies", "publicSuffixList"];

  function open() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        STORES.forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
        });
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function complete(db) {
    return STORES.every(function (name) { return db.objectStoreNames.contains(name); });
  }

  // A database stuck without its stores (created by an earlier race) can only be
  // fixed by deleting it; Scramjet re-creates config and cookies afterwards.
  function recreate() {
    return new Promise(function (resolve) {
      var request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = request.onerror = request.onblocked = function () { resolve(); };
      setTimeout(resolve, 3000);
    }).then(open);
  }

  global.snEnsureScramjetDb = function () {
    return open().then(function (db) {
      if (complete(db)) { db.close(); return; }
      db.close();
      return recreate().then(function (fresh) { fresh.close(); });
    });
  };
})(self);
