/*
 * Search suggestions for the taskbar's web search (GET /api/suggest?q=...&engine=...).
 *
 * The server asks the search engine on the person's behalf, so the engine sees the server and not the
 * visitor, and the browser never needs permission to talk to it. Only a fixed list of engines is ever
 * contacted (the page names one, never an address), a search that the content filter blocks gets nothing, and
 * suggestions the filter would block are dropped. Answers are kept for a few minutes.
 */

// Every one answers in the OpenSearch shape: ["what was typed", ["suggestion", ...], ...].
const ENGINES = {
  brave: (q) => `https://search.brave.com/api/suggest?q=${q}`,
  duckduckgo: (q) => `https://duckduckgo.com/ac/?type=list&q=${q}`,
  google: (q) => `https://suggestqueries.google.com/complete/search?client=firefox&q=${q}`,
};
const FALLBACK = "duckduckgo"; // for engines without a suggestion service we can use (Bing, Startpage, Ecosia, custom)

export const LIMITS = { query: 80, results: 8, text: 100, timeoutMs: 3000, maxBytes: 64 * 1024, cacheEntries: 500, cacheMs: 5 * 60_000 };

const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/g;
export const cleanQuery = (value) => String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.query);

/** The suggestion strings in an OpenSearch answer, cleaned and unique. */
export function parseSuggestions(data) {
  const list = Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  const out = [];
  for (const item of list) {
    const text = cleanQuery(typeof item === "string" ? item : item?.q ?? item?.query);
    if (!text || text.length > LIMITS.text || out.some((s) => s.toLowerCase() === text.toLowerCase())) continue;
    out.push(text);
    if (out.length >= LIMITS.results) break;
  }
  return out;
}

/** options: policy() -> the live content policy, fetch (for tests). */
export function createSuggest({ policy, fetch: fetcher = globalThis.fetch } = {}) {
  const cache = new Map(); // "engine|query" -> { at, list }

  async function suggest(rawQuery, engine) {
    const query = cleanQuery(rawQuery);
    if (query.length < 2) return [];
    const current = policy?.();
    if (current?.checkQuery(query)) return [];
    const name = ENGINES[engine] ? engine : FALLBACK;
    const key = `${name}|${query.toLowerCase()}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < LIMITS.cacheMs) return hit.list;

    // The chosen engine first; if it can't answer (down, or limiting us), the others in turn.
    let list = [];
    for (const engineName of [name, ...Object.keys(ENGINES).filter((other) => other !== name)]) {
      try {
        const response = await fetcher(ENGINES[engineName](encodeURIComponent(query)), {
          headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; SuperNova-OS)" },
          signal: AbortSignal.timeout(LIMITS.timeoutMs),
          redirect: "error",
        });
        if (!response.ok) continue;
        const text = await response.text();
        if (text.length <= LIMITS.maxBytes) list = parseSuggestions(JSON.parse(text));
      } catch { /* try the next one */ }
      if (list.length) break;
    }
    list = list.filter((s) => !current?.checkQuery(s));
    cache.delete(key);
    cache.set(key, { at: Date.now(), list }); // (an empty answer is kept too, so a dead engine isn't asked again at once)
    if (cache.size > LIMITS.cacheEntries) cache.delete(cache.keys().next().value);
    return list;
  }

  return { suggest };
}
