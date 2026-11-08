/*
 * Content policy.
 *
 * The authoritative check is the hostname blacklist handed to the Wisp server, so
 * it applies to every connection, including links followed inside proxied pages
 * and direct /service/ URLs. The client also asks /api/verdict before navigating
 * so it can show a friendly message instead of a network error.
 *
 * Matching is deliberately hostname-based. Matching keywords against a whole URL
 * blocks innocent addresses (essex.ac.uk, adult-education.org, ...).
 */

const normalise = (host) => String(host ?? "").trim().toLowerCase().replace(/\.$/, "");
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {object} options
 * @param {boolean} options.enabled
 * @param {string[]} options.hosts          blocked domains (and all their subdomains)
 * @param {string[]} options.tlds           blocked top-level domains
 * @param {string[]} options.hostKeywords   substrings that block a hostname outright
 * @param {string[]} options.queryWords     whole words that block a typed search
 */
export function createPolicy({ enabled = true, hosts = [], tlds = [], hostKeywords = [], queryWords = [] } = {}) {
  const blockedHosts = hosts.map(normalise).filter(Boolean);
  const blockedTlds = tlds.map(normalise).filter(Boolean);
  const keywords = hostKeywords.map(normalise).filter(Boolean);
  const words = queryWords.map(normalise).filter(Boolean);
  const wordPattern = words.length ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${words.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}])`, "iu") : null;

  /** Why a hostname is blocked, or null when it is allowed. */
  function checkHost(host) {
    if (!enabled) return null;
    const name = normalise(host);
    if (!name) return null;
    if (blockedHosts.some((blocked) => name === blocked || name.endsWith(`.${blocked}`))) return "host";
    if (blockedTlds.includes(name.slice(name.lastIndexOf(".") + 1))) return "tld";
    if (keywords.some((word) => name.includes(word))) return "keyword";
    return null;
  }

  /** Why a typed search is blocked, or null when it is allowed. */
  function checkQuery(text) {
    if (!enabled || !wordPattern) return null;
    return wordPattern.test(String(text ?? "")) ? "query" : null;
  }

  /** Regular expressions for wisp.options.hostname_blacklist. */
  function wispBlacklist() {
    if (!enabled) return null;
    const patterns = [];
    for (const host of blockedHosts) patterns.push(new RegExp(`(?:^|\\.)${escapeRegExp(host)}$`, "i"));
    for (const tld of blockedTlds) patterns.push(new RegExp(`\\.${escapeRegExp(tld)}$`, "i"));
    for (const word of keywords) patterns.push(new RegExp(escapeRegExp(word), "i"));
    return patterns.length ? patterns : null;
  }

  return { enabled, checkHost, checkQuery, wispBlacklist };
}
