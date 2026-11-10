/*
 * Turn what someone typed into a destination: a URL to visit, or a web search.
 *
 * Plain script (no modules) so pages load it with <script>; it attaches
 * `SnResolve` to the global object. It has no DOM dependencies and is unit-tested
 * under Node (see test/resolve.test.js).
 */
(function (global) {
  "use strict";

  // %s is replaced with the URL-encoded query. `safe` is appended when safe search
  // is requested; engines without a documented URL parameter simply have none.
  var SEARCH_ENGINES = {
    brave: { name: "Brave Search", url: "https://search.brave.com/search?q=%s", safe: "&safesearch=strict" },
    duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=%s", safe: "&kp=1" },
    google: { name: "Google", url: "https://www.google.com/search?q=%s", safe: "&safe=active" },
    bing: { name: "Bing", url: "https://www.bing.com/search?q=%s", safe: "&adlt=strict" },
    startpage: { name: "Startpage", url: "https://www.startpage.com/do/search?q=%s", safe: "" },
    ecosia: { name: "Ecosia", url: "https://www.ecosia.org/search?q=%s", safe: "" },
  };

  var DEFAULT_ENGINE = "brave";

  // "host:123" looks like a scheme to a naive check, so recognise ports explicitly.
  var HAS_SCHEME = /^[a-z][a-z0-9+.-]*:(?!\d+(?:[/?#]|$))/i;
  var HTTP_SCHEME = /^https?:\/\//i;
  var IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  // Hostname with at least one dot and an alphabetic (or punycode) TLD.
  var DOMAIN = /^(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:\p{L}{2,63}|xn--[a-z0-9-]{1,59})$/iu;

  /**
   * Template for a search engine id, or a custom "https://...%s..." template.
   * With `safe`, engines that support it get their strict safe-search parameter.
   */
  function searchTemplate(choice, safe) {
    if (choice && SEARCH_ENGINES[choice]) return SEARCH_ENGINES[choice].url + (safe ? SEARCH_ENGINES[choice].safe : "");
    if (typeof choice === "string" && /^https?:\/\/.+%s/i.test(choice)) return choice;
    return searchTemplate(DEFAULT_ENGINE, safe);
  }

  function parse(href) {
    try { return new URL(href); } catch (e) { return null; }
  }

  /**
   * The URL for `input` if it is (or plausibly is) an address, otherwise null.
   * Only http(s) is ever returned: javascript:, data:, file: and friends are not
   * navigable and fall through to search.
   */
  function toUrl(input) {
    var value = String(input == null ? "" : input).trim();
    if (!value || /\s/.test(value)) return null;

    if (HTTP_SCHEME.test(value)) {
      var explicit = parse(value);
      return explicit && explicit.hostname ? explicit.href : null;
    }
    if (HAS_SCHEME.test(value)) return null;

    // Split off "host[:port]" to inspect it without a scheme.
    var authority = value.split(/[/?#]/, 1)[0];
    // "name@host" is a credential/phishing trick (google.com@evil.example), never an address.
    if (authority.indexOf("@") !== -1) return null;

    var host = authority.replace(/:\d+$/, "");
    var bracketedIpv6 = /^\[[0-9a-f:.]+\]$/i.test(host);
    var local = host.toLowerCase() === "localhost" || IPV4.test(host) || bracketedIpv6;
    if (!local && !DOMAIN.test(host)) return null;

    var url = parse((local ? "http://" : "https://") + value);
    return url ? url.href : null;
  }

  /**
   * Decide what to open for `input`.
   * `engine` is a search-engine id or a custom template (see searchTemplate).
   * `options.safe` turns on the engine's strict safe-search parameter.
   * Returns { kind: "url" | "search", url } or null for empty input.
   */
  function resolve(input, engine, options) {
    var value = String(input == null ? "" : input).trim();
    if (!value) return null;
    var url = toUrl(value);
    if (url) return { kind: "url", url: url };
    var safe = Boolean(options && options.safe);
    return { kind: "search", url: searchTemplate(engine, safe).replace("%s", encodeURIComponent(value)) };
  }

  global.SnResolve = {
    SEARCH_ENGINES: SEARCH_ENGINES,
    DEFAULT_ENGINE: DEFAULT_ENGINE,
    searchTemplate: searchTemplate,
    toUrl: toUrl,
    resolve: resolve,
  };
})(typeof self !== "undefined" ? self : globalThis);
