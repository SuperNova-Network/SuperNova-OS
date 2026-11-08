/*
 * SuperNova Browser: tabs over the proxy.
 *
 * Every tab is an iframe whose address is produced by SnProxy, so switching the
 * engine or transport in Settings changes how tabs load without any changes here.
 * Because proxied pages are same-origin with the desktop, the address bar can read
 * the real URL and title back from the frame.
 */
(() => {
  "use strict";

  const MAX_TABS = 20;
  const SYNC_MS = 800; // single-page apps change URL/title without a load event

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

  const $ = (id) => document.getElementById(id);
  const els = {
    tabs: $("tabs"),
    newTab: $("new-tab"),
    back: $("back"),
    forward: $("forward"),
    reload: $("reload"),
    home: $("home"),
    form: $("address-form"),
    address: $("address"),
    engineButton: $("engine-button"),
    engineLabel: $("engine-label"),
    engineList: $("engine-list"),
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
  };

  /** @type {{id:number,title:string,url:string,pending:string,frame:HTMLIFrameElement|null,button:HTMLElement,loading:boolean,problem:null|{kind:string,title:string,text:string},icon:string}[]} */
  const tabs = [];
  let activeId = 0;
  let nextId = 1;

  const active = () => tabs.find((tab) => tab.id === activeId);
  const hostOf = (url) => {
    try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
  };

  // --- tabs --------------------------------------------------------------------

  function svg(name) {
    const root = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    root.appendChild(use);
    return root;
  }

  function buildTabButton(tab) {
    const button = document.createElement("div");
    button.className = "tab";
    button.setAttribute("role", "tab");
    button.tabIndex = 0;

    const icon = document.createElement("span");
    icon.className = "tab-icon";
    const title = document.createElement("span");
    title.className = "tab-title";
    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.setAttribute("aria-label", "Close tab");
    close.append(svg("close"));

    button.append(icon, title, close);
    button.addEventListener("click", () => activate(tab.id));
    button.addEventListener("auxclick", (event) => { if (event.button === 1) closeTab(tab.id); });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); activate(tab.id); }
      if (event.key === "Delete") closeTab(tab.id);
    });
    close.addEventListener("click", (event) => { event.stopPropagation(); closeTab(tab.id); });
    return button;
  }

  function createTab(input) {
    if (tabs.length >= MAX_TABS) { toast(`You can have up to ${MAX_TABS} tabs open`); return null; }
    const tab = { id: nextId++, title: "New tab", url: "", pending: "", frame: null, button: null, loading: false, problem: null, icon: "" };
    tab.button = buildTabButton(tab);
    tabs.push(tab);
    els.tabs.appendChild(tab.button);
    renderTab(tab);
    activate(tab.id);
    if (input) navigate(tab, input);
    else els.newtabInput.focus();
    return tab;
  }

  function closeTab(id) {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const [tab] = tabs.splice(index, 1);
    tab.frame?.remove();
    tab.button.remove();
    if (!tabs.length) { createTab(); return; }
    if (id === activeId) activate(tabs[Math.min(index, tabs.length - 1)].id);
  }

  function renderTab(tab) {
    const title = tab.button.querySelector(".tab-title");
    const icon = tab.button.querySelector(".tab-icon");
    title.textContent = tab.title;
    tab.button.title = tab.title;
    tab.button.dataset.loading = String(tab.loading);

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

  const letterFor = (tab) => (hostOf(tab.url) || tab.title || "N").charAt(0);

  function activate(id) {
    activeId = id;
    tabs.forEach((tab) => {
      const selected = tab.id === id;
      tab.button.setAttribute("aria-selected", String(selected));
      if (tab.frame) tab.frame.hidden = !selected || Boolean(tab.problem) || !tab.url;
    });
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
    els.engineLabel.textContent = SnProxy.engines[SnProxy.engine()].name;
    els.note.textContent = `Engine: ${SnProxy.engines[SnProxy.engine()].name} · Transport: ${SnProxy.transports[SnStore.get("transport")]?.name ?? "libcurl"}`
      + (SnStore.flag("safesearch") ? " · Safe search on" : "");
  }

  // --- navigation ----------------------------------------------------------------

  function ensureFrame(tab) {
    if (tab.frame) return tab.frame;
    const frame = document.createElement("iframe");
    frame.title = "Web page";
    frame.setAttribute("allow", "fullscreen; autoplay; clipboard-read; clipboard-write; microphone; camera");
    frame.allowFullscreen = true;
    frame.hidden = true;
    SnProxy.registerFrame(frame); // names the frame for Scramjet; harmless for other engines
    frame.addEventListener("load", () => { if (frame.getAttribute("src")) onFrameLoad(tab); });
    els.viewport.appendChild(frame);
    tab.frame = frame;
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
    if (tab.id === activeId) refresh();
  }

  setInterval(() => {
    const tab = active();
    if (tab && tab.frame && !tab.loading && readFrame(tab)) { renderTab(tab); refresh(); }
  }, SYNC_MS);

  const withFrame = (action) => {
    try { action(active().frame.contentWindow); } catch { /* nothing loaded */ }
  };

  function goHome() {
    const tab = active();
    tab.url = "";
    tab.title = "New tab";
    tab.icon = "";
    tab.problem = null;
    tab.loading = false;
    // Removing the src attribute would not unload the page (audio would keep playing).
    tab.frame?.remove();
    tab.frame = null;
    renderTab(tab);
    refresh();
    els.newtabInput.focus();
  }

  // --- engine menu -----------------------------------------------------------------

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

      const check = svg("check");
      check.classList.add("check");
      const text = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = engine.name;
      const note = document.createElement("small");
      note.textContent = ENGINE_NOTES[key] ?? "";
      text.append(name, note);
      item.append(check, text);

      item.addEventListener("click", () => {
        setMenu(false);
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

  function setMenu(open) {
    if (open) buildEngineMenu();
    els.engineList.hidden = !open;
    els.engineButton.setAttribute("aria-expanded", String(open));
  }

  // --- small UI helpers ----------------------------------------------------------------

  function toast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.textContent = message;
    document.body.append(el);
    setTimeout(() => el.remove(), 2600);
  }

  function buildTiles() {
    for (const link of QUICK_LINKS) {
      const tile = document.createElement("button");
      tile.type = "button";
      tile.className = "tile";
      tile.dataset.ripple = "";
      tile.style.setProperty("--tile-color", link.color);
      const badge = document.createElement("span");
      badge.className = "tile-badge";
      badge.textContent = link.name.charAt(0);
      const name = document.createElement("span");
      name.className = "tile-name";
      name.textContent = link.name;
      tile.append(badge, name);
      tile.addEventListener("click", () => navigate(active(), link.url));
      els.tiles.append(tile);
    }
  }

  // --- wiring ---------------------------------------------------------------------------

  els.newTab.addEventListener("click", () => createTab());
  els.back.addEventListener("click", () => withFrame((win) => win.history.back()));
  els.forward.addEventListener("click", () => withFrame((win) => win.history.forward()));
  els.reload.addEventListener("click", () => {
    const tab = active();
    if (tab.problem || !tab.frame) navigate(tab, tab.pending || tab.url);
    else withFrame((win) => win.location.reload());
  });
  els.home.addEventListener("click", goHome);

  els.form.addEventListener("submit", (event) => {
    event.preventDefault();
    els.address.blur();
    navigate(active(), els.address.value);
  });
  els.address.addEventListener("focus", () => els.address.select());
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
    setMenu(els.engineList.hidden);
  });
  document.addEventListener("click", (event) => {
    if (!els.engineList.hidden && !els.engineList.contains(event.target)) setMenu(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setMenu(false);
    const alt = event.altKey && !event.ctrlKey && !event.metaKey;
    if (alt && event.code === "KeyT") { event.preventDefault(); createTab(); }
    else if (alt && event.code === "KeyW") { event.preventDefault(); closeTab(activeId); }
    else if (alt && event.code === "KeyL") { event.preventDefault(); els.address.focus(); }
    else if (alt && event.key === "ArrowLeft") { event.preventDefault(); withFrame((win) => win.history.back()); }
    else if (alt && event.key === "ArrowRight") { event.preventDefault(); withFrame((win) => win.history.forward()); }
    else if (alt && /^Digit[1-9]$/.test(event.code)) { event.preventDefault(); const tab = tabs[Number(event.code.slice(5)) - 1]; if (tab) activate(tab.id); }
    else if (event.key === "F5" || (event.ctrlKey && event.code === "KeyR")) { event.preventDefault(); els.reload.click(); }
    else if (event.ctrlKey && event.key === "Tab") {
      event.preventDefault();
      const index = tabs.findIndex((tab) => tab.id === activeId);
      activate(tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length].id);
    }
  });

  // Settings can change the engine, transport or search options while we are open.
  SnStore.onChange(() => refresh());

  buildTiles();

  // Opened with ?q=... (from the taskbar search) or ?url=...
  const params = new URLSearchParams(location.search);
  createTab(params.get("q") ?? params.get("url") ?? undefined);

  // Start the proxy warming up so the first navigation is quick.
  SnProxy.ready().catch(() => { /* surfaced when a page is requested */ });
})();
