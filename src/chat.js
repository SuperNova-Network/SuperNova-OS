/*
 * The live chat: one public room for everyone who is signed in.
 *
 * Live delivery uses Server-Sent Events (GET /api/chat/stream): one long-lived
 * response the server writes events to, and the page sends messages with ordinary
 * POSTs. That needs no extra dependency, is covered by the same session cookie and
 * sign-in gate as everything else, and reconnects by itself. Each (re)connection
 * starts with a "ready" event holding the recent history, so a dropped connection
 * can never leave the page with a gap or a message that was since deleted.
 *
 * Events (server -> page): ready, message, delete, clear, presence, settings, sanction,
 * sanction-lifted, closed.
 *
 * Who can say what: see chatfilter.js (spam rules) and chatdb.js (sanctions, settings).
 * Admins (accounts.isAdmin) moderate under /api/chat/admin; an admin can't be
 * sanctioned. Everything a page shows is plain text: messages are never HTML.
 */
import express from "express";
import { AdminError } from "./accountsdb.js";
import { HttpError, guardWrites } from "./http.js";
import { imageInfo } from "./imageinfo.js";
import { createLimiter } from "./ratelimit.js";
import { LIMITS, checkMessage, createSpamTracker, createWordFilter, normalizeText } from "./chatfilter.js";
import * as store from "./chatdb.js";

const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;     // an uploaded GIF
const UPLOAD_MAX_PIXELS = 2000;
const MAX_STREAMS_PER_USER = 5;               // browser tabs
const HEARTBEAT_MS = 20_000;                  // keeps proxies from closing a quiet stream
const REVALIDATE_MS = 30_000;                 // sessions and bans are re-checked this often
const PURGE_MINUTES = 10;                     // what "delete their recent messages" covers
const AUTO_TIMEOUT_MINUTES = [2, 10, 60];     // by how many automatic timeouts someone had today
const GIPHY_ID = /^[A-Za-z0-9]{5,32}$/;
const GIPHY_MEDIA_MAX = 4 * 1024 * 1024;
const CACHE_BYTES = 24 * 1024 * 1024;

/**
 * options:
 *   db, site, userFor, isAdmin, sessionActive, onBan, onSiteChange   from createAccounts()
 *   giphy  { key, apiUrl, mediaUrl }: GIF search is available when there is a key
 */
