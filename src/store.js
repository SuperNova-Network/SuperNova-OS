/*
 * The App Store API (/api/store): browse apps, publish your own, install and remove them.
 *
 * Who may do what:
 *   - anyone signed in can browse the approved apps and publish their own
 *   - the owner can edit and remove their own apps; admins can remove any (Admin Panel)
 *   - whether a new app goes live at once or waits for an admin is the admin's "store"
 *     setting. Admins' own apps always go live at once.
 *
 * Installing is done by the desktop (it adds the app to the person's own apps); the
 * server only counts it. An app is just an address, so nothing here ever serves a user's
 * HTML, and every piece of text a page shows from it is plain text.
 */
import express from "express";
import { AdminError } from "./accountsdb.js";
import { getAdminSetting, logAdmin } from "./admindb.js";
import { HttpError, guardWrites } from "./http.js";
import { imageInfo } from "./imageinfo.js";
import { createLimiter } from "./ratelimit.js";
import * as apps from "./storedb.js";

const ICON_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

/**
 * options: db, site(), userFor, policy() -> the live content policy (checkHost, checkQuery).
 */
export function createStore({ db, site, userFor, policy }) {
  const limits = {
    publish: createLimiter({ limit: 12, windowMs: 60 * 60_000 }),
    install: createLimiter({ limit: 120, windowMs: 60_000 }),
    read: createLimiter({ limit: 240, windowMs: 60_000 }),
  };
  const limit = (limiter, key) => {
    const wait = limiter.hit(key);
    if (wait) throw new HttpError(429, "Slow down a little.", { retryAfter: wait });
  };

  const settings = () => getAdminSetting(db, "store");

  function requireUser(req) {
    const user = userFor(req);
    if (!user) throw new HttpError(401, "Sign in to use the App Store.");
    if (site().mode === "off") throw new HttpError(403, "The App Store needs accounts, which are turned off on this site.");
    return user;
  }

  /** The content rules every submission passes: the blocked sites and search words admins keep. */
  function checkContent(fields, user) {
    if (user.admin) return;
    const current = policy();
    if (current.checkHost(fields.host)) throw new HttpError(400, "That site is blocked on this server, so it can't be an app.");
    if (current.checkQuery(`${fields.name} ${fields.description}`)) throw new HttpError(400, "That name or description isn't allowed here.");
  }

  function readIcon(data) {
    if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new HttpError(400, "Send the icon as base64.");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > apps.LIMITS.iconBytes) throw new HttpError(413, `Icons can be up to ${apps.LIMITS.iconBytes / 1024} KB.`);
    const info = imageInfo(bytes);
    if (!info || !ICON_MIMES.has(info.mime)) throw new HttpError(400, "Icons are PNG, JPEG or WebP pictures.");
    if (info.width > apps.LIMITS.iconPixels || info.height > apps.LIMITS.iconPixels) throw new HttpError(400, `Icons can be up to ${apps.LIMITS.iconPixels} by ${apps.LIMITS.iconPixels} pixels.`);
    return { mime: info.mime, data: bytes };
  }

  /** `icon` in a request: absent (leave it), null/false (remove it) or a base64 picture. */
  const iconFrom = (body, { existing = false } = {}) => {
    if (!("icon" in body)) return undefined;
    if (body.icon === null || body.icon === false) return existing ? false : undefined;
    return readIcon(body.icon);
  };

  const ownedApp = (req, user) => {
    const row = apps.getApp(db, req.params.id);
    if (!row) throw new HttpError(404, "That app isn't in the store.");
    const owner = db.prepare("SELECT id FROM users WHERE username = ?").get(row.owner);
    if (owner?.id !== user.id) throw new HttpError(403, "That isn't your app.");
    return row;
  };

  const router = express.Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "no-store"); next(); });
  router.use(guardWrites());
  router.use(express.json({ limit: "400kb" }));
  const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

  const status = () => {
    const { approval, publishing, maxPerUser } = settings();
    return { approval, publishing, maxPerUser, categories: apps.CATEGORIES };
  };

  router.get("/apps", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.read, req.ip);
    const { q, category, sort, offset, limit: count } = req.query;
    const rows = apps.listApproved(db, { q: String(q ?? ""), category: String(category ?? ""), sort: String(sort ?? "popular"), offset, limit: count });
    const installed = apps.installedIds(db, user.id);
    res.json({
      ...status(),
      apps: rows.map((row) => ({ ...apps.publicApp(row), installed: installed.has(row.id) })),
    });
  }));

  router.get("/mine", handle((req, res) => {
    const user = requireUser(req);
    res.json({ ...status(), apps: apps.listMine(db, user.id).map((row) => apps.publicApp(row, { forOwner: true })) });
  }));

  router.get("/icon/:id", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.read, req.ip);
    const row = apps.getApp(db, req.params.id);
    const icon = row ? apps.getIcon(db, row.id) : null;
    // Pending and rejected apps' icons are for their owner and for admins only.
    const visible = row && (row.status === "approved" || user.admin || row.owner === user.username);
    if (!icon || !visible) return res.status(404).json({ error: "No icon." });
    res.set({
      "Content-Type": icon.mime,
      "Content-Length": String(icon.data.length),
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, max-age=3600",
    });
    res.end(icon.data);
  }));

  router.post("/apps", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.publish, `u${user.id}`);
    const current = settings();
    if (!current.publishing && !user.admin) throw new HttpError(403, "Publishing is paused right now. You can still browse and install apps.");
    const fields = apps.checkSubmission(req.body);
    checkContent(fields, user);
    if (!user.admin && apps.countActive(db, user.id) >= current.maxPerUser) {
      throw new HttpError(400, `You can have ${current.maxPerUser} apps in the store at once. Remove one to add another.`);
    }
    if (apps.urlTaken(db, fields.key)) throw new HttpError(409, "That app is already in the store, or waiting for approval.");
    const icon = iconFrom(req.body);
    const live = user.admin || current.approval === "auto";
    const id = apps.insertApp(db, { ownerId: user.id, ...fields, status: live ? "approved" : "pending", by: user.admin ? user.username : "automatic", icon });
    if (user.admin) logAdmin(db, user.username, "published a store app", fields.name);
    res.status(201).json({ app: apps.publicApp(apps.getApp(db, id), { forOwner: true }), live });
  }));

  router.post("/apps/:id", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.publish, `u${user.id}`);
    const row = ownedApp(req, user);
    const fields = apps.checkSubmission(req.body);
    checkContent(fields, user);
    if (apps.urlTaken(db, fields.key, row.id)) throw new HttpError(409, "That app is already in the store, or waiting for approval.");
    const icon = iconFrom(req.body, { existing: row.icon_version > 0 });
    // Anything that changes what people install goes back to an admin when approval is manual.
    const changed = fields.name !== row.name || fields.description !== row.description || fields.key !== row.url_key || fields.category !== row.category || icon !== undefined;
    const needsReview = !user.admin && settings().approval === "manual" && changed;
    const next = row.status === "rejected" ? (user.admin || settings().approval === "auto" ? "approved" : "pending") : needsReview ? "pending" : row.status;
    apps.updateApp(db, row.id, { ...fields, status: next, icon });
    res.json({ app: apps.publicApp(apps.getApp(db, row.id), { forOwner: true }) });
  }));

  router.post("/apps/:id/delete", handle((req, res) => {
    const user = requireUser(req);
    const row = ownedApp(req, user);
    apps.deleteApp(db, row.id);
    res.json({ ok: true });
  }));

  router.post("/apps/:id/install", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.install, `u${user.id}`);
    const row = apps.getApp(db, req.params.id);
    if (!row || row.status !== "approved") throw new HttpError(404, "That app isn't in the store.");
    apps.addInstall(db, row.id, user.id);
    res.json({ app: { ...apps.publicApp(apps.getApp(db, row.id)), installed: true } });
  }));

  router.post("/apps/:id/uninstall", handle((req, res) => {
    const user = requireUser(req);
    limit(limits.install, `u${user.id}`);
    const row = apps.getApp(db, req.params.id);
    if (!row) throw new HttpError(404, "That app isn't in the store.");
    apps.removeInstall(db, row.id, user.id);
    res.json({ ok: true });
  }));

  router.use((_req, res) => res.status(404).json({ error: "Not found." }));

  // eslint-disable-next-line no-unused-vars
  router.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      if (err.extra.retryAfter) res.set("Retry-After", String(err.extra.retryAfter));
      return res.status(err.status).json({ error: err.message });
    }
    if (err instanceof AdminError) return res.status(err.status).json({ error: err.message });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "That request is too big." });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "That request isn't valid JSON." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong on the server." });
  });

  return { router };
}

/** The router for /api/store when accounts are unavailable: it only says so. */
export function disabledStore() {
  const router = express.Router();
  router.use((_req, res) => res.status(404).json({ error: "The App Store needs accounts, which aren't available on this site." }));
  return { router };
}
