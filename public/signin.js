/*
 * The sign-in screen: shown instead of the desktop when the site needs an account
 * (ACCOUNTS=required), and at /setup on a fresh site. It is a Windows 10 lock screen
 * (see signin.css for the states) in front of the real sign-in. Signing in goes through
 * SnAccount, so this browser picks up the account's settings exactly as it does from
 * Settings > Account.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const root = document.documentElement;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // Where to go afterwards: a path on this site (the server checks this too).
  const next = (() => {
    const value = new URLSearchParams(location.search).get("next") ?? "/";
    return /^\/(?![/\\])/.test(value) && !value.startsWith("/signin") ? value : "/";
  })();
  const proceed = () => location.replace(next);

  // localStorage can be blocked: every read and write is allowed to fail.
  const keep = {
    get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (key, value) => { try { localStorage.setItem(key, value); } catch { /* not saved */ } },
  };

  // ----------------------------------------------------------------------------------------
  // Motion: full effects, or reduced (Ease of access, or the system setting)
  // ----------------------------------------------------------------------------------------

  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const motionReduced = () => root.dataset.motion === "reduced";
  function setMotion(mode) {
    root.dataset.motion = mode;
    $("opt-reduce").checked = mode === "reduced";
    if (mode === "reduced") dust.stop(); else dust.start();
  }

  // ----------------------------------------------------------------------------------------
  // The wallpaper: a different picture each visit, drifting slowly, with a little parallax
  // ----------------------------------------------------------------------------------------

  const WALLPAPERS = [
    ["space.jpg", "Deep space"],
    ["OrionNebula.jpg", "Orion Nebula"],
    ["WebbDeepField.jpg", "Webb Deep Field"],
    ["Pillars.jpg", "Pillars of Creation"],
    ["Saturn.jpg", "Saturn"],
    ["Synthwave.jpg", "Synthwave"],
  ];
  let wallIndex = (Number(keep.get("sn-signin-wall")) + 1) % WALLPAPERS.length || 0;
  let wallBusy = false;

  async function showWallpaper(index) {
    const [file, name] = WALLPAPERS[index];
    const src = `/resources/media/wallpapers/${file}`;
    const sharp = $("wall-sharp"), blur = $("wall-blur");
    sharp.src = blur.src = src;
    try { await sharp.decode(); } catch { /* shown when it arrives */ }
    $("wall-name").textContent = name;
    sharp.classList.add("ready");
    blur.classList.add("ready");
    keep.set("sn-signin-wall", String(index));
  }

  // "Like what you see?" shows the next picture.
  $("credit").addEventListener("click", async (event) => {
    event.stopPropagation();
    if (wallBusy) return;
    wallBusy = true;
    body.classList.add("is-swapping");
    await sleep(280);
    wallIndex = (wallIndex + 1) % WALLPAPERS.length;
    await showWallpaper(wallIndex);
    body.classList.remove("is-swapping");
    wallBusy = false;
  });

  // Parallax: the picture and the clock drift a little against the pointer, for depth.
  {
    let frame = 0, nx = 0, ny = 0;
    const apply = () => {
      frame = 0;
      $("wall").style.setProperty("--px", `${(-nx * 16).toFixed(1)}px`);
      $("wall").style.setProperty("--py", `${(-ny * 10).toFixed(1)}px`);
      $("lock-clock").style.setProperty("--cx", `${(nx * 10).toFixed(1)}px`);
      $("lock-clock").style.setProperty("--cy", `${(ny * 6).toFixed(1)}px`);
    };
    addEventListener("pointermove", (event) => {
      if (event.pointerType === "touch" || motionReduced()) return;
      nx = event.clientX / innerWidth - 0.5;
      ny = event.clientY / innerHeight - 0.5;
      if (!frame) frame = requestAnimationFrame(apply);
    }, { passive: true });
  }

  // ----------------------------------------------------------------------------------------
  // Floating dust: a few dozen soft specks that drift upward and twinkle
  // ----------------------------------------------------------------------------------------

  const dust = (() => {
    const canvas = $("dust");
    const ctx = canvas.getContext("2d");
    const specks = [];
    let width = 0, height = 0, ratio = 1, frame = 0, last = 0;

    function resize() {
      ratio = Math.min(devicePixelRatio || 1, 1.5);
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }

    function speck(anywhere) {
      return {
        x: Math.random() * width,
        y: anywhere ? Math.random() * height : height + 10,
        r: 0.6 + Math.random() * 2.2,
        vy: 6 + Math.random() * 16,        // pixels per second, upward
        vx: (Math.random() - 0.5) * 8,
        phase: Math.random() * Math.PI * 2,
        glow: Math.random() < 0.2,
      };
    }

    function draw(time) {
      frame = requestAnimationFrame(draw);
      const dt = Math.min((time - last) / 1000, 0.1);
      last = time;
      ctx.clearRect(0, 0, width, height);
      for (const s of specks) {
        s.y -= s.vy * dt;
        s.x += s.vx * dt + Math.sin(time / 2400 + s.phase) * 0.12;
        if (s.y < -12) Object.assign(s, speck(false));
        const alpha = 0.25 + 0.4 * (0.5 + 0.5 * Math.sin(time / 900 + s.phase));
        if (s.glow) {
          ctx.fillStyle = `rgba(255,255,255,${(alpha * 0.18).toFixed(3)})`;
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 4.5, 0, 6.283); ctx.fill();
        }
        ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
      }
    }

    const api = {
      start() {
        if (frame || motionReduced() || document.hidden) return;
        resize();
        const count = Math.round(Math.min(60, Math.max(24, (width * height) / 28000)));
        while (specks.length < count) specks.push(speck(true));
        specks.length = count;
        last = performance.now();
        frame = requestAnimationFrame(draw);
      },
      stop() {
        cancelAnimationFrame(frame);
        frame = 0;
        ctx.clearRect(0, 0, width, height);
      },
    };
    addEventListener("resize", () => { if (frame) resize(); });
    document.addEventListener("visibilitychange", () => (document.hidden ? api.stop() : api.start()));
    return api;
  })();

  // ----------------------------------------------------------------------------------------
  // The clock
  // ----------------------------------------------------------------------------------------

  const timeFormat = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
  const dateFormat = new Intl.DateTimeFormat([], { weekday: "long", month: "long", day: "numeric" });
  let shownTime = "";

  function tickClock() {
    const now = new Date();
    // "7:01", without AM or PM, like Windows' lock screen
    const time = timeFormat.formatToParts(now).filter((part) => part.type !== "dayPeriod").map((part) => part.value).join("").trim();
    if (time !== shownTime) {
      $("lock-time").textContent = time;
      $("lock-date").textContent = dateFormat.format(now);
      if (shownTime) {
        $("lock-time").classList.remove("tick");
        void $("lock-time").offsetWidth;
        $("lock-time").classList.add("tick");
      }
      shownTime = time;
    }
    setTimeout(tickClock, 60000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 40);
  }

  // ----------------------------------------------------------------------------------------
  // Lock screen <-> sign-in
  // ----------------------------------------------------------------------------------------

  const lock = $("lock");
  const login = $("login");
  const isLocked = () => body.classList.contains("is-locked");
  let ready = false;     // the account state has arrived and the right panel is showing
  let busy = false;      // signing in: nothing else may start

  login.inert = true;

  function unlock() {
    if (!isLocked() || busy) return;
    lock.style.removeProperty("--lock-y");
    lock.classList.remove("dragging");
    body.classList.remove("is-locked");
    body.classList.add("is-signin");
    lock.inert = true;
    lock.setAttribute("aria-hidden", "true");
    login.inert = false;
    armIdle();
    setTimeout(focusForm, motionReduced() ? 30 : 650);
  }

  function relock() {
    if (isLocked() || busy) return;
    for (const input of login.querySelectorAll("input")) if (input.type === "password") { input.value = ""; input.type = "password"; }
    document.activeElement?.blur?.();
    body.classList.remove("is-signin");
    body.classList.add("is-locked");
    login.inert = true;
    lock.inert = false;
    lock.removeAttribute("aria-hidden");
    flyouts.close();
    lock.focus({ preventScroll: true });
  }

  // Click, any key, scrolling, or dragging up
  {
    let startY = 0, pointer = null, dragged = false;

    lock.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".credit")) return;
      // With a menu open, the first click only closes the menu.
      if (flyouts.anyOpen()) { flyouts.close(); pointer = null; return; }
      pointer = event.pointerId;
      startY = event.clientY;
      dragged = false;
      lock.setPointerCapture?.(pointer);
    });
    lock.addEventListener("pointermove", (event) => {
      if (event.pointerId !== pointer) return;
      const dy = Math.min(0, event.clientY - startY);
      if (!dragged && dy > -8) return;
      dragged = true;
      lock.classList.add("dragging");
      lock.style.setProperty("--lock-y", `${dy}px`);
    });
    const release = (event) => {
      if (event.pointerId !== pointer) return;
      pointer = null;
      const dy = Math.min(0, event.clientY - startY);
      lock.classList.remove("dragging");
      if (!dragged || dy < -innerHeight * 0.16) unlock();            // a click, or pulled far enough
      else lock.style.setProperty("--lock-y", "0px");               // let go early: spring back
    };
    lock.addEventListener("pointerup", release);
    lock.addEventListener("pointercancel", (event) => { if (event.pointerId === pointer) { pointer = null; lock.classList.remove("dragging"); lock.style.setProperty("--lock-y", "0px"); } });

    lock.addEventListener("wheel", (event) => { if (event.deltaY > 8) unlock(); }, { passive: true });
  }

  const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "NumLock", "ScrollLock", "AltGraph", "OS"]);
  document.addEventListener("keydown", (event) => {
    if ($("sleep").hidden === false) return;
    if (event.key === "Escape" && flyouts.anyOpen()) { flyouts.close(); return; }
    if (isLocked()) {
      if (MODIFIER_KEYS.has(event.key) || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      unlock();
      return;
    }
    if (event.key === "Escape") {
      // Back to the lock screen, but never throw away something that was typed.
      if (!busy && $("code").hidden && !typedAnything()) relock();
    }
    armIdle();
  });

  const typedAnything = () => [...login.querySelectorAll("input")].some((input) => input.value);

  // After a minute of nobody touching anything, go back to the lock screen (like Windows).
  let idleTimer = 0;
  function armIdle() {
    clearTimeout(idleTimer);
    if (isLocked() || busy) return;
    idleTimer = setTimeout(() => {
      if (!typedAnything() && $("code").hidden) relock();
      else armIdle();
    }, 75000);
  }
  for (const type of ["pointerdown", "input"]) addEventListener(type, armIdle, { passive: true });

  // ----------------------------------------------------------------------------------------
  // The status icons: network, battery, ease of access, power
  // ----------------------------------------------------------------------------------------

  {
    const net = $("tray-net");
    const sync = () => {
      const online = navigator.onLine !== false;
      net.dataset.offline = String(!online);
      net.title = online ? "Connected" : "No connection";
      net.setAttribute("aria-label", online ? "Network: connected" : "Network: no connection");
    };
    addEventListener("online", sync);
    addEventListener("offline", sync);
    sync();

    // Laptops show their battery, like the real lock screen. Browsers without the API show nothing.
    navigator.getBattery?.().then((battery) => {
      const icon = $("tray-battery");
      const update = () => {
        const percent = Math.round(battery.level * 100);
        icon.hidden = false;
        icon.style.setProperty("--level", String(Math.max(0.06, battery.level)));
        icon.dataset.charging = String(battery.charging);
        icon.title = `${percent}%${battery.charging ? ", charging" : ""}`;
        icon.setAttribute("aria-label", `Battery: ${percent}%${battery.charging ? ", charging" : ""}`);
      };
      update();
      battery.addEventListener("levelchange", update);
      battery.addEventListener("chargingchange", update);
    }).catch(() => { /* no battery information */ });
  }

  const flyouts = (() => {
    const entries = [["tray-access", "flyout-access"], ["tray-power", "flyout-power"]].map(([button, menu]) => ({ button: $(button), menu: $(menu) }));
    const api = {
      anyOpen: () => entries.some((entry) => !entry.menu.hidden),
      close() { for (const entry of entries) { entry.menu.hidden = true; entry.button.setAttribute("aria-expanded", "false"); } },
    };
    for (const entry of entries) {
      entry.button.addEventListener("click", (event) => {
        event.stopPropagation();
        const open = entry.menu.hidden;
        api.close();
        entry.menu.hidden = !open;
        entry.button.setAttribute("aria-expanded", String(open));
        if (open) entry.menu.querySelector("button, input")?.focus();
      });
    }
    document.addEventListener("pointerdown", (event) => { if (!event.target.closest(".tray")) api.close(); });
    return api;
  })();

  $("opt-reduce").addEventListener("change", () => {
    const mode = $("opt-reduce").checked ? "reduced" : "full";
    keep.set("sn-signin-motion", mode);
    setMotion(mode);
  });

  // Sleep: the screen goes black until you touch it. Restart: back to black, then a fresh start.
  $("power-sleep").addEventListener("click", () => {
    flyouts.close();
    const cover = $("sleep");
    cover.classList.remove("out");
    cover.hidden = false;
    setTimeout(() => {
      const wake = () => {
        removeEventListener("keydown", wake, true);
        removeEventListener("pointerdown", wake, true);
        cover.classList.add("out");
        setTimeout(() => { cover.hidden = true; cover.classList.remove("out"); }, 420);
      };
      addEventListener("keydown", wake, true);
      addEventListener("pointerdown", wake, true);
    }, 700);
  });
  $("power-restart").addEventListener("click", async () => {
    flyouts.close();
    $("restart").hidden = false;
    await sleep(motionReduced() ? 300 : 1700);
    location.reload();
  });

  // ----------------------------------------------------------------------------------------
  // The avatar and the name under it
  // ----------------------------------------------------------------------------------------

  const COLORS = ["#d9534f", "#e8892e", "#c9a227", "#43a047", "#16a085", "#2b8cd6", "#5c6bc0", "#8e44ad", "#d6457a", "#6d7b8a"];
  const colorFor = (name) => {
    let hash = 0;
    for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return COLORS[hash % COLORS.length];
  };

  const avatar = $("avatar");
  let shownLetter = "";

  function restart(element, className) {
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
  }

  /** The initial of the typed name on a colour, or the plain silhouette when there is none. */
  function setAvatar(name) {
    const letter = name ? [...name][0].toUpperCase() : "";
    if (letter === shownLetter) return;
    shownLetter = letter;
    $("avatar-letter").textContent = letter;
    avatar.style.background = letter ? colorFor(name) : "";
    avatar.classList.toggle("has-letter", Boolean(letter));
    restart(avatar, "pop");
  }

  const who = $("who");
  function setTitle(text, animate = true) {
    if (who.textContent === text) return;
    who.textContent = text;
    if (animate) restart(who, "swap");
  }

  const TITLES = { login: "SuperNova OS", register: "Create an account", recover: "Reset your password", setup: "Set up SuperNova OS", code: "Save your recovery code" };
  let mode = "login";

  /** Keep the picture and the heading in step with what is typed in the visible form. */
  function identify() {
    const setup = !$("setup").hidden;
    const name = (setup ? $("form-setup") : forms[mode]).elements.username.value.trim();
    setAvatar(name);
    // Only the sign-in screen shows the typed name as the heading, like Windows does.
    if (setup || mode !== "login") return;
    setTitle(name || TITLES.login, !name !== !who.dataset.named);
    who.dataset.named = name ? "1" : "";
  }

  // ----------------------------------------------------------------------------------------
  // The forms
  // ----------------------------------------------------------------------------------------

  const forms = { login: $("form-login"), register: $("form-register"), recover: $("form-recover") };

  function focusForm() {
    if (isLocked() || busy || !ready) return;
    const panel = !$("setup").hidden ? $("form-setup") : !$("code").hidden ? null : forms[mode];
    if (!panel) { $("continue").focus(); return; }
    const first = [...panel.querySelectorAll("input")].find((input) => !input.value && !input.closest("[hidden]")) ?? panel.querySelector("input");
    first?.focus({ preventScroll: true });
  }

  function show(next_) {
    mode = next_;
    for (const [key, form] of Object.entries(forms)) {
      form.hidden = key !== mode;
      form.querySelector(".error").textContent = "";
    }
    // Carry the typed username over between the forms.
    const typed = Object.values(forms).map((form) => form.elements.username.value).find(Boolean) ?? "";
    forms[mode].elements.username.value ||= typed;
    setTitle(mode === "login" ? (forms.login.elements.username.value.trim() || TITLES.login) : TITLES[mode]);
    who.dataset.named = mode === "login" && forms.login.elements.username.value.trim() ? "1" : "";
    setAvatar(forms[mode].elements.username.value.trim());
    forms[mode].elements[forms[mode].elements.username.value ? (mode === "recover" ? "code" : "password") : "username"].focus({ preventScroll: true });
  }

  document.querySelectorAll("[data-show]").forEach((button) => button.addEventListener("click", () => show(button.dataset.show)));

  // The eye: show the password while you check what you typed.
  for (const wrap of document.querySelectorAll(".field.pw")) {
    const input = wrap.querySelector("input"), peek = wrap.querySelector(".peek");
    input.addEventListener("input", () => { peek.hidden = !input.value; if (!input.value) { input.type = "password"; peek.setAttribute("aria-label", "Show password"); } });
    peek.addEventListener("click", () => {
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      peek.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      input.focus();
    });
  }

  // Caps lock, for anyone typing a password
  document.addEventListener("keydown", warnCaps);
  document.addEventListener("keyup", warnCaps);
  function warnCaps(event) {
    if (!event.getModifierState || event.target?.type !== "password") return;
    const form = event.target.closest("form");
    const note = form?.querySelector(".caps");
    if (note) note.hidden = !event.getModifierState("CapsLock");
  }

  for (const form of [...Object.values(forms), $("form-setup")]) {
    for (const input of form.querySelectorAll("input")) input.addEventListener("input", () => { if (input.name === "username") identify(); });
  }

  function setBusy(form, on) {
    busy = on;
    for (const button of form.querySelectorAll("button[type='submit']")) { button.disabled = on; button.classList.toggle("busy", on); }
    if (on) armIdle();
  }

  function failed(form, message) {
    const error = form.querySelector(".error");
    error.textContent = message;
    if (!motionReduced()) { restart($("stack"), "shake"); restart(avatar, "fail"); }
    // Windows clears the password and puts you back in the box.
    const password = form.elements.password;
    if (password && form === forms.login) { password.value = ""; password.type = "password"; form.querySelector(".peek").hidden = true; password.focus(); }
  }

  let pending = null; // { user, kind } while the recovery code is on screen

  function submitting(form, action, kind) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (busy) return;
      form.querySelector(".error").textContent = "";
      setBusy(form, true);
      try {
        const result = await action(form.elements);
        if (result.recoveryCode) {
          pending = { user: result.user, kind };
          $("recovery-code").textContent = result.recoveryCode;
          $("forms").hidden = true;
          $("setup").hidden = true;
          $("code").hidden = false;
          setTitle(TITLES.code);
          setBusy(form, false);
          $("continue").focus();
        } else {
          welcome(result.user, kind);
        }
      } catch (err) {
        setBusy(form, false);
        failed(form, err.message);
      }
    });
  }

  submitting(forms.login, (f) => SnAccount.login(f.username.value, f.password.value), "login");
  submitting(forms.register, (f) => {
    if (f.password.value !== f.confirm.value) return Promise.reject(new Error("The passwords don't match."));
    return SnAccount.register(f.username.value, f.password.value, f.invite.value);
  }, "new");
  submitting(forms.recover, (f) => SnAccount.recover(f.username.value, f.code.value, f.password.value), "login");
  submitting($("form-setup"), (f) => {
    if (f.password.value !== f.confirm.value) return Promise.reject(new Error("The passwords don't match."));
    return SnAccount.setup(f.code.value, f.username.value, f.password.value);
  }, "new");

  $("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("recovery-code").textContent);
      $("copy").textContent = "Copied";
    } catch {
      getSelection().selectAllChildren($("recovery-code"));
    }
  });
  $("continue").addEventListener("click", () => {
    if (pending) welcome(pending.user, pending.kind); else proceed();
  });

  // ----------------------------------------------------------------------------------------
  // Welcome: the picture stays, the dots chase each other, a greeting changes, then the desktop
  // ----------------------------------------------------------------------------------------

  /** Ask the browser to fetch the desktop's main files now, while the animation plays. */
  function prefetchDesktop() {
    for (const href of ["/resources/css/styles.css", "/resources/scripts/main.js", "/proxy/core.js", "/proxy/resolve.js"]) {
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.href = href;
      document.head.append(link);
    }
  }

  async function welcome(user, kind) {
    busy = true;
    flyouts.close();
    clearTimeout(idleTimer);
    document.activeElement?.blur?.();
    body.classList.add("is-welcome");
    login.inert = true;
    setAvatar(user.username);

    // Their real picture, if they have one, fades in over the initial.
    const url = SnAccount.avatarUrl(user.username, user.avatar);
    if (url) {
      const picture = $("avatar-picture");
      picture.src = url;
      picture.decode().then(() => avatar.classList.add("has-picture")).catch(() => { /* keep the initial */ });
    }
    prefetchDesktop();

    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const steps = motionReduced()
      ? [["Welcome", 700]]
      : kind === "new"
        ? [["Hi", 1000], ["We're setting things up for you", 1500], ["This will only take a moment", 1300], [`Welcome, ${user.username}`, 1000]]
        : [["Welcome", 1000], [`${greeting}, ${user.username}`, 1000], ["Loading your desktop", 800]];
    for (const [text, ms] of steps) {
      setTitle(text);
      await sleep(ms);
    }
    body.classList.add("is-leaving");
    await sleep(motionReduced() ? 40 : 650);
    proceed();
  }

  // ----------------------------------------------------------------------------------------
  // Start
  // ----------------------------------------------------------------------------------------

  const stored = keep.get("sn-signin-motion");
  setMotion(stored === "reduced" || stored === "full" ? stored : reducedQuery.matches ? "reduced" : "full");
  showWallpaper(wallIndex);
  tickClock();
  lock.focus({ preventScroll: true });

  const onSetupPage = location.pathname === "/setup";
  if (onSetupPage) unlock(); // first run: straight to the form, no lock screen in the way

  SnAccount.status().then((state) => {
    if (state.user) { proceed(); return; }
    $("loading").hidden = true;
    ready = true;
    if (onSetupPage && state.setup) {
      $("footnote").hidden = true;
      $("setup").hidden = false;
      setTitle(TITLES.setup, false);
      setTimeout(focusForm, 500);
      return;
    }
    // Accounts off: only admins sign in (to reach Settings > Admin).
    if (!state.enabled) $("off").hidden = false;
    $("to-register").hidden = !state.signup;
    $("invite-field").hidden = !state.invite;
    forms.register.elements.invite.required = Boolean(state.invite);
    $("forms").hidden = false;
    show("login");
    if (!isLocked()) focusForm();
  }, () => {
    $("loading").textContent = "Couldn't reach the server. Reload to try again.";
  });
})();
