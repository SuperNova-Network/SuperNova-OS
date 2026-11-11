/*
 * Friends app (the server side is src/friends.js and src/friendsdb.js). Everything people typed, and every
 * name, is put on the page with textContent, never as HTML.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const main = $("main");
  const desktop = (() => { try { return window.parent !== window ? window.parent : null; } catch { return null; } })();

  /** h("div", { class: "x", text: "hi", onclick: fn }, child, child...) */
  function h(tag, attrs = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
      else if (key === "value") node.value = value;
      else if (key === "checked" || key === "disabled" || key === "hidden") node[key] = true;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const kid of kids.flat()) if (kid !== undefined && kid !== null && kid !== false) node.append(kid);
    return node;
  }

  async function api(method, path, body) {
    let res;
    try {
      res = await fetch(`/api/friends${path}`, {
        method, credentials: "same-origin",
        headers: method === "POST" ? { "content-type": "application/json" } : {},
        body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
      });
    } catch { throw new Error("The server could not be reached."); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Something went wrong (${res.status}).`);
    return data;
  }

  let toastTimer = 0;
  function toast(message, kind = "") {
    const el = $("toast");
    el.textContent = message;
    if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  async function act(button, work, done) {
    if (button) button.disabled = true;
    try {
      const result = await work();
      if (done) toast(done, "ok");
      return result ?? true;
    } catch (err) {
      toast(err.message, "error");
      return false;
    } finally {
      if (button) button.disabled = false;
    }
  }

  const COLORS = ["#d9534f", "#e8892e", "#c9a227", "#43a047", "#16a085", "#2b8cd6", "#5c6bc0", "#8e44ad", "#d6457a", "#6d7b8a"];
  const colorFor = (name) => { let hash = 0; for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0; return COLORS[hash % COLORS.length]; };

  function avatar(person) {
    const box = h("span", { class: "avatar", "aria-hidden": "true" });
    const letter = () => { box.replaceChildren(person.username.charAt(0).toUpperCase()); box.style.background = colorFor(person.username); };
    const url = person.avatar ? SnAccount.avatarUrl(person.username, person.avatar) : "";
    if (!url) { letter(); return box; }
    const img = h("img", { alt: "" });
    img.addEventListener("error", letter, { once: true });
    img.src = url;
    box.append(img);
    return box;
  }

  const chip = (text, tone = "") => h("span", { class: `chip ${tone}`.trim(), text });

  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 3600) return "just now";
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  // --- dialogs --------------------------------------------------------------------------------

  const dialog = $("dialog");
  dialog.addEventListener("mousedown", (event) => { if (event.target === dialog) dialog.close(); });
  function confirmBox(title, message, { confirm = "OK", danger = false } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const bar = h("div", { class: "actions" },
        h("button", { class: "btn", type: "button", text: "Cancel", onclick: () => { answered = true; resolve(false); dialog.close(); } }),
        h("button", { class: `btn ${danger ? "danger" : "primary"}`, type: "button", text: confirm, onclick: () => { answered = true; resolve(true); dialog.close(); } }));
      dialog.replaceChildren(h("h2", { text: title }), h("p", { class: "dim", text: message }), bar);
      dialog.addEventListener("close", () => { if (!answered) resolve(false); }, { once: true });
      dialog.showModal();
    });
  }

  // --- state and navigation ---------------------------------------------------------------

  let me = null, data = null, current = "friends", timer = 0;
  const views = {};

  async function refresh() {
    data = await api("GET", "");
    $("mode").value = data.me.mode;
    const online = data.friends.filter((f) => f.status !== "offline").length;
    setCount("online-count", online, false);
    setCount("request-count", data.incoming.length, true);
  }

  function setCount(id, n, show) {
    const badge = $(id);
    badge.hidden = !n;
    badge.textContent = String(n);
  }

  async function show(name) {
    if (!views[name]) name = "friends";
    current = name;
    for (const item of document.querySelectorAll(".nav-item")) {
      if (item.dataset.view === name) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
    }
    if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
    try { await refresh(); } catch (err) { main.replaceChildren(h("p", { class: "status", "data-state": "error", text: err.message })); return; }
    draw();
  }

  function draw() { main.replaceChildren(...views[current]()); }
  for (const item of document.querySelectorAll(".nav-item")) item.addEventListener("click", () => show(item.dataset.view));
  addEventListener("hashchange", () => show(location.hash.slice(1)));

  const head = (title) => h("div", { class: "view-head" }, h("h2", { text: title }));

  /** Do something to a person, then show the new state. */
  async function doTo(button, path, person, done) {
    const ok = await act(button, () => api("POST", path, { username: person.username }), done);
    if (ok) { await refresh(); draw(); }
    return ok;
  }

  const STATUS_TEXT = { online: "Online", away: "Away", offline: "Offline" };

  function personRow(person, text, actions, { status = null } = {}) {
    return h("div", { class: `person${status === "offline" ? " offline" : ""}` },
      h("div", { class: "pic" }, avatar(person), status && h("span", { class: "dot", "data-status": status, title: STATUS_TEXT[status] })),
      h("div", { class: "text" }, h("div", { class: "name", text: person.username }, person.admin && chip("ADMIN", "admin")), h("div", { class: "sub", text: text })),
      h("div", { class: "actions" }, actions));
  }

  views.friends = () => {
    const input = h("input", { class: "field", placeholder: "Add a friend by username", maxlength: "32", autocomplete: "off", spellcheck: "false", "aria-label": "Username" });
    const send = h("button", { class: "btn primary", type: "button", text: "Send request" });
    const go = async () => {
      const name = input.value.trim();
      if (!name) return;
      const ok = await act(send, async () => {
        const r = await api("POST", "/request", { username: name });
        toast(r.result === "accepted" ? `You and ${name} are friends now.` : `Request sent to ${name}.`, "ok");
        return true;
      });
      if (ok) { input.value = ""; await refresh(); draw(); }
    };
    send.addEventListener("click", go);
    input.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });

    const online = data.friends.filter((f) => f.status !== "offline");
    const offline = data.friends.filter((f) => f.status === "offline");
    const row = (f) => personRow(f, f.status === "offline" ? "Offline" : STATUS_TEXT[f.status], [
      h("button", { class: "btn small", type: "button", text: "Remove", onclick: async (e) => { if (await confirmBox(`Remove ${f.username}?`, "You won't be friends any more. They aren't told.", { confirm: "Remove", danger: true })) doTo(e.target, "/remove", f, `${f.username} was removed.`); } }),
      h("button", { class: "btn small danger", type: "button", text: "Block", onclick: async (e) => { if (await confirmBox(`Block ${f.username}?`, "You stop being friends, and they can't send you requests. They aren't told.", { confirm: "Block", danger: true })) doTo(e.target, "/block", f, `${f.username} is blocked.`); } }),
    ], { status: f.status });
    return [
      head("Friends"),
      h("div", { class: "add" }, input, send),
      !data.friends.length && h("div", { class: "tablewrap" }, h("p", { class: "empty", text: "No friends yet. Add someone by their username, and they'll get a request." })),
      online.length > 0 && h("div", { class: "group", text: `Online, ${online.length}` }),
      online.length > 0 && h("div", { class: "people" }, online.map(row)),
      offline.length > 0 && h("div", { class: "group", text: `Offline, ${offline.length}` }),
      offline.length > 0 && h("div", { class: "people" }, offline.map(row)),
    ].filter(Boolean);
  };

  views.requests = () => {
    const incoming = data.incoming.map((p) => personRow(p, `Asked ${ago(p.at)}`, [
      h("button", { class: "btn small primary", type: "button", text: "Accept", onclick: (e) => doTo(e.target, "/accept", p, `You and ${p.username} are friends now.`) }),
      h("button", { class: "btn small", type: "button", text: "Decline", onclick: (e) => doTo(e.target, "/decline", p) }),
      h("button", { class: "btn small danger", type: "button", text: "Block", onclick: async (e) => { if (await confirmBox(`Block ${p.username}?`, "They can't send you requests. They aren't told.", { confirm: "Block", danger: true })) doTo(e.target, "/block", p, `${p.username} is blocked.`); } }),
    ]));
    const outgoing = data.outgoing.map((p) => personRow(p, `You asked ${ago(p.at)}`, [
      h("button", { class: "btn small", type: "button", text: "Cancel", onclick: (e) => doTo(e.target, "/cancel", p) }),
    ]));
    return [
      head("Requests"),
      !incoming.length && !outgoing.length && h("div", { class: "tablewrap" }, h("p", { class: "empty", text: "No requests right now." })),
      incoming.length > 0 && h("div", { class: "group", text: "Asking to be your friend" }),
      incoming.length > 0 && h("div", { class: "people" }, incoming),
      outgoing.length > 0 && h("div", { class: "group", text: "Waiting for an answer" }),
      outgoing.length > 0 && h("div", { class: "people" }, outgoing),
    ].filter(Boolean);
  };

  views.blocked = () => [
    head("Blocked"),
    h("p", { class: "dim section", text: "People you blocked can't send you requests, and they aren't told." }),
    data.blocked.length
      ? h("div", { class: "people" }, data.blocked.map((p) => personRow(p, "Blocked", [h("button", { class: "btn small", type: "button", text: "Unblock", onclick: (e) => doTo(e.target, "/unblock", p, `${p.username} is unblocked.`) })])))
      : h("div", { class: "tablewrap" }, h("p", { class: "empty", text: "You haven't blocked anyone." })),
  ];

  $("mode").addEventListener("change", async () => {
    const ok = await act($("mode"), () => api("POST", "/status", { mode: $("mode").value }));
    if (!ok) await refresh();
    toast(`You show as ${$("mode").value === "invisible" ? "offline to your friends" : $("mode").value}.`, "ok");
  });

  // --- the Reveal glow, like Settings ---------------------------------------------------------

  {
    const REVEAL = ".nav-item, .person, .btn";
    const REACH = 150;
    const mark = () => document.querySelectorAll(REVEAL).forEach((el) => el.classList.add("reveal"));
    mark();
    let pointer = null, frame = 0;
    const paint = () => {
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
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(paint); };
    document.addEventListener("pointermove", (event) => { pointer = { x: event.clientX, y: event.clientY }; schedule(); }, { passive: true });
    document.addEventListener("pointerleave", () => { pointer = null; schedule(); });
    new MutationObserver(mark).observe(document.body, { childList: true, subtree: true });
  }

  // --- start ----------------------------------------------------------------------------------

  function gate(title, text, signIn = false) {
    $("app").hidden = true;
    $("gate").hidden = false;
    $("gate-title").textContent = title;
    $("gate-text").textContent = text;
    $("gate-signin").hidden = !signIn;
  }
  $("gate-signin").addEventListener("click", () => {
    try { if (desktop?.openSettings) return void desktop.openSettings("account"); } catch { /* fall through */ }
    window.open("/apps/settings.html#account", "_blank");
  });

  (async () => {
    let state;
    try { state = await SnAccount.status(true); } catch { return gate("Friends", "The server could not be reached."); }
    if (!state.user) return gate("Sign in first", "Friends are for people with an account on this site. Sign in to add friends and see who is online.", true);
    me = state.user;
    try { await refresh(); } catch (err) { return gate("Friends", err.message); }
    $("gate").hidden = true;
    $("app").hidden = false;
    $("nav-foot").textContent = `Signed in as ${me.username}`;
    show(location.hash.slice(1) || "friends");
    // Keep the list fresh while the window is open (the person typing in the box isn't interrupted).
    timer = setInterval(async () => {
      if (document.hidden || dialog.open || document.activeElement?.tagName === "INPUT" || document.activeElement === $("mode")) return;
      try { await refresh(); draw(); } catch { /* try again next time */ }
    }, 15000);
  })();
})();
