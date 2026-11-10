import { test } from "node:test";
import assert from "node:assert/strict";
import { loadBrowserScript } from "./helpers.js";

const { SnResolve } = loadBrowserScript("public/proxy/resolve.js");
const { resolve, toUrl } = SnResolve;

test("bare domains become https URLs", () => {
  // Objects from the vm sandbox have a different Object.prototype, so compare fields.
  const result = resolve("example.com");
  assert.equal(result.kind, "url");
  assert.equal(result.url, "https://example.com/");
  assert.equal(resolve("sub.domain.co.uk/path?x=1#h").url, "https://sub.domain.co.uk/path?x=1#h");
  assert.equal(resolve("  example.com  ").url, "https://example.com/");
});

test("explicit http and https are kept as typed", () => {
  assert.equal(resolve("http://example.com/a").url, "http://example.com/a");
  assert.equal(resolve("https://example.com/a?b=c#d").url, "https://example.com/a?b=c#d");
});

test("localhost, IPv4 and IPv6 hosts default to http", () => {
  assert.equal(resolve("localhost:3000/x").url, "http://localhost:3000/x");
  assert.equal(resolve("192.168.1.1").url, "http://192.168.1.1/");
  assert.equal(resolve("[::1]:8080").url, "http://[::1]:8080/");
});

test("anything with spaces is a search, even if it contains a dot", () => {
  assert.equal(resolve("what is 3.14").kind, "search");
  assert.equal(resolve("node.js tutorial").kind, "search");
});

test("numbers and plain words are searches", () => {
  assert.equal(resolve("3.14").kind, "search");
  assert.equal(resolve("supernova").kind, "search");
  assert.equal(resolve("v1.2").kind, "search");
});

test("non-http schemes are never navigated to", () => {
  for (const input of ["javascript:alert(1)", "data:text/html,hi", "about:blank", "file:///etc/passwd", "view-source:https://example.com"]) {
    assert.equal(resolve(input).kind, "search", input);
  }
});

test("credential-style addresses are not treated as URLs", () => {
  assert.equal(toUrl("google.com@evil.example"), null);
  assert.equal(toUrl("user@example.com"), null);
});

test("internationalised domains work", () => {
  assert.equal(resolve("münchen.de").kind, "url");
  assert.equal(resolve("xn--mnchen-3ya.de").kind, "url");
});

test("empty input resolves to nothing", () => {
  assert.equal(resolve(""), null);
  assert.equal(resolve("   "), null);
  assert.equal(resolve(null), null);
});

test("searches are URL-encoded so '&', '#' and '%' cannot break the query", () => {
  const { url } = resolve("cats & dogs #1 100%", "duckduckgo");
  assert.equal(url, "https://duckduckgo.com/?q=cats%20%26%20dogs%20%231%20100%25");
});

test("search engine selection", () => {
  assert.match(resolve("hello", "google").url, /^https:\/\/www\.google\.com\/search\?q=hello$/);
  assert.match(resolve("hello", "bing").url, /bing\.com/);
  assert.match(resolve("hello").url, /search\.brave\.com/, "default engine");
  assert.match(resolve("hello", "nonsense").url, /search\.brave\.com/, "unknown id falls back to the default");
});

test("custom search templates must contain %s and be http(s)", () => {
  assert.equal(resolve("hi there", "https://example.org/find?term=%s").url, "https://example.org/find?term=hi%20there");
  assert.match(resolve("hi", "javascript:alert(%s)").url, /search\.brave\.com/);
  assert.match(resolve("hi", "https://example.org/no-placeholder").url, /search\.brave\.com/);
});

test("safe search adds the engine's strict parameter only when asked", () => {
  assert.equal(resolve("hi", "google", { safe: true }).url, "https://www.google.com/search?q=hi&safe=active");
  assert.equal(resolve("hi", "google").url, "https://www.google.com/search?q=hi");
  assert.equal(resolve("hi", "brave", { safe: true }).url, "https://search.brave.com/search?q=hi&safesearch=strict");
  assert.equal(resolve("hi", "duckduckgo", { safe: true }).url, "https://duckduckgo.com/?q=hi&kp=1");
  assert.equal(resolve("hi", "ecosia", { safe: true }).url, "https://www.ecosia.org/search?q=hi", "no documented parameter, so none added");
  assert.equal(resolve("hi", "https://example.org/?q=%s", { safe: true }).url, "https://example.org/?q=hi", "custom templates are left alone");
  assert.equal(resolve("example.com", "google", { safe: true }).url, "https://example.com/", "addresses are not touched");
});
