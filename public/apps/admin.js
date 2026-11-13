/*
 * Admin Panel app (the server side is src/admin.js, src/admindb.js and the admin routes of
 * src/accounts.js and src/chat.js). Everything people typed, and every name, is put on the
 * page with textContent, never as HTML.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const main = $("main");
  const desktop = (() => { try { return window.parent !== window ? window.parent : null; } catch { return null; } })();

  // ---------------------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------------------

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
      res = await fetch(path, {
        method, credentials: "same-origin",
        headers: body !== undefined ? { "content-type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch { throw new Error("The server could not be reached."); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const error = new Error(data.error || `Something went wrong (${res.status}).`); error.status = res.status; throw error; }
    return data;
  }
  const A = (method, path, body) => api(method, `/api/admin${path}`, body);
  const query = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== "" && v != null && v !== false)).toString();

  let toastTimer = 0;
  function toast(message, kind = "") {
    const el = $("toast");
    el.textContent = message;
    if (kind) el.dataset.kind = kind; else delete el.dataset.kind;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  /** Run an action with a button disabled meanwhile; failures become a toast. */
  async function act(button, work, done) {
    if (button) button.disabled = true;
    try {
      const result = await work();
      if (done) toast(done, "ok");
      return result;
    } catch (err) {
      toast(err.message, "error");
      return undefined;
    } finally {
      if (button) button.disabled = false;
    }
  }

  const pad = (n) => String(n).padStart(2, "0");
  const dateTime = (ms) => { if (!ms) return "never"; const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function ago(ms) {
    if (!ms) return "never";
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 45) return "just now";
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 60) return `${Math.round(s / 86400)} d ago`;
    return dateTime(ms).slice(0, 10);
  }
  function inFuture(ms) {
    if (!ms) return "never";
    const s = Math.round((ms - Date.now()) / 1000);
    if (s <= 0) return "expired";
    if (s < 3600) return `in ${Math.round(s / 60)} min`;
    if (s < 86400) return `in ${Math.round(s / 3600)} h`;
    return `in ${Math.round(s / 86400)} d`;
  }
  const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
  const duration = (s) => { const d = Math.floor(s / 86400), hr = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m ${s % 60}s`; };
  const number = (n) => Number(n ?? 0).toLocaleString();

  const COLORS = ["#d9534f", "#e8892e", "#c9a227", "#43a047", "#16a085", "#2b8cd6", "#5c6bc0", "#8e44ad", "#d6457a", "#6d7b8a"];
  function colorFor(name) { let hash = 0; for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) >>> 0; return COLORS[hash % COLORS.length]; }
  function avatar(name, version, big = false) {
    const box = h("span", { class: `avatar${big ? " big" : ""}`, "aria-hidden": "true" });
    const letter = () => { box.replaceChildren(name.charAt(0).toUpperCase()); box.style.background = colorFor(name); };
    const url = version ? SnAccount.avatarUrl(name, version) : "";
    if (!url) { letter(); return box; }
    const img = h("img", { alt: "" });
    img.addEventListener("error", letter, { once: true });
    img.src = url;
    box.append(img);
    return box;
  }

  const chip = (text, tone = "") => h("span", { class: `chip ${tone}`.trim(), text });
  const dateCell = (ms) => h("td", { title: dateTime(ms), text: ago(ms) });

  // ---------------------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------------------

  const dialog = $("dialog"), dialog2 = $("dialog2");
  /** Show a dialog. One opened over another (a question inside "Manage account") stacks on top. */
  function showDialog({ title, body, actions = [], wide = false }) {
    const d = dialog.open ? dialog2 : dialog;
    const bar = h("div", { class: "actions" });
    for (const action of actions) {
      const button = h("button", { class: `btn ${action.kind ?? ""}`.trim(), type: "button", text: action.label });
      button.addEventListener("click", async () => {
        if (!action.onClick) return d.close();
        button.disabled = true;
        try { if ((await action.onClick(button)) !== false) d.close(); } finally { button.disabled = false; }
      });
      bar.append(button);
    }
    d.replaceChildren(h("h2", { text: title }), body, bar);
    d.classList.toggle("wide", wide);
    d.showModal();
    return d;
  }
  /** Close every dialog. */
  function closeDialog() { for (const d of [dialog2, dialog]) if (d.open) d.close(); }
  for (const d of [dialog, dialog2]) d.addEventListener("mousedown", (event) => { if (event.target === d) d.close(); });

  /** Ask yes or no. */
  function confirmBox(title, message, { confirm = "OK", danger = false } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (value) => { answered = true; resolve(value); };
      const d = showDialog({ title, body: h("p", { class: "dim", text: message }), actions: [
        { label: "Cancel", onClick: () => done(false) },
        { label: confirm, kind: danger ? "danger" : "primary", onClick: () => done(true) },
      ] });
      d.addEventListener("close", () => { if (!answered) resolve(false); }, { once: true });
    });
  }

  /** Ask for a line of text. Resolves to the text, or null if cancelled. */
  function askText(title, label, { value = "", type = "text", hint = "", confirm = "OK", danger = false, validate } = {}) {
    return new Promise((resolve) => {
      let answered = false;
      const input = h("input", { class: "field", type, value, autocomplete: "off", spellcheck: "false" });
      const note = h("p", { class: "status" });
      const body = h("div", {}, h("label", { class: "labeled" }, h("span", { text: label }), input), hint && h("p", { class: "faint small", text: hint }), note);
      const d = showDialog({ title, body, actions: [
        { label: "Cancel", onClick: () => { answered = true; resolve(null); } },
        { label: confirm, kind: danger ? "danger" : "primary", onClick: () => {
          const problem = validate?.(input.value);
          if (problem) { note.textContent = problem; note.dataset.state = "error"; return false; }
          answered = true; resolve(input.value);
        } },
      ] });
      d.addEventListener("close", () => { if (!answered) resolve(null); }, { once: true });
      input.focus();
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") d.querySelector(".actions .btn:last-child").click(); });
    });
  }

  // ---------------------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------------------

  const views = {};
  let current = "";
  let leave = null; // what to stop when leaving the current view (timers)

  async function show(name) {
    if (!views[name]) name = "dashboard";
    leave?.(); leave = null;
    current = name;
    for (const item of document.querySelectorAll(".nav-item")) {
      if (item.dataset.view === name) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
    }
    main.replaceChildren(h("p", { class: "dim", text: "Loading…" }));
    main.scrollTop = 0;
    if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
    try {
      const result = await views[name]();
      if (current !== name) return;
      leave = result?.leave ?? null;
    } catch (err) {
      if (current === name) main.replaceChildren(h("p", { class: "status", "data-state": "error", text: err.message }));
    }
  }
  for (const item of document.querySelectorAll(".nav-item")) item.addEventListener("click", () => show(item.dataset.view));
  addEventListener("hashchange", () => show(location.hash.slice(1)));

  const head = (title, ...tools) => h("div", { class: "view-head" }, h("h2", { text: title }), ...tools);
  const table = (columns, rows, empty = "Nothing here.") => {
    if (!rows.length) return h("div", { class: "tablewrap" }, h("p", { class: "empty", text: empty }));
    return h("div", { class: "tablewrap" }, h("table", {}, h("thead", {}, h("tr", {}, columns.map((c) => (typeof c === "string" ? h("th", { text: c }) : c)))), h("tbody", {}, rows)));
  };
  const pager = (state, total, pageSize, reload) => {
    const pages = Math.max(1, Math.ceil(total / pageSize));
    return h("div", { class: "pager" },
      h("span", { text: `${number(total)} in all · page ${state.page} of ${pages}` }),
      h("button", { class: "btn small", type: "button", text: "Previous", disabled: state.page <= 1, onclick: () => { state.page--; reload(); } }),
      h("button", { class: "btn small", type: "button", text: "Next", disabled: state.page >= pages, onclick: () => { state.page++; reload(); } }));
  };

  // ---------------------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------------------

  function bars(values, label) {
    const max = Math.max(1, ...values);
    const w = 280, hgt = 80, gap = 3, bw = (w - gap * (values.length - 1)) / values.length;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${w} ${hgt + 14}`);
    svg.setAttribute("class", "bars");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${label}: ${values.join(", ")}`);
    values.forEach((value, i) => {
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const barHeight = value ? Math.max(2, (value / max) * hgt) : 1;
      rect.setAttribute("x", String(i * (bw + gap)));
      rect.setAttribute("y", String(hgt - barHeight));
      rect.setAttribute("width", String(bw));
      rect.setAttribute("height", String(barHeight));
      const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
      const day = new Date(Date.now() - (values.length - 1 - i) * 86400000);
      title.textContent = `${day.toLocaleDateString([], { month: "short", day: "numeric" })}: ${value}`;
      rect.append(title);
      svg.append(rect);
    });
    for (const [i, text] of [[0, `${values.length - 1} days ago`], [values.length - 1, "today"]]) {
      const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
      t.setAttribute("x", String(i === 0 ? 0 : w));
      t.setAttribute("y", String(hgt + 11));
      t.setAttribute("text-anchor", i === 0 ? "start" : "end");
      t.textContent = text;
      svg.append(t);
    }
    return svg;
  }

  const tile = (num, label, sub, tone) => h("div", { class: "tile", "data-tone": tone }, h("div", { class: "num", text: number(num) }), h("div", { class: "label", text: label }), sub && h("div", { class: "sub", text: sub }));

  views.dashboard = async () => {
    const draw = async () => {
      const d = await A("GET", "/overview");
      if (current !== "dashboard") return;
      const r = d.runtime;
      main.replaceChildren(
        head("Dashboard", h("button", { class: "btn", type: "button", text: "Refresh", onclick: () => draw().catch((e) => toast(e.message, "error")) })),
        h("div", { class: "tiles section" },
          tile(d.users.total, "Accounts", `${d.users.today} new today, ${d.users.week} this week`),
          tile(d.users.active, "Active in 24 hours", "signed in or used the site"),
          tile(r.chat.online, "In the chat now", `${r.chat.quietStreams} listening for notifications`, r.chat.online ? "green" : ""),
          tile(r.wisp, "Proxy connections", "open right now"),
          tile(d.sessions, "Signed-in browsers", "active sessions"),
          tile(d.users.admins, "Admins"),
          tile(d.users.banned, "Banned", "", d.users.banned ? "red" : ""),
          tile(d.invites, "Invite codes", "still usable"),
          tile(d.store.pending, "Apps waiting for approval", `${d.store.live} in the App Store, ${d.store.reported} reported`, d.store.pending || d.store.reported ? "red" : ""),
          tile(d.chat.messages, "Chat messages", `${d.chat.today} in the last 24 hours`),
          tile(d.chat.sanctions, "Chat timeouts and bans", "in force now", d.chat.sanctions ? "red" : "")),
        h("div", { class: "cols section" },
          h("div", { class: "card" }, h("h3", { text: "New accounts, last 14 days" }), bars(d.signups, "New accounts")),
          h("div", { class: "card" }, h("h3", { text: "Chat messages, last 14 days" }), bars(d.messages, "Chat messages"))),
        h("div", { class: "cols section" },
          h("div", { class: "card" }, h("h3", { text: "Recent activity" }),
            d.recent.length
              ? h("ul", { class: "feed" }, d.recent.map((e) => h("li", {}, h("span", { class: "when", title: dateTime(e.at), text: ago(e.at) }), h("span", {}, h("strong", { text: e.actor }), ` ${e.action}${e.target ? ` ${e.target}` : ""}`))))
              : h("p", { class: "faint", text: "Nothing has happened yet." }),
            h("p", { class: "small", style: "margin-top:8px" }, h("a", { href: "#audit", text: "See the whole audit log", style: "color:inherit" }))),
          h("div", { class: "card" }, h("h3", { text: "This site" }),
            h("dl", { class: "kv" },
              h("dt", { text: "Accounts" }), h("dd", { text: `${r.config.accounts.mode}, sign-up ${r.config.accounts.signup}` }),
              h("dt", { text: "Version" }), h("dd", { text: r.config.version ?? "unknown" }),
              h("dt", { text: "Content filter" }), h("dd", { text: r.filter.enabled ? `on (${r.filter.hosts} sites, ${r.filter.tlds} endings, ${r.filter.keywords} keywords)` : "off" }),
              h("dt", { text: "GIF search" }), h("dd", { text: r.config.giphy ? "set up (GIPHY)" : "not set up (uploads only)" }),
              h("dt", { text: "Site password" }), h("dd", { text: r.config.sitePassword ? "set (AUTH_PASS)" : "none" })))));
    };
    await draw();
    const timer = setInterval(() => { if (!document.hidden) draw().catch(() => {}); }, 20000);
    return { leave: () => clearInterval(timer) };
  };

  // ---------------------------------------------------------------------------------------
  // Accounts
  // ---------------------------------------------------------------------------------------

  const accountState = { q: "", filter: "all", sort: "created", order: "desc", page: 1, selected: new Set() };
  let me = null;

  views.accounts = async () => {
    const s = accountState;
    const list = h("div");
    const bulk = h("div", { class: "bulkbar", hidden: true });
    const update = () => {
      bulk.hidden = !s.selected.size;
      bulk.replaceChildren(h("strong", { text: `${s.selected.size} selected` }),
        h("button", { class: "btn small", type: "button", text: "Sign out", onclick: (e) => bulkDo(e.target, "signout") }),
        h("button", { class: "btn small danger", type: "button", text: "Ban…", onclick: (e) => bulkDo(e.target, "ban") }),
        h("button", { class: "btn small", type: "button", text: "Unban", onclick: (e) => bulkDo(e.target, "unban") }),
        h("button", { class: "btn small", type: "button", text: "Clear selection", onclick: () => { s.selected.clear(); load(); } }));
    };
    async function bulkDo(button, action) {
      let reason = "";
      if (action === "ban") {
        reason = await askText(`Ban ${s.selected.size} account${s.selected.size === 1 ? "" : "s"}`, "Reason (they will see it)", { confirm: "Ban", danger: true, hint: "Admins, and you, are skipped." });
        if (reason === null) return;
      } else if (action === "signout" && !(await confirmBox("Sign out", `Sign ${s.selected.size} account${s.selected.size === 1 ? "" : "s"} out of every browser?`, { confirm: "Sign out" }))) return;
      const res = await act(button, () => A("POST", "/users/bulk", { action, usernames: [...s.selected], reason }));
      if (!res) return;
      const ok = res.results.filter((r) => r.ok).length, failed = res.results.filter((r) => !r.ok);
      toast(`${ok} done${failed.length ? `, ${failed.length} skipped (${failed.slice(0, 3).map((f) => `${f.username}: ${f.error}`).join("; ")})` : ""}.`, failed.length ? "" : "ok");
      s.selected.clear();
      load();
    }
    async function load() {
      const data = await A("GET", `/users?${query({ q: s.q, filter: s.filter === "all" ? "" : s.filter, sort: s.sort, order: s.order, page: s.page })}`);
      if (current !== "accounts") return;
      update();
      const all = h("input", { type: "checkbox", "aria-label": "Select everyone on this page", checked: data.users.length && data.users.every((u) => s.selected.has(u.username)) });
      all.addEventListener("change", () => { for (const u of data.users) all.checked ? s.selected.add(u.username) : s.selected.delete(u.username); load(); });
      list.replaceChildren(
        table([h("th", {}, all), "Account", "Joined", "Last seen", h("th", { class: "num", text: "Messages" }), h("th", { class: "num", text: "Browsers" }), "Invite", ""],
          data.users.map((u) => {
            const box = h("input", { type: "checkbox", "aria-label": `Select ${u.username}`, checked: s.selected.has(u.username) });
            box.addEventListener("change", () => { box.checked ? s.selected.add(u.username) : s.selected.delete(u.username); update(); });
            return h("tr", {},
              h("td", {}, box),
              h("td", {}, h("span", { class: "who" }, avatar(u.username, u.avatar), h("span", {}, u.username, u.admin && chip("ADMIN", "admin"), u.banned && chip("BANNED", "red")))),
              dateCell(u.createdAt), dateCell(u.lastSeenAt),
              h("td", { class: "num", text: number(u.messages) }), h("td", { class: "num", text: number(u.sessions) }),
              h("td", { text: u.invite ?? "" }),
              h("td", {}, h("button", { class: "btn small", type: "button", text: "Manage", onclick: () => openUser(u.username) })));
          }), "No accounts match."),
        pager(s, data.total, data.pageSize, load));
    }
    const search = h("input", { class: "field grow", type: "search", placeholder: "Search by username", value: s.q, "aria-label": "Search accounts" });
    let timer = 0;
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { s.q = search.value.trim(); s.page = 1; load(); }, 250); });
    const select = (key, options, label) => {
      const el = h("select", { class: "field", "aria-label": label }, options.map(([value, text]) => h("option", { value, text })));
      el.value = s[key];
      el.addEventListener("change", () => { s[key] = el.value; s.page = 1; load(); });
      return el;
    };
    main.replaceChildren(
      head("Accounts", h("a", { class: "btn", href: "/api/admin/export/users.csv", text: "Export CSV" })),
      h("div", { class: "toolbar" }, search,
        select("filter", [["all", "Everyone"], ["admins", "Admins"], ["banned", "Banned"], ["new", "Joined this week"], ["active", "Active in 24 hours"], ["inactive", "Inactive for 30 days"]], "Show"),
        select("sort", [["created", "Newest first"], ["seen", "Last seen"], ["name", "Name"], ["messages", "Chat messages"]], "Sort by"),
        select("order", [["desc", "Descending"], ["asc", "Ascending"]], "Order")),
      bulk, list);
    await load();
  };

  /** The roles someone has (click one's x to take it away), and a list to give another. */
  function rolesBox(detail, u, refresh) {
    const box = h("div", { class: "role-members" });
    for (const r of detail.roles) {
      box.append(h("span", { class: "chip", style: `border:1px solid ${r.color};color:${r.color};background:transparent` }, r.name, h("button", { class: "chip-x", type: "button", title: `Take ${r.name} away`, text: "x", onclick: (e) => act(e.target, async () => { await A("POST", `/roles/${r.id}/members`, { username: detail.username, add: false }); await refresh(); }) })));
    }
    const pick = h("select", { class: "field", style: "width:auto", "aria-label": "Give a role" }, h("option", { value: "", text: "Give a role…" }));
    A("GET", "/roles").then(({ roles }) => {
      for (const r of roles) if (!detail.roles.some((x) => x.id === r.id)) pick.append(h("option", { value: r.id, text: r.name }));
    }).catch(() => {});
    pick.addEventListener("change", () => { if (pick.value) act(pick, async () => { await A("POST", `/roles/${pick.value}/members`, { username: detail.username }); await refresh(); }); });
    box.append(pick);
    return box;
  }

  /** Everything about one account, with every action you can take on it. */
  async function openUser(name) {
    let detail;
    try { detail = await A("GET", `/users/${encodeURIComponent(name)}`); } catch (err) { toast(err.message, "error"); return; }
    const self = me && me.username.toLowerCase() === detail.username.toLowerCase();
    const refresh = async () => { closeDialog(); await openUser(name); if (current === "accounts") views.accounts(); };
    const u = encodeURIComponent(detail.username);
    const btn = (label, onClick, kind = "", disabled = false) => h("button", { class: `btn small ${kind}`.trim(), type: "button", text: label, disabled, onclick: (e) => onClick(e.target) });

    const actions = h("div", { class: "row" },
      btn(detail.verified ? "Remove verification" : "Verify", (b) => act(b, async () => { await A("POST", `/users/${u}/verify`, { verified: !detail.verified }); await refresh(); }, detail.verified ? "Verification removed." : "Verified."), "", detail.admin),
      btn(detail.admin ? "Remove admin" : "Make admin", (b) => act(b, async () => { await api("POST", `/api/account/admin/users/${u}/${detail.admin ? "unadmin" : "admin"}`, {}); await refresh(); }, detail.admin ? "Admin role removed." : "Now an admin."), "", detail.serverAdmin || self),
      detail.banned
        ? btn("Unban", (b) => act(b, async () => { await api("POST", `/api/account/admin/users/${u}/unban`, {}); await refresh(); }, "Unbanned."))
        : btn("Ban from the site…", async (b) => {
          const reason = await askText(`Ban ${detail.username}`, "Reason (they will see it)", { confirm: "Ban", danger: true });
          if (reason !== null) act(b, async () => { await api("POST", `/api/account/admin/users/${u}/ban`, { reason }); await refresh(); }, "Banned and signed out.");
        }, "danger", detail.admin || self),
      btn("Sign out everywhere", (b) => act(b, async () => { const r = await A("POST", `/users/${u}/signout`, {}); await refresh(); toast(`${r.ended} session${r.ended === 1 ? "" : "s"} ended.`, "ok"); })),
      btn("Set a new password…", async (b) => {
        const password = await askText(`New password for ${detail.username}`, "New password", { type: "password", hint: "At least 8 characters. They are signed out everywhere and should change it after signing in.", validate: (v) => (v.length < 8 ? "Use at least 8 characters." : "") });
        if (password !== null) act(b, async () => { await A("POST", `/users/${u}/password`, { password }); await refresh(); }, "Password changed.");
      }, "", detail.admin && !self),
      btn("Chat timeout or ban…", () => chatSanction(detail.username, refresh), "", detail.admin),
      btn("Delete account…", async (b) => {
        const typed = await askText(`Delete ${detail.username}`, `Type ${detail.username} to delete the account, its messages and its settings for good.`, { confirm: "Delete", danger: true, validate: (v) => (v !== detail.username ? "That isn't the username." : "") });
        if (typed !== null) act(b, async () => { await A("POST", `/users/${u}/delete`, { confirm: typed }); closeDialog(); if (current === "accounts") views.accounts(); }, "Account deleted.");
      }, "danger", detail.admin || self));

    const sessions = detail.sessionList.length
      ? table(["Started", "Expires", "From", "Browser", ""], detail.sessionList.map((s) => h("tr", {}, dateCell(s.createdAt), h("td", { text: inFuture(s.expiresAt) }), h("td", { text: s.ip ?? "unknown" }), h("td", { class: "wrap", text: s.userAgent ?? "unknown" }),
        h("td", {}, btn("End", (b) => act(b, async () => { await A("POST", `/sessions/${s.id}/revoke`, {}); await refresh(); }, "Session ended."))))))
      : h("p", { class: "faint", text: "Not signed in anywhere." });
    const messages = detail.recentMessages.length
      ? h("ul", { class: "feed" }, detail.recentMessages.map((m) => h("li", {}, h("span", { class: "when", title: dateTime(m.at), text: ago(m.at) }), h("span", { class: "wrap", text: m.text || (m.gif ? "[GIF]" : "") }))))
      : h("p", { class: "faint", text: "No chat messages." });
    const sanctions = detail.sanctions.length
      ? h("ul", { class: "feed" }, detail.sanctions.map((s) => h("li", {}, h("span", { class: "when", title: dateTime(s.at), text: ago(s.at) }),
        h("span", {}, h("strong", { text: s.kind === "ban" ? "Chat ban" : "Timeout" }), ` by ${s.by}${s.reason ? `: ${s.reason}` : ""}`, s.liftedAt ? ` (lifted by ${s.liftedBy})` : s.until && s.until < Date.now() ? " (ended)" : " (in force)"))))
      : h("p", { class: "faint", text: "No chat timeouts or bans." });
    const audit = detail.audit.length
      ? h("ul", { class: "feed" }, detail.audit.map((e) => h("li", {}, h("span", { class: "when", title: dateTime(e.at), text: ago(e.at) }), h("span", {}, h("strong", { text: e.actor }), ` ${e.action}${e.target ? ` ${e.target}` : ""}${e.detail ? ` (${e.detail})` : ""}`))))
      : h("p", { class: "faint", text: "Nothing in the log." });

    const panes = { Browsers: sessions, "Chat messages": messages, "Chat history": sanctions, "Admin log": audit };
    const pane = h("div");
    const tabs = h("div", { class: "tabs", role: "tablist" });
    const pick = (label) => { pane.replaceChildren(panes[label]); for (const tab of tabs.children) tab.setAttribute("aria-selected", String(tab.textContent === label)); };
    for (const label of Object.keys(panes)) tabs.append(h("button", { class: "tab", type: "button", role: "tab", text: label, onclick: () => pick(label) }));
    pick("Browsers");

    const body = h("div", { class: "stack" },
      h("div", { class: "row" }, avatar(detail.username, detail.avatar, true), h("div", {}, h("strong", { text: detail.username }), detail.admin && chip(detail.serverAdmin ? "ADMIN (ADMINS)" : "ADMIN", "admin"), detail.verified && chip("VERIFIED", "green"), detail.banned && chip("BANNED", "red"),
        h("div", { class: "dim small", text: detail.banned ? `Banned${detail.banReason ? `: ${detail.banReason}` : ""}` : `Last seen ${ago(detail.lastSeenAt)}` }))),
      h("dl", { class: "kv" },
        h("dt", { text: "Joined" }), h("dd", { text: dateTime(detail.createdAt) }),
        h("dt", { text: "Invite" }), h("dd", { text: detail.invite ?? "none" }),
        h("dt", { text: "Roles" }), h("dd", {}, rolesBox(detail, u, refresh)),
        h("dt", { text: "Chat messages" }), h("dd", { text: number(detail.messages) }),
        h("dt", { text: "Saved settings" }), h("dd", { text: `${bytes(detail.settingsBytes)} (revision ${detail.settingsRevision})` })),
      actions, tabs, pane);
    showDialog({ title: "Manage account", body, wide: true, actions: [{ label: "Close" }] });
  }

  /** Time someone out of the chat, or ban them from it, or lift it. */
  function chatSanction(username, after) {
    const u = encodeURIComponent(username);
    const kind = h("select", { class: "field" }, [["5", "Time out for 5 minutes"], ["15", "Time out for 15 minutes"], ["60", "Time out for 1 hour"], ["360", "Time out for 6 hours"], ["1440", "Time out for 1 day"], ["10080", "Time out for 7 days"], ["ban", "Ban from the chat until lifted"]].map(([v, t]) => h("option", { value: v, text: t })));
    kind.value = "60";
    const reason = h("input", { class: "field", maxlength: "200", autocomplete: "off" });
    const purge = h("input", { type: "checkbox", checked: true });
    const note = h("p", { class: "status" });
    showDialog({
      title: `Chat: ${username}`,
      body: h("div", { class: "stack" },
        h("label", { class: "labeled" }, h("span", { text: "Action" }), kind),
        h("label", { class: "labeled" }, h("span", { text: "Reason (they will see it)" }), reason),
        h("label", { class: "check" }, purge, h("span", { text: "Also delete their messages from the last 10 minutes" })), note),
      actions: [
        { label: "Cancel" },
        { label: "Lift timeout or ban", onClick: async () => { try { await api("POST", `/api/chat/admin/users/${u}/lift`, {}); toast("Lifted.", "ok"); after?.(); return false; } catch (err) { note.textContent = err.message; note.dataset.state = "error"; return false; } } },
        { label: "Apply", kind: "danger", onClick: async () => {
          try {
            const body = { reason: reason.value, purge: purge.checked };
            if (kind.value !== "ban") body.minutes = Number(kind.value);
            await api("POST", `/api/chat/admin/users/${u}/${kind.value === "ban" ? "ban" : "timeout"}`, body);
            toast("Done.", "ok"); after?.(); return false;
          } catch (err) { note.textContent = err.message; note.dataset.state = "error"; return false; }
        } },
      ],
    });
  }

  // ---------------------------------------------------------------------------------------
  // Sessions
  // ---------------------------------------------------------------------------------------

  const sessionState = { q: "", page: 1 };
  views.sessions = async () => {
    const s = sessionState;
    const list = h("div");
    async function load() {
      const data = await A("GET", `/sessions?${query({ q: s.q, page: s.page })}`);
      if (current !== "sessions") return;
      list.replaceChildren(
        table(["Account", "Started", "Expires", "From", "Browser", ""], data.sessions.map((x) => h("tr", {},
          h("td", {}, x.username, x.current && chip("THIS ONE", "green")), dateCell(x.createdAt), h("td", { text: inFuture(x.expiresAt) }), h("td", { text: x.ip ?? "unknown" }), h("td", { class: "wrap", text: x.userAgent ?? "unknown" }),
          h("td", {}, h("button", { class: "btn small", type: "button", text: "End", onclick: async (e) => { if (x.current && !(await confirmBox("End your own session?", "You would be signed out of this browser.", { confirm: "End it", danger: true }))) return; act(e.target, async () => { await A("POST", `/sessions/${x.id}/revoke`, {}); load(); }, "Session ended."); } })))), "Nobody is signed in."),
        pager(s, data.total, data.pageSize, load));
    }
    const search = h("input", { class: "field grow", type: "search", placeholder: "Search by username", value: s.q, "aria-label": "Search sessions" });
    let timer = 0;
    search.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { s.q = search.value.trim(); s.page = 1; load(); }, 250); });
    main.replaceChildren(head("Sessions"), h("p", { class: "dim section", text: "Every browser that is signed in right now. Ending one signs that browser out. Each session remembers the address and browser it started from." }), h("div", { class: "toolbar" }, search), list);
    await load();
  };

  // ---------------------------------------------------------------------------------------
  // Invites
  // ---------------------------------------------------------------------------------------

  views.invites = async () => {
    const result = h("div");
    const list = h("div");
    const label = h("input", { class: "field", maxlength: "60", placeholder: "For example, Period 3" });
    const uses = h("input", { class: "field", type: "number", min: "1", max: "1000", value: "1", style: "width:80px" });
    const days = h("input", { class: "field", type: "number", min: "0", max: "365", value: "7", style: "width:80px" });
    const count = h("input", { class: "field", type: "number", min: "1", max: "50", value: "1", style: "width:80px" });
    async function loadList() {
      const { invites } = await api("GET", "/api/account/admin/invites");
      if (current !== "invites") return;
      const tone = { active: "green", revoked: "red", expired: "amber", "used up": "amber" };
      list.replaceChildren(table(["Code", "Label", "Used", "Expires", "Made by", "State", ""], invites.map((i) => h("tr", {},
        h("td", {}, h("code", { text: `…${i.hint}` })), h("td", { text: i.label || "" }), h("td", { text: `${i.uses} of ${i.maxUses}` }), h("td", { text: i.expiresAt ? inFuture(i.expiresAt) : "never" }), h("td", { text: i.createdBy ?? "" }),
        h("td", {}, chip(i.state.toUpperCase(), tone[i.state] ?? "")),
        h("td", {}, i.state === "active" && h("button", { class: "btn small", type: "button", text: "Revoke", onclick: (e) => act(e.target, async () => { await api("POST", `/api/account/admin/invites/${i.id}/revoke`, {}); loadList(); }, "Revoked.") })))), "No invite codes yet."));
    }
    const make = async (button) => {
      const n = Number(count.value) || 1;
      const options = { label: label.value, maxUses: Number(uses.value), expiresInDays: Number(days.value) };
      const codes = await act(button, async () => (n === 1 ? [(await api("POST", "/api/account/admin/invites", options)).code] : (await A("POST", "/invites/bulk", { ...options, count: n })).codes));
      if (!codes) return;
      result.replaceChildren(h("div", { class: "section" }, h("p", { class: "status", "data-state": "ok", text: `Made ${codes.length} code${codes.length === 1 ? "" : "s"}. They are only shown now.` }), h("div", { class: "codes", text: codes.join("\n") }),
        h("button", { class: "btn small", type: "button", style: "margin-top:6px", text: "Copy", onclick: async (e) => { try { await navigator.clipboard.writeText(codes.join("\n")); e.target.textContent = "Copied"; } catch { toast("Select the codes and copy them.", "error"); } } })));
      loadList();
    };
    main.replaceChildren(head("Invites"),
      h("div", { class: "card section" }, h("h3", { text: "Make invite codes" }),
        h("div", { class: "row" },
          h("label", { class: "labeled", style: "flex:1;min-width:160px" }, h("span", { text: "Label" }), label),
          h("label", { class: "labeled" }, h("span", { text: "Uses each" }), uses),
          h("label", { class: "labeled" }, h("span", { text: "Expires (days, 0 = never)" }), days),
          h("label", { class: "labeled" }, h("span", { text: "How many codes" }), count),
          h("button", { class: "btn primary", type: "button", text: "Make", onclick: (e) => make(e.target) })),
        result),
      list);
    await loadList();
  };

  // ---------------------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------------------

  const chatState = { tab: "messages", q: "", username: "", deleted: false };
  views.chat = async () => {
    const body = h("div");
    const tabs = h("div", { class: "tabs", role: "tablist" });
    const pick = (tab) => { chatState.tab = tab; for (const t of tabs.children) t.setAttribute("aria-selected", String(t.dataset.tab === tab)); (tab === "messages" ? chatMessages : chatModeration)(body); };
    for (const [tab, text] of [["messages", "Messages"], ["moderation", "Rules and timeouts"]]) tabs.append(h("button", { class: "tab", type: "button", role: "tab", "data-tab": tab, text, onclick: () => pick(tab) }));
    main.replaceChildren(head("Chat", h("a", { class: "btn", href: "/api/admin/export/chat.csv", text: "Export recent messages" })), tabs, body);
    pick(chatState.tab);
  };

  async function chatMessages(body) {
    const s = chatState;
    const list = h("div");
    const rows = [];
    const more = h("button", { class: "btn", type: "button", text: "Load older messages", hidden: true });
    let last = null;
    async function load(reset) {
      if (reset) { rows.length = 0; last = null; }
      const { messages } = await A("GET", `/chat/messages?${query({ q: s.q, username: s.username, deleted: s.deleted ? "1" : "", before: last, limit: 50 })}`);
      for (const m of messages) {
        rows.push(h("tr", {},
          dateCell(m.at), h("td", { text: m.username }),
          h("td", { class: "wrap" }, m.text || (m.gif ? "[GIF]" : ""), m.gif && m.text ? chip("GIF") : null, m.deleted && chip(`DELETED by ${m.deletedBy}`, "red")),
          h("td", {}, !m.deleted && h("button", { class: "btn small", type: "button", text: "Delete", onclick: (e) => act(e.target, async () => { await api("POST", `/api/chat/admin/messages/${m.id}/delete`, {}); load(true); }, "Deleted.") }),
            " ", h("button", { class: "btn small", type: "button", text: "Account", onclick: () => openUser(m.username) }))));
      }
      if (messages.length) last = messages.at(-1).id;
      more.hidden = messages.length < 50;
      list.replaceChildren(table(["When", "Who", "Message", ""], rows.slice(), "No messages match."), more);
    }
    more.addEventListener("click", () => load(false));
    const q = h("input", { class: "field grow", type: "search", placeholder: "Search the text of messages", value: s.q, "aria-label": "Search messages" });
    const user = h("input", { class: "field", type: "search", placeholder: "Username", value: s.username, "aria-label": "Only this person", style: "width:150px" });
    const deleted = h("input", { type: "checkbox", checked: s.deleted });
    const go = () => { s.q = q.value.trim(); s.username = user.value.trim(); s.deleted = deleted.checked; load(true); };
    for (const el of [q, user]) el.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });
    deleted.addEventListener("change", go);
    body.replaceChildren(h("div", { class: "toolbar" }, q, user, h("label", { class: "check" }, deleted, h("span", { text: "Show deleted" })), h("button", { class: "btn primary", type: "button", text: "Search", onclick: go })), list);
    await load(true);
  }

  async function chatModeration(body) {
    const [{ settings }, { sanctions }] = await Promise.all([api("GET", "/api/chat/admin/settings"), api("GET", "/api/chat/admin/sanctions")]);
    const box = (label, checked) => { const input = h("input", { type: "checkbox", checked }); return [input, h("label", { class: "check" }, input, h("span", { text: label }))]; };
    const [enabled, enabledRow] = box("The chat is on", settings.enabled);
    const [locked, lockedRow] = box("Locked: only admins can post", settings.locked);
    const [gifs, gifsRow] = box("Allow GIFs", settings.gifs);
    const slow = h("select", { class: "field" }, [[0, "Off"], [1, "1 second"], [3, "3 seconds"], [5, "5 seconds"], [10, "10 seconds"], [30, "30 seconds"], [60, "1 minute"], [300, "5 minutes"]].map(([v, t]) => h("option", { value: String(v), text: t })));
    if (![0, 1, 3, 5, 10, 30, 60, 300].includes(settings.slowSeconds)) slow.append(h("option", { value: String(settings.slowSeconds), text: `${settings.slowSeconds} seconds` }));
    slow.value = String(settings.slowSeconds);
    const links = h("select", { class: "field" }, [h("option", { value: "blocked", text: "Blocked" }), h("option", { value: "allowed", text: "Allowed" })]);
    links.value = settings.links;
    const age = h("input", { class: "field", type: "number", min: "0", max: "1440", value: String(settings.minAccountMinutes), style: "width:100px" });
    const words = h("textarea", { class: "field", rows: "5", spellcheck: "false", value: settings.words.join("\n") });
    const status = h("p", { class: "status" });
    const save = h("button", { class: "btn primary", type: "button", text: "Save chat rules", onclick: () => act(save, async () => {
      await api("POST", "/api/chat/admin/settings", { enabled: enabled.checked, locked: locked.checked, gifs: gifs.checked, slowSeconds: Number(slow.value), links: links.value, minAccountMinutes: Number(age.value) || 0, words: words.value.split("\n") });
    }, "Saved. It applies to everyone at once.") });
    const lifted = async (name, b) => act(b, async () => { await api("POST", `/api/chat/admin/users/${encodeURIComponent(name)}/lift`, {}); chatModeration(body); }, "Lifted.");
    body.replaceChildren(
      h("div", { class: "cols" },
        h("div", { class: "card stack" }, h("h3", { text: "Rules" }), enabledRow, lockedRow, gifsRow,
          h("label", { class: "labeled" }, h("span", { text: "Slow mode" }), slow),
          h("label", { class: "labeled" }, h("span", { text: "Links in messages" }), links),
          h("label", { class: "labeled" }, h("span", { text: "New accounts can post after (minutes, 0 = at once)" }), age),
          h("label", { class: "labeled" }, h("span", { text: "Blocked words (one per line; end with * to catch longer words)" }), words),
          h("div", { class: "row" }, save, h("button", { class: "btn danger", type: "button", text: "Clear the whole chat", onclick: async (e) => { if (await confirmBox("Clear the chat", "Every message and uploaded GIF is removed for everyone.", { confirm: "Clear it", danger: true })) act(e.target, () => api("POST", "/api/chat/admin/clear", {}), "The chat was cleared."); } })), status),
        h("div", { class: "card" }, h("h3", { text: "Timeouts and bans in force" }),
          sanctions.length
            ? h("ul", { class: "feed" }, sanctions.map((x) => h("li", {}, h("span", { class: "when", text: x.kind === "ban" ? "ban" : inFuture(x.until) }), h("span", { style: "flex:1" }, h("strong", { text: x.username }), ` by ${x.by}${x.reason ? `: ${x.reason}` : ""}`), h("button", { class: "btn small", type: "button", text: "Lift", onclick: (e) => lifted(x.username, e.target) }))))
            : h("p", { class: "faint", text: "Nobody is timed out or banned." }))));
  }

  // ---------------------------------------------------------------------------------------
  // Content filter
  // ---------------------------------------------------------------------------------------

  views.filter = async () => {
    const { custom, builtin } = await A("GET", "/blocklist");
    const area = (rows, hint) => h("textarea", { class: "field", rows: String(rows), spellcheck: "false", autocapitalize: "off", value: hint.join("\n") });
    const hosts = area(8, custom.hosts), keywords = area(4, custom.keywords), words = area(4, custom.queryWords);
    const status = h("p", { class: "status" });
    const testInput = h("input", { class: "field grow", placeholder: "A site (example.com) or something to search for" });
    const testOut = h("p", { class: "status" });
    const test = async () => {
      const value = testInput.value.trim();
      if (!value) return;
      const isHost = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
      try {
        const verdict = await api("POST", "/api/verdict", isHost ? { host: value.replace(/^https?:\/\//, "").replace(/\/.*$/, "") } : { query: value });
        testOut.textContent = verdict.blocked ? `Blocked (${verdict.reason}).` : "Allowed.";
        testOut.dataset.state = verdict.blocked ? "error" : "ok";
      } catch (err) { testOut.textContent = err.message; testOut.dataset.state = "error"; }
    };
    testInput.addEventListener("keydown", (event) => { if (event.key === "Enter") test(); });
    const save = h("button", { class: "btn primary", type: "button", text: "Save and apply", onclick: () => act(save, async () => {
      const lines = (el) => el.value.split("\n");
      const saved = await A("POST", "/blocklist", { hosts: lines(hosts), keywords: lines(keywords), queryWords: lines(words) });
      hosts.value = saved.custom.hosts.join("\n"); keywords.value = saved.custom.keywords.join("\n"); words.value = saved.custom.queryWords.join("\n");
      status.textContent = `Saved: ${saved.custom.hosts.length} sites, ${saved.custom.keywords.length} keywords, ${saved.custom.queryWords.length} search words. It applies to new connections at once.`;
      status.dataset.state = "ok";
    }).catch(() => {}) });
    main.replaceChildren(head("Content filter"),
      h("p", { class: "dim section", text: `The server already blocks ${builtin.hosts} sites, ${builtin.tlds} domain endings and ${builtin.keywords} hostname keywords${builtin.enabled ? "" : " (the filter is switched off on the server with CONTENT_FILTER=0, so only these extras would apply if it were on)"}. Add your own below.` }),
      h("div", { class: "cols section" },
        h("div", { class: "card stack" }, h("h3", { text: "Blocked sites" }), h("p", { class: "dim small", text: "One per line. A site and all of its subdomains, so example.com also blocks www.example.com. Paste a whole address if you like; it is cleaned up." }), hosts),
        h("div", { class: "stack" },
          h("div", { class: "card stack" }, h("h3", { text: "Hostname keywords" }), h("p", { class: "dim small", text: "Blocks any site whose name contains the word. Use carefully: short words block innocent sites." }), keywords),
          h("div", { class: "card stack" }, h("h3", { text: "Blocked search words" }), h("p", { class: "dim small", text: "Whole words that stop a typed search." }), words))),
      h("div", { class: "row section" }, save), status,
      h("div", { class: "card section stack" }, h("h3", { text: "Try it" }), h("p", { class: "dim small", text: "See whether the filter would block something, with everything above applied." }), h("div", { class: "row" }, testInput, h("button", { class: "btn", type: "button", text: "Check", onclick: test })), testOut));
  };

  // ---------------------------------------------------------------------------------------
  // Site: accounts, maintenance, announcement
  // ---------------------------------------------------------------------------------------

  views.site = async () => {
    const [site, maintenance, announcement, terms] = await Promise.all([api("GET", "/api/account/admin/site"), A("GET", "/maintenance"), A("GET", "/announcement"), A("GET", "/terms")]);
    const radios = (key, options) => {
      const wrap = h("div", { class: "radios", role: "radiogroup" });
      for (const [value, text] of options) {
        const input = h("input", { type: "radio", name: key, value, checked: site[key] === value, disabled: site.locked[key] });
        input.addEventListener("change", () => act(null, async () => { await api("POST", "/api/account/admin/site", { [key]: value }); }, "Saved."));
        wrap.append(h("label", {}, input, h("span", { text })));
      }
      return wrap;
    };
    const lockedNote = (key, variable) => site.locked[key] && h("p", { class: "faint small", text: `${variable} is set on the server, so this can only be changed there.` });

    const mOn = h("input", { type: "checkbox", checked: maintenance.on });
    const mMsg = h("textarea", { class: "field", rows: "2", maxlength: "300", value: maintenance.message });
    const mSave = h("button", { class: "btn primary", type: "button", text: "Save", onclick: async () => {
      if (mOn.checked && !maintenance.on && !(await confirmBox("Turn on maintenance mode", "Everyone except admins is taken to the \"back soon\" page right away, wherever they are, and the proxy closes to them.", { confirm: "Turn it on", danger: true }))) { mOn.checked = false; return; }
      act(mSave, async () => { const saved = await A("POST", "/maintenance", { on: mOn.checked, message: mMsg.value }); maintenance.on = saved.on; }, mOn.checked ? "Maintenance mode is on. Only admins can use the site." : "Maintenance mode is off.");
    } });

    const aText = h("textarea", { class: "field", rows: "3", maxlength: "300", placeholder: "For example: The server restarts at 3pm.", value: announcement.text });
    const aLevel = h("select", { class: "field", style: "width:180px" }, [["info", "Information (notification)"], ["warning", "Warning (notification)"], ["danger", "Important (window to close)"]].map(([v, t]) => h("option", { value: v, text: t })));
    aLevel.value = announcement.level;
    const preview = h("div", { class: "announce", "data-level": announcement.level }, h("strong", { text: "Announcement" }), h("div", { class: "dim" }));
    const draw = () => { preview.dataset.level = aLevel.value; preview.lastChild.textContent = aText.value.trim() || "(nothing yet)"; };
    aText.addEventListener("input", draw); aLevel.addEventListener("change", draw); draw();
    const post = h("button", { class: "btn primary", type: "button", text: announcement.active ? "Update announcement" : "Post announcement", onclick: () => act(post, async () => { await A("POST", "/announcement", { text: aText.value, level: aLevel.value, active: true }); views.site(); }, "Posted. Everyone sees it now: Important as a window to close, the rest as a notification at the bottom right.") });
    const clear = h("button", { class: "btn", type: "button", text: "Take it down", disabled: !announcement.active, onclick: () => act(clear, async () => { await A("POST", "/announcement", { text: aText.value, level: aLevel.value, active: false }); views.site(); }, "Taken down.") });

    const tOn = h("input", { type: "checkbox", checked: terms.enabled });
    const tSave = h("button", { class: "btn primary", type: "button", text: "Save", onclick: () => act(tSave, async () => { const saved = await A("POST", "/terms", { enabled: tOn.checked }); terms.enabled = saved.enabled; }, tOn.checked ? "On. Everyone who isn't signed in sees it now, and must agree once." : "Off.") });
    const tPreview = h("button", { class: "btn", type: "button", text: "Preview the screen", onclick: () => {
      const t = desktop?.SnTerms;
      if (!t) return toast("Open the Admin Panel inside SuperNova OS to preview it.", "error");
      t.show({ preview: true });
    } });

    main.replaceChildren(head("Site"),
      h("div", { class: "card section stack" }, h("h3", { text: "Accounts" }),
        h("div", {}, h("p", { class: "dim small", text: "Whether the site has accounts, and whether the whole site needs one." }), radios("mode", [["off", "Off"], ["optional", "Optional"], ["required", "Required (sign-in screen)"]]), lockedNote("mode", "ACCOUNTS")),
        h("div", {}, h("p", { class: "dim small", text: "Who can create an account." }), radios("signup", [["invite", "Invite code"], ["open", "Anyone"], ["closed", "Nobody"]]), lockedNote("signup", "ACCOUNTS_SIGNUP"))),
      h("div", { class: "card section stack" }, h("h3", { text: "Maintenance mode" }),
        h("p", { class: "dim small", text: "Locks everyone but admins out with a \"back soon\" page, and closes the proxy to them. Sign-in stays open so admins can still get in." }),
        h("label", { class: "check" }, mOn, h("span", { text: "Maintenance mode is on" })),
        h("label", { class: "labeled" }, h("span", { text: "What people see" }), mMsg), h("div", { class: "row" }, mSave)),
      h("div", { class: "card section stack" }, h("h3", { text: "Acceptable use screen" }),
        h("p", { class: "dim small", text: "A big bright red notice, like a terms of service, saying this site is only for education and open source learning and must not be used during school or to get past school filters. Everyone who is not signed in has to tick the box and press I agree once; it is remembered on their device, even after they close the site. People who are signed in never see it. It appears and disappears on open pages the moment you save." }),
        h("label", { class: "check" }, tOn, h("span", { text: "Show the acceptable use screen" })),
        h("div", { class: "row" }, tSave, tPreview)),
      h("div", { class: "card section stack" }, h("h3", { text: "Announcement" }),
        h("p", { class: "dim small", text: "Shown to everyone on their desktop the moment you post it, once each time you change it: Important ones as a window to close, the others as a notification." }),
        h("label", { class: "labeled" }, h("span", { text: "Message" }), aText), h("label", { class: "labeled" }, h("span", { text: "Kind" }), aLevel),
        preview, h("div", { class: "row" }, post, clear)));
  };

  // ---------------------------------------------------------------------------------------
  // Audit log
  // ---------------------------------------------------------------------------------------

  const auditState = { q: "", actor: "", source: "" };
  views.audit = async () => {
    const s = auditState;
    const list = h("div");
    const rows = [];
    const more = h("button", { class: "btn", type: "button", text: "Load older entries", hidden: true });
    let before = null;
    async function load(reset) {
      if (reset) { rows.length = 0; before = null; }
      const { entries } = await A("GET", `/audit?${query({ q: s.q, actor: s.actor, source: s.source, before, limit: 100 })}`);
      for (const e of entries) rows.push(h("tr", {}, h("td", { title: dateTime(e.at), text: dateTime(e.at) }), h("td", {}, chip(e.source === "chat" ? "CHAT" : "SITE", e.source === "chat" ? "" : "amber")), h("td", { text: e.actor }), h("td", { text: e.action }), h("td", { text: e.target ?? "" }), h("td", { class: "wrap", text: e.detail ?? "" })));
      if (entries.length) before = entries.at(-1).at;
      more.hidden = entries.length < 100;
      list.replaceChildren(table(["Time", "Where", "Who", "Did", "To", "Details"], rows.slice(), "Nothing matches."), more);
    }
    more.addEventListener("click", () => load(false));
    const q = h("input", { class: "field grow", type: "search", placeholder: "Search actions, names and details", value: s.q, "aria-label": "Search the log" });
    const actor = h("input", { class: "field", type: "search", placeholder: "Who did it", value: s.actor, "aria-label": "Only this admin", style: "width:140px" });
    const source = h("select", { class: "field", "aria-label": "Where" }, [["", "Everything"], ["site", "Site"], ["chat", "Chat"]].map(([v, t]) => h("option", { value: v, text: t })));
    source.value = s.source;
    const go = () => { s.q = q.value.trim(); s.actor = actor.value.trim(); s.source = source.value; load(true); };
    for (const el of [q, actor]) el.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });
    source.addEventListener("change", go);
    main.replaceChildren(head("Audit log", h("a", { class: "btn", href: "/api/admin/export/audit.csv", text: "Export CSV" })),
      h("p", { class: "dim section", text: "What admins did on the site, and the chat's moderation actions, newest first. Only the latest 5000 site entries are kept." }),
      h("div", { class: "toolbar" }, q, actor, source, h("button", { class: "btn primary", type: "button", text: "Search", onclick: go })), list);
    await load(true);
  };

  // ---------------------------------------------------------------------------------------
  // System
  // ---------------------------------------------------------------------------------------

  views.system = async () => {
    const draw = async () => {
      const d = await A("GET", "/system");
      if (current !== "system") return;
      const memoryUse = d.host.totalMemory ? Math.round((1 - d.host.freeMemory / d.host.totalMemory) * 100) : 0;
      main.replaceChildren(head("System", h("button", { class: "btn", type: "button", text: "Refresh", onclick: () => draw().catch((e) => toast(e.message, "error")) })),
        h("div", { class: "cols section" },
          h("div", { class: "card" }, h("h3", { text: "Server" }), h("dl", { class: "kv" },
            h("dt", { text: "Running for" }), h("dd", { text: duration(d.process.uptimeSeconds) }),
            h("dt", { text: "Node.js" }), h("dd", { text: `${d.process.node} on ${d.process.platform}` }),
            h("dt", { text: "Memory used" }), h("dd", { text: `${bytes(d.process.rss)} (heap ${bytes(d.process.heapUsed)} of ${bytes(d.process.heapTotal)})` }),
            h("dt", { text: "Machine" }), h("dd", { text: `${d.host.cpus} CPU${d.host.cpus === 1 ? "" : "s"}, ${memoryUse}% of ${bytes(d.host.totalMemory)} memory in use, load ${d.host.load.join(" ")}` }),
            d.host.fly && h("dt", { text: "Fly.io" }), d.host.fly && h("dd", { text: `${d.host.fly.app}${d.host.fly.region ? `, region ${d.host.fly.region}` : ""}${d.host.fly.machine ? `, machine ${d.host.fly.machine}` : ""}` }),
            h("dt", { text: "Connections" }), h("dd", { text: `${d.runtime.wisp} proxy, ${d.runtime.chat.streams} in the chat, ${d.runtime.chat.quietStreams} notification listeners` }))),
          h("div", { class: "card" }, h("h3", { text: "Database" }), h("dl", { class: "kv" },
            h("dt", { text: "File size" }), h("dd", { text: `${bytes(d.database.bytes.database)} (+ ${bytes(d.database.bytes.wal)} write-ahead log)` }),
            h("dt", { text: "Profile pictures" }), h("dd", { text: bytes(d.database.bytes.pictures) }),
            h("dt", { text: "Uploaded GIFs" }), h("dd", { text: bytes(d.database.bytes.gifs) }),
            h("dt", { text: "Schema version" }), h("dd", { text: String(d.database.schemaVersion) })))),
        h("div", { class: "card section" }, h("h3", { text: "Rows in each table" }), h("dl", { class: "kv" }, Object.entries(d.database.counts).flatMap(([name, n]) => [h("dt", { text: name }), h("dd", { text: number(n) })]))),
        h("div", { class: "card section stack" }, h("h3", { text: "Tools" }),
          h("div", { class: "row" },
            h("button", { class: "btn", type: "button", text: "Tidy the database", onclick: (e) => act(e.target, async () => { const r = await A("POST", "/system/prune", {}); toast(`Removed ${r.sessions} old sessions and ${r.messages} deleted messages. The file went from ${bytes(r.bytesBefore)} to ${bytes(r.bytesAfter)}.`, "ok"); draw(); }) }),
            h("a", { class: "btn", href: "/api/admin/system/backup", text: "Download a backup" })),
          h("p", { class: "dim small", text: "A backup is a copy of the whole database, including accounts, password hashes, chat and settings. Keep it somewhere safe. Restore it by putting it back as accounts.db in the data folder while the server is stopped. Tidying removes expired sessions and chat messages deleted more than a week ago, and shrinks the file.", style: "max-width:640px" })));
    };
    await draw();
  };


  // ---------------------------------------------------------------------------------------
  // Roles: names, colours, permissions, order and who has them
  // ---------------------------------------------------------------------------------------

  const ROLE_COLORS = ["#e5484d", "#ff6b78", "#f5803e", "#3fb950", "#2dd4bf", "#4aa3ff", "#a78bfa", "#f472b6", "#99aab5"];

  views.roles = async () => {
    const data = await A("GET", "/roles");
    if (current !== "roles") return;
    const reload = () => show("roles");
    const dot = (color) => h("span", { class: "role-dot", style: `background:${color}` });

    const rows = data.roles.map((role, i) => h("tr", {},
      h("td", {}, dot(role.color), h("strong", { text: role.name, style: `color:${role.color};margin-left:8px` })),
      h("td", { text: `@${role.slug}` }),
      h("td", { class: "num", text: number(role.members) }),
      h("td", { class: "wrap dim", text: role.permissions.length ? role.permissions.map((p) => data.permissions.find((x) => x.id === p)?.label ?? p).join(", ") : "no special permissions" }),
      h("td", {}, role.mentionable ? chip("PINGABLE", "green") : ""),
      h("td", {}, h("div", { class: "row end" },
        h("button", { class: "btn small", type: "button", text: "Up", disabled: i === 0, title: "More important", onclick: (e) => act(e.target, async () => { await A("POST", `/roles/${role.id}/move`, { direction: -1 }); await reload(); }) }),
        h("button", { class: "btn small", type: "button", text: "Down", disabled: i === data.roles.length - 1, title: "Less important", onclick: (e) => act(e.target, async () => { await A("POST", `/roles/${role.id}/move`, { direction: 1 }); await reload(); }) }),
        h("button", { class: "btn small primary", type: "button", text: "Edit", onclick: () => roleDialog(role, data, reload) }),
        h("button", { class: "btn small danger", type: "button", text: "Delete", onclick: async (e) => {
          if (!(await confirmBox(`Delete ${role.name}?`, `${role.members ? `${role.members} ${role.members === 1 ? "person has" : "people have"} it and will lose it. ` : ""}Pings of @${role.slug} stop working.`, { confirm: "Delete", danger: true }))) return;
          act(e.target, async () => { await A("POST", `/roles/${role.id}/delete`, {}); await reload(); }, `${role.name} was deleted.`);
        } })))));

    main.replaceChildren(
      head("Roles", h("button", { class: "btn primary", type: "button", text: "Create a role", onclick: () => roleDialog(null, data, reload) })),
      h("p", { class: "dim section", text: "Roles give people a colour, a tag in the chat and permissions. Someone with several roles gets all of their permissions and the colour of the highest one. People are moderated by rank: nobody can moderate someone whose highest role is as high as theirs. Site admins always have every permission. A role doesn't make anyone a site admin: that stays in Accounts." }),
      table(["Role", "Ping it with", "People", "Permissions", "", ""], rows, "There are no roles yet."));
  };

  /** Create a role (role = null) or change one: name, colour, who can ping it, permissions, and its members. */
  async function roleDialog(role, data, reload) {
    const picked = new Set(role?.permissions ?? []);
    const name = h("input", { class: "field", maxlength: String(data.limits.name), value: role?.name ?? "", autocomplete: "off", spellcheck: "false" });
    let color = role?.color ?? ROLE_COLORS[5];
    const wheel = h("input", { type: "color", value: color, class: "role-wheel", "aria-label": "Colour wheel" });
    const swatches = h("div", { class: "role-swatches" });
    const paintColors = () => {
      swatches.replaceChildren(...ROLE_COLORS.map((c) => h("button", { class: "role-swatch", type: "button", style: `background:${c}`, title: c, "aria-pressed": String(c === color), onclick: () => { color = c; wheel.value = c; paintColors(); preview(); } })));
    };
    wheel.addEventListener("input", () => { color = wheel.value; paintColors(); preview(); });
    const mentionable = h("input", { type: "checkbox", checked: role?.mentionable ?? true });
    const sample = h("strong");
    const preview = () => { sample.textContent = name.value.trim() || "Role name"; sample.style.color = color; };
    name.addEventListener("input", preview);
    paintColors(); preview();

    const checks = data.permissions.map((p) => {
      const box = h("input", { type: "checkbox", checked: picked.has(p.id) });
      box.addEventListener("change", () => { if (box.checked) picked.add(p.id); else picked.delete(p.id); });
      return h("label", { class: "check" }, box, h("span", {}, h("strong", { text: p.label }), h("br"), h("small", { class: "dim", text: p.hint })));
    });

    // members (changing a role that exists)
    const members = h("div");
    const paintMembers = (list) => {
      members.replaceChildren(
        list.length ? h("div", { class: "role-members" }, list.map((m) => h("span", { class: "chip" }, m.username, h("button", { class: "chip-x", type: "button", title: `Remove ${m.username}`, text: "x", onclick: async (e) => {
          const res = await act(e.target, () => A("POST", `/roles/${role.id}/members`, { username: m.username, add: false }));
          if (res) paintMembers(res.members);
        } })))) : h("p", { class: "faint small", text: "Nobody has this role yet." }));
    };
    const add = h("input", { class: "field", placeholder: "Add someone by username", maxlength: "32", autocomplete: "off", spellcheck: "false" });
    const addGo = async () => {
      const who = add.value.trim();
      if (!who) return;
      const res = await act(null, () => A("POST", `/roles/${role.id}/members`, { username: who }));
      if (res) { add.value = ""; paintMembers(res.members); }
    };
    add.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addGo(); } });
    if (role) A("GET", `/roles/${role.id}/members`).then((r) => paintMembers(r.members)).catch(() => {});

    const note = h("p", { class: "status" });
    const body = h("div", { class: "stack" },
      h("label", { class: "labeled" }, h("span", { text: "Name" }), name),
      h("div", {}, h("span", { text: "Colour" }), h("div", { class: "row", style: "margin-top:6px" }, swatches, wheel, h("span", { class: "dim small", text: "Preview:" }), sample)),
      h("label", { class: "check" }, mentionable, h("span", { text: "Anyone can ping this role with @name (otherwise only people allowed to ping any role can)" })),
      h("div", {}, h("h3", { text: "Permissions", style: "margin:4px 0 6px" }), h("div", { class: "stack" }, checks)),
      role && h("div", {}, h("h3", { text: "People with this role", style: "margin:10px 0 6px" }), members, h("div", { class: "row", style: "margin-top:8px" }, add, h("button", { class: "btn", type: "button", text: "Add", onclick: addGo }))),
      note);
    showDialog({
      title: role ? `Edit ${role.name}` : "Create a role", body, wide: true,
      actions: [
        { label: "Cancel", onClick: () => reload() },
        { label: role ? "Save" : "Create", kind: "primary", onClick: async () => {
          const payload = { name: name.value, color, mentionable: mentionable.checked, permissions: [...picked] };
          try { await A("POST", role ? `/roles/${role.id}` : "/roles", payload); toast(role ? "Saved." : "Role created.", "ok"); reload(); }
          catch (err) { note.textContent = err.message; note.dataset.state = "error"; return false; }
        } },
      ],
    });
    name.focus();
  }

  // ---------------------------------------------------------------------------------------
  // App Store: the approval queue, every app, and how new apps get in
  // ---------------------------------------------------------------------------------------

  const storeState = { status: "pending", q: "" };
  const setStoreCount = (counts) => {
    const badge = $("store-count");
    const todo = counts.pending + (counts.reported ?? 0);
    badge.hidden = !todo;
    badge.textContent = String(todo);
  };

  views.store = async () => {
    const s = storeState;
    const list = h("div");
    const tabs = h("div", { class: "tabs", role: "tablist" });
    const settingsBox = h("div", { class: "card section stack" });
    let counts = { pending: 0, approved: 0, rejected: 0, reported: 0 };

    const label = { pending: "Waiting", approved: "In the store", rejected: "Not approved", reported: "Reported" };
    const drawTabs = () => tabs.replaceChildren(...Object.entries(label).map(([status, text]) =>
      h("button", { class: "tab", role: "tab", type: "button", "aria-selected": String(s.status === status), text: `${text} (${counts[status]})`, onclick: () => { s.status = status; load(); } })));

    async function decide(button, app, action, body) {
      const result = await act(button, () => A("POST", `/store/apps/${app.id}/${action}`, body ?? {}));
      if (!result) return false;
      toast(action === "approve" ? `${app.name} is in the store.` : action === "dismiss" ? "The reports were dismissed." : action === "reject" ? `${app.name} was ${app.status === "approved" ? "taken down" : "rejected"}.` : `${app.name} was deleted.`, "ok");
      load();
      return true;
    }

    function peek(app) {
      const body = h("div", {},
        h("p", { class: "dim", text: app.description, style: "white-space:pre-wrap;overflow-wrap:anywhere;margin-bottom:12px" }),
        h("dl", { class: "kv" },
          h("dt", { text: "Name" }), h("dd", { text: app.name }),
          h("dt", { text: "Web address" }), h("dd", {}, h("a", { href: app.url, target: "_blank", rel: "noopener noreferrer", text: app.url, style: "color:inherit" })),
          h("dt", { text: "Made by" }), h("dd", { text: app.owner }),
          h("dt", { text: "Category" }), h("dd", { text: app.category }),
          h("dt", { text: "Sent" }), h("dd", { text: dateTime(app.created) }),
          app.reviewedBy && h("dt", { text: "Decided by" }), app.reviewedBy && h("dd", { text: `${app.reviewedBy}${app.reviewedAt ? `, ${ago(app.reviewedAt)}` : ""}` }),
          app.reason && h("dt", { text: "Reason given" }), app.reason && h("dd", { text: app.reason }),
          h("dt", { text: "Installs" }), h("dd", { text: number(app.installs) })),
        h("div", { id: "peek-reports" }),
        app.icon ? h("img", { src: `/api/store/icon/${app.id}?v=${app.icon}`, alt: "", width: "64", height: "64", style: "margin-top:12px;display:block" }) : null);
      const actions = [{ label: "Close" }];
      if (app.reports) actions.unshift({ label: "Dismiss reports", onClick: (b) => decide(b, app, "dismiss") });
      showDialog({ title: app.name, body, actions });
      if (app.reports) {
        A("GET", `/store/apps/${app.id}/reports`).then(({ reports }) => {
          const box = body.querySelector("#peek-reports");
          box.append(h("h3", { text: `Reports (${reports.length})`, style: "margin:14px 0 6px;font-size:15px" }),
            h("ul", { class: "feed" }, reports.map((r) => h("li", {}, h("span", { class: "when", title: dateTime(r.at), text: ago(r.at) }), h("span", {}, h("strong", { text: r.reporter }), ` ${r.reason}${r.note ? `: ${r.note}` : ""}`)))));
        }).catch(() => {});
      }
    }

    async function reject(button, app) {
      const taking = app.status === "approved";
      const reason = await askText(taking ? `Take down ${app.name}` : `Reject ${app.name}`, "Reason (the maker sees it)", { confirm: taking ? "Take down" : "Reject", danger: true, hint: "Optional, but it helps them fix it." });
      if (reason === null) return;
      decide(button, app, "reject", { reason });
    }

    async function load() {
      const data = await A("GET", `/store?${query({ status: s.status, q: s.q })}`);
      if (current !== "store") return;
      counts = data.counts;
      setStoreCount(counts);
      drawTabs();
      drawSettings(data.settings);
      const rows = data.apps.map((app) => h("tr", {},
        h("td", {}, h("a", { href: "#", text: app.name, style: "color:inherit", onclick: (e) => { e.preventDefault(); peek(app); } }), app.ownerIsAdmin && chip("ADMIN", "admin")),
        h("td", { text: app.owner }),
        h("td", {}, h("a", { href: app.url, target: "_blank", rel: "noopener noreferrer", text: new URL(app.url).hostname, title: app.url, style: "color:inherit" })),
        h("td", { text: app.category }),
        h("td", { title: dateTime(app.created), text: ago(app.created) }),
        h("td", { class: "num", text: number(app.installs) }),
        h("td", {}, app.reports ? chip(`${app.reports} report${app.reports === 1 ? "" : "s"}`, "red") : ""),
        h("td", {}, h("div", { class: "row end" },
          app.reports && h("button", { class: "btn small", type: "button", text: "Dismiss", onclick: (e) => decide(e.target, app, "dismiss") }),
          app.status !== "approved" && h("button", { class: "btn small primary", type: "button", text: "Approve", onclick: (e) => decide(e.target, app, "approve") }),
          app.status !== "rejected" && h("button", { class: "btn small", type: "button", text: app.status === "approved" ? "Take down…" : "Reject…", onclick: (e) => reject(e.target, app) }),
          h("button", { class: "btn small danger", type: "button", text: "Delete", onclick: async (e) => { if (await confirmBox(`Delete ${app.name}?`, "It is removed for good, along with its install counts.", { confirm: "Delete", danger: true })) decide(e.target, app, "delete"); } })))));
      list.replaceChildren(table(["App", "Made by", "Site", "Category", "Sent", "Installs", "Reports", ""], rows,
        s.q ? "Nothing matches." : s.status === "reported" ? "Nobody has reported an app." : s.status === "pending" ? "Nothing is waiting for approval." : s.status === "approved" ? "No apps are in the store yet." : "No apps have been turned down."));
    }

    function drawSettings(settings) {
      const approval = h("div", { class: "radios" },
        [["manual", "Approve each app", "New apps wait here until an admin approves them."], ["auto", "Approve automatically", "New apps go live in the store at once. You can still take any of them down."]].map(([value, title, text]) =>
          h("label", {}, h("input", { type: "radio", name: "approval", value, checked: settings.approval === value }), h("span", {}, h("strong", { text: title }), h("br"), h("small", { class: "dim", text })))));
      const publishing = h("input", { type: "checkbox", checked: settings.publishing });
      const maxPer = h("input", { class: "field", type: "number", min: "1", max: "50", value: String(settings.maxPerUser), style: "width:80px", "aria-label": "Apps each person can have" });
      const status = h("p", { class: "status" });
      const save = h("button", { class: "btn primary", type: "button", text: "Save", onclick: async (e) => {
        const chosen = approval.querySelector("input:checked")?.value;
        const result = await act(e.target, () => A("POST", "/store/settings", { approval: chosen, publishing: publishing.checked, maxPerUser: Number(maxPer.value) }), "App Store settings saved.");
        if (result) { status.textContent = "Saved."; status.dataset.state = "ok"; }
      } });
      settingsBox.replaceChildren(h("h3", { text: "How new apps get in" }), approval,
        h("label", { class: "check" }, publishing, h("span", { text: "People can publish new apps (turn off to pause publishing; admins can still publish)" })),
        h("label", { class: "row" }, h("span", { text: "Apps each person can have in the store at once" }), maxPer),
        h("div", { class: "row" }, save), status);
    }

    const q = h("input", { class: "field grow", type: "search", placeholder: "Search by app, site or maker", value: s.q, "aria-label": "Search apps" });
    const go = () => { s.q = q.value.trim(); load(); };
    q.addEventListener("keydown", (event) => { if (event.key === "Enter") go(); });
    main.replaceChildren(head("App Store"),
      h("p", { class: "dim section", text: "Apps are web addresses people publish for everyone to add to their desktop. They open through the proxy; nothing they publish runs on this site." }),
      settingsBox, tabs, h("div", { class: "toolbar" }, q, h("button", { class: "btn primary", type: "button", text: "Search", onclick: go })), list);
    await load();
  };

  // ---------------------------------------------------------------------------------------
  // Reveal highlight, like Settings: borders and surfaces glow near the pointer
  // ---------------------------------------------------------------------------------------

  {
    const REVEAL = ".nav-item, .tile, .card, .btn, .tab, .radios label";
    const REACH = 150; // px beyond an element's edge where its light still shows
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

  // ---------------------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------------------

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
    try { state = await SnAccount.status(true); } catch { return gate("Admin Panel", "The server could not be reached."); }
    if (!state.user) return gate("Sign in first", "The Admin Panel is for admins. Sign in with an admin account.", true);
    if (!state.user.admin) return gate("Admins only", "You're signed in as " + state.user.username + ", which isn't an admin.");
    me = state.user;
    $("gate").hidden = true;
    $("app").hidden = false;
    $("nav-foot").textContent = `Signed in as ${me.username}`;
    A("GET", "/store?status=none").then((d) => setStoreCount(d.counts), () => {}); // the badge on the App Store item
    show(location.hash.slice(1) || "dashboard");
  })();
})();
