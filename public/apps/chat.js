/*
 * Chat app (see src/chat.js for the server).
 *
 * Messages arrive over one EventSource and are sent with ordinary POSTs. Everything
 * people write is put on the page with textContent, never as HTML.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const API = "/api/chat";
  const AVATAR_COLORS = ["#d9534f", "#e8892e", "#c9a227", "#43a047", "#16a085", "#2b8cd6", "#5c6bc0", "#8e44ad", "#d6457a", "#6d7b8a"];
  const GROUP_MS = 5 * 60 * 1000;      // messages by one person this close together share a heading
  const KEEP = 400;                     // messages kept on the page
  const GIF_MAX_BYTES = 2 * 1024 * 1024;

  const state = {
    me: null,            // { id, username, admin, avatar, sanction }
    settings: null,
    messages: [],        // oldest first
    online: [],
    source: null,
    sanction: null,
    cooldownUntil: 0,
    hasOlder: false,
    atBottom: true,
    moderating: null,    // the person the Moderate dialog is about
  };

  /** The desktop's functions, when this page runs inside a desktop window. */
  const desktop = (() => { try { return window.parent !== window ? window.parent : null; } catch { return null; } })();

  // --- small helpers -------------------------------------------------------------------

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function status(node, message, kind = "") {
    node.textContent = message;
    if (kind) node.dataset.state = kind; else delete node.dataset.state;
  }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(API + path, {
        method,
        credentials: "same-origin",
        headers: body !== undefined ? { "content-type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      const error = new Error("The server could not be reached. Check your connection.");
      error.status = 0;
      throw error;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || `Something went wrong (${res.status}).`);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function colorFor(name) {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return AVATAR_COLORS[hash % AVATAR_COLORS.length];
  }

  /** Fill `node` with someone's picture, or their initial on a colour when they have none. */
  function paintAvatar(node, user) {
    node.textContent = "";
    node.style.background = "";
    const url = window.SnAccount ? SnAccount.avatarUrl(user.username, user.avatar) : "";
    const letter = () => {
      node.textContent = "";
      node.style.background = colorFor(user.username);
      node.append(user.username.charAt(0).toUpperCase());
    };
    if (!url) return letter();
    const img = el("img");
    img.alt = "";
    img.decoding = "async";
    img.addEventListener("error", letter, { once: true });
    img.src = url;
    node.append(img);
  }

  function avatar(user, size = "") {
    const node = el("span", `avatar ${size}`.trim());
    node.setAttribute("aria-hidden", "true");
    paintAvatar(node, user);
    return node;
  }

  const SHIELD = "M12 2 3.5 5.5v6c0 5 3.6 9 8.5 10.5 4.9-1.5 8.5-5.5 8.5-10.5v-6z";
  function adminBadge() {
    const badge = el("span", "badge");
    badge.title = "This person is an admin";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", SHIELD);
    svg.append(path);
    badge.append(svg, "ADMIN");
    return badge;
  }

  const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  function dayLabel(ms) {
    const day = new Date(ms), today = new Date();
    const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((midnight(today) - midnight(day)) / 86_400_000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return day.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  }
  const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

  // --- the gate: signed out, accounts off, loading ---------------------------------------

  function showGate(title, message, { signIn = false, retry = false } = {}) {
    $("app").hidden = true;
    $("gate").hidden = false;
    $("gate-title").textContent = title;
    $("gate-text").textContent = message;
    $("gate-signin").hidden = !signIn;
    $("gate-retry").hidden = !retry;
  }

  let waitForSignIn = null;
  async function start() {
    clearInterval(waitForSignIn);
    showGate("Chat", "Checking…");
    let account;
    try {
      account = await SnAccount.status(true);
    } catch {
      return showGate("Chat", "The server could not be reached.", { retry: true });
    }
    if (!account.enabled) {
      return showGate("Chat needs accounts", "Accounts are turned off on this site, so there is nobody to chat as. An admin can turn them on in Settings > Admin.");
    }
    if (!account.user) {
      showGate("Sign in to chat", "The chat uses your account's name and picture. Sign in, or make an account, in Settings.", { signIn: true });
      // Notice when sign-in happens in another window, and carry on.
      waitForSignIn = setInterval(async () => {
        try { if ((await SnAccount.status(true)).user) start(); } catch { /* keep waiting */ }
      }, 3000);
      return;
    }
    connect();
  }

  $("gate-signin").addEventListener("click", () => {
    try { if (desktop && desktop.openSettings) return void desktop.openSettings("account"); } catch { /* fall through */ }
    window.open("/apps/settings.html#account", "_blank");
  });
  $("gate-retry").addEventListener("click", start);

  // --- the live connection ------------------------------------------------------------------

  function setConn(kind, text) {
    $("conn").dataset.state = kind;
    $("conn").textContent = text;
  }

  let failures = 0; // consecutive failed connections, for backing off
  function connect() {
    if (state.source) state.source.close();
    setConn("connecting", "Connecting…");
    const source = new EventSource(`${API}/stream`);
    state.source = source;

    source.addEventListener("open", () => setConn("online", "Connected"));
    source.addEventListener("error", () => {
      if (state.source !== source) return;
      setConn("connecting", "Reconnecting…");
      // The browser retries by itself, except after a refusal (signed out, banned).
      if (source.readyState === EventSource.CLOSED) {
        source.close();
        setTimeout(start, Math.min(30_000, 1500 * 2 ** failures++));
      }
    });
    const on = (name, handler) => source.addEventListener(name, (event) => { try { handler(JSON.parse(event.data)); } catch (err) { console.warn("Chat:", err); } });

    on("ready", (data) => {
      failures = 0;
      state.me = data.me;
      state.settings = data.settings;
      state.messages = data.messages;
      state.online = data.online;
      state.hasOlder = data.messages.length >= 60;
      state.sanction = data.me.sanction;
      $("gate").hidden = true;
      $("app").hidden = false;
      renderMe();
      renderAll();
      renderOnline();
      renderComposerState();
      autosize(); // now that the chat is showing, so it can be measured
      $("mod-open").hidden = !state.me.admin;
      scrollToEnd();
    });
    on("message", (message) => addMessage(message));
    on("delete", ({ id }) => {
      const before = state.messages.length;
      state.messages = state.messages.filter((message) => message.id !== id);
      if (state.messages.length !== before) renderAll();
    });
    on("clear", () => { state.messages = []; state.hasOlder = false; renderAll(); });
    on("presence", ({ online }) => {
      state.online = online;
      renderOnline();
      applyAvatars(online);
    });
    on("settings", (settings) => { state.settings = settings; renderComposerState(); });
    on("sanction", (sanction) => { state.sanction = sanction; renderComposerState(); });
    on("sanction-lifted", () => { state.sanction = null; renderComposerState(); });
    on("closed", ({ reason }) => {
      source.close();
      if (reason === "another-tab") {
        setConn("offline", "Closed");
        showBanner("The chat was opened in too many windows, so this one was disconnected. Reload to reconnect.", "danger");
      } else {
        setConn("offline", "Disconnected");
        start(); // signed out or banned from the site: the gate explains
      }
    });
  }

  // --- rendering -------------------------------------------------------------------------------

  function renderMe() {
    paintAvatar($("me-avatar"), state.me);
    $("me-avatar").className = "avatar small";
    $("me-name").textContent = state.me.username;
    $("me-name").classList.toggle("admin", Boolean(state.me.admin));
  }

  function messageNode(message, previous) {
    const grouped = previous && previous.user.username === message.user.username && message.at - previous.at < GROUP_MS && sameDay(previous.at, message.at);
    const row = el("li", `msg${message.user.admin ? " admin" : ""}${grouped ? " grouped" : ""}`);
    row.dataset.id = message.id;

    row.append(grouped ? el("span", "spacer-avatar") : avatar(message.user));
    const content = el("div", "content");
    if (!grouped) {
      const head = el("div", "head");
      head.append(el("span", `name${message.user.admin ? " admin" : ""}`, message.user.username));
      if (message.user.admin) head.append(adminBadge());
      head.append(el("span", "time", clock(message.at)));
      content.append(head);
    }
    if (message.text) content.append(el("div", "text", message.text));
    if (message.media) content.append(mediaNode(message.media));
    row.append(content);

    if (state.me?.admin) {
      const tools = el("div", "tools");
      const del = el("button", "", "Delete");
      del.type = "button";
      del.title = "Delete this message";
      del.addEventListener("click", () => deleteMessage(message, del));
      tools.append(del);
      if (!message.user.admin) {
        const mod = el("button", "", "Moderate…");
        mod.type = "button";
        mod.title = `Time out or ban ${message.user.username}`;
        mod.addEventListener("click", () => openModerate(message.user));
        tools.append(mod);
      }
      row.append(tools);
    }
    return row;
  }

  function mediaNode(media) {
    const src = media.kind === "giphy" ? `${API}/giphy/${encodeURIComponent(media.id)}/full` : `${API}/media/${encodeURIComponent(media.id)}`;
    const img = el("img", "gif");
    img.alt = "GIF";
    img.loading = "lazy";
    img.addEventListener("load", () => { if (state.atBottom) scrollToEnd(); }, { once: true });
    img.addEventListener("error", () => img.replaceWith(el("div", "gif-missing", "[GIF unavailable]")), { once: true });
    img.src = src;
    return img;
  }

  function renderAll() {
    const list = $("list");
    const keepAtBottom = state.atBottom;
    list.textContent = "";
    let previous = null;
    for (const message of state.messages) {
      if (!previous || !sameDay(previous.at, message.at)) {
        const day = el("li", "day", dayLabel(message.at));
        day.setAttribute("role", "separator");
        list.append(day);
        previous = null;
      }
      list.append(messageNode(message, previous));
      previous = message;
    }
    $("empty").hidden = state.messages.length > 0;
    $("older").hidden = !state.hasOlder;
    if (keepAtBottom) scrollToEnd();
  }

  function addMessage(message) {
    if (state.messages.some((existing) => existing.id === message.id)) return;
    const previous = state.messages.at(-1) ?? null;
    state.messages.push(message);
    if (state.messages.length > KEEP && state.atBottom) { state.messages.shift(); state.hasOlder = true; return renderAll(); }
    const list = $("list");
    if (!previous || !sameDay(previous.at, message.at)) {
      const day = el("li", "day", dayLabel(message.at));
      day.setAttribute("role", "separator");
      list.append(day);
      list.append(messageNode(message, null));
    } else {
      list.append(messageNode(message, previous));
    }
    $("empty").hidden = true;
    if (state.atBottom || message.user.username === state.me?.username) scrollToEnd();
    else $("jump").hidden = false;
  }

  function renderOnline() {
    $("online-count").textContent = String(state.online.length);
    const list = $("online");
    list.textContent = "";
    for (const person of state.online) {
      const item = el("li");
      const row = el("button");
      row.type = "button";
      row.append(avatar(person, "small"), el("span", `who${person.admin ? " admin" : ""}`, person.username));
      if (person.admin) row.append(adminBadge());
      if (state.me?.admin && !person.admin && person.username !== state.me.username) {
        row.dataset.action = "moderate";
        row.title = `Moderate ${person.username}`;
        row.addEventListener("click", () => openModerate(person));
      }
      item.append(row);
      list.append(item);
    }
  }

  // --- scrolling ---------------------------------------------------------------------------------

  const scroller = $("messages");
  function scrollToEnd() {
    scroller.scrollTop = scroller.scrollHeight;
    state.atBottom = true;
    $("jump").hidden = true;
  }
  scroller.addEventListener("scroll", () => {
    state.atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    if (state.atBottom) $("jump").hidden = true;
  });
  $("jump").addEventListener("click", () => scrollToEnd());

  $("older").addEventListener("click", async () => {
    const oldest = state.messages[0]?.id;
    if (!oldest) return;
    $("older").disabled = true;
    try {
      const { messages } = await api("GET", `/messages?before=${oldest}&limit=60`);
      const height = scroller.scrollHeight;
      state.messages = messages.concat(state.messages);
      state.hasOlder = messages.length >= 60;
      state.atBottom = false;
      renderAll();
      scroller.scrollTop = scroller.scrollHeight - height; // keep what you were reading in place
    } catch (err) {
      showNotice(err.message);
    } finally {
      $("older").disabled = false;
    }
  });

  // --- banner, notice and the composer's state ------------------------------------------------------

  function showBanner(message, kind = "") {
    const banner = $("banner");
    banner.hidden = !message;
    banner.textContent = message || "";
    if (kind) banner.dataset.kind = kind; else delete banner.dataset.kind;
  }

  let noticeTimer = null;
  function showNotice(message) {
    const notice = $("notice");
    notice.textContent = message;
    notice.hidden = !message;
    clearTimeout(noticeTimer);
    if (message) noticeTimer = setTimeout(() => { notice.hidden = true; }, 7000);
  }

  function sanctionText(sanction) {
    if (sanction.kind === "ban") return `You are banned from the chat.${sanction.reason ? ` Reason: ${sanction.reason}` : ""}`;
    const minutes = Math.max(1, Math.ceil((sanction.until - Date.now()) / 60_000));
    return `You are timed out for ${minutes} more minute${minutes === 1 ? "" : "s"}.${sanction.reason ? ` Reason: ${sanction.reason}` : ""}`;
  }

  function canPost() {
    if (!state.settings || !state.me) return false;
    if (state.sanction && (state.sanction.kind === "ban" || state.sanction.until > Date.now())) return false;
    if (!state.settings.enabled && !state.me.admin) return false;
    if (state.settings.locked && !state.me.admin) return false;
    return true;
  }

  function renderComposerState() {
    if (!state.settings || !state.me) return;
    const s = state.settings;
    const active = state.sanction && (state.sanction.kind === "ban" || state.sanction.until > Date.now());
    if (state.sanction && !active) state.sanction = null;
    let banner = "", kind = "";
    if (active) { banner = sanctionText(state.sanction); kind = "danger"; }
    else if (!s.enabled) { banner = state.me.admin ? "The chat is turned off. Only admins can see it." : "The chat is turned off by an admin."; kind = "danger"; }
    else if (s.locked) { banner = state.me.admin ? "The chat is locked: only admins can post." : "The chat is locked: only admins can post right now."; }
    showBanner(banner, kind);
    if (active) showNotice(""); // the banner says it better than an old error

    const allowed = canPost();
    $("text").disabled = !allowed;
    $("text").placeholder = allowed ? "Message everyone" : "You can't post right now";
    $("gif-btn").hidden = !s.gifs;
    $("emoji-btn").disabled = !allowed;
    $("gif-btn").disabled = !allowed;
    $("text").maxLength = s.maxLength * 2; // the server counts; this only stops a runaway paste
    updateSend();
    updateCount();
    if (!allowed) closePopups();
  }
  // The timeout banner counts down.
  setInterval(() => { if (state.me && state.settings && state.sanction) renderComposerState(); }, 15_000);

  function updateSend() {
    const send = $("send");
    const cooling = state.cooldownUntil > Date.now();
    send.disabled = !canPost() || cooling || sending;
    send.textContent = cooling ? `${Math.ceil((state.cooldownUntil - Date.now()) / 1000)}s` : "Send";
  }
  setInterval(() => { if (state.cooldownUntil && state.cooldownUntil <= Date.now() + 1000) { updateSend(); if (state.cooldownUntil <= Date.now()) state.cooldownUntil = 0; } }, 250);

  // --- sending -------------------------------------------------------------------------------------------

  let sending = false;
  const text = $("text");

  function updateCount() {
    const length = [...text.value].length;
    const max = state.settings?.maxLength ?? 500;
    $("count").hidden = length < max - 100;
    $("count").textContent = `${length}/${max}`;
    $("count").dataset.over = String(length > max);
  }

  const MAX_HEIGHT = 110; // about four lines
  function autosize() {
    text.style.height = "auto";
    const wanted = text.scrollHeight;
    // Hidden (the chat is still connecting) it measures 0: leave the box at its normal height.
    if (!wanted) { text.style.height = ""; return; }
    text.style.height = `${Math.min(wanted, MAX_HEIGHT)}px`;
    // A scrollbar only when the text really is taller than the box (some browsers draw
    // one, arrows and all, for a single line otherwise).
    text.style.overflowY = wanted > MAX_HEIGHT ? "auto" : "hidden";
  }
  text.addEventListener("input", () => { autosize(); updateCount(); });
  text.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); $("composer").requestSubmit(); }
  });

  async function send(body, { clear = false } = {}) {
    if (sending || !canPost()) return false;
    sending = true;
    updateSend();
    try {
      const { message } = await api("POST", "/messages", body);
      addMessage(message);
      if (clear) { text.value = ""; autosize(); updateCount(); }
      if (state.settings.slowSeconds && !state.me.admin) state.cooldownUntil = Date.now() + state.settings.slowSeconds * 1000;
      showNotice("");
      return true;
    } catch (err) {
      if (err.data?.sanction) { state.sanction = err.data.sanction; renderComposerState(); }
      showNotice(err.message);
      return false;
    } finally {
      sending = false;
      updateSend();
      if (!$("text").disabled) text.focus();
    }
  }

  $("composer").addEventListener("submit", (event) => {
    event.preventDefault();
    const value = text.value.trim();
    if (value) send({ text: value }, { clear: true });
  });

  // --- emoji picker -------------------------------------------------------------------------------------------

  const RECENT_KEY = "chatRecentEmoji";
  const recent = () => { try { return JSON.parse(SnStore.get(RECENT_KEY) || "[]").filter((e) => typeof e === "string").slice(0, 24); } catch { return []; } };

  let emojiTab = "recent";
  function renderEmoji() {
    const categories = [{ id: "recent", label: "Recently used", icon: "🕘", list: recent() }, ...CHAT_EMOJI.map((c) => ({ ...c, list: c.list.split(" ") }))];
    const tabs = $("emoji-tabs");
    tabs.textContent = "";
    if (emojiTab === "recent" && !categories[0].list.length) emojiTab = "smileys";
    for (const category of categories) {
      if (category.id === "recent" && !category.list.length) continue;
      const tab = el("button", "", category.icon);
      tab.type = "button";
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(category.id === emojiTab));
      tab.setAttribute("aria-label", category.label);
      tab.title = category.label;
      tab.addEventListener("click", () => { emojiTab = category.id; renderEmoji(); });
      tabs.append(tab);
    }
    const grid = $("emoji-grid");
    grid.textContent = "";
    const current = categories.find((category) => category.id === emojiTab) ?? categories[1];
    grid.append(el("div", "cat", current.label));
    for (const emoji of current.list) {
      const button = el("button", "", emoji);
      button.type = "button";
      button.setAttribute("role", "option");
      button.addEventListener("click", () => insertEmoji(emoji));
      grid.append(button);
    }
    grid.scrollTop = 0;
  }

  function insertEmoji(emoji) {
    const start = text.selectionStart ?? text.value.length, end = text.selectionEnd ?? start;
    text.value = text.value.slice(0, start) + emoji + text.value.slice(end);
    text.selectionStart = text.selectionEnd = start + emoji.length;
    autosize();
    updateCount();
    text.focus();
    try { SnStore.set(RECENT_KEY, JSON.stringify([emoji, ...recent().filter((e) => e !== emoji)].slice(0, 24))); } catch { /* storage blocked */ }
  }

  // --- GIF picker ---------------------------------------------------------------------------------------------------

  let gifTab = "search", gifSearchTimer = null, gifRequest = 0;

  function setGifTab(tab) {
    gifTab = tab;
    for (const [name, button] of [["search", $("gif-tab-search")], ["upload", $("gif-tab-upload")]]) button.setAttribute("aria-selected", String(name === tab));
    $("gif-search").hidden = tab !== "search";
    $("gif-upload").hidden = tab !== "upload";
    if (tab === "search") loadGifs();
  }

  async function loadGifs() {
    const grid = $("gif-grid"), message = $("gif-msg");
    if (!state.settings?.giphy) {
      grid.textContent = "";
      message.hidden = false;
      message.textContent = state.me?.admin
        ? "GIF search isn't set up. Add a GIPHY_API_KEY on the server to turn it on. You can still upload GIFs."
        : "GIF search isn't set up on this site. You can upload a GIF instead.";
      return;
    }
    const request = ++gifRequest;
    message.hidden = false;
    message.textContent = "Loading…";
    try {
      const { gifs } = await api("GET", `/gifs?q=${encodeURIComponent($("gif-q").value.trim())}`);
      if (request !== gifRequest) return;
      grid.textContent = "";
      message.hidden = gifs.length > 0;
      message.textContent = gifs.length ? "" : "No GIFs found.";
      for (const gif of gifs) {
        const button = el("button");
        button.type = "button";
        button.title = gif.title;
        const img = el("img");
        img.alt = gif.title || "GIF";
        img.loading = "lazy";
        img.src = `${API}/giphy/${encodeURIComponent(gif.id)}/thumb`;
        button.append(img);
        button.addEventListener("click", async () => { if (await send({ gif: { giphy: gif.id } })) closePopups(); });
        grid.append(button);
      }
    } catch (err) {
      if (request !== gifRequest) return;
      grid.textContent = "";
      message.hidden = false;
      message.textContent = err.message;
    }
  }

  $("gif-q").addEventListener("input", () => { clearTimeout(gifSearchTimer); gifSearchTimer = setTimeout(loadGifs, 350); });
  $("gif-tab-search").addEventListener("click", () => setGifTab("search"));
  $("gif-tab-upload").addEventListener("click", () => setGifTab("upload"));

  let pendingGif = null;
  function readAsBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("That file could not be read."));
      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
      reader.readAsDataURL(blob);
    });
  }

  $("gif-file").addEventListener("change", async () => {
    const file = $("gif-file").files[0], message = $("gif-upload-msg");
    pendingGif = null;
    $("gif-preview").hidden = true;
    message.hidden = true;
    if (!file) return;
    if (file.type !== "image/gif") { message.hidden = false; message.textContent = "That isn't a GIF."; return; }
    if (file.size > GIF_MAX_BYTES) { message.hidden = false; message.textContent = "GIFs can be up to 2 MB."; return; }
    try {
      pendingGif = await readAsBase64(file);
      $("gif-preview-img").src = `data:image/gif;base64,${pendingGif}`;
      $("gif-preview").hidden = false;
    } catch (err) {
      message.hidden = false;
      message.textContent = err.message;
    }
  });

  $("gif-send").addEventListener("click", async () => {
    if (!pendingGif) return;
    $("gif-send").disabled = true;
    try {
      if (await send({ gif: { data: pendingGif } })) { pendingGif = null; $("gif-file").value = ""; $("gif-preview").hidden = true; closePopups(); }
    } finally { $("gif-send").disabled = false; }
  });

  // --- opening and closing the pop-ups -----------------------------------------------------------------------------------

  function closePopups() {
    for (const [popup, button] of [[$("emoji-pop"), $("emoji-btn")], [$("gif-pop"), $("gif-btn")]]) {
      popup.hidden = true;
      button.setAttribute("aria-expanded", "false");
    }
  }

  function togglePopup(popup, button, onOpen) {
    const wasOpen = !popup.hidden;
    closePopups();
    if (wasOpen) return;
    popup.hidden = false;
    button.setAttribute("aria-expanded", "true");
    onOpen?.();
  }

  $("emoji-btn").addEventListener("click", () => togglePopup($("emoji-pop"), $("emoji-btn"), renderEmoji));
  $("gif-btn").addEventListener("click", () => togglePopup($("gif-pop"), $("gif-btn"), () => { setGifTab(gifTab); if (gifTab === "search") $("gif-q").focus(); }));
  document.addEventListener("mousedown", (event) => {
    if (event.target.closest(".popup, #emoji-btn, #gif-btn")) return;
    closePopups();
  });
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && (!$("emoji-pop").hidden || !$("gif-pop").hidden)) { closePopups(); text.focus(); } });

  $("online-toggle").addEventListener("click", () => {
    const show = $("side").hidden;
    $("side").hidden = !show;
    $("online-toggle").setAttribute("aria-pressed", String(show));
    try { SnStore.set("chatOnlineList", show ? "1" : "0"); } catch { /* storage blocked */ }
  });
  if (SnStore.get("chatOnlineList") === "0") { $("side").hidden = true; $("online-toggle").setAttribute("aria-pressed", "false"); }

  // --- your profile ----------------------------------------------------------------------------------------------------
  // The picture itself is changed in Settings > Account (and arrives here as an update to the online list).

  function openProfile() {
    paintAvatar($("profile-avatar"), state.me);
    $("profile-name").textContent = state.me.username;
    $("profile-badge-slot").textContent = "";
    if (state.me.admin) $("profile-badge-slot").append(adminBadge());
    $("profile").showModal();
  }
  $("me").addEventListener("click", openProfile);
  $("profile-close").addEventListener("click", () => $("profile").close());
  $("profile-settings").addEventListener("click", () => {
    $("profile").close();
    try { if (desktop && desktop.openSettings) return void desktop.openSettings("account"); } catch { /* fall through */ }
    window.open("/apps/settings.html#account", "_blank");
  });

  /** Someone's picture changed: update everything on the page that shows it. */
  function applyAvatars(online) {
    let changed = false;
    for (const person of online) {
      if (person.username === state.me?.username && state.me.avatar !== person.avatar) {
        state.me.avatar = person.avatar;
        renderMe();
        if ($("profile").open) paintAvatar($("profile-avatar"), state.me);
      }
      for (const message of state.messages) {
        if (message.user.username === person.username && message.user.avatar !== person.avatar) { message.user.avatar = person.avatar; changed = true; }
      }
    }
    if (changed) renderAll();
  }

  // --- notifications ------------------------------------------------------------------------------------------------------
  // The pop-ups belong to the desktop around this window (notify.js, chatwatch.js). This only
  // turns the Chat's notifications on and off; how they look is Settings > Notifications.

  const notifier = (() => { try { return desktop && desktop.SnNotify ? desktop.SnNotify : null; } catch { return null; } })();

  function renderNotifyState() {
    const settings = SnNotifyCore.settings();
    $("chat-notify").checked = settings.chat;
    $("notify-open").dataset.on = String(settings.chat && settings.enabled && !settings.dnd);
    let note = "";
    if (settings.chat && !settings.enabled) note = "All notifications are turned off in Settings > Notifications, so none will show.";
    else if (settings.chat && settings.dnd) note = "Do not disturb is on, so none will show for now.";
    else if (settings.chat && !notifier) note = "Notifications show on the desktop. Open the Chat from the desktop to get them.";
    status($("chat-notify-note"), note);
    $("chat-notify-test").hidden = !notifier;
    $("chat-notify-settings").hidden = !desktop;
  }

  $("notify-open").addEventListener("click", () => { renderNotifyState(); $("chat-settings").showModal(); });
  $("chat-settings-close").addEventListener("click", () => $("chat-settings").close());
  $("chat-notify").addEventListener("change", () => { SnStore.set("notifyChat", $("chat-notify").checked ? "1" : "0"); renderNotifyState(); });
  SnStore.onChange((key) => { if (key === "*" || key.startsWith("notify")) renderNotifyState(); });
  $("chat-notify-test").addEventListener("click", () => {
    const name = state.me?.username ?? "You";
    const shown = notifier?.show({
      app: "Messaging app",
      icon: "chat",
      title: name,
      text: "This is what a Chat notification looks like.",
      picture: { url: state.me ? SnAccount.avatarUrl(state.me.username, state.me.avatar) : "", letter: name.charAt(0).toUpperCase(), color: SnNotifyCore.avatarColor(name) },
    });
    if (!shown) status($("chat-notify-note"), "Nothing was shown, because notifications are off or Do not disturb is on in Settings.", "error");
  });
  $("chat-notify-settings").addEventListener("click", () => {
    $("chat-settings").close();
    try { if (desktop && desktop.openSettings) desktop.openSettings("notifications"); } catch { /* not on the desktop */ }
  });
  renderNotifyState();

  // --- moderation: single messages and people -------------------------------------------------------------------------------------------

  let armed = null;
  /** Two-step buttons: the first click asks, the second does it. */
  function confirmTwice(button, label, action) {
    if (armed && armed.button === button) { clearTimeout(armed.timer); const done = armed; armed = null; button.textContent = done.label; return action(); }
    if (armed) { clearTimeout(armed.timer); armed.button.textContent = armed.label; }
    armed = { button, label: button.textContent, timer: setTimeout(() => { button.textContent = armed?.label ?? label; armed = null; }, 4000) };
    button.textContent = "Sure? Click again";
  }

  async function deleteMessage(message, button) {
    button.disabled = true;
    try { await api("POST", `/admin/messages/${message.id}/delete`, {}); } catch (err) { showNotice(err.message); button.disabled = false; }
  }

  function openModerate(user) {
    state.moderating = user;
    $("moderate-title").textContent = `Moderate ${user.username}`;
    $("moderate-who").textContent = "Timeouts and chat bans stop them posting. They can still read the chat and use the rest of the site.";
    $("moderate-reason").value = "";
    $("moderate-purge").checked = true;
    status($("moderate-status"), "");
    $("moderate").showModal();
  }

  $("moderate-close").addEventListener("click", () => $("moderate").close());
  $("moderate-apply").addEventListener("click", async () => {
    const choice = $("moderate-duration").value, name = encodeURIComponent(state.moderating.username);
    const body = { reason: $("moderate-reason").value, purge: $("moderate-purge").checked };
    if (choice !== "ban") body.minutes = Number(choice);
    try {
      const result = await api("POST", `/admin/users/${name}/${choice === "ban" ? "ban" : "timeout"}`, body);
      status($("moderate-status"), `Done${result.removed ? `: ${result.removed} message${result.removed === 1 ? "" : "s"} removed` : ""}.`, "ok");
    } catch (err) { status($("moderate-status"), err.message, "error"); }
  });
  $("moderate-lift").addEventListener("click", async () => {
    try {
      await api("POST", `/admin/users/${encodeURIComponent(state.moderating.username)}/lift`, {});
      status($("moderate-status"), "Their timeout or ban was lifted.", "ok");
    } catch (err) { status($("moderate-status"), err.message, "error"); }
  });
  $("moderate-site").addEventListener("click", () => confirmTwice($("moderate-site"), "Ban from the whole site", async () => {
    try {
      await SnAccount.admin.ban(state.moderating.username, $("moderate-reason").value);
      status($("moderate-status"), `${state.moderating.username} is banned from the whole site and signed out.`, "ok");
    } catch (err) { status($("moderate-status"), err.message, "error"); }
  }));

  // --- the moderation panel -------------------------------------------------------------------------------------------------------------

  const panel = $("panel");

  function setPanelTab(tab) {
    status($("settings-status"), "");
    for (const button of panel.querySelectorAll(".tab")) button.setAttribute("aria-selected", String(button.dataset.tab === tab));
    for (const name of ["settings", "sanctions", "log"]) $(`tab-${name}`).hidden = name !== tab;
    if (tab === "settings") loadSettings();
    if (tab === "sanctions") loadSanctions();
    if (tab === "log") loadLog();
  }
  for (const button of panel.querySelectorAll(".tab")) button.addEventListener("click", () => setPanelTab(button.dataset.tab));
  $("mod-open").addEventListener("click", () => { panel.showModal(); setPanelTab("settings"); });
  $("panel-close").addEventListener("click", () => panel.close());

  async function loadSettings() {
    try {
      const { settings } = await api("GET", "/admin/settings");
      $("set-enabled").checked = settings.enabled;
      $("set-locked").checked = settings.locked;
      $("set-gifs").checked = settings.gifs;
      $("set-slow").value = String(settings.slowSeconds);
      if ($("set-slow").value !== String(settings.slowSeconds)) { // a value that isn't in the list (set elsewhere)
        const option = el("option", "", `${settings.slowSeconds} seconds`);
        option.value = String(settings.slowSeconds);
        $("set-slow").append(option);
        $("set-slow").value = option.value;
      }
      $("set-links").value = settings.links;
      $("set-age").value = String(settings.minAccountMinutes);
      $("set-words").value = settings.words.join("\n");
    } catch (err) { status($("settings-status"), err.message, "error"); }
  }

  $("settings-save").addEventListener("click", async () => {
    try {
      await api("POST", "/admin/settings", {
        enabled: $("set-enabled").checked,
        locked: $("set-locked").checked,
        gifs: $("set-gifs").checked,
        slowSeconds: Number($("set-slow").value),
        links: $("set-links").value,
        minAccountMinutes: Number($("set-age").value) || 0,
        words: $("set-words").value.split("\n"),
      });
      await loadSettings();
      status($("settings-status"), "Saved. It applies to everyone at once.", "ok");
    } catch (err) { status($("settings-status"), err.message, "error"); }
  });

  $("clear-chat").addEventListener("click", () => confirmTwice($("clear-chat"), "Clear the whole chat", async () => {
    try {
      const { removed } = await api("POST", "/admin/clear", {});
      status($("settings-status"), `The chat was cleared (${removed} message${removed === 1 ? "" : "s"}).`, "ok");
    } catch (err) { status($("settings-status"), err.message, "error"); }
  }));

  function until(sanction) {
    if (sanction.kind === "ban") return "until lifted";
    const minutes = Math.max(1, Math.ceil((sanction.until - Date.now()) / 60_000));
    return minutes >= 120 ? `${Math.round(minutes / 60)} more hours` : `${minutes} more minute${minutes === 1 ? "" : "s"}`;
  }

  async function loadSanctions() {
    const list = $("sanction-list");
    list.textContent = "";
    try {
      const { sanctions } = await api("GET", "/admin/sanctions");
      if (!sanctions.length) { list.append(el("li", "", "Nobody is timed out or banned.")); return; }
      for (const sanction of sanctions) {
        const row = el("li");
        const info = el("div", "row-main");
        info.append(el("strong", "", sanction.username), ` ${sanction.kind === "ban" ? "banned from chat" : "timed out"} (${until(sanction)})`);
        info.append(el("small", "", `By ${sanction.by}${sanction.reason ? ` - ${sanction.reason}` : ""}`));
        const lift = el("button", "btn", "Lift");
        lift.type = "button";
        lift.addEventListener("click", async () => {
          try { await api("POST", `/admin/users/${encodeURIComponent(sanction.username)}/lift`, {}); loadSanctions(); } catch (err) { showNotice(err.message); }
        });
        row.append(info, lift);
        list.append(row);
      }
    } catch (err) { list.append(el("li", "", err.message)); }
  }

  async function loadLog() {
    const list = $("log-list");
    list.textContent = "";
    try {
      const { log } = await api("GET", "/admin/log?limit=100");
      if (!log.length) { list.append(el("li", "", "Nothing yet.")); return; }
      for (const entry of log) {
        const row = el("li");
        const info = el("div", "row-main");
        info.append(el("strong", "", entry.actor), ` ${entry.action}${entry.target ? ` - ${entry.target}` : ""}`);
        if (entry.detail) info.append(el("small", "", entry.detail));
        row.append(info, el("small", "", new Date(entry.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" })));
        list.append(row);
      }
    } catch (err) { list.append(el("li", "", err.message)); }
  }

  // Dialogs close with Escape (built in) and when you click the dimmed area around them.
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("mousedown", (event) => { if (event.target === dialog) dialog.close(); });
  }

  autosize();
  start();
})();