export function createChat({ db, site, userFor, isAdmin, sessionActive, onBan, onSiteChange, giphy = {} }) {
  const giphyKey = giphy.key || "";
  const giphyApi = (giphy.apiUrl || "https://api.giphy.com").replace(/\/+$/, "");
  const giphyMedia = (giphy.mediaUrl || "https://media.giphy.com").replace(/\/+$/, "");

  const spam = createSpamTracker();
  const limits = {
    send: createLimiter({ limit: 90, windowMs: 60_000 }),       // per address, on top of the per-person rules
    upload: createLimiter({ limit: 6, windowMs: 10 * 60_000 }), // GIFs a person may upload
    connect: createLimiter({ limit: 40, windowMs: 60_000 }),
    search: createLimiter({ limit: 30, windowMs: 60_000 }),
  };
  const limit = (limiter, key, message = "Slow down a little.") => {
    const wait = limiter.hit(key);
    if (wait) throw new HttpError(429, message, { retryAfter: wait });
  };

  // --- settings ------------------------------------------------------------------------

  let filterCache = { key: null, match: null };
  function wordFilter(words) {
    const key = words.join("\n");
    if (filterCache.key !== key) filterCache = { key, match: createWordFilter(words) };
    return filterCache.match;
  }

  const settings = () => store.getChatSettings(db);
  /** What every page may know about the settings (not the blocked words). */
  const publicSettings = (s = settings()) => ({
    enabled: s.enabled, locked: s.locked, slowSeconds: s.slowSeconds, links: s.links, gifs: s.gifs,
    giphy: Boolean(giphyKey), maxLength: LIMITS.maxLength, minAccountMinutes: s.minAccountMinutes,
  });

  // --- live streams ---------------------------------------------------------------------

  const streams = new Set(); // { res, user, hash, heartbeat }

  function write(stream, event, data) {
    try { stream.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* the close handler cleans up */ }
  }
  const broadcast = (event, data) => { for (const stream of streams) write(stream, event, data); };
  const sendToUser = (userId, event, data) => { for (const stream of streams) if (stream.user.id === userId) write(stream, event, data); };

  function closeStreams(match, reason) {
    for (const stream of [...streams]) {
      if (!match(stream)) continue;
      write(stream, "closed", { reason });
      stream.res.end();
    }
  }

  /** Who is here, one entry per person however many tabs they have open. */
  function presence() {
    const ids = [...new Set([...streams].map((stream) => stream.user.id))];
    if (!ids.length) return [];
    const rows = db.prepare(`SELECT id, username, is_admin, avatar_version FROM users WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids);
    return rows
      .map((row) => ({ username: row.username, ...(isAdmin(row) ? { admin: true } : {}), avatar: row.avatar_version }))
      .sort((a, b) => Number(Boolean(b.admin)) - Number(Boolean(a.admin)) || a.username.localeCompare(b.username))
      .slice(0, 200);
  }

  let presenceTimer = null;
  function schedulePresence() {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => { presenceTimer = null; broadcast("presence", { online: presence() }); }, 250);
    presenceTimer.unref();
  }

  // Sessions, bans and the site's accounts mode are re-checked on a timer, and at once on a ban.
  const revalidate = setInterval(() => {
    spam.sweep();
    closeStreams((stream) => !sessionActive(stream.hash) || site().mode === "off", "signed-out");
  }, REVALIDATE_MS);
  revalidate.unref();
  onBan((userId) => closeStreams((stream) => stream.user.id === userId, "banned"));
  onSiteChange(() => closeStreams((stream) => !sessionActive(stream.hash) || site().mode === "off", "signed-out"));

  // --- helpers ----------------------------------------------------------------------------

  function requireUser(req) {
    const user = userFor(req);
    if (!user) throw new HttpError(401, "Sign in to use the chat.");
    if (site().mode === "off") throw new HttpError(403, "Chat needs accounts, which are turned off on this site.");
    return user;
  }

  function requireAdmin(req) {
    const user = requireUser(req);
    if (!user.admin) throw new HttpError(403, "Only admins can do that.");
    return user;
  }

  const userRow = (name) => db.prepare("SELECT id, username, is_admin, created_at FROM users WHERE username = ?").get(String(name ?? ""));

  /** The person a moderator names. Admins and yourself are off limits. */
  function moderationTarget(req, admin) {
    const row = userRow(req.params.username);
    if (!row) throw new HttpError(404, "There's no account with that name.");
    if (row.id === admin.id) throw new HttpError(400, "You can't do that to yourself.");
    if (isAdmin(row)) throw new HttpError(403, "Admins can't be sanctioned. Remove their admin role first.");
    return row;
  }

  const wait = (sanction) => {
    if (sanction.kind === "ban") return "You are banned from the chat.";
    const minutes = Math.max(1, Math.ceil((sanction.until - Date.now()) / 60_000));
    return `You are timed out for ${minutes} more minute${minutes === 1 ? "" : "s"}.`;
  };

  function readUpload(data) {
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, "Send the GIF as base64.");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > UPLOAD_MAX_BYTES) throw new HttpError(413, `GIFs can be up to ${UPLOAD_MAX_BYTES / 1024 / 1024} MB.`);
    const info = imageInfo(bytes);
    if (info?.mime !== "image/gif") throw new HttpError(400, "That isn't a GIF.");
    if (info.width > UPLOAD_MAX_PIXELS || info.height > UPLOAD_MAX_PIXELS) throw new HttpError(400, `GIFs can be up to ${UPLOAD_MAX_PIXELS} by ${UPLOAD_MAX_PIXELS} pixels.`);
    return { mime: "image/gif", data: bytes };
  }

  /** A strike for something spammy. After enough of them, an automatic timeout. Returns it, or null. */
  function strike(user) {
    if (spam.strike(user.id) < LIMITS.strikesForTimeout) return null;
    spam.clearStrikes(user.id);
    const minutes = AUTO_TIMEOUT_MINUTES[Math.min(store.recentAutoTimeouts(db, user.id), AUTO_TIMEOUT_MINUTES.length - 1)];
    const sanction = store.addSanction(db, { userId: user.id, kind: "timeout", minutes, reason: "Spam (automatic)", by: "AutoMod" });
    store.addLog(db, "AutoMod", "timeout", user.username, `${minutes} minutes for spam`);
    sendToUser(user.id, "sanction", sanction);
    return sanction;
  }

  // --- the router --------------------------------------------------------------------------

  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(guardWrites());
  const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

  router.get("/stream", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.connect, req.ip);
    const mine = [...streams].filter((stream) => stream.user.id === user.id);
    if (mine.length >= MAX_STREAMS_PER_USER) { write(mine[0], "closed", { reason: "another-tab" }); mine[0].res.end(); }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: compression must not buffer the stream.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write("retry: 3000\n\n");

    const stream = { res, user, hash: req.sessionHash, heartbeat: null };
    streams.add(stream);
    stream.heartbeat = setInterval(() => { try { res.write(": ping\n\n"); } catch { /* closed */ } }, HEARTBEAT_MS);
    req.on("close", () => {
      clearInterval(stream.heartbeat);
      streams.delete(stream);
      schedulePresence();
    });

    const s = settings();
    write(stream, "ready", {
      me: { ...user, sanction: store.activeSanction(db, user.id) },
      settings: publicSettings(s),
      messages: s.enabled || user.admin ? store.listMessages(db, { limit: 60 }).map((row) => store.publicMessage(row, isAdmin)) : [],
      online: presence(),
    });
    schedulePresence();
  }));

  router.get("/messages", handle((req, res) => {
    requireUser(req);
    const s = settings();
    const messages = s.enabled ? store.listMessages(db, { before: req.query.before, limit: req.query.limit }) : [];
    res.json({ messages: messages.map((row) => store.publicMessage(row, isAdmin)) });
  }));

  // Send a message. { text?, gif?: { giphy: id } | { data: base64 } }. GIF uploads need a bigger body.
  router.post("/messages", express.json({ limit: "3mb" }), handle((req, res) => {
    const user = requireUser(req);
    limit(limits.send, req.ip);
    const s = settings();
    if (!s.enabled) throw new HttpError(403, "The chat is turned off.");
    const sanction = store.activeSanction(db, user.id);
    if (sanction) throw new HttpError(403, `${wait(sanction)}${sanction.reason ? ` Reason: ${sanction.reason}` : ""}`, { sanction });
    if (s.locked && !user.admin) throw new HttpError(403, "The chat is locked: only admins can post right now.");
    if (!user.admin && s.minAccountMinutes) {
      const age = Date.now() - db.prepare("SELECT created_at FROM users WHERE id = ?").get(user.id).created_at;
      if (age < s.minAccountMinutes * 60_000) throw new HttpError(403, `New accounts can post ${s.minAccountMinutes} minutes after they are made.`);
    }

    const gif = req.body?.gif;
    if (gif !== undefined && (typeof gif !== "object" || gif === null || Array.isArray(gif))) throw new HttpError(400, "That GIF isn't valid.");
    if (gif && !s.gifs) throw new HttpError(403, "GIFs are turned off.");
    const rawText = typeof req.body?.text === "string" ? req.body.text : "";
    if (rawText.length > LIMITS.maxLength * 8) throw new HttpError(400, `Messages can be up to ${LIMITS.maxLength} characters.`);

    // The text. A GIF can go without any.
    let text = "";
    if (normalizeText(rawText) || !gif) {
      const verdict = checkMessage(rawText, { admin: user.admin, allowLinks: s.links === "allowed", matchWord: wordFilter(s.words) });
      if (!verdict.ok) {
        const timedOut = verdict.strike ? strike(user) : null;
        throw new HttpError(400, timedOut ? `${verdict.reason} ${wait(timedOut)}` : verdict.reason, timedOut ? { sanction: timedOut } : {});
      }
      text = verdict.text;
    }

    // Rate limits, slow mode and repeats. Admins are exempt.
    let media = null;
    let fingerprint = text;
    if (gif) {
      if (typeof gif.giphy === "string") {
        if (!giphyKey) throw new HttpError(400, "GIF search isn't set up on this site.");
        if (!GIPHY_ID.test(gif.giphy)) throw new HttpError(400, "That GIF isn't valid.");
        media = { kind: "giphy", ref: gif.giphy };
        fingerprint = `${text}\u0000giphy:${gif.giphy}`;
      } else {
        fingerprint = `${text}\u0000upload:${typeof gif.data === "string" ? gif.data.length : 0}:${typeof gif.data === "string" ? gif.data.slice(-64) : ""}`;
      }
    }
    if (!user.admin) {
      const blocked = spam.check(user.id, fingerprint, { slowMs: s.slowSeconds * 1000 });
      if (blocked) {
        const timedOut = blocked.strike ? strike(user) : null;
        throw new HttpError(429, timedOut ? `${blocked.reason} ${wait(timedOut)}` : blocked.reason, { retryAfter: Math.max(1, Math.ceil(blocked.retryMs / 1000)), ...(timedOut ? { sanction: timedOut } : {}) });
      }
    }
    if (gif && !media) {
      limit(limits.upload, String(user.id), "You're uploading GIFs too fast.");
      media = { upload: readUpload(gif.data) };
    }

    const row = store.insertMessage(db, { userId: user.id, text, media });
    if (!user.admin) spam.record(user.id, fingerprint);
    const message = store.publicMessage(row, isAdmin);
    broadcast("message", message);
    res.status(201).json({ message });
  }));

  // An uploaded GIF.
  router.get("/media/:id", handle((req, res) => {
    requireUser(req);
    const media = /^[0-9a-f]{24}$/.test(req.params.id) ? store.getMedia(db, req.params.id) : null;
    if (!media) throw new HttpError(404, "No such GIF.");
    res.set({
      "Content-Type": media.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    }).send(media.data);
  }));

  // --- GIF search (GIPHY). The page never talks to GIPHY itself: the server searches
  // and relays the pictures, so people's addresses stay off third-party servers. ----------

  const searchCache = new Map(); // query -> { at, gifs }
  const mediaCache = new Map();  // "id/size" -> { bytes, at }; insertion order = age
  let mediaCacheBytes = 0;

  async function fetchLimited(url, maxBytes) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
    if (!response.ok) return { status: response.status, bytes: null };
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) return { status: 502, bytes: null };
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) return { status: 502, bytes: null };
      chunks.push(chunk);
    }
    return { status: 200, bytes: Buffer.concat(chunks) };
  }

  router.get("/gifs", handle(async (req, res) => {
    requireUser(req);
    if (!giphyKey) throw new HttpError(404, "GIF search isn't set up on this site.");
    if (!settings().gifs) throw new HttpError(403, "GIFs are turned off.");
    limit(limits.search, req.ip);
    const q = normalizeText(String(req.query.q ?? "")).slice(0, 50);
    const cached = searchCache.get(q);
    if (cached && Date.now() - cached.at < 60_000) return res.json({ gifs: cached.gifs });
    const url = new URL(`${giphyApi}/v1/gifs/${q ? "search" : "trending"}`);
    url.searchParams.set("api_key", giphyKey);
    url.searchParams.set("limit", "24");
    url.searchParams.set("rating", "pg");
    if (q) url.searchParams.set("q", q);
    let body;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`GIPHY answered ${response.status}`);
      body = await response.json();
    } catch (err) {
      console.warn(`GIF search failed: ${err.message}`);
      throw new HttpError(502, "GIF search isn't working right now.");
    }
    const gifs = (Array.isArray(body?.data) ? body.data : [])
      .filter((item) => typeof item?.id === "string" && GIPHY_ID.test(item.id))
      .map((item) => ({ id: item.id, title: String(item.title ?? "").slice(0, 100) }));
    if (searchCache.size >= 100) searchCache.delete(searchCache.keys().next().value);
    searchCache.set(q, { at: Date.now(), gifs });
    res.json({ gifs });
  }));

  // size: "full" (the GIF) or "thumb" (a small one for the picker).
  router.get("/giphy/:id/:size", handle(async (req, res) => {
    requireUser(req);
    const { id, size } = req.params;
    if (!giphyKey || !GIPHY_ID.test(id) || (size !== "full" && size !== "thumb")) throw new HttpError(404, "No such GIF.");
    const key = `${id}/${size}`;
    let entry = mediaCache.get(key);
    if (!entry) {
      let result;
      try {
        result = await fetchLimited(`${giphyMedia}/media/${id}/${size === "thumb" ? "200w" : "giphy"}.gif`, GIPHY_MEDIA_MAX);
      } catch {
        throw new HttpError(502, "That GIF could not be loaded.");
      }
      if (!result.bytes || imageInfo(result.bytes)?.mime !== "image/gif") throw new HttpError(result.status === 404 ? 404 : 502, "That GIF could not be loaded.");
      entry = { bytes: result.bytes };
      mediaCache.set(key, entry);
      mediaCacheBytes += entry.bytes.length;
      while (mediaCacheBytes > CACHE_BYTES) {
        const oldest = mediaCache.keys().next().value;
        mediaCacheBytes -= mediaCache.get(oldest).bytes.length;
        mediaCache.delete(oldest);
      }
    }
    res.set({
      "Content-Type": "image/gif",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    }).send(entry.bytes);
  }));

  // --- moderation (admins) --------------------------------------------------------------------

  // Everything else that takes a body takes a small one (the message route above has its own parser).
  router.use("/admin", express.json({ limit: "20kb" }));

  router.get("/admin/settings", handle((req, res) => {
    requireAdmin(req);
    res.json({ settings: settings() });
  }));

  router.post("/admin/settings", handle((req, res) => {
    const admin = requireAdmin(req);
    const before = settings();
    const next = store.setChatSettings(db, req.body, admin.username);
    const changed = Object.keys(req.body).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(next[key]));
    for (const key of changed) store.addLog(db, admin.username, "setting", key, key === "words" ? `${next.words.length} words` : String(next[key]));
    broadcast("settings", publicSettings(next));
    if (changed.includes("enabled") && !next.enabled) broadcast("clear", {});
    res.json({ settings: next });
  }));

  router.post("/admin/messages/:id/delete", handle((req, res) => {
    const admin = requireAdmin(req);
    const row = store.getMessage(db, req.params.id);
    if (!row || !store.deleteMessage(db, row.id, admin.username)) throw new HttpError(404, "That message is already gone.");
    store.addLog(db, admin.username, "delete message", row.username, row.body.slice(0, 80) || (row.media_kind ? "[GIF]" : ""));
    broadcast("delete", { id: row.id });
    res.json({ ok: true });
  }));

  router.post("/admin/clear", handle((req, res) => {
    const admin = requireAdmin(req);
    const removed = store.clearMessages(db, admin.username);
    store.addLog(db, admin.username, "clear chat", null, `${removed} messages`);
    broadcast("clear", {});
    res.json({ removed });
  }));

  function sanction(kind) {
    return handle((req, res) => {
      const admin = requireAdmin(req);
      const target = moderationTarget(req, admin);
      const minutes = kind === "timeout" ? Number(req.body?.minutes) : null;
      const result = store.addSanction(db, { userId: target.id, kind, minutes, reason: req.body?.reason, by: admin.username });
      let purged = [];
      if (req.body?.purge) purged = store.deleteRecentMessages(db, target.id, PURGE_MINUTES, admin.username);
      for (const id of purged) broadcast("delete", { id });
      store.addLog(db, admin.username, kind, target.username, [kind === "timeout" ? `${minutes} minutes` : "", result.reason, purged.length ? `${purged.length} messages removed` : ""].filter(Boolean).join(" - "));
      sendToUser(target.id, "sanction", result);
      res.json({ sanction: result, removed: purged.length });
    });
  }
  router.post("/admin/users/:username/timeout", sanction("timeout"));
  router.post("/admin/users/:username/ban", sanction("ban"));

  router.post("/admin/users/:username/lift", handle((req, res) => {
    const admin = requireAdmin(req);
    const row = userRow(req.params.username);
    if (!row) throw new HttpError(404, "There's no account with that name.");
    if (!store.liftSanctions(db, row.id, admin.username)) throw new HttpError(404, "They have no timeout or chat ban.");
    store.addLog(db, admin.username, "lift", row.username);
    sendToUser(row.id, "sanction-lifted", {});
    res.json({ ok: true });
  }));

  router.get("/admin/sanctions", handle((req, res) => {
    requireAdmin(req);
    res.json({ sanctions: store.listActiveSanctions(db) });
  }));

  router.get("/admin/log", handle((req, res) => {
    requireAdmin(req);
    res.json({ log: store.listLog(db, req.query.limit) });
  }));

  router.use((_req, res) => res.status(404).json({ error: "Not found." }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.extra.retryAfter) res.set("Retry-After", String(err.extra.retryAfter));
      return res.status(err.status).json({ error: err.message, ...(err.extra.sanction ? { sanction: err.extra.sanction } : {}) });
    }
    if (err instanceof AdminError) return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "That message is too big." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "That request isn't valid JSON." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return {
    router,
    close() {
      clearInterval(revalidate);
      for (const stream of streams) { clearInterval(stream.heartbeat); stream.res.end(); }
      streams.clear();
    },
  };
}

/** The router for /api/chat when accounts are unavailable: it only says so. */
export function disabledChat() {
  const router = express.Router();
  router.use((_req, res) => res.status(404).json({ error: "Chat needs accounts, which aren't available on this site." }));
  return { router, close() {} };
}
