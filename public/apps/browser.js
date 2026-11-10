/*
 * SuperNova Browser: tabs over the proxy.
 *
 * Every tab is an iframe whose address is produced by SnProxy, so switching the
 * engine or transport in Settings changes how tabs load without any changes here.
 * Because proxied pages are same-origin with the desktop, the address bar can read
 * the real URL and title back from the frame.
 *
 * Features: Chrome-style tabs (drag to reorder, pin, duplicate, reopen closed),
 * per-tab fullscreen and zoom, bookmarks bar, address suggestions from bookmarks,
 * history and quick links, and keyboard shortcuts.
 */
(() => {
  "use strict";

  const MAX_TABS = 30;
  const SYNC_MS = 800; // single-page apps change URL/title without a load event
  const HISTORY_MAX = 100;
  const CLOSED_MAX = 20;
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 3;
  const ZOOM_STEPS = [0.3, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

  const QUICK_LINKS = [
    { name: "YouTube", url: "https://www.youtube.com", color: "#e62117" },
    { name: "Wikipedia", url: "https://en.wikipedia.org", color: "#5b6573" },
    { name: "Reddit", url: "https://www.reddit.com", color: "#ff4500" },
    { name: "Discord", url: "https://discord.com", color: "#5865f2" },
    { name: "GitHub", url: "https://github.com", color: "#2b3137" },
    { name: "DuckDuckGo", url: "https://duckduckgo.com", color: "#de5833" },
    { name: "Spotify", url: "https://open.spotify.com", color: "#1db954" },
    { name: "Khan Academy", url: "https://www.khanacademy.org", color: "#14bf96" },
  ];

  const ENGINE_NOTES = {
    sj: "Newest engine, best compatibility with modern sites",
    uv: "Lightweight, a good fallback if a site misbehaves",
  };

  SnStore.defaults({ bookmarks: "[]", history: "[]", bookmarkbar: "1" });

  const $ = (id) => document.getElementById(id);
  const els = {
    chrome: $("chrome"),
    tabs: $("tabs"),
    newTab: $("new-tab"),
    back: $("back"),
    forward: $("forward"),
    reload: $("reload"),
    home: $("home"),
    form: $("address-form"),
    address: $("address"),
    addressIcon: $("address-icon"),
    suggest: $("suggest"),
    bookmark: $("bookmark"),
    engineButton: $("engine-button"),
    engineLabel: $("engine-label"),
    engineList: $("engine-list"),
    fullscreen: $("fullscreen"),
    menuButton: $("menu-button"),
    bookmarks: $("bookmarks"),
    progress: $("progress"),
    viewport: $("viewport"),
    newtab: $("newtab"),
    newtabForm: $("newtab-form"),
    newtabInput: $("newtab-input"),
    tiles: $("tiles"),
    note: $("newtab-note"),
    problem: $("problem"),
    problemTitle: $("problem-title"),
    problemText: $("problem-text"),
    problemRetry: $("problem-retry"),
    problemHome: $("problem-home"),
    fsReveal: $("fs-reveal"),
    fsExit: $("fs-exit"),
    mainMenu: $("main-menu"),
    tabMenu: $("tab-menu"),
    zoomBadge: $("zoom-badge"),
  };

  /**
   * @typedef {object} Tab
   * @property {number} id
   * @property {string} title
   * @property {string} url           the real address
   * @property {string} pending       what was last typed (for retry)
   * @property {HTMLIFrameElement|null} frame
   * @property {HTMLElement} button
   * @property {boolean} loading
   * @property {null|{kind:string,title:string,text:string}} problem
   * @property {string} icon
   * @property {boolean} pinned
   * @property {boolean} fullscreen
   * @property {number} zoom
   */
  /** @type {Tab[]} */
  const tabs = [];
  const closed = [];
  let activeId = 0;
  let nextId = 1;

  const active = () => tabs.find((tab) => tab.id === activeId);
  const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };
  const readList = (key) => {
    try { const list = JSON.parse(SnStore.get(key)); return Array.isArray(list) ? list : []; } catch { return []; }
  };
  const writeList = (key, list) => SnStore.set(key, JSON.stringify(list));

  function svg(name, className) {
    const root = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    root.appendChild(use);
    if (className) root.setAttribute("class", className);
    return root;
  }

  function setIcon(button, name) {
    button.querySelector("use").setAttribute("href", `#i-${name}`);
  }

  /** The desktop's bridge (SnOS) when this browser runs in a desktop window, else null. */
  function desktop() {
    try { return window.parent !== window ? window.parent.SnOS ?? null : null; } catch { return null; }
  }

  function toast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  // --- tabs ---------------------------------------------------------------------------

  const letterFor = (tab) => (hostOf(tab.url) || tab.title || "N").charAt(0);

  function buildTabButton(tab) {
    const button = document.createElement("div");
    button.className = "tab";
    button.setAttribute("role", "tab");
    button.tabIndex = 0;
    button.draggable = true;

    const bg = document.createElement("span");
    bg.className = "tab-bg";
    const icon = document.createElement("span");
    icon.className = "tab-icon";
    const title = document.createElement("span");
    title.className = "tab-title";
    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close tab");
    close.append(svg("close"));
    button.append(bg, icon, title, close);

    button.addEventListener("click", () => activate(tab.id));
    button.addEventListener("auxclick", (event) => { if (event.button === 1) { event.preventDefault(); closeTab(tab.id); } });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(tab.id); }
      if (event.key === "Delete") closeTab(tab.id);
    });
    close.addEventListener("click", (event) => { event.stopPropagation(); closeTab(tab.id); });
    button.addEventListener("contextmenu", (event) => { event.preventDefault(); openTabMenu(tab, event.clientX, event.clientY); });
    // A soft light follows the pointer across the tab
    button.addEventListener("pointermove", (event) => {
      const rect = button.getBoundingClientRect();
      button.style.setProperty("--mx", `${event.clientX - rect.left}px`);
      button.style.setProperty("--my", `${event.clientY - rect.top}px`);
    });

    // Drag to reorder
    button.addEventListener("dragstart", (event) => {
      dragging = tab;
      button.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", String(tab.id));
    });
    button.addEventListener("dragover", (event) => {
      if (!dragging || dragging === tab) return;
      event.preventDefault();
      const rect = button.getBoundingClientRect();
      if (event.clientX > rect.left + rect.width / 2) button.after(dragging.button);
      else button.before(dragging.button);
    });
    button.addEventListener("dragend", () => {
      button.classList.remove("dragging");
      dragging = null;
      const order = [...els.tabs.children];
      tabs.sort((a, b) => order.indexOf(a.button) - order.indexOf(b.button));
      sortPinned();
    });
    return button;
  }
  let dragging = null;

  /** Pinned tabs stay at the left, in the order they were pinned. */
  function sortPinned() {
    const sorted = [...tabs].sort((a, b) => Number(b.pinned) - Number(a.pinned));
    tabs.splice(0, tabs.length, ...sorted);
    for (const tab of tabs) els.tabs.append(tab.button);
  }

  function createTab(input, options = {}) {
    if (tabs.length >= MAX_TABS) { toast(`You can have up to ${MAX_TABS} tabs open`); return null; }
    const tab = {
      id: nextId++, title: options.title ?? "New tab", url: "", pending: "", frame: null, button: null,
      loading: false, problem: null, icon: "", pinned: Boolean(options.pinned), fullscreen: false, zoom: 1,
    };
    tab.button = buildTabButton(tab);
    tabs.push(tab);
    els.tabs.appendChild(tab.button);
    if (tab.pinned) sortPinned();
    renderTab(tab);
    activate(tab.id);
    els.tabs.scrollLeft = els.tabs.scrollWidth;
    if (input) navigate(tab, input);
    else els.newtabInput.focus();
    return tab;
  }

  function closeTab(id) {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const [tab] = tabs.splice(index, 1);
    if (tab.url) { closed.push({ url: tab.url, title: tab.title, pinned: tab.pinned }); if (closed.length > CLOSED_MAX) closed.shift(); }
    tab.frame?.remove();
    // Shrink away, then remove
    tab.button.classList.add("closing");
    setTimeout(() => tab.button.remove(), 220);
    if (!tabs.length) { createTab(); return; }
    if (id === activeId) activate(tabs[Math.min(index, tabs.length - 1)].id);
    else refresh();
  }

  function reopenClosed() {
    const last = closed.pop();
    if (!last) return toast("No recently closed tabs");
    createTab(last.url, { pinned: last.pinned });
  }

  function duplicateTab(tab) {
    if (tab.url) createTab(tab.url);
    else createTab();
  }

  function togglePin(tab) {
    tab.pinned = !tab.pinned;
    sortPinned();
    renderTab(tab);
  }

  function closeOthers(tab) {
    tabs.filter((other) => other !== tab && !other.pinned).forEach((other) => closeTab(other.id));
  }

  function closeToRight(tab) {
    const index = tabs.indexOf(tab);
    tabs.slice(index + 1).filter((other) => !other.pinned).forEach((other) => closeTab(other.id));
  }

  function renderTab(tab) {
    const title = tab.button.querySelector(".tab-title");
    const icon = tab.button.querySelector(".tab-icon");
    title.textContent = tab.title;
    tab.button.title = tab.title;
    tab.button.dataset.loading = String(tab.loading);
    tab.button.classList.toggle("pinned", tab.pinned);

    icon.replaceChildren();
    if (tab.icon && !tab.loading) {
      const img = new Image();
      img.alt = "";
      img.src = tab.icon;
      img.addEventListener("error", () => { icon.replaceChildren(document.createTextNode(letterFor(tab))); });
      icon.append(img);
    } else {
      icon.textContent = letterFor(tab);
    }
  }

  function activate(id) {
    activeId = id;
    tabs.forEach((tab) => {
      const selected = tab.id === id;
      tab.button.setAttribute("aria-selected", String(selected));
      if (tab.frame) tab.frame.hidden = !selected || Boolean(tab.problem) || !tab.url;
    });
    active()?.button.scrollIntoView({ block: "nearest", inline: "nearest" });
    closeMenus();
    refresh();
    if (!active()?.url) els.newtabInput.focus();
  }

  /** Bring every piece of chrome in line with the active tab. */
  function refresh() {
    const tab = active();
    if (!tab) return;
    const showNewTab = !tab.url && !tab.problem && !tab.loading;
    els.newtab.hidden = !showNewTab;
    els.problem.hidden = !tab.problem;
    els.progress.hidden = !tab.loading;
    if (tab.frame) tab.frame.hidden = Boolean(tab.problem) || (!tab.url && !tab.loading);

    if (tab.problem) {
      els.problem.dataset.kind = tab.problem.kind;
      els.problemTitle.textContent = tab.problem.title;
      els.problemText.textContent = tab.problem.text;
      els.problem.querySelector("use").setAttribute("href", tab.problem.kind === "blocked" ? "#i-shield" : "#i-alert");
    }
    if (document.activeElement !== els.address) els.address.value = tab.url;
    document.title = tab.title && tab.title !== "New tab" ? `${tab.title} - SuperNova Browser` : "SuperNova Browser";

    const engine = SnProxy.engines[SnProxy.engine()].name;
    els.engineLabel.textContent = engine;
    els.note.textContent = `Engine: ${engine} · Transport: ${SnProxy.transports[SnStore.get("transport")]?.name ?? "libcurl"}`
      + (SnStore.flag("safesearch") ? " · Safe search on" : "");

    // Reload turns into Stop while a page is loading
    const stopping = tab.loading;
    els.reload.dataset.mode = stopping ? "stop" : "reload";
    setIcon(els.reload, stopping ? "stop" : "reload");
    els.reload.title = stopping ? "Stop loading" : "Reload (F5)";

    const secure = /^https:/i.test(tab.url);
    els.form.classList.toggle("secure", secure);
    setIcon(els.addressIcon, secure ? "lock" : "search");

    const marked = Boolean(tab.url) && readList("bookmarks").some((b) => b.url === tab.url);
    els.bookmark.setAttribute("aria-pressed", String(marked));
    els.bookmark.title = marked ? "Remove bookmark (Alt+D)" : "Bookmark this page (Alt+D)";

    applyFullscreen();
  }

  // --- navigation ----------------------------------------------------------------------

  function ensureFrame(tab) {
    if (tab.frame) return tab.frame;
    const frame = document.createElement("iframe");
    frame.title = "Web page";
    frame.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; microphone; camera; gamepad");
    frame.allowFullscreen = true;
    frame.hidden = true;
    SnProxy.registerFrame(frame); // names the frame for Scramjet; harmless for other engines
    frame.addEventListener("load", () => { if (frame.getAttribute("src")) onFrameLoad(tab); });
    els.viewport.appendChild(frame);
    tab.frame = frame;
    applyZoom(tab);
    return frame;
  }

  async function navigate(tab, input) {
    const text = String(input ?? "").trim();
    if (!text) return;
    tab.pending = text;
    tab.problem = null;
    tab.loading = true;
    tab.title = "Loading…";
    renderTab(tab);
    refresh();

    try {
      const proxied = await SnProxy.open(text);
      if (!proxied) { tab.loading = false; renderTab(tab); refresh(); return; }
      const frame = ensureFrame(tab);
      tab.url = SnResolve.resolve(text, SnStore.get("search"))?.url ?? text;
      frame.src = proxied;
    } catch (error) {
      tab.loading = false;
      tab.url = tab.url || "";
      tab.title = error.blocked ? "Blocked" : "Couldn't load page";
      tab.problem = error.blocked
        ? { kind: "blocked", title: "This page is blocked", text: error.message }
        : { kind: "error", title: "The proxy couldn't load this page", text: error.message };
      renderTab(tab);
    }
    refresh();
    activate(tab.id);
  }

  /** Read what we can from a loaded page: its real URL, title and icon. */
  function readFrame(tab) {
    const frame = tab.frame;
    if (!frame) return false;
    let changed = false;
    try {
      const win = frame.contentWindow;
      const real = SnProxy.decode(win.location.href);
      if (real && real !== tab.url) { tab.url = real; changed = true; }

      const title = win.document.title || hostOf(tab.url) || tab.url;
      if (title && title !== tab.title && !tab.loading) { tab.title = title; changed = true; }

      // The page's icon must be fetched through the proxy: reading link.href from a
      // proxied document returns the *real* address, and loading that directly would
      // bypass the proxy and expose the visitor's IP to the site.
      const link = win.document.querySelector("link[rel~='icon']");
      const href = link?.getAttribute("href");
      const absolute = href ? new URL(href, tab.url).href : tab.url ? new URL("/favicon.ico", tab.url).href : "";
      const icon = absolute && /^https?:/i.test(absolute) ? SnProxy.encode(absolute) : "";
      if (icon !== tab.icon) { tab.icon = icon; changed = true; }
    } catch {
      /* the frame is between pages, or not same-origin yet */
    }
    return changed;
  }

  function onFrameLoad(tab) {
    tab.loading = false;
    readFrame(tab);
    renderTab(tab);
    if (tab.url) addHistory(tab.url, tab.title);
    if (tab.id === activeId) refresh();
  }

  setInterval(() => {
    const tab = active();
    if (tab && tab.frame && !tab.loading && readFrame(tab)) { renderTab(tab); refresh(); }
  }, SYNC_MS);

  const withFrame = (action) => {
    try { action(active().frame.contentWindow); } catch { /* nothing loaded */ }
  };

  function stopLoading(tab) {
    try { tab.frame?.contentWindow.stop(); } catch { /* nothing loaded */ }
    tab.loading = false;
    if (tab.title === "Loading…") tab.title = hostOf(tab.url) || "New tab";
    renderTab(tab);
    refresh();
  }

  function goHome() {
    const tab = active();
    tab.url = "";
    tab.title = "New tab";
    tab.icon = "";
    tab.problem = null;
    tab.loading = false;
    tab.zoom = 1;
    // Removing the src attribute would not unload the page (audio would keep playing).
    tab.frame?.remove();
    tab.frame = null;
    renderTab(tab);
    refresh();
    els.newtabInput.focus();
  }

  // --- history and bookmarks --------------------------------------------------------------

  function addHistory(url, title) {
    const list = readList("history").filter((entry) => entry.url !== url);
    list.unshift({ url, title: title || hostOf(url), t: Date.now() });
    writeList("history", list.slice(0, HISTORY_MAX));
  }

  function toggleBookmark(tab) {
    if (!tab?.url) return toast("Open a page first, then bookmark it");
    const list = readList("bookmarks");
    const index = list.findIndex((b) => b.url === tab.url);
    if (index === -1) {
      list.push({ url: tab.url, title: tab.title || hostOf(tab.url) });
      toast("Bookmarked");
    } else {
      list.splice(index, 1);
      toast("Bookmark removed");
    }
    writeList("bookmarks", list);
  }

  function renderBookmarks() {
    const show = SnStore.flag("bookmarkbar");
    els.bookmarks.hidden = !show;
    if (!show) return;
    els.bookmarks.replaceChildren();
    const list = readList("bookmarks");
    if (!list.length) {
      const hint = document.createElement("span");
      hint.className = "bookmarks-empty";
      hint.textContent = "Press Alt+D on a page to bookmark it";
      els.bookmarks.append(hint);
      return;
    }
    list.forEach((bookmark, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bookmark";
      button.title = `${bookmark.title}\n${bookmark.url}\n(right-click to remove)`;
      button.style.animationDelay = `${Math.min(index, 10) * 30}ms`;
      const letter = document.createElement("i");
      letter.textContent = (hostOf(bookmark.url) || bookmark.title || "?").charAt(0);
      const label = document.createElement("span");
      label.textContent = bookmark.title || hostOf(bookmark.url);
      button.append(letter, label);
      button.addEventListener("click", () => navigate(active(), bookmark.url));
      button.addEventListener("auxclick", (event) => { if (event.button === 1) { event.preventDefault(); createTab(bookmark.url); } });
      button.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        writeList("bookmarks", readList("bookmarks").filter((b) => b.url !== bookmark.url));
        toast("Bookmark removed");
      });
      els.bookmarks.append(button);
    });
  }

  // --- address bar suggestions ---------------------------------------------------------------

  let suggestions = [];
  let suggestIndex = -1;

  function computeSuggestions(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const seen = new Set();
    const out = [];
    const consider = (kind, title, url) => {
      if (seen.has(url) || !(`${title} ${url}`.toLowerCase().includes(q))) return;
      seen.add(url);
      out.push({ kind, title, url });
    };
    readList("bookmarks").forEach((b) => consider("bookmark", b.title, b.url));
    readList("history").forEach((h) => consider("history", h.title, h.url));
    QUICK_LINKS.forEach((l) => consider("site", l.name, l.url));
    return out.slice(0, 6);
  }

  function renderSuggestions() {
    const query = els.address.value;
    suggestions = computeSuggestions(query);
    suggestIndex = -1;
    els.suggest.replaceChildren();
    if (!query.trim() || document.activeElement !== els.address) return hideSuggestions();

    const typed = SnResolve.resolve(query, SnStore.get("search"));
    const rows = [{ kind: typed?.kind === "url" ? "go" : "search", title: typed?.kind === "url" ? `Go to ${hostOf(typed.url)}` : `Search for “${query.trim()}”`, url: query.trim(), typed: true }, ...suggestions];
    suggestions = rows;
    rows.forEach((row, index) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.append(svg(row.kind === "search" ? "search" : row.kind === "bookmark" ? "star" : row.kind === "go" ? "forward" : "home"));
      const main = document.createElement("span");
      main.className = "s-main";
      main.textContent = row.title;
      li.append(main);
      if (!row.typed) {
        const sub = document.createElement("span");
        sub.className = "s-sub";
        sub.textContent = hostOf(row.url);
        li.append(sub);
      }
      li.addEventListener("mousedown", (event) => event.preventDefault()); // keep focus in the field
      li.addEventListener("click", () => { hideSuggestions(); els.address.blur(); navigate(active(), row.url); });
      li.addEventListener("mouseenter", () => selectSuggestion(index));
      els.suggest.append(li);
    });
    els.suggest.hidden = false;
    els.address.setAttribute("aria-expanded", "true");
  }

  function selectSuggestion(index) {
    suggestIndex = index;
    [...els.suggest.children].forEach((li, i) => li.setAttribute("aria-selected", String(i === index)));
  }

  function hideSuggestions() {
    els.suggest.hidden = true;
    els.address.setAttribute("aria-expanded", "false");
    suggestIndex = -1;
  }

  // --- fullscreen ------------------------------------------------------------------------------

  let realFullscreen = false;
  let hintTimer = 0;
  let peekTimer = 0;

  /** Each tab remembers whether it is fullscreen; the chrome follows the active tab. */
  function applyFullscreen() {
    const tab = active();
    const on = Boolean(tab?.fullscreen);
    const wasOn = document.body.classList.contains("fs");
    document.body.classList.toggle("fs", on);
    els.fullscreen.setAttribute("aria-pressed", String(on));
    els.fullscreen.title = on ? "Exit fullscreen (F11)" : "Fullscreen this tab (F11)";
    setIcon(els.fullscreen, on ? "exit-fullscreen" : "fullscreen");
    els.fsExit.hidden = !on;
    if (on === wasOn) return;
    document.body.classList.remove("fs-peek");
    if (on) {
      document.activeElement?.blur?.(); // a focused toolbar button would hold the toolbar open
      document.body.classList.add("fs-hint");
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => document.body.classList.remove("fs-hint"), 3200);
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().then(() => { realFullscreen = true; }, () => { /* page-only fullscreen */ });
      }
    } else {
      document.body.classList.remove("fs-hint");
      if (document.fullscreenElement) { realFullscreen = false; document.exitFullscreen().catch(() => {}); }
    }
  }

  function toggleFullscreen(tab = active()) {
    if (!tab) return;
    tab.fullscreen = !tab.fullscreen;
    if (tab.id === activeId) applyFullscreen();
    else activate(tab.id);
  }

  // The browser's own Esc handling leaves real fullscreen; leave ours with it.
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && realFullscreen) {
      realFullscreen = false;
      const tab = active();
      if (tab?.fullscreen) { tab.fullscreen = false; applyFullscreen(); }
    }
  });

  function peek(on) {
    clearTimeout(peekTimer);
    if (on) { document.body.classList.add("fs-peek"); return; }
    peekTimer = setTimeout(() => {
      // Only typing in the address bar (or an open menu) keeps the toolbar down.
      if (document.activeElement === els.address || !els.mainMenu.hidden || !els.engineList.hidden) return;
      document.body.classList.remove("fs-peek");
    }, 380);
  }

  els.fsReveal.addEventListener("mouseenter", () => peek(true));
  // A quick flick off the edge strip straight into the page never "leaves" the toolbar.
  els.fsReveal.addEventListener("mouseleave", () => peek(false));
  els.chrome.addEventListener("mouseenter", () => { if (document.body.classList.contains("fs")) peek(true); });
  els.chrome.addEventListener("mouseleave", () => { if (document.body.classList.contains("fs")) peek(false); });
  els.fsExit.addEventListener("click", () => toggleFullscreen());

  // --- zoom -----------------------------------------------------------------------------------------

  function applyZoom(tab) {
    const frame = tab.frame;
    if (!frame) return;
    if (tab.zoom === 1) {
      frame.style.width = frame.style.height = frame.style.transform = "";
      return;
    }
    // Scale the page and give it proportionally more room, so it still fills the view.
    frame.style.width = frame.style.height = `${100 / tab.zoom}%`;
    frame.style.transform = `scale(${tab.zoom})`;
  }

  function setZoom(tab, zoom) {
    if (!tab?.url) return;
    tab.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(zoom * 100) / 100));
    applyZoom(tab);
    const badge = els.zoomBadge;
    badge.hidden = true;
    void badge.offsetWidth; // restart the animation
    badge.textContent = `${Math.round(tab.zoom * 100)}%`;
    badge.hidden = false;
    clearTimeout(setZoom.timer);
    setZoom.timer = setTimeout(() => { badge.hidden = true; }, 1400);
  }

  function stepZoom(tab, direction) {
    const current = tab?.zoom ?? 1;
    const next = direction > 0 ? ZOOM_STEPS.find((z) => z > current + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001);
    if (next) setZoom(tab, next);
  }

  // --- menus -------------------------------------------------------------------------------------------

  function menuItem(label, { icon, kbd, onClick, disabled, note } = {}) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "menu-item";
    item.setAttribute("role", "menuitem");
    item.disabled = Boolean(disabled);
    if (icon) item.append(svg(icon));
    const text = document.createElement("span");
    text.className = "grow";
    text.textContent = label;
    if (note) { const small = document.createElement("small"); small.textContent = note; text.append(small); }
    item.append(text);
    if (kbd) { const k = document.createElement("span"); k.className = "kbd"; k.textContent = kbd; item.append(k); }
    item.addEventListener("click", () => { closeMenus(); onClick?.(); });
    return item;
  }

  const separator = () => Object.assign(document.createElement("div"), { className: "menu-sep" });

  /** Show a fixed-position menu at (x, y), kept inside the window. */
  function placeMenu(menu, x, y) {
    menu.hidden = false;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(6, Math.min(x, innerWidth - width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(y, innerHeight - height - 6))}px`;
  }

  function closeMenus() {
    let closedAny = false;
    for (const menu of [els.mainMenu, els.tabMenu, els.engineList]) {
      if (!menu.hidden) { menu.hidden = true; closedAny = true; }
    }
    els.menuButton.setAttribute("aria-expanded", "false");
    els.engineButton.setAttribute("aria-expanded", "false");
    return closedAny;
  }

  function openMainMenu() {
    const tab = active();
    closeMenus();
    els.mainMenu.replaceChildren(
      menuItem("New tab", { icon: "plus", kbd: "Alt+T", onClick: () => createTab() }),
      menuItem("Reopen closed tab", { icon: "undo", kbd: "Alt+Shift+T", disabled: !closed.length, onClick: reopenClosed }),
      menuItem("Duplicate tab", { icon: "copy", disabled: !tab.url, onClick: () => duplicateTab(tab) }),
      menuItem(tab.pinned ? "Unpin tab" : "Pin tab", { icon: "pin", onClick: () => togglePin(tab) }),
      separator(),
    );
    const zoomRow = document.createElement("div");
    zoomRow.className = "zoom-row";
    const label = Object.assign(document.createElement("span"), { className: "grow", textContent: "Zoom" });
    const out = Object.assign(document.createElement("output"), { textContent: `${Math.round(tab.zoom * 100)}%` });
    const minus = Object.assign(document.createElement("button"), { type: "button", className: "icon-btn small", title: "Zoom out (Alt+-)" });
    minus.append(svg("minus"));
    const plus = Object.assign(document.createElement("button"), { type: "button", className: "icon-btn small", title: "Zoom in (Alt+=)" });
    plus.append(svg("plus"));
    const bump = (direction) => { stepZoom(tab, direction); out.textContent = `${Math.round(tab.zoom * 100)}%`; };
    minus.addEventListener("click", () => bump(-1));
    plus.addEventListener("click", () => bump(1));
    out.title = "Reset zoom (Alt+0)";
    out.style.cursor = "pointer";
    out.addEventListener("click", () => { setZoom(tab, 1); out.textContent = "100%"; });
    zoomRow.append(label, minus, out, plus);
    els.mainMenu.append(
      zoomRow,
      menuItem(tab.fullscreen ? "Exit fullscreen" : "Fullscreen this tab", { icon: "fullscreen", kbd: "F11", onClick: () => toggleFullscreen(tab) }),
      separator(),
      menuItem("Bookmark this page", { icon: "star", kbd: "Alt+D", disabled: !tab.url, onClick: () => toggleBookmark(tab) }),
      menuItem("Add to desktop", { icon: "plus", disabled: !tab.url || !desktop(), onClick: () => desktop().openAddApp(tab.title, tab.url) }),
      menuItem(SnStore.flag("bookmarkbar") ? "Hide bookmarks bar" : "Show bookmarks bar", { icon: "star", kbd: "Alt+B", onClick: toggleBookmarkBar }),
      menuItem("Clear history", { icon: "trash", note: `${readList("history").length} pages`, disabled: !readList("history").length, onClick: () => { writeList("history", []); toast("History cleared"); } }),
    );
    const rect = els.menuButton.getBoundingClientRect();
    els.menuButton.setAttribute("aria-expanded", "true");
    placeMenu(els.mainMenu, rect.right - 280, rect.bottom + 6);
  }

  function openTabMenu(tab, x, y) {
    closeMenus();
    const index = tabs.indexOf(tab);
    els.tabMenu.replaceChildren(
      menuItem("New tab", { icon: "plus", onClick: () => createTab() }),
      menuItem("Reload", { icon: "reload", disabled: !tab.url, onClick: () => { activate(tab.id); navigate(tab, tab.url); } }),
      menuItem("Duplicate", { icon: "copy", disabled: !tab.url, onClick: () => duplicateTab(tab) }),
      menuItem(tab.pinned ? "Unpin" : "Pin", { icon: "pin", onClick: () => togglePin(tab) }),
      menuItem(tab.fullscreen ? "Exit fullscreen" : "Fullscreen this tab", { icon: "fullscreen", onClick: () => { activate(tab.id); toggleFullscreen(tab); } }),
      menuItem("Bookmark", { icon: "star", disabled: !tab.url, onClick: () => toggleBookmark(tab) }),
      separator(),
      menuItem("Close tab", { icon: "close", onClick: () => closeTab(tab.id) }),
      menuItem("Close other tabs", { disabled: tabs.length < 2, onClick: () => closeOthers(tab) }),
      menuItem("Close tabs to the right", { disabled: index === tabs.length - 1, onClick: () => closeToRight(tab) }),
    );
    placeMenu(els.tabMenu, x, y);
  }

  function buildEngineMenu() {
    els.engineList.replaceChildren();
    const heading = document.createElement("div");
    heading.className = "menu-heading";
    heading.textContent = "Proxy engine";
    els.engineList.append(heading);

    for (const [key, engine] of Object.entries(SnProxy.engines)) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "menu-item";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(SnProxy.engine() === key));

      const check = svg("check", "check");
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = engine.name;
      const note = document.createElement("small");
      note.textContent = ENGINE_NOTES[key] ?? "";
      text.append(name, note);
      item.append(check, text);

      item.addEventListener("click", () => {
        setEngineMenu(false);
        if (SnProxy.engine() === key) return;
        SnProxy.set("engine", key);
        const tab = active();
        // Re-open the current page with the new engine; other tabs keep theirs until reloaded.
        if (tab?.url) navigate(tab, tab.url);
        else refresh();
      });
      els.engineList.append(item);
    }
  }

  function setEngineMenu(open) {
    if (open) { closeMenus(); buildEngineMenu(); }
    els.engineList.hidden = !open;
    els.engineButton.setAttribute("aria-expanded", String(open));
  }

  function toggleBookmarkBar() {
    SnStore.set("bookmarkbar", SnStore.flag("bookmarkbar") ? "0" : "1");
  }

  // --- new tab page ---------------------------------------------------------------------------------------

  function buildTiles() {
    QUICK_LINKS.forEach((link, index) => {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tile";
      tile.style.setProperty("--tile-color", link.color);
      tile.style.setProperty("--i", String(index));
      const badge = document.createElement("span");
      badge.className = "tile-badge";
      badge.textContent = link.name.charAt(0);
      const name = document.createElement("span");
      name.className = "tile-name";
      name.textContent = link.name;
      tile.append(badge, name);
      tile.addEventListener("click", () => navigate(active(), link.url));
      els.tiles.append(tile);
    });
  }

  // --- wiring -----------------------------------------------------------------------------------------------

  // Ripple on buttons and menu items
  document.addEventListener("pointerdown", (event) => {
    const host = event.target.closest?.(".icon-btn, .menu-item");
    if (!host || event.button !== 0) return;
    const rect = host.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2.2;
    const ripple = document.createElement("span");
    ripple.className = "rip";
    ripple.style.cssText = `width:${size}px;height:${size}px;left:${event.clientX - rect.left - size / 2}px;top:${event.clientY - rect.top - size / 2}px`;
    host.append(ripple);
    ripple.addEventListener("animationend", () => ripple.remove());
  }, true);

  els.newTab.addEventListener("click", () => createTab());
  els.back.addEventListener("click", () => withFrame((win) => win.history.back()));
  els.forward.addEventListener("click", () => withFrame((win) => win.history.forward()));
  els.reload.addEventListener("click", () => {
    const tab = active();
    if (tab.loading) return stopLoading(tab);
    if (tab.problem || !tab.frame) navigate(tab, tab.pending || tab.url);
    else withFrame((win) => win.location.reload());
  });
  els.home.addEventListener("click", goHome);
  els.bookmark.addEventListener("click", () => toggleBookmark(active()));
  els.fullscreen.addEventListener("click", () => toggleFullscreen());
  els.menuButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!els.mainMenu.hidden) closeMenus(); else openMainMenu();
  });

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    const chosen = suggestions[suggestIndex];
    const value = chosen ? chosen.url : els.address.value;
    hideSuggestions();
    els.address.blur();
    navigate(active(), value);
  });
  els.address.addEventListener("focus", () => els.address.select());
  els.address.addEventListener("input", renderSuggestions);
  els.address.addEventListener("blur", () => setTimeout(hideSuggestions, 120));
  els.address.addEventListener("keydown", (event) => {
    if (els.suggest.hidden || !suggestions.length) return;
    if (event.key === "ArrowDown") { event.preventDefault(); selectSuggestion((suggestIndex + 1) % suggestions.length); }
    else if (event.key === "ArrowUp") { event.preventDefault(); selectSuggestion((suggestIndex - 1 + suggestions.length) % suggestions.length); }
  });
  els.newtabForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = els.newtabInput.value;
    els.newtabInput.value = "";
    navigate(active(), value);
  });

  els.problemRetry.addEventListener("click", () => navigate(active(), active().pending || active().url));
  els.problemHome.addEventListener("click", goHome);

  els.engineButton.addEventListener("click", (event) => {
    event.stopPropagation();
    setEngineMenu(els.engineList.hidden);
  });
  document.addEventListener("click", (event) => {
    const inside = (el) => el.contains(event.target);
    if (!els.engineList.hidden && !inside(els.engineList)) setEngineMenu(false);
    if (!els.mainMenu.hidden && !inside(els.mainMenu)) closeMenus();
    if (!els.tabMenu.hidden && !inside(els.tabMenu)) closeMenus();
  });
  document.addEventListener("contextmenu", (event) => {
    if (!event.target.closest?.(".tab")) closeMenus();
  });
  window.addEventListener("blur", closeMenus);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const closedMenu = closeMenus();
      hideSuggestions();
      if (!closedMenu && document.body.classList.contains("fs")) toggleFullscreen();
      return;
    }
    if (event.key === "F11") { event.preventDefault(); toggleFullscreen(); return; }

    const alt = event.altKey && !event.ctrlKey && !event.metaKey;
    const tab = active();
    if (alt && event.shiftKey && event.code === "KeyT") { event.preventDefault(); reopenClosed(); }
    else if (alt && event.code === "KeyT") { event.preventDefault(); createTab(); }
    else if (alt && event.code === "KeyW") { event.preventDefault(); closeTab(activeId); }
    else if (alt && event.code === "KeyL") { event.preventDefault(); els.address.focus(); }
    else if (alt && event.code === "KeyD") { event.preventDefault(); toggleBookmark(tab); }
    else if (alt && event.code === "KeyB") { event.preventDefault(); toggleBookmarkBar(); }
    else if (alt && (event.code === "Equal" || event.code === "NumpadAdd")) { event.preventDefault(); stepZoom(tab, 1); }
    else if (alt && (event.code === "Minus" || event.code === "NumpadSubtract")) { event.preventDefault(); stepZoom(tab, -1); }
    else if (alt && (event.code === "Digit0" || event.code === "Numpad0")) { event.preventDefault(); setZoom(tab, 1); }
    else if (alt && event.key === "ArrowLeft") { event.preventDefault(); withFrame((win) => win.history.back()); }
    else if (alt && event.key === "ArrowRight") { event.preventDefault(); withFrame((win) => win.history.forward()); }
    else if (alt && /^Digit[1-9]$/.test(event.code)) { event.preventDefault(); const target = tabs[Number(event.code.slice(5)) - 1]; if (target) activate(target.id); }
    else if (event.key === "F5" || (event.ctrlKey && event.code === "KeyR")) { event.preventDefault(); els.reload.click(); }
    else if (event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      const index = tabs.findIndex((t) => t.id === activeId);
      activate(tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id);
    }
  });

  // Settings can change the engine, transport, search options or bookmarks while we are open.
  SnStore.onChange((key) => {
    if (key === "bookmarks" || key === "bookmarkbar" || key === "*") renderBookmarks();
    refresh();
  });

  buildTiles();
  renderBookmarks();

  // Opened with ?q=... (from the taskbar search) or ?url=...
  const params = new URLSearchParams(location.search);
  createTab(params.get("q") ?? params.get("url") ?? undefined);

  // Start the proxy warming up so the first navigation is quick.
  SnProxy.ready().catch(() => { /* surfaced when a page is requested */ });
})();
