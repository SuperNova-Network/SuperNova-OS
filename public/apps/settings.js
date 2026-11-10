/*
 * Settings app.
 *
 * Proxy and cloaking preferences are plain SnStore values: the proxy core, the
 * browser app and the cloak all react to changes (also across windows), so this
 * page needs no wiring to them. Desktop options (colour scheme, wallpaper, window
 * size, clock) go through the SnOS bridge that the desktop exposes to its windows.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const text = (el, value) => { el.textContent = value; return el; };

  /** The desktop's bridge, when this page runs inside a desktop window. */
  const os = (() => {
    try { return window.parent !== window ? window.parent.SnOS ?? null : null; } catch { return null; }
  })();

  function status(el, message, state = "") {
    el.textContent = message;
    if (state) el.dataset.state = state; else delete el.dataset.state;
  }

  // --- navigation -------------------------------------------------------------------

  const tabs = [...document.querySelectorAll(".nav-item")];

  function showPanel(name) {
    if (!document.getElementById(`panel-${name}`)) name = "home";
    for (const tab of tabs) {
      const selected = tab.dataset.panel === name;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      $(`panel-${tab.dataset.panel}`).hidden = !selected;
    }
    if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => showPanel(tab.dataset.panel));
    tab.addEventListener("keydown", (event) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key];
      if (!step) return;
      event.preventDefault();
      const next = tabs[(index + step + tabs.length) % tabs.length];
      next.focus();
      showPanel(next.dataset.panel);
    });
  });
  window.addEventListener("hashchange", () => showPanel(location.hash.slice(1)));
  showPanel(location.hash.slice(1) || "home");

  // Home page tiles jump to their page
  document.querySelectorAll("[data-go]").forEach((tile) => tile.addEventListener("click", () => showPanel(tile.dataset.go)));

  // --- generic bindings -----------------------------------------------------------------

  /** Settings that need a reconnect (or other work) after they change. */
  function changed(key) {
    if (key === "transport" || key === "wisp") SnProxy.reconnect().catch(() => { /* reported by the test button */ });
  }

  document.querySelectorAll("[data-radio]").forEach((group) => {
    const key = group.dataset.radio;
    const inputs = [...group.querySelectorAll("input[type=radio]")];
    const sync = () => inputs.forEach((input) => { input.checked = input.value === SnStore.get(key); });
    sync();
    inputs.forEach((input) => input.addEventListener("change", () => {
      if (!input.checked) return;
      SnStore.set(key, input.value);
      changed(key);
    }));
    SnStore.onChange((changedKey) => { if (changedKey === key || changedKey === "*") sync(); });
  });

  document.querySelectorAll("[data-flag]").forEach((input) => {
    const key = input.dataset.flag;
    const wrap = document.createElement("span");
    wrap.className = "toggle";
    const state = document.createElement("span");
    state.className = "toggle-state";
    input.replaceWith(wrap);
    wrap.append(state, input);
    const sync = () => { input.checked = SnStore.flag(key); state.textContent = input.checked ? "On" : "Off"; };
    sync();
    input.addEventListener("change", () => { SnStore.set(key, input.checked ? "1" : "0"); state.textContent = input.checked ? "On" : "Off"; });
    SnStore.onChange((changedKey) => { if (changedKey === key || changedKey === "*") sync(); });
  });

  // --- proxy: wisp, search ----------------------------------------------------------------

  const wisp = $("wisp");
  wisp.value = SnStore.get("wisp") ?? "";

  function validWisp(value) { return value === "" || /^wss?:\/\/\S+$/i.test(value); }
  const wispTarget = () => wisp.value.trim() || `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${self.__sn$config.wisp}`;

  wisp.addEventListener("change", () => {
    const value = wisp.value.trim();
    if (!validWisp(value)) return status($("wisp-status"), "Enter an address starting with ws:// or wss://, or leave it empty.", "error");
    SnStore.set("wisp", value);
    changed("wisp");
    status($("wisp-status"), value ? "Saved. Using your Wisp server." : "Saved. Using this site's Wisp server.", "ok");
  });

  $("wisp-test").addEventListener("click", () => {
    const value = wisp.value.trim();
    if (!validWisp(value)) return status($("wisp-status"), "That is not a valid ws:// or wss:// address.", "error");
    const started = performance.now();
    status($("wisp-status"), "Connecting…");
    let socket;
    const finish = (message, state) => { clearTimeout(timer); try { socket?.close(); } catch { /* already closed */ } status($("wisp-status"), message, state); };
    const timer = setTimeout(() => finish("No answer after 6 seconds.", "error"), 6000);
    try {
      socket = new WebSocket(wispTarget());
      socket.onopen = () => finish(`Reachable (${Math.round(performance.now() - started)} ms).`, "ok");
      socket.onerror = () => finish("Could not connect to that Wisp server.", "error");
    } catch {
      finish("That address cannot be used.", "error");
    }
  });

  const searchSelect = $("search");
  const customRow = $("search-custom-row");
  const customInput = $("search-custom");
  for (const [id, engine] of Object.entries(SnResolve.SEARCH_ENGINES)) searchSelect.add(new Option(engine.name, id));
  searchSelect.add(new Option("Custom…", "custom"));

  function syncSearch() {
    const value = SnStore.get("search");
    const known = value in SnResolve.SEARCH_ENGINES;
    searchSelect.value = known ? value : "custom";
    customRow.hidden = known;
    if (!known && document.activeElement !== customInput) customInput.value = value;
  }
  searchSelect.addEventListener("change", () => {
    if (searchSelect.value === "custom") { customRow.hidden = false; customInput.focus(); return; }
    SnStore.set("search", searchSelect.value);
    customRow.hidden = true;
  });
  customInput.addEventListener("change", () => {
    const value = customInput.value.trim();
    if (/^https?:\/\/.+%s/i.test(value)) SnStore.set("search", value);
    else customInput.setCustomValidity("The address must start with http:// or https:// and contain %s");
    customInput.reportValidity();
    customInput.setCustomValidity("");
  });
  syncSearch();
  SnStore.onChange((key) => { if (key === "search" || key === "*") syncSearch(); });

  // --- proxy: troubleshooting ----------------------------------------------------------------

  $("proxy-test").addEventListener("click", async () => {
    const out = $("proxy-test-status");
    const button = $("proxy-test");
    button.disabled = true;
    status(out, "Starting the proxy…");
    const started = performance.now();
    try {
      const proxied = await SnProxy.go("https://example.com/");
      const readyAt = performance.now();
      status(out, "Loading a test page through the proxy…");
      const response = await fetch(proxied);
      const body = await response.text();
      if (!response.ok || !/Example Domain/.test(body)) throw new Error(`The test page came back as ${response.status} without the expected content.`);
      const engine = SnProxy.engines[SnProxy.engine()].name;
      const transport = SnProxy.transports[SnStore.get("transport")].name;
      status(out, `Working. Started in ${Math.round(readyAt - started)} ms and loaded a page in ${Math.round(performance.now() - readyAt)} ms using ${engine} and ${transport}.`, "ok");
    } catch (error) {
      status(out, `Not working: ${error.message}`, "error");
    } finally {
      button.disabled = false;
    }
  });

  $("proxy-reset").addEventListener("click", async () => {
    const out = $("proxy-reset-status");
    status(out, "Resetting…");
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
      await Promise.all((await caches.keys()).map((key) => caches.delete(key)));
      await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase("$scramjet");
        request.onsuccess = request.onerror = request.onblocked = () => resolve();
        setTimeout(resolve, 2500);
      });
      status(out, "Done. Reloading…", "ok");
      setTimeout(() => (window.top ?? window).location.reload(), 700);
    } catch (error) {
      status(out, `Could not reset: ${error.message}`, "error");
    }
  });

  // --- cloaking: disguise -------------------------------------------------------------------------

  const presetsEl = $("presets");
  const presetButtons = new Map();

  function addPreset(id, name, icon) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset";
    button.setAttribute("role", "radio");
    if (icon) {
      const img = new Image();
      img.alt = "";
      img.src = icon;
      img.loading = "lazy";
      button.append(img);
    } else {
      button.append(text(Object.assign(document.createElement("span"), { className: "preset-plain" }), "✎"));
    }
    button.append(text(document.createElement("span"), name));
    button.addEventListener("click", () => SnStore.set("cloak", id));
    presetsEl.append(button);
    presetButtons.set(id, button);
  }
  SnCloak.presets.forEach((preset) => addPreset(preset.id, preset.name, preset.icon));
  addPreset("custom", "Custom…", "");

  const titleInput = $("cloak-title");
  const iconInput = $("cloak-icon");

  function syncCloak() {
    const selected = SnStore.get("cloak");
    presetButtons.forEach((button, id) => button.setAttribute("aria-checked", String(id === selected)));
    $("custom-cloak").hidden = selected !== "custom";
    if (document.activeElement !== titleInput) titleInput.value = SnStore.get("cloakTitle") ?? "";
    if (document.activeElement !== iconInput) iconInput.value = SnStore.get("cloakIcon") ?? "";
    const look = SnCloak.current();
    text($("preview-title"), look.title);
    const icon = $("preview-icon");
    icon.hidden = !look.icon;
    if (look.icon) icon.src = look.icon; else icon.removeAttribute("src");
  }
  titleInput.addEventListener("input", () => SnStore.set("cloakTitle", titleInput.value));
  iconInput.addEventListener("input", () => SnStore.set("cloakIcon", iconInput.value.trim()));
  syncCloak();
  SnStore.onChange((key) => { if (/^cloak/.test(key) || key === "*") syncCloak(); });

  // --- cloaking: launcher -----------------------------------------------------------------------------

  function launch(kind) {
    const opened = kind === "blob" ? SnCloak.launchBlob() : SnCloak.launchAboutBlank();
    if (!opened) status($("launch-status"), "The browser blocked the new tab. Allow pop-ups for this site and try again.", "error");
  }
  $("launch-blank").addEventListener("click", () => launch("blank"));
  $("launch-blob").addEventListener("click", () => launch("blob"));

  // --- cloaking: panic key -----------------------------------------------------------------------------

  const panicButton = $("panic-record");
  const panicLabel = $("panic-label");
  const panicHint = $("panic-hint");
  const DEFAULT_HINT = "Click the button, then press the keys you want.";
  let recording = null; // { previous } while capturing

  // A plain typing key (a letter, digit or punctuation) would fire the panic key while
  // someone is just typing, so it needs Ctrl, Alt or Cmd as well.
  const TYPING_KEY = /(^|\+)(Key[A-Z]|Digit\d|Space|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash)$/;
  const needsModifier = (combo) => TYPING_KEY.test(combo) && !/(^|\+)(Ctrl|Alt|Meta)(\+|$)/.test(combo);

  function syncPanic() {
    text(panicLabel, recording ? "Press keys…" : SnCloak.formatCombo(SnStore.get("panicKey")));
    panicButton.dataset.recording = String(Boolean(recording));
  }

  function stopRecording(save) {
    if (!recording) return;
    document.removeEventListener("keydown", onRecordKey, true);
    // Restore (or replace) the key that was cleared so the old shortcut could not fire while recording.
    SnStore.set("panicKey", save ?? recording.previous);
    recording = null;
    syncPanic();
  }

  function onRecordKey(event) {
    event.preventDefault();
    event.stopPropagation();
    if (event.code === "Escape" && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
      text(panicHint, DEFAULT_HINT);
      return stopRecording();
    }
    const combo = SnCloak.comboFromEvent(event);
    if (!combo) return; // only a modifier so far
    if (needsModifier(combo)) {
      text(panicHint, "Add Ctrl, Alt or Cmd, otherwise typing that key would trigger it. Press Esc to cancel.");
      return;
    }
    text(panicHint, `Saved ${SnCloak.formatCombo(combo)}.`);
    stopRecording(combo);
  }

  panicButton.addEventListener("click", () => {
    if (recording) return stopRecording();
    recording = { previous: SnStore.get("panicKey") };
    SnStore.set("panicKey", ""); // the existing shortcut must not fire while we record a new one
    text(panicHint, "Press the key combination now. Esc cancels.");
    document.addEventListener("keydown", onRecordKey, true);
    syncPanic();
  });
  panicButton.addEventListener("blur", () => { if (recording) { text(panicHint, DEFAULT_HINT); stopRecording(); } });
  $("panic-clear").addEventListener("click", () => { if (recording) stopRecording(); SnStore.set("panicKey", ""); text(panicHint, DEFAULT_HINT); });
  syncPanic();
  SnStore.onChange((key) => { if ((key === "panicKey" || key === "*") && !recording) syncPanic(); });

  const DESTINATIONS = [
    ["Google Classroom", "https://classroom.google.com"],
    ["Google Docs", "https://docs.google.com"],
    ["Google Drive", "https://drive.google.com"],
    ["Canvas", "https://canvas.instructure.com"],
    ["Schoology", "https://app.schoology.com"],
    ["Clever", "https://clever.com"],
    ["Khan Academy", "https://www.khanacademy.org"],
    ["Wikipedia", "https://en.wikipedia.org"],
  ];
  const destSelect = $("panic-preset");
  const destCustom = $("panic-custom");
  DESTINATIONS.forEach(([name, url]) => destSelect.add(new Option(name, url)));
  destSelect.add(new Option("Custom…", "custom"));

  function syncDestination() {
    const url = SnStore.get("panicUrl");
    const preset = DESTINATIONS.find(([, value]) => value === url);
    destSelect.value = preset ? url : "custom";
    $("panic-custom-row").hidden = Boolean(preset);
    if (!preset && document.activeElement !== destCustom) destCustom.value = url;
  }
  destSelect.addEventListener("change", () => {
    if (destSelect.value === "custom") { $("panic-custom-row").hidden = false; destCustom.focus(); return; }
    SnStore.set("panicUrl", destSelect.value);
  });
  destCustom.addEventListener("change", () => SnStore.set("panicUrl", SnCloak.safeNavigationUrl(destCustom.value)));
  syncDestination();
  SnStore.onChange((key) => { if (key === "panicUrl" || key === "*") syncDestination(); });

  $("panic-test").addEventListener("click", () => SnCloak.panic());

  // --- appearance and system (desktop bridge) ---------------------------------------------------------------

  if (!os) {
    $("no-os").hidden = false;
    document.querySelectorAll("[data-needs-os]").forEach((group) => { group.dataset.disabled = ""; });
  } else {
    // Colour scheme
    const schemes = $("schemes");
    const schemeButtons = os.schemes.map((scheme, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
        button.setAttribute("role", "radio");
      button.setAttribute("aria-label", `Colour scheme ${index + 1}`);
      for (const color of scheme) button.append(Object.assign(document.createElement("i"), { style: `background:${color}` }));
      button.addEventListener("click", () => { os.setScheme(index); syncDesktop(); });
      schemes.append(button);
      return button;
    });

    // Wallpapers (index 0 is the plain gradient)
    const WALLPAPERS_SHOWN = 10;
    const wallpapers = $("wallpapers");
    const wallpaperButtons = ["", ...os.wallpapers].map((file, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "wallpaper";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", file ? file.replace(/\.[^.]+$/, "") : "Gradient");
      if (file) button.style.backgroundImage = `url(/resources/media/wallpapers/icons/${file.replace(".", "Ico.")})`;
      else button.style.background = "linear-gradient(135deg, var(--accent), #0b0b14)";
      button.addEventListener("click", () => { os.setWallpaper(index); $("wallpaper-url").value = ""; syncDesktop(); });
      if (index >= WALLPAPERS_SHOWN) button.hidden = true;
      wallpapers.append(button);
      return button;
    });

    // Only the first few are listed; "Show more" reveals the rest
    const showMore = $("wallpapers-more");
    const setWallpapersExpanded = (open) => {
      wallpaperButtons.forEach((button, index) => { if (index >= WALLPAPERS_SHOWN) button.hidden = !open; });
      showMore.textContent = open ? "Show less" : "Show more";
      showMore.setAttribute("aria-expanded", String(open));
    };
    showMore.hidden = wallpaperButtons.length <= WALLPAPERS_SHOWN;
    showMore.addEventListener("click", () => setWallpapersExpanded(showMore.getAttribute("aria-expanded") !== "true"));

    $("wallpaper-apply").addEventListener("click", () => {
      const url = $("wallpaper-url").value.trim();
      if (url && !/^https?:\/\//i.test(url) && url[0] !== "/") return $("wallpaper-url").focus();
      os.setCustomBackground(url);
      syncDesktop();
    });

    // Window size
    for (const id of ["win-w", "win-h"]) {
      $(id).addEventListener("input", () => {
        text($(`${id}-out`), $(id).value);
        os.setWindowSize($("win-w").value, $("win-h").value);
      });
    }

    // Time zone
    const zone = $("timezone");
    zone.add(new Option("Local time", "local"));
    for (let hours = -12; hours <= 14; hours++) zone.add(new Option(hours === 0 ? "UTC" : `UTC${hours > 0 ? "+" : ""}${hours}`, String(hours)));
    zone.addEventListener("change", () => os.setTimezone(zone.value));

    $("reset-names").addEventListener("click", () => os.resetNames());
    $("factory-reset").addEventListener("click", () => os.factoryReset());

    function syncDesktop() {
      const state = os.state();
      schemeButtons.forEach((button, index) => button.setAttribute("aria-checked", String(index === state.scheme)));
      wallpaperButtons.forEach((button, index) => button.setAttribute("aria-checked", String(index === state.wallpaper && !state.customBackground)));
      // Never hide the wallpaper that is in use
      if (state.wallpaper >= WALLPAPERS_SHOWN && !state.customBackground && showMore.getAttribute("aria-expanded") !== "true") setWallpapersExpanded(true);
      if (document.activeElement !== $("wallpaper-url")) $("wallpaper-url").value = state.customBackground;
      $("win-w").value = state.windowWidth;
      $("win-h").value = state.windowHeight;
      text($("win-w-out"), state.windowWidth);
      text($("win-h-out"), state.windowHeight);
      zone.value = state.timezone;
    }
    syncDesktop();
  }

  // --- account ------------------------------------------------------------------------------------

  {
    const views = { loading: $("account-loading"), off: $("account-off"), out: $("account-out"), code: $("account-code"), in: $("account-in") };
    const forms = { login: $("form-login"), register: $("form-register"), recover: $("form-recover") };
    let afterCode = null; // what "I've saved it" does next

    const show = (name) => Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
    const formStatus = (form, message, state) => status(form.querySelector(".status"), message, state);

    function showForm(mode) {
      Object.entries(forms).forEach(([key, form]) => { form.hidden = key !== mode; formStatus(form, ""); });
      forms[mode].elements.username.value ||= Object.values(forms).map((form) => form.elements.username.value).find(Boolean) ?? "";
      forms[mode].elements[forms[mode].elements.username.value ? (mode === "recover" ? "code" : "password") : "username"].focus();
    }
    document.querySelectorAll("[data-show]").forEach((button) => button.addEventListener("click", () => showForm(button.dataset.show)));

    function signedInView(user) {
      text($("account-name"), user.username);
      text($("account-avatar"), user.username.charAt(0).toUpperCase());
      text($("account-tile"), `Signed in as ${user.username}`);
      status($("account-status"), "");
      show("in");
    }

    function signedOutView(state) {
      text($("account-tile"), state.enabled ? "Sign in to keep your settings everywhere" : "Not available on this site");
      if (!state.enabled) return show("off");
      forms.login.querySelector("[data-show='register']").hidden = !state.signup;
      show("out");
      showForm("login");
    }

    /** Make the desktop (or this page) show settings that just changed. */
    function reloadEverything() {
      setTimeout(() => (os?.restart ? os.restart() : location.reload()), 600);
    }

    async function refresh() {
      try {
        const state = await SnAccount.status(true);
        if (state.user) signedInView(state.user); else signedOutView(state);
      } catch {
        text($("account-loading").querySelector(".hint"), "Couldn't reach the server. Try again later.");
      }
    }

    /** Run an account action from a form: busy state, errors shown under the form. */
    function submitting(form, action) {
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = form.querySelector("button[type='submit']");
        button.disabled = true;
        formStatus(form, "");
        try {
          await action(form.elements);
        } catch (err) {
          formStatus(form, err.message, "error");
        } finally {
          button.disabled = false;
        }
      });
    }

    function afterSignIn(result, message) {
      if (result.recoveryCode) {
        text($("recovery-code"), result.recoveryCode);
        show("code");
        $("recovery-copy").focus();
        afterCode = () => finish();
      } else {
        finish();
      }
      function finish() {
        Object.values(forms).forEach((form) => form.reset());
        signedInView(result.user);
        if (result.changed) {
          status($("account-status"), "Loading your settings…", "ok");
          reloadEverything();
        } else {
          status($("account-status"), message, "ok");
        }
      }
    }

    submitting(forms.login, async (f) => {
      afterSignIn(await SnAccount.login(f.username.value, f.password.value), "Signed in. This browser's settings are now saved to your account.");
    });

    submitting(forms.register, async (f) => {
      if (f.password.value !== f.confirm.value) throw new Error("The passwords don't match.");
      afterSignIn(await SnAccount.register(f.username.value, f.password.value), "Account created. This browser's settings are saved to it.");
    });

    submitting(forms.recover, async (f) => {
      afterSignIn(await SnAccount.recover(f.username.value, f.code.value, f.password.value), "Password changed. You're signed in.");
    });

    $("recovery-copy").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("recovery-code").textContent);
        text($("recovery-copy"), "Copied");
      } catch {
        getSelection().selectAllChildren($("recovery-code"));
      }
    });
    $("recovery-done").addEventListener("click", () => { text($("recovery-copy"), "Copy"); afterCode?.(); afterCode = null; });

    $("account-logout").addEventListener("click", async () => {
      $("account-logout").disabled = true;
      await SnAccount.logout();
      status($("account-status"), "Signed out. Restarting…", "ok");
      reloadEverything();
    });

    submitting($("form-password"), async (f) => {
      await SnAccount.changePassword(f.current.value, f.password.value);
      $("form-password").reset();
      formStatus($("form-password"), "Password changed. Other browsers have been signed out.", "ok");
    });

    submitting($("form-delete"), async (f) => {
      await SnAccount.deleteAccount(f.password.value);
      $("form-delete").reset();
      await refresh();
      status(forms.login.querySelector(".status"), "Your account has been deleted.", "ok");
    });

    refresh();
  }

  // --- backup (export / import) -----------------------------------------------------------------

  {
    const backupStatus = $("backup-status");
    const confirmBox = $("import-confirm");
    let pending = null;

    const hideConfirm = () => { confirmBox.hidden = true; pending = null; };

    $("export-settings").addEventListener("click", () => {
      hideConfirm();
      const backup = SnBackup.create(SnStore);
      const blob = new Blob([`${JSON.stringify(backup, null, 2)}\n`], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      const now = new Date(); // name the file by the local date, not the UTC one in "exported"
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      link.download = `supernova-settings-${day}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      const count = Object.keys(backup.settings).length;
      status(backupStatus, `Saved ${count} setting${count === 1 ? "" : "s"} to ${link.download}.`, "ok");
    });

    $("import-settings").addEventListener("click", () => $("import-file").click());

    $("import-file").addEventListener("change", async () => {
      const file = $("import-file").files[0];
      $("import-file").value = ""; // choosing the same file again still fires "change"
      if (!file) return;
      hideConfirm();
      try {
        if (file.size > 1_000_000) throw new Error("That file is too large to be a SuperNova backup.");
        pending = SnBackup.parse(await file.text());
      } catch (err) {
        status(backupStatus, err.message, "error");
        return;
      }
      const when = pending.exported ? ` from ${new Date(pending.exported).toLocaleDateString()}` : "";
      text($("import-summary"), `Replace your current settings with the ${pending.count} in this backup${when}?` +
        (pending.skipped ? ` ${pending.skipped} unreadable entr${pending.skipped === 1 ? "y" : "ies"} will be skipped.` : ""));
      $("import-warnings").replaceChildren(...pending.warnings.map((warning) => text(document.createElement("li"), warning)));
      status(backupStatus, "");
      confirmBox.hidden = false;
      $("import-apply").focus();
    });

    $("import-cancel").addEventListener("click", () => { hideConfirm(); status(backupStatus, "Import cancelled."); });

    $("import-apply").addEventListener("click", () => {
      if (!pending) return;
      SnBackup.apply(SnStore, pending.settings);
      hideConfirm();
      status(backupStatus, "Settings restored. Restarting…", "ok");
      // Restart so every part of the desktop reads the new settings.
      setTimeout(() => (os?.restart ? os.restart() : location.reload()), 800);
    });
  }

  // --- find a setting -------------------------------------------------------------------------------

  const findInput = $("find");
  const findResults = $("find-results");
  let findIndex = [];

  function buildIndex() {
    findIndex = [];
    document.querySelectorAll(".panel").forEach((panel) => {
      const panelName = panel.id.replace("panel-", "");
      if (panelName === "home") return;
      const pageTitle = panel.querySelector(".panel-head h2")?.textContent ?? panelName;
      panel.querySelectorAll(".group > h3, .row, .choice-body").forEach((el) => {
        const label = (el.matches("h3") ? el.textContent : el.querySelector("strong")?.textContent) ?? "";
        const detail = el.querySelector?.("small")?.textContent ?? "";
        if (label.trim()) findIndex.push({ el, panel: panelName, page: pageTitle, label: label.trim(), text: `${label} ${detail}`.toLowerCase() });
      });
    });
  }

  function renderFind() {
    const query = findInput.value.trim().toLowerCase();
    findResults.replaceChildren();
    if (!query) { findResults.hidden = true; return; }
    if (!findIndex.length) buildIndex();
    const hits = findIndex.filter((item) => item.text.includes(query)).slice(0, 7);
    if (!hits.length) {
      const none = document.createElement("li");
      none.className = "find-empty";
      none.textContent = `No results for “${findInput.value.trim()}”`;
      findResults.append(none);
    }
    hits.forEach((hit, index) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(index === 0));
      li.append(text(document.createElement("span"), hit.label), text(document.createElement("small"), hit.page));
      li.addEventListener("mousedown", (event) => event.preventDefault());
      li.addEventListener("click", () => go(hit));
      findResults.append(li);
    });
    findResults.hidden = false;
  }

  function go(hit) {
    findInput.value = "";
    findResults.hidden = true;
    showPanel(hit.panel);
    const target = hit.el.closest(".row, .group") ?? hit.el;
    requestAnimationFrame(() => {
      target.scrollIntoView({ block: "center", behavior: "smooth" });
      target.classList.remove("flash");
      void target.offsetWidth;
      target.classList.add("flash");
    });
  }

  findInput.addEventListener("input", renderFind);
  findInput.addEventListener("blur", () => setTimeout(() => { findResults.hidden = true; }, 120));
  findInput.addEventListener("keydown", (event) => {
    const items = [...findResults.querySelectorAll("li[role=option]")];
    const current = items.findIndex((li) => li.getAttribute("aria-selected") === "true");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items.forEach((li, i) => li.setAttribute("aria-selected", String(i === next)));
    } else if (event.key === "Enter" && items[Math.max(current, 0)]) {
      items[Math.max(current, 0)].click();
    } else if (event.key === "Escape") {
      findInput.value = "";
      findResults.hidden = true;
    }
  });

  // --- Reveal highlight: borders and surfaces glow near the pointer ------------------------------------------

  const REVEAL = ".nav-item, .home-tile, .btn, .choice-body, .preset, .swatch, .wallpaper";
  const REACH = 150; // px beyond an element's edge where its light still shows
  document.querySelectorAll(REVEAL).forEach((el) => el.classList.add("reveal"));

  let pointer = null;
  let frame = 0;
  function paintReveal() {
    frame = 0;
    for (const el of document.querySelectorAll(".reveal")) {
      if (!pointer) { el.style.setProperty("--ro", "0"); continue; }
      const rect = el.getBoundingClientRect();
      const dx = Math.max(rect.left - pointer.x, 0, pointer.x - rect.right);
      const dy = Math.max(rect.top - pointer.y, 0, pointer.y - rect.bottom);
      const strength = Math.max(0, 1 - Math.hypot(dx, dy) / REACH);
      el.style.setProperty("--ro", strength.toFixed(2));
      if (strength > 0) {
        el.style.setProperty("--rx", `${pointer.x - rect.left}px`);
        el.style.setProperty("--ry", `${pointer.y - rect.top}px`);
      }
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(paintReveal); };
  document.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY }; schedule(); }, { passive: true });
  document.addEventListener("pointerleave", () => { pointer = null; schedule(); });
  // Rows created after load (presets, swatches, wallpapers) join in too
  new MutationObserver(() => document.querySelectorAll(REVEAL).forEach((el) => el.classList.add("reveal")))
    .observe(document.body, { childList: true, subtree: true });

  // --- about ----------------------------------------------------------------------------------------------------

  fetch("/api/info")
    .then((response) => response.json())
    .then((info) => {
      text($("about-name"), info.name);
      if (info.source) $("about-source").href = info.source; else $("about-license").hidden = true;
      text($("about-version"), `Version ${info.version ?? "unknown"} · Node ${info.node}${info.filter ? " · Content filter on" : ""}`);
      const list = $("about-components");
      for (const [name, version] of Object.entries(info.components)) {
        list.append(text(document.createElement("dt"), name), text(document.createElement("dd"), version ?? "not installed"));
      }
    })
    .catch(() => text($("about-version"), "Version information is unavailable."));
})();
