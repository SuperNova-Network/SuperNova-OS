/*
 * A small in-memory rate limiter (fixed windows). Enough for one server process;
 * counts are lost on restart, which is fine for slowing down password guessing.
 *
 * To limit only what goes wrong (so that many people on one network, or someone who keeps getting it right,
 * are never locked out), check with peek(), count with hit() before the work, and give the hit back with
 * refund() when it succeeds: a flood is still stopped before it finishes, and a success costs nothing.
 */

/**
 * `limit` hits per `windowMs` for each key. hit(key) returns 0 when allowed, or the
 * number of seconds until the key may try again.
 */
export function createLimiter({ limit, windowMs }) {
  const hits = new Map();

  function sweep(now) {
    for (const [key, entry] of hits) if (entry.reset <= now) hits.delete(key);
  }

  return {
    hit(key, now = Date.now()) {
      if (hits.size > 10000) sweep(now);
      let entry = hits.get(key);
      if (!entry || entry.reset <= now) {
        entry = { count: 0, reset: now + windowMs };
        hits.set(key, entry);
      }
      entry.count++;
      return entry.count > limit ? Math.ceil((entry.reset - now) / 1000) : 0;
    },
    /** Seconds until the key may try again if it has used up its hits (nothing is counted), else 0. */
    peek(key, now = Date.now()) {
      const entry = hits.get(key);
      if (!entry || entry.reset <= now) return 0;
      return entry.count >= limit ? Math.ceil((entry.reset - now) / 1000) : 0;
    },
    /** Give back one hit (the attempt turned out fine). */
    refund(key, now = Date.now()) {
      const entry = hits.get(key);
      if (entry && entry.reset > now && entry.count > 0) entry.count--;
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
