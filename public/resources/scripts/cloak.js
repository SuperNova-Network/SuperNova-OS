/*
 * Tab cloaking.
 *
 *  - Tab disguise: a preset (or custom) title and icon, applied on every load.
 *  - Panic key: a key combination that immediately sends the tab somewhere else.
 *    It also works while focus is inside windows and proxied pages, which are
 *    same-origin frames of the desktop.
 *  - about:blank / blob launcher: runs the desktop inside a disguised tab and
 *    sends the original tab away.
 *  - Leave-page prompt: asks for confirmation before the tab is closed.
 *
 * Settings live in SnStore (sn.cloak, sn.cloakTitle, sn.cloakIcon, sn.panicKey,
 * sn.panicUrl, sn.autoblank, sn.anticlose) and changes apply live, including from
 * the Settings window. Plain script; attaches `SnCloak` to the global object.
 */
(function (global) {
  "use strict";

  var store = global.SnStore;

  // Favicons come from Google's favicon service, which serves a stable image for
  // any domain (the sites' own favicon URLs change with every deploy).
  function favicon(domain) {
    return "https://www.google.com/s2/favicons?domain=" + domain + "&sz=64";
  }

  var PRESETS = [
    { id: "classroom", name: "Google Classroom", title: "Classes", icon: favicon("classroom.google.com") },
    { id: "docs", name: "Google Docs", title: "Untitled document - Google Docs", icon: favicon("docs.google.com") },
    { id: "drive", name: "Google Drive", title: "My Drive - Google Drive", icon: favicon("drive.google.com") },
    { id: "slides", name: "Google Slides", title: "Google Slides", icon: favicon("slides.google.com") },
    { id: "canvas", name: "Canvas", title: "Dashboard", icon: favicon("canvas.instructure.com") },
    { id: "schoology", name: "Schoology", title: "Home | Schoology", icon: favicon("schoology.com") },
    { id: "clever", name: "Clever", title: "Clever | Portal", icon: favicon("clever.com") },
    { id: "khan", name: "Khan Academy", title: "Khan Academy | Free Online Courses, Lessons & Practice", icon: favicon("khanacademy.org") },
    { id: "desmos", name: "Desmos", title: "Desmos | Graphing Calculator", icon: favicon("desmos.com") },
    { id: "ixl", name: "IXL", title: "IXL | Math, Language Arts, Science, Social Studies, and Spanish", icon: favicon("ixl.com") },
    { id: "quizlet", name: "Quizlet", title: "Quizlet: Learn Languages & Vocab with Free Flashcards", icon: favicon("quizlet.com") },
    { id: "wikipedia", name: "Wikipedia", title: "Wikipedia, the free encyclopedia", icon: favicon("wikipedia.org") },
    { id: "google", name: "Google", title: "Google", icon: favicon("google.com") },
    { id: "none", name: "No disguise (SuperNova OS)", title: "SuperNova OS", icon: "/resources/media/app_icons/SuperNova.png" },
  ];

  store.defaults({
    cloak: "classroom",     // preset id, or "custom"
    cloakTitle: "",         // used when cloak === "custom"
    cloakIcon: "",
    autoblank: "0",         // launch in about:blank on the first click of each visit
    anticlose: "0",         // ask before the tab is closed
    panicKey: "",           // e.g. "Ctrl+Alt+KeyP"; empty = disabled
    panicUrl: "https://classroom.google.com",
  });

  // --- tab disguise -----------------------------------------------------------

  /** Only http(s) and same-origin paths are accepted as icons; never javascript: or data: URLs. */
  function safeIcon(raw) {
    var value = String(raw || "").trim();
    if (!value) return "";
    if (value.charAt(0) === "/" && value.charAt(1) !== "/") return value;
    return /^https?:\/\//i.test(value) ? value : "";
  }

  /** The title and icon the current settings call for. */
  function current() {
    var id = store.get("cloak");
    if (id === "custom") {
      return { id: id, title: store.get("cloakTitle") || "SuperNova OS", icon: safeIcon(store.get("cloakIcon")) };
    }
    var preset = PRESETS.filter(function (p) { return p.id === id; })[0] || PRESETS[0];
    return { id: preset.id, title: preset.title, icon: preset.icon };
  }

  function setIcon(doc, href) {
    var head = doc.head || doc.getElementsByTagName("head")[0];
    if (!head) return;
    var existing = doc.querySelectorAll("link[rel~='icon']");
    for (var i = 0; i < existing.length; i++) existing[i].parentNode.removeChild(existing[i]);
    if (!href) return;
    var link = doc.createElement("link");
    link.id = "favicon";
    link.rel = "icon";
    link.href = href;
    head.appendChild(link);
  }

  /** The topmost window we are allowed to touch (the cloaked about:blank/blob page, if any). */
  function topWindow() {
    try {
      void global.top.document;
      return global.top;
    } catch (e) {
      return global; // cross-origin parent
    }
  }

  function apply() {
    var look = current();
    [global, topWindow()].forEach(function (win) {
      try {
        win.document.title = look.title;
        setIcon(win.document, look.icon);
      } catch (e) { /* not reachable */ }
    });
  }

  // --- panic key --------------------------------------------------------------

  var MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$/;

  /** "Ctrl+Alt+KeyP" for a keydown event, or "" for a bare modifier press. */
  function comboFromEvent(event) {
    if (!event.code || MODIFIER_CODES.test(event.code)) return "";
    var parts = [];
    if (event.ctrlKey) parts.push("Ctrl");
    if (event.altKey) parts.push("Alt");
    if (event.shiftKey) parts.push("Shift");
    if (event.metaKey) parts.push("Meta");
    parts.push(event.code);
    return parts.join("+");
  }

  /** "Ctrl+Alt+KeyP" -> "Ctrl + Alt + P" */
  function formatCombo(combo) {
    if (!combo) return "Not set";
    return combo.split("+").map(function (part) {
      return part.replace(/^Key([A-Z])$/, "$1").replace(/^Digit(\d)$/, "$1").replace(/^Arrow/, "").replace(/^Backquote$/, "`");
    }).join(" + ");
  }

  function panic() {
    var url = safeNavigationUrl(store.get("panicUrl"));
    var target = topWindow();
    try { target.location.replace(url); } catch (e) { global.location.replace(url); }
  }

  /** The panic destination must be http(s); anything else falls back to the default. */
  function safeNavigationUrl(raw) {
    var value = String(raw || "").trim();
    if (value && !/^[a-z][a-z0-9+.-]*:/i.test(value)) value = "https://" + value;
    return /^https?:\/\//i.test(value) ? value : "https://classroom.google.com";
  }

  function onKeyDown(event) {
    var combo = store.get("panicKey");
    if (combo && comboFromEvent(event) === combo) {
      event.preventDefault();
      event.stopPropagation();
      panic();
    }
  }

  // The native method works on same-origin windows from other realms, and sidesteps
  // any patched addEventListener inside a proxied page.
  var nativeAddListener = EventTarget.prototype.addEventListener;

  function watchWindow(win) {
    try {
      if (win.__snPanic) return;
      nativeAddListener.call(win, "keydown", onKeyDown, true);
      win.__snPanic = true;
    } catch (e) { /* cross-origin frame */ }
  }

  function watchFrame(frame) {
    function attach() {
      try { watchWindow(frame.contentWindow); } catch (e) { /* cross-origin */ }
    }
    frame.addEventListener("load", attach);
    attach();
  }

  function watchFrames() {
    watchWindow(global);
    Array.prototype.forEach.call(document.getElementsByTagName("iframe"), watchFrame);
    new MutationObserver(function (records) {
      records.forEach(function (record) {
        Array.prototype.forEach.call(record.addedNodes, function (node) {
          if (node.nodeType !== 1) return;
          if (node.tagName === "IFRAME") watchFrame(node);
          else if (node.getElementsByTagName) Array.prototype.forEach.call(node.getElementsByTagName("iframe"), watchFrame);
        });
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  // --- leave-page prompt ------------------------------------------------------

  function onBeforeUnload(event) {
    if (!store.flag("anticlose")) return;
    event.preventDefault();
    event.returnValue = ""; // required by some browsers to show the prompt
  }

  // --- about:blank / blob launcher --------------------------------------------

  /** The URL of the desktop, flagged so the wrapped copy does not try to cloak itself again. */
  function cloakedUrl() {
    return global.location.origin + "/?cloaked=1";
  }

  function isCloaked() {
    return /[?&]cloaked=1(&|$)/.test(global.location.search);
  }

  function wrapperHtml(look) {
    var esc = function (text) { return String(text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
    return "<!doctype html><html><head><meta charset=\"utf-8\"><title>" + esc(look.title) + "</title>" +
      (look.icon ? "<link rel=\"icon\" href=\"" + esc(look.icon) + "\">" : "") +
      "<style>html,body{margin:0;height:100%;overflow:hidden;background:#000}iframe{border:0;width:100%;height:100%}</style>" +
      "</head><body><iframe src=\"" + esc(cloakedUrl()) + "\" allow=\"fullscreen; autoplay; clipboard-write\" allowfullscreen></iframe></body></html>";
  }

  /**
   * Send the tab we are leaving somewhere harmless. This must be the top window:
   * the launcher is usually triggered from a window (iframe) inside the desktop,
   * and replacing only that frame would leave the desktop sitting in the tab.
   */
  function leaveOriginalTab() {
    var url = safeNavigationUrl(store.get("panicUrl"));
    try { topWindow().location.replace(url); } catch (e) { global.location.replace(url); }
  }

  /**
   * Open the desktop inside a disguised about:blank tab.
   * Returns false when the browser blocked the popup (it must run from a click).
   */
  function launchAboutBlank(options) {
    var popup = global.open("about:blank", "_blank");
    if (!popup) return false;
    try {
      popup.document.open();
      popup.document.write(wrapperHtml(current()));
      popup.document.close();
    } catch (e) {
      popup.close();
      return false;
    }
    if (!options || options.leave !== false) leaveOriginalTab();
    return true;
  }

  /** Same idea with a blob: URL, which some filters treat differently from about:blank. */
  function launchBlob(options) {
    var blob = new Blob([wrapperHtml(current())], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    var popup = global.open(url, "_blank");
    if (!popup) { URL.revokeObjectURL(url); return false; }
    if (!options || options.leave !== false) leaveOriginalTab();
    return true;
  }

  // Browsers only allow popups from a user gesture, so "auto" launches on the first click.
  function armAutoLaunch() {
    if (global.top !== global || isCloaked() || /[?&]nocloak=1(&|$)/.test(global.location.search)) return;
    if (!store.flag("autoblank")) return;

    var notice = document.createElement("div");
    notice.textContent = "Click anywhere to open SuperNova in a cloaked tab";
    notice.setAttribute("role", "status");
    notice.style.cssText = "position:fixed;left:50%;bottom:4.5em;transform:translateX(-50%);z-index:100000;" +
      "padding:.6em 1.1em;border-radius:999px;background:rgba(20,20,30,.92);color:#fff;font:14px system-ui,sans-serif;" +
      "box-shadow:0 6px 24px rgba(0,0,0,.4);pointer-events:none";
    document.body.appendChild(notice);

    function launch() {
      global.removeEventListener("pointerdown", launch, true);
      global.removeEventListener("keydown", launch, true);
      if (notice.parentNode) notice.parentNode.removeChild(notice);
      if (store.flag("autoblank")) launchAboutBlank();
    }
    global.addEventListener("pointerdown", launch, true);
    global.addEventListener("keydown", launch, true);
  }

  // --- start ------------------------------------------------------------------

  store.onChange(function (key) {
    if (key === "*" || /^cloak/.test(key)) apply();
  });

  global.addEventListener("beforeunload", onBeforeUnload);

  function start() {
    apply();
    watchFrames();
    armAutoLaunch();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  global.SnCloak = {
    presets: PRESETS,
    current: current,
    apply: apply,
    safeIcon: safeIcon,
    comboFromEvent: comboFromEvent,
    formatCombo: formatCombo,
    safeNavigationUrl: safeNavigationUrl,
    panic: panic,
    launchAboutBlank: launchAboutBlank,
    launchBlob: launchBlob,
    isCloaked: isCloaked,
  };
})(self);
