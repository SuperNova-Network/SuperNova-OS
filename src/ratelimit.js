/*
 * A small in-memory rate limiter (fixed windows). Enough for one server process;
 * counts are lost on restart, which is fine for slowing down password guessing.
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
    reset(key) {
      hits.delete(key);
    },
  };
}
