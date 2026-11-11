/*
 * App Store app (the server side is src/store.js and src/storedb.js). Browse the apps people
 * published, add them to your desktop, and publish your own. Everything people typed is put on the
 * page with textContent, never as HTML, and an app is only ever an address: it opens through the
 * proxy like any site you add yourself.
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
  // Writes must be JSON (the server refuses anything else), even when there is nothing to say.
  const S = (method, path, body) => api(method, `/api/store${path}`, method === "POST" && body === undefined ? {} : body);
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

  const number = (n) => Number(n ?? 0).toLocaleString();
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
  function ago(ms) {
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 3600) return "just now";
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 60) return `${Math.round(s / 86400)} d ago`;
    return new Date(ms).toLocaleDateString();
  }

  const COLORS = ["#d9534f", "#e8892e", "#c9a227", "#43a047", "#16a085", "#2b8cd6", "#5c6bc0", "#8e44ad", "#d6457a", "#6d7b8a"];
  function colorFor(text) { let hash = 0; for (const c of text) hash = (hash * 31 + c.charCodeAt(0)) >>> 0; return COLORS[hash % COLORS.length]; }
  /** An app's picture, or its first letter on a colour when it has none (or the picture can't load). */
  function icon(app, size = "") {
    const box = h("span", { class: `app-icon ${size}`.trim(), "aria-hidden": "true" });
    const letter = () => { box.replaceChildren((app.name || "?").charAt(0).toUpperCase()); box.style.background = colorFor(hostOf(app.url)); };
    if (!app.icon) { letter(); return box; }
    const img = h("img", { alt: "" });
    img.addEventListener("error", letter, { once: true });
    img.src = `/api/store/icon/${app.id}?v=${app.icon}`;
    box.append(img);
    return box;
  }

  const chip = (text, tone = "") => h("span", { class: `chip ${tone}`.trim(), text });

  // ---------------------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------------------

  const dialog = $("dialog"), dialog2 = $("dialog2");
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
    d.replaceChildren(title ? h("h2", { text: title }) : "", body, bar);
    d.classList.toggle("wide", wide);
    d.showModal();
    return d;
  }
  for (const d of [dialog, dialog2]) d.addEventListener("mousedown", (event) => { if (event.target === d) d.close(); });

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

  // ---------------------------------------------------------------------------------------
  // Putting apps on the desktop (main.js keeps the person's own apps; the store only asks it to)
  // ---------------------------------------------------------------------------------------

  /** The desktop's id for an app that is already on it, or -1. */
  function desktopId(app) {
    try {
      const address = desktop.SnResolve.toUrl(app.url);
      const list = desktop.programData;
      for (let i = desktop.builtinCount; i < list.length; i++) if (list[i] && !list[i].removed && list[i].custom && list[i].proxy === address) return i;
    } catch { /* no desktop: nothing is installed */ }
    return -1;
  }

  async function install(app, button) {
    if (!desktop?.addApp) { toast("Open the App Store inside SuperNova OS to add apps to your desktop.", "error"); return; }
    return act(button, async () => {
      const result = await desktop.addApp(app.name, app.url, app.icon ? `/api/store/icon/${app.id}?v=${app.icon}` : null);
      if (result.error && desktopId(app) === -1) throw new Error(result.error);
      const counted = await S("POST", `/apps/${app.id}/install`);
      Object.assign(app, counted.app);
      toast(`${app.name} was added to your desktop.`, "ok");
      return true;
    });
  }

  function open(app) {
    const id = desktopId(app);
    if (id === -1) return;
    try { desktop.addWindow(id, null, null, desktop.DEF_WIN_W, desktop.DEF_WIN_H); } catch { toast("Couldn't open it from here. Find it on your desktop.", "error"); }
  }

  async function uninstall(app, button) {
    const id = desktopId(app);
    if (id === -1) return;
    if (!(await confirmBox(`Remove ${app.name}?`, "It leaves your desktop and taskbar. You can add it again from the store.", { confirm: "Remove", danger: true }))) return;
    return act(button, async () => {
      desktop.removeApp(id);
      await S("POST", `/apps/${app.id}/uninstall`);
      app.installed = false;
      toast(`${app.name} was removed from your desktop.`, "ok");
      return true;
    });
  }

  // ---------------------------------------------------------------------------------------
  // State and navigation
  // ---------------------------------------------------------------------------------------

  let me = null;
  let meta = { approval: "manual", publishing: true, maxPerUser: 5, categories: [] };
  const browse = { q: "", sort: "popular" };
  const views = {};
  let current = "";

  async function show(name) {
    const category = meta.categories.find((c) => c.id === name);
    if (!views[name] && !category) name = "home";
    current = name;
    for (const item of document.querySelectorAll(".nav-item")) {
      if (item.dataset.view === name) item.setAttribute("aria-current", "page"); else item.removeAttribute("aria-current");
    }
    main.replaceChildren(h("p", { class: "dim", text: "Loading…" }));
    main.scrollTop = 0;
    if (location.hash.slice(1) !== name) history.replaceState(null, "", `#${name}`);
    try {
      if (views[name]) await views[name](); else await views.browse(category);
    } catch (err) {
      if (current === name) main.replaceChildren(h("p", { class: "status", "data-state": "error", text: err.message }));
    }
  }
  addEventListener("hashchange", () => show(location.hash.slice(1)));

  function buildNav() {
    const box = $("nav-categories");
    const icons = {
      games: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 10v4M5 12h4M15.5 11h.01M18 13h.01"/>',
      tools: '<path d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5z"/>',
      social: '<path d="M4 5h16v11H11l-4 4v-4H4z"/>',
      media: '<rect x="3" y="5" width="18" height="14"/><path d="m10 9 5 3-5 3z"/>',
      learning: '<path d="M3 9l9-4 9 4-9 4z"/><path d="M7 11.5V16c1.4 1.4 3 2 5 2s3.6-.6 5-2v-4.5"/>',
      other: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
    };
    box.replaceChildren(...meta.categories.map((category) => {
      const item = h("button", { class: "nav-item", "data-view": category.id, type: "button" }, h("span", { text: category.label }));
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      svg.innerHTML = icons[category.id] ?? icons.other; // fixed markup above, nothing from the server
      item.prepend(svg);
      return item;
    }));
    for (const item of document.querySelectorAll(".nav-item")) item.addEventListener("click", () => show(item.dataset.view));
  }

  // ---------------------------------------------------------------------------------------
  // Browsing
  // ---------------------------------------------------------------------------------------

  function appCard(app, reload) {
    const installedNow = () => desktopId(app) !== -1;
    const button = h("button", { class: `btn small${installedNow() ? "" : " primary"}`, type: "button", text: installedNow() ? "Open" : "Get" });
    button.addEventListener("click", async () => {
      if (installedNow()) return open(app);
      if (await install(app, button)) reload();
    });
    return h("div", { class: "app-card" },
      h("button", { class: "hit", type: "button", "aria-label": `Details of ${app.name}`, onclick: () => details(app, reload) }),
      h("div", { class: "app-top" }, icon(app), h("div", { class: "app-text" }, h("div", { class: "app-name", text: app.name }), h("div", { class: "app-by", text: `by ${app.owner}` }))),
      h("p", { class: "app-desc", text: app.description }),
      h("div", { class: "app-foot" }, h("span", { text: `${number(app.installs)} ${app.installs === 1 ? "install" : "installs"}` }), button));
  }

  views.browse = async (category) => {
    const name = category?.id ?? "home";
    const grid = h("div", { class: "apps" });
    let timer = 0, token = 0;
    async function load() {
      const mine = ++token;
      const data = await S("GET", `/apps?${query({ q: browse.q, category: category?.id ?? "", sort: browse.sort })}`);
      if (mine !== token || current !== name) return;
      meta = { ...meta, ...data };
      if (!data.apps.length) {
        grid.replaceChildren(h("p", { class: "empty", style: "grid-column:1/-1", text: browse.q ? "No apps match your search." : category ? `No ${category.label.toLowerCase()} apps yet.` : "The store is empty. Be the first to publish an app." }));
        return;
      }
      grid.replaceChildren(...data.apps.map((app) => appCard(app, load)));
    }
    const q = h("input", { class: "field grow", type: "search", placeholder: category ? `Search ${category.label.toLowerCase()}` : "Search apps, descriptions and makers", value: browse.q, "aria-label": "Search the store", maxlength: "60" });
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { browse.q = q.value.trim(); load().catch((e) => toast(e.message, "error")); }, 250); });
    const sort = h("select", { class: "field select-sort", "aria-label": "Order" }, [["popular", "Most installed"], ["new", "Newest"], ["name", "A to Z"]].map(([v, t]) => h("option", { value: v, text: t })));
    sort.value = browse.sort;
    sort.addEventListener("change", () => { browse.sort = sort.value; load().catch((e) => toast(e.message, "error")); });
    main.replaceChildren(
      h("div", { class: "view-head" }, h("h2", { text: category ? category.label : "App Store" }), h("button", { class: "btn primary", type: "button", text: "Publish an app", onclick: () => editor(null, () => show("mine")) })),
      // (replaceChildren turns a stray false into the text "false", so leave the line out instead of passing false)
      ...(category ? [] : [h("p", { class: "lead", text: "Apps made by people on this site. Get one and it joins your desktop, and it opens like any other app." })]),
      h("div", { class: "toolbar" }, q, sort),
      grid);
    await load();
  };
  views.home = () => views.browse(null);

  function details(app, reload) {
    const id = () => desktopId(app);
    const body = h("div", {},
      h("div", { class: "detail-head" }, icon(app, "big"), h("div", {}, h("h2", { text: app.name }), h("div", { class: "dim", text: `by ${app.owner}` }),
        h("div", { style: "margin-top:6px" }, chip(meta.categories.find((c) => c.id === app.category)?.label ?? app.category), chip(`${number(app.installs)} ${app.installs === 1 ? "install" : "installs"}`)))),
      h("p", { class: "detail-text", text: app.description }),
      h("dl", { class: "kv" }, h("dt", { text: "Opens" }), h("dd", { text: hostOf(app.url) }), h("dt", { text: "Added" }), h("dd", { text: ago(app.created) })),
      h("p", { class: "notice", text: "Apps are made by other people and open through the proxy, like any site you add yourself. Only add apps you trust." }));
    const actions = [{ label: "Close" }];
    if (me && app.owner === me.username) actions.unshift({ label: "Edit", onClick: () => { setTimeout(() => editor(app, reload), 0); } });
    else actions.unshift({ label: "Report", onClick: () => { setTimeout(() => reportApp(app), 0); } });
    if (id() !== -1) {
      actions.push({ label: "Remove from desktop", kind: "danger", onClick: async (b) => { if (await uninstall(app, b)) reload(); } });
      actions.push({ label: "Open", kind: "primary", onClick: () => { open(app); } });
    } else {
      actions.push({ label: "Get", kind: "primary", onClick: async (b) => { if (await install(app, b)) { reload(); return true; } return false; } });
    }
    showDialog({ body, actions });
  }

  /** Tell the admins something is wrong with an app. */
  function reportApp(app) {
    const reasons = meta.reportReasons ?? [];
    const note = h("textarea", { class: "field", rows: "3", maxlength: "200", placeholder: "Tell us more (optional)" });
    const message = h("p", { class: "status" });
    const choices = h("div", { class: "radios", style: "flex-direction:column" }, reasons.map((r, i) =>
      h("label", {}, h("input", { type: "radio", name: "reason", value: r.id, checked: i === 0 }), h("span", { text: r.label }))));
    showDialog({
      title: `Report ${app.name}`,
      body: h("div", { class: "form-grid" }, h("p", { class: "dim", text: "An admin will look at it. Reports are private: the maker doesn't see who sent them." }), choices, note, message),
      actions: [
        { label: "Cancel" },
        { label: "Send report", kind: "primary", onClick: async () => {
          try {
            await S("POST", `/apps/${app.id}/report`, { reason: choices.querySelector("input:checked")?.value, note: note.value });
            toast("Thanks. An admin will look at it.", "ok");
          } catch (error) { message.textContent = error.message; message.dataset.state = "error"; return false; }
        } },
      ],
    });
  }

  // ---------------------------------------------------------------------------------------
  // Your apps and the publish form
  // ---------------------------------------------------------------------------------------

  const STATUS = {
    approved: ["In the store", "green"],
    pending: ["Waiting for approval", "amber"],
    rejected: ["Not approved", "red"],
  };

  views.mine = async () => {
    const data = await S("GET", "/mine");
    if (current !== "mine") return;
    meta = { ...meta, ...data };
    showMineCount(data.apps);
    const reload = () => show("mine");
    const rows = data.apps.map((app) => {
      const [label, tone] = STATUS[app.status];
      return h("div", { class: "mine-row" },
        icon(app, "small"),
        h("div", { class: "app-text" },
          h("div", { class: "app-name", text: app.name }, chip(label, tone)),
          h("div", { class: "app-by", text: `${hostOf(app.url)} · ${number(app.installs)} ${app.installs === 1 ? "install" : "installs"}` }),
          app.status === "rejected" && h("div", { class: "why", text: app.reason ? `Reason: ${app.reason}` : "An admin didn't approve this app. Change it and send it again." })),
        h("div", { class: "mine-actions" },
          h("button", { class: "btn small", type: "button", text: app.status === "rejected" ? "Fix and resend" : "Edit", onclick: () => editor(app, reload) }),
          h("button", { class: "btn small danger", type: "button", text: "Remove", onclick: async (event) => {
            if (!(await confirmBox(`Remove ${app.name}?`, "It leaves the store for everyone. People who already added it keep it on their desktop.", { confirm: "Remove", danger: true }))) return;
            if (await act(event.target, () => S("POST", `/apps/${app.id}/delete`, {}), `${app.name} was removed.`)) reload();
          } })));
    });
    const how = meta.approval === "auto" ? "New apps go live in the store right away." : "An admin looks at new apps before they appear in the store.";
    main.replaceChildren(
      h("div", { class: "view-head" }, h("h2", { text: "Your apps" }), h("button", { class: "btn primary", type: "button", text: "Publish an app", onclick: () => editor(null, reload) })),
      h("p", { class: "lead", text: `${how} You can have ${meta.maxPerUser} apps in the store at once.${meta.publishing ? "" : " Publishing is paused right now."}` }),
      rows.length ? h("div", { class: "mine" }, rows) : h("div", { class: "tablewrap" }, h("p", { class: "empty", text: "You haven't published anything yet. Got a site or a game people would like? Publish it." })));
  };

  function showMineCount(apps) {
    const waiting = apps.filter((a) => a.status !== "approved").length;
    const badge = $("mine-count");
    badge.hidden = !waiting;
    badge.textContent = String(waiting);
  }

  /** A picture file, cropped square and made small in the browser: Promise of a base64 string. */
  async function prepareIcon(file) {
    const bitmap = await createImageBitmap(file).catch(() => { throw new Error("That file isn't a picture this browser can read. Try a PNG or JPEG."); });
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const context = canvas.getContext("2d");
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const w = bitmap.width * scale, hgt = bitmap.height * scale;
    context.drawImage(bitmap, (size - w) / 2, (size - hgt) / 2, w, hgt);
    const encode = (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    let blob = null;
    for (const [type, quality] of [["image/png"], ["image/webp", 0.85], ["image/webp", 0.6]]) {
      blob = await encode(type, quality);
      if (blob && blob.type === type && blob.size <= 100 * 1024) break;
      blob = null;
    }
    if (!blob) throw new Error("That picture is too detailed. Try a simpler one.");
    const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
    return String(dataUrl).split(",")[1];
  }

  /** The form for a new app (app = null) or for changing one of yours. */
  function editor(app, done) {
    if (!app && !meta.publishing && !me?.admin) { toast("Publishing is paused right now. You can still browse and add apps.", "error"); return; }
    let pictureData; // undefined: unchanged, null: removed, string: new
    const name = h("input", { class: "field", maxlength: "40", value: app?.name ?? "", autocomplete: "off", spellcheck: "false" });
    const url = h("input", { class: "field", type: "text", maxlength: "500", value: app?.url ?? "", placeholder: "example.com", autocomplete: "off", spellcheck: "false", inputmode: "url" });
    const category = h("select", { class: "field" }, meta.categories.map((c) => h("option", { value: c.id, text: c.label })));
    category.value = app?.category ?? meta.categories[0]?.id;
    const description = h("textarea", { class: "field", rows: "4", maxlength: "300" });
    description.value = app?.description ?? "";
    const counter = h("span", { class: "counter" });
    const count = () => { counter.textContent = `${Array.from(description.value).length} / 300`; };
    description.addEventListener("input", count);
    count();
    const preview = h("span");
    const paint = () => {
      const shown = pictureData === null ? { ...app, icon: 0 } : pictureData ? { id: 0, name: name.value || "?", url: url.value || "x.com", icon: 0 } : { id: app?.id ?? 0, name: name.value || app?.name || "?", url: url.value || app?.url || "x.com", icon: app?.icon ?? 0 };
      const box = icon(shown, "big");
      if (typeof pictureData === "string") { box.replaceChildren(h("img", { alt: "", src: `data:image/png;base64,${pictureData}` })); box.style.background = "transparent"; }
      preview.replaceChildren(box);
    };
    const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif" });
    const note = h("p", { class: "status" });
    file.addEventListener("change", async () => {
      const chosen = file.files?.[0];
      file.value = "";
      if (!chosen) return;
      try { pictureData = await prepareIcon(chosen); note.textContent = ""; paint(); } catch (error) { note.textContent = error.message; note.dataset.state = "error"; }
    });
    const remove = h("button", { class: "btn small", type: "button", text: "Remove picture", onclick: () => { pictureData = null; paint(); } });
    paint();
    for (const field of [name, url]) field.addEventListener("input", () => { if (pictureData === undefined && !app?.icon) paint(); });

    const rule = meta.approval === "auto" || me?.admin ? "Your app goes live in the store as soon as you publish it." : "An admin looks at your app before it appears in the store.";
    const warnEdit = app && app.status === "approved" && meta.approval === "manual" && !me?.admin ? " Changing a live app sends it back for approval first." : "";
    const body = h("div", { class: "form-grid" },
      h("label", { class: "labeled" }, h("span", { text: "Name" }), name),
      h("label", { class: "labeled" }, h("span", { text: "Web address" }), url, h("small", { class: "faint", text: "The site that opens when someone starts your app. It has to be public." })),
      h("label", { class: "labeled" }, h("span", { text: "Category" }), category),
      h("label", { class: "labeled" }, h("span", {}, "Description", counter), description),
      h("div", {}, h("span", { text: "Picture (optional)" }),
        h("div", { class: "icon-pick", style: "margin-top:6px" }, preview, h("button", { class: "btn small", type: "button", text: "Choose a picture", onclick: () => file.click() }), remove, file)),
      note,
      h("p", { class: "notice", text: rule + warnEdit }));

    showDialog({
      title: app ? `Edit ${app.name}` : "Publish an app",
      body,
      wide: true,
      actions: [
        { label: "Cancel" },
        { label: app ? (app.status === "rejected" ? "Send again" : "Save") : "Publish", kind: "primary", onClick: async () => {
          const payload = { name: name.value, url: url.value, category: category.value, description: description.value };
          if (pictureData !== undefined) payload.icon = pictureData;
          try {
            const result = await S("POST", app ? `/apps/${app.id}` : "/apps", payload);
            const saved = result.app;
            toast(app ? (saved.status === "pending" ? "Saved. An admin will look at it before it goes back in the store." : "Saved.") : result.live ? "Published. It's in the store now." : "Sent for approval. An admin will look at it soon.", "ok");
            done?.();
          } catch (error) {
            note.textContent = error.message; note.dataset.state = "error";
            return false;
          }
        } },
      ],
    });
    name.focus();
  }

  // ---------------------------------------------------------------------------------------
  // Reveal highlight, like Settings: borders and surfaces glow near the pointer
  // ---------------------------------------------------------------------------------------

  {
    const REVEAL = ".nav-item, .app-card, .mine-row, .btn, .radios label";
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
    try { state = await SnAccount.status(true); } catch { return gate("App Store", "The server could not be reached."); }
    if (!state.user) return gate("Sign in first", "The App Store is for people with an account on this site. Sign in to browse, get and publish apps.", true);
    me = state.user;
    try {
      const data = await S("GET", "/apps?limit=1");
      meta = { ...meta, ...data };
    } catch (err) { return gate("App Store", err.message); }
    $("gate").hidden = true;
    $("app").hidden = false;
    $("nav-foot").textContent = `Signed in as ${me.username}`;
    buildNav();
    S("GET", "/mine").then((data) => showMineCount(data.apps), () => {});
    show(location.hash.slice(1) || "home");
  })();
})();
