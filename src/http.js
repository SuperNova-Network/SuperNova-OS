/*
 * Small pieces of HTTP handling shared by the accounts and chat APIs.
 */

/** An error that becomes a JSON response: { error: message } with this status. */
export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

/**
 * Middleware for APIs that change things: they must come from this site's own pages.
 * The session cookie is SameSite=Strict and bodies must be JSON, and a cross-site
 * Origin is refused outright.
 */
export function guardWrites() {
  return (req, _res, next) => {
    if (req.method === "GET" || req.method === "HEAD") return next();
    const origin = req.get("origin");
    if (origin) {
      let host = null;
      try { host = new URL(origin).host; } catch { /* "null" or garbage */ }
      if (host !== req.get("host")) return next(new HttpError(403, "Cross-site requests are not allowed."));
    }
    if (!req.is("application/json")) return next(new HttpError(415, "Send JSON."));
    next();
  };
}
