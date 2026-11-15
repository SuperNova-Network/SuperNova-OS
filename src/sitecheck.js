/*
 * Which popular sites work right now. Every few minutes the server asks each one for its front page the way the proxy
 * would reach it (from this server's own connection) and remembers whether it answered, and how fast. The desktop's
 * network flyout shows the list (GET /api/sites), so people can tell "YouTube is down" from "the proxy is broken".
 *
 * A site that answered with anything below 500 counts as up (a login wall or a bot check still means it is reachable);
 * a failure, a timeout or a 5xx is down; a site the content filter blocks is not asked at all and is shown as blocked.
 * Nothing about any visitor is sent: it is the server asking for a public page.
 */

export const SITES = [
  { id: "google", name: "Google", url: "https://www.google.com/" },
  { id: "youtube", name: "YouTube", url: "https://www.youtube.com/" },
  { id: "reddit", name: "Reddit", url: "https://www.reddit.com/" },
  { id: "discord", name: "Discord", url: "https://discord.com/" },
  { id: "spotify", name: "Spotify", url: "https://open.spotify.com/" },
  { id: "twitch", name: "Twitch", url: "https://www.twitch.tv/" },
  { id: "github", name: "GitHub", url: "https://github.com/" },
  { id: "wikipedia", name: "Wikipedia", url: "https://en.wikipedia.org/" },
  { id: "khan", name: "Khan Academy", url: "https://www.khanacademy.org/" },
  { id: "docs", name: "Google Docs", url: "https://docs.google.com/" },
  { id: "tiktok", name: "TikTok", url: "https://www.tiktok.com/" },
  { id: "instagram", name: "Instagram", url: "https://www.instagram.com/" },
];

export const SLOW_MS = 2500;

/**
 * options:
 *   sites      what to check ({ id, name, url })
 *   fetch      the function that asks (a stand-in in tests)
 *   blocked    host -> truthy when the content filter blocks it
 *   timeoutMs  how long to wait for each
 *   intervalMs how often to check them all
 *   slowMs     how long an answer can take before the site counts as slow
 */
export function createSiteCheck({ sites = SITES, fetch: ask = globalThis.fetch, blocked = () => false, timeoutMs = 6000, intervalMs = 5 * 60_000, slowMs = SLOW_MS } = {}) {
  let results = sites.map((site) => ({ id: site.id, name: site.name, state: "unknown", ms: null }));
  let checkedAt = 0;
  let timer = null;
  let running = null;

  async function probe(site) {
    const base = { id: site.id, name: site.name };
    let host = "";
    try { host = new URL(site.url).hostname; } catch { return { ...base, state: "down", ms: null }; }
    if (blocked(host)) return { ...base, state: "blocked", ms: null };
    const started = performance.now();
    try {
      const response = await ask(site.url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": "Mozilla/5.0 (compatible; SuperNova status check)", accept: "text/html" } });
      const ms = Math.round(performance.now() - started);
      try { await response.body?.cancel(); } catch { /* nothing to read */ }
      if (response.status >= 500) return { ...base, state: "down", ms };
      return { ...base, state: ms > slowMs ? "slow" : "up", ms };
    } catch {
      return { ...base, state: "down", ms: null };
    }
  }

  /** Check everything now (at most one run at a time). */
  function checkNow() {
    if (running) return running;
    running = Promise.all(sites.map(probe)).then((list) => {
      results = list;
      checkedAt = Date.now();
    }).finally(() => { running = null; });
    return running;
  }

  return {
    /** The last results: { checkedAt, sites: [{ id, name, state: up | slow | down | blocked | unknown, ms }] }. */
    results: () => ({ checkedAt, sites: results }),
    checkNow,
    start({ firstAfterMs = 8000 } = {}) {
      if (timer) return;
      setTimeout(() => { checkNow().catch(() => {}); }, firstAfterMs).unref();
      timer = setInterval(() => { checkNow().catch(() => {}); }, intervalMs);
      timer.unref();
    },
    stop() { clearInterval(timer); timer = null; },
  };
}
