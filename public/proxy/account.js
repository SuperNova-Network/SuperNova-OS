/*
 * Accounts on the client: signing in and out, and keeping SnStore in step with the
 * signed-in account (see src/accounts.js for the server).
 *
 * Which settings sync: everything a backup holds (SnBackup.DEVICE_ONLY stays put,
 * so browsing history never leaves the browser).
 *
 * How: the sync engine runs in top-level pages only (the desktop, or Settings or
 * the browser opened on their own); windows inside the desktop write to the shared
 * localStorage, and the desktop hears those writes through the storage event.
 *   - A change is remembered as pending (in localStorage, so it survives a reload)
 *     and sent a moment later as { set, remove }. The server merges key by key, so
 *     two browsers changing different settings never undo each other.
 *   - On load, pending changes go up first, then the account's settings come down
 *     and replace this browser's. If that changed anything, the page reloads once so
 *     every part of the desktop shows it (it is still behind the load screen then),
 *     provided the browser really kept the new values: where storage is blocked a
 *     reload would only start over, so the values stay in memory instead.
 *
 * Needs store.js and backup.js. Plain script; attaches `SnAccount` to window.
 */
(function () {
  "use strict";

  var API = "/api/account";
  var PENDING = "sn-sync:pending";   // not under "sn.": not a setting, never synced or exported
  var RELOADS = "sn-sync:reloads";   // sessionStorage: recent automatic reloads (a last-resort loop guard)
  var PUSH_DELAY = 1500;

  var store = window.SnStore;
  var deviceOnly = (window.SnBackup && SnBackup.DEVICE_ONLY) || ["history", "visited-before", "welcome-popup"];

  function syncable(key) {
    return typeof key === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(key) && deviceOnly.indexOf(key) === -1;
  }

  // --- talking to the server ------------------------------------------------------

  function call(method, path, body) {
    return fetch(API + path, {
      method: method,
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) {
          var error = new Error(data.error || "The server could not be reached.");
          error.status = res.status;
          throw error;
        }
        return data;
      });
    }, function () {
      var error = new Error("The server could not be reached. Check your connection.");
      error.status = 0;
      throw error;
    });
  }

  // --- local state ----------------------------------------------------------------

  function localSettings() {
    var all = store.entries(), out = {};
    Object.keys(all).forEach(function (key) { if (syncable(key)) out[key] = all[key]; });
    return out;
  }

  function readPending() {
    try { return JSON.parse(localStorage.getItem(PENDING) || "[]").filter(syncable); } catch (e) { return []; }
  }

  function writePending(keys) {
    try {
      if (keys.length) localStorage.setItem(PENDING, JSON.stringify(keys));
      else localStorage.removeItem(PENDING);
    } catch (e) { /* storage blocked: pending changes live only as long as the page */ }
  }

  // Applying the account's values must not be mistaken for the user changing them.
  var applying = false;

  /** Make this browser's synced settings equal `settings`, except keys in `keep`. Returns whether anything changed. */
  function replaceLocal(settings, keep) {
    keep = keep || [];
    var local = localSettings(), changed = false;
    applying = true;
    try {
      Object.keys(local).forEach(function (key) {
        if (keep.indexOf(key) === -1 && !Object.prototype.hasOwnProperty.call(settings, key)) { store.remove(key); changed = true; }
      });
      Object.keys(settings).forEach(function (key) {
        if (syncable(key) && keep.indexOf(key) === -1 && local[key] !== settings[key]) { store.set(key, settings[key]); changed = true; }
      });
    } finally {
      applying = false;
    }
    return changed;
  }

  // --- the sync engine --------------------------------------------------------------

  var active = false, timer = null, pushing = null, unsubscribe = null, user = null;

  function onChange(key) {
    if (!active || applying || key === "*" || !syncable(key)) return;
    var pending = readPending();
    if (pending.indexOf(key) === -1) { pending.push(key); writePending(pending); }
    schedulePush();
  }

  function schedulePush() {
    clearTimeout(timer);
    timer = setTimeout(push, PUSH_DELAY);
  }

  /** Send pending changes. Resolves when done (or when there was nothing to send). */
  function push() {
    clearTimeout(timer);
    if (pushing) return pushing.then(function () { return readPending().length ? push() : undefined; });
    var keys = readPending();
    if (!active || !keys.length) return Promise.resolve();
    var local = localSettings(), set = {}, remove = [];
    keys.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(local, key)) set[key] = local[key]; else remove.push(key);
    });
    pushing = call("PATCH", "/settings", { set: set, remove: remove }).then(function () {
      // Keep keys that changed again while this request was on its way.
      var now = localSettings();
      writePending(readPending().filter(function (key) {
        return keys.indexOf(key) === -1 || (Object.prototype.hasOwnProperty.call(set, key) ? now[key] !== set[key] : Object.prototype.hasOwnProperty.call(now, key));
      }));
    }, function (err) {
      if (err.status === 401) {
        // Signed out elsewhere (or the session expired): stop, and drop changes that
        // belonged to that account.
        stop();
        writePending([]);
      } else {
        console.warn("SuperNova: settings not synced yet:", err.message);
        timer = setTimeout(push, 30000);
      }
    }).then(function () { pushing = null; });
    return pushing;
  }

  /** Bring this browser in line with the account. Resolves to whether anything changed. */
  function pull() {
    return call("GET", "/settings").then(function (data) {
      return replaceLocal(data.settings || {}, readPending());
    });
  }

  function listen() {
    if (!unsubscribe) unsubscribe = store.onChange(onChange);
  }

  function stop() {
    active = false;
    clearTimeout(timer);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  }

  /** Start syncing if signed in. Called on load by top-level pages, and (refresh) after signing in. */
  function start(refresh) {
    return status(refresh).then(function (state) {
      if (!state.user) return { user: null, changed: false };
      active = true;
      listen();
      return push().then(pull).then(function (changed) {
        return { user: state.user, changed: changed };
      });
    });
  }

  var statusRequest = null;
  function status(refresh) {
    if (!statusRequest || refresh) {
      statusRequest = call("GET", "/").then(function (state) {
        user = state.user || null;
        return state;
      }, function (err) {
        statusRequest = null;
        throw err;
      });
    }
    return statusRequest;
  }

  // --- signing in and out ---------------------------------------------------------

  /**
   * After signing in or up: an account with no settings yet takes this browser's;
   * otherwise the account's replace this browser's. Resolves to whether this browser
   * changed (and so needs a reload to show it).
   */
  function adopt() {
    writePending([]);
    return call("GET", "/settings").then(function (data) {
      var remote = data.settings || {};
      if (!Object.keys(remote).length) {
        return call("PATCH", "/settings", { set: localSettings(), remove: [] }).then(function () { return false; });
      }
      return replaceLocal(remote);
    });
  }

  /** The engine of the top-level page this one lives in (the desktop, for its windows). */
  function topEngine() {
    try { return window.top !== window && window.top.SnAccount ? window.top.SnAccount : null; } catch (e) { return null; }
  }

  function signedIn(result) {
    return status(true).then(function () {
      return adopt();
    }).then(function (changed) {
      // Sync from the top-level page: the desktop around this window, or this page.
      var top = topEngine();
      (top || window.SnAccount).start(true);
      return { user: user, changed: changed, recoveryCode: result.recoveryCode || null };
    });
  }

  function register(username, password, inviteCode) {
    return call("POST", "/register", { username: username, password: password, inviteCode: inviteCode || "" }).then(signedIn);
  }

  function login(username, password) {
    return call("POST", "/login", { username: username, password: password }).then(signedIn);
  }

  /** First run: create the first admin with the code from the server's log. */
  function setup(code, username, password) {
    return call("POST", "/setup", { code: code, username: username, password: password }).then(signedIn);
  }

  function recover(username, recoveryCode, newPassword) {
    return call("POST", "/recover", { username: username, recoveryCode: recoveryCode, newPassword: newPassword }).then(signedIn);
  }

  /**
   * Sign out and remove the account's settings from this browser (it may be a shared
   * computer). The engines stop first so the clean-up is not synced as deletions.
   */
  function logout(options) {
    var top = topEngine();
    if (top) top.stop();
    stop();
    return call("POST", "/logout", {}).catch(function () { /* signed out locally either way */ }).then(function () {
      user = null;
      statusRequest = null;
      writePending([]);
      if (!options || options.keepSettings !== true) replaceLocal({});
    });
  }

  function changePassword(currentPassword, newPassword) {
    return call("POST", "/password", { currentPassword: currentPassword, newPassword: newPassword });
  }

  function deleteAccount(password) {
    var top = topEngine();
    return call("POST", "/delete", { password: password }).then(function () {
      if (top) top.stop();
      stop();
      user = null;
      statusRequest = null;
      writePending([]);
      // The settings stay in this browser: deleting the account is not a reset.
    });
  }

  /** Set the profile picture from base64 image data. Resolves to the new version (0 = none). */
  function setAvatar(mime, base64) {
    return call("POST", "/avatar", { mime: mime, data: base64 }).then(function (result) {
      if (user) user.avatar = result.avatar;
      return result.avatar;
    });
  }

  var AVATAR_SIZE = 256;           // pixels: pictures are small, so they load quickly everywhere
  var AVATAR_MAX_BYTES = 100 * 1024; // the server allows 120 KB

  function readAsBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error("That file could not be read.")); };
      reader.onload = function () { resolve(String(reader.result).split(",")[1] || ""); };
      reader.readAsDataURL(blob);
    });
  }

  /** The first of these (type, quality) encodings of the canvas that is small enough, or null. */
  function encodeSmall(canvas, attempts) {
    if (!attempts.length) return Promise.resolve(null);
    return new Promise(function (resolve) { canvas.toBlob(resolve, attempts[0][0], attempts[0][1]); }).then(function (blob) {
      return blob && blob.type === attempts[0][0] && blob.size <= AVATAR_MAX_BYTES ? blob : encodeSmall(canvas, attempts.slice(1));
    });
  }

  /**
   * Crop a picture file to a square, shrink it and re-encode it (WebP, or JPEG where
   * that is not available), so what is uploaded is small and clean. Resolves to a Blob.
   */
  function prepareAvatar(file) {
    return createImageBitmap(file).then(function (bitmap) {
      var canvas = document.createElement("canvas");
      canvas.width = canvas.height = AVATAR_SIZE;
      var context = canvas.getContext("2d");
      var scale = Math.max(AVATAR_SIZE / bitmap.width, AVATAR_SIZE / bitmap.height);
      var w = bitmap.width * scale, h = bitmap.height * scale;
      function draw(background) {
        context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
        if (background) { context.fillStyle = background; context.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE); }
        context.drawImage(bitmap, (AVATAR_SIZE - w) / 2, (AVATAR_SIZE - h) / 2, w, h);
      }
      draw(null);
      return encodeSmall(canvas, [["image/webp", 0.9], ["image/webp", 0.75], ["image/webp", 0.6]]).then(function (blob) {
        if (blob) return blob;
        draw("#2b2b2b"); // JPEG has no transparency
        return encodeSmall(canvas, [["image/jpeg", 0.85], ["image/jpeg", 0.7], ["image/jpeg", 0.55]]);
      });
    }, function () {
      throw new Error("That file isn't a picture this browser can read. Try a PNG or JPEG.");
    }).then(function (blob) {
      if (!blob) throw new Error("That picture is too detailed to save. Try a simpler one.");
      return blob;
    });
  }

  /** Choose a picture file as your profile picture: prepared in the browser, then saved. Resolves to the new version. */
  function uploadAvatar(file) {
    return prepareAvatar(file).then(function (blob) {
      return readAsBase64(blob).then(function (data) { return setAvatar(blob.type, data); });
    });
  }

  function removeAvatar() {
    return call("POST", "/avatar/remove", {}).then(function (result) {
      if (user) user.avatar = 0;
      return 0;
    });
  }

  /** The address of someone's picture (version: the number from their account), or "" for none. */
  function avatarUrl(username, version) {
    return version ? API + "/avatar/" + encodeURIComponent(username) + "?v=" + encodeURIComponent(version) : "";
  }

  // Admin requests (usernames in ADMINS): invite codes and bans.
  var path = encodeURIComponent;
  var admin = {
    users: function (search) { return call("GET", "/admin/users?q=" + path(search || "")).then(function (data) { return data.users; }); },
    ban: function (username, reason) { return call("POST", "/admin/users/" + path(username) + "/ban", { reason: reason || "" }); },
    unban: function (username) { return call("POST", "/admin/users/" + path(username) + "/unban", {}); },
    invites: function () { return call("GET", "/admin/invites").then(function (data) { return data.invites; }); },
    createInvite: function (options) { return call("POST", "/admin/invites", options); },
    revokeInvite: function (id) { return call("POST", "/admin/invites/" + path(id) + "/revoke", {}); },
    site: function () { return call("GET", "/admin/site"); },
    setSite: function (changes) { return call("POST", "/admin/site", changes); },
    makeAdmin: function (username) { return call("POST", "/admin/users/" + path(username) + "/admin", {}); },
    removeAdmin: function (username) { return call("POST", "/admin/users/" + path(username) + "/unadmin", {}); },
  };

  window.SnAccount = {
    admin: admin,
    status: status,
    start: start,
    stop: stop,
    push: push,
    pull: pull,
    register: register,
    login: login,
    recover: recover,
    setup: setup,
    logout: logout,
    changePassword: changePassword,
    deleteAccount: deleteAccount,
    setAvatar: setAvatar,
    uploadAvatar: uploadAvatar,
    removeAvatar: removeAvatar,
    avatarUrl: avatarUrl,
    get user() { return user; },
    get syncing() { return active; },
  };

  // --- start-up ---------------------------------------------------------------------

  /** Whether localStorage now holds exactly the synced settings (so a reload will show them). */
  function kept(settings) {
    try {
      return Object.keys(settings).every(function (key) {
        return !syncable(key) || localStorage.getItem("sn." + key) === settings[key];
      });
    } catch (e) {
      return false;
    }
  }

  /** Reload, unless that already happened twice in the last 20 seconds (it never should). */
  function reloadOnce() {
    var now = Date.now(), recent = [];
    try { recent = JSON.parse(sessionStorage.getItem(RELOADS) || "[]").filter(function (t) { return now - t < 20000; }); } catch (e) { /* ignore */ }
    if (recent.length >= 2) {
      console.warn("SuperNova: not reloading again to show synced settings; they apply after the next reload.");
      return;
    }
    try { sessionStorage.setItem(RELOADS, JSON.stringify(recent.concat(now))); } catch (e) { /* ignore */ }
    location.reload();
  }

  if (window.top === window) {
    start().then(function (result) {
      // The account had something this page didn't read at load: reload so every part
      // of the page shows it. Only if the browser kept the values, or it would loop.
      if (result.changed && kept(localSettings())) reloadOnce();
    }).catch(function () { /* offline or accounts unavailable: this browser's settings still work */ });
  }
})();
