import { test } from "node:test";
import assert from "node:assert/strict";
import { createSuggest, cleanQuery, parseSuggestions } from "../src/suggest.js";
import { createPolicy } from "../src/policy.js";

const answer = (list) => async () => ({ ok: true, text: async () => JSON.stringify(["x", list]) });

test("suggestions are cleaned, unique and limited", () => {
  const got = parseSuggestions(["dino", ["dinosaur", "Dinosaur", " dino\u0000 game ", 42, null, { q: "dino run" }, "", "a".repeat(300), "b", "c", "d", "e", "f", "g", "h"]]);
  assert.deepEqual(got.slice(0, 3), ["dinosaur", "dino game", "dino run"]);
  assert.ok(got.length <= 8);
  assert.deepEqual(parseSuggestions("nonsense"), []);
  assert.deepEqual(parseSuggestions(["q", "not a list"]), []);
  assert.equal(cleanQuery("  a‮  b\n\tc  "), "a b c");
  assert.equal(cleanQuery("x".repeat(500)).length, 80);
});

test("only the named engines are asked, and short searches aren't", async () => {
  const asked = [];
  const { suggest } = createSuggest({ fetch: async (url) => { asked.push(url); return answer(["one"])(); } });
  assert.deepEqual(await suggest("d", "brave"), []);
  assert.equal(asked.length, 0);
  await suggest("dinos", "brave");
  await suggest("dinos two", "google");
  await suggest("dinos three", "https://evil.example/?q=");
  await suggest("dinos four", "bing");
  assert.match(asked[0], /^https:\/\/search\.brave\.com\/api\/suggest\?q=dinos$/);
  assert.match(asked[1], /^https:\/\/suggestqueries\.google\.com\//);
  assert.match(asked[2], /^https:\/\/duckduckgo\.com\/ac\//, "an unknown engine falls back to DuckDuckGo");
  assert.match(asked[3], /^https:\/\/duckduckgo\.com\/ac\//);
  assert.ok(asked.every((u) => !u.includes("evil")));
});

test("the query is encoded, answers are cached, and a failing engine gives nothing", async () => {
  let calls = 0;
  const { suggest } = createSuggest({ fetch: async (url) => { calls++; assert.ok(url.endsWith("a%26b%3Dc%20d")); return answer(["a b"])(); } });
  assert.deepEqual(await suggest("a&b=c d", "brave"), ["a b"]);
  assert.deepEqual(await suggest("A&B=C D", "brave"), ["a b"], "the same search again, in other case");
  assert.equal(calls, 1);
  const down = createSuggest({ fetch: async () => { throw new Error("offline"); } });
  assert.deepEqual(await down.suggest("anything", "brave"), []);
  const bad = createSuggest({ fetch: async () => ({ ok: true, text: async () => "<html>" }) });
  assert.deepEqual(await bad.suggest("anything", "brave"), []);
  const huge = createSuggest({ fetch: async () => ({ ok: true, text: async () => `["x",["${"a".repeat(70000)}"]]` }) });
  assert.deepEqual(await huge.suggest("anything", "brave"), [], "an enormous answer is ignored");
});

test("the content filter applies to what is searched and to what comes back", async () => {
  const policy = createPolicy({ queryWords: ["badword"] });
  let calls = 0;
  const { suggest } = createSuggest({ policy: () => policy, fetch: async () => { calls++; return answer(["fine one", "a badword here", "fine two"])(); } });
  assert.deepEqual(await suggest("badword stuff", "brave"), []);
  assert.equal(calls, 0, "a blocked search never leaves the server");
  assert.deepEqual(await suggest("something", "brave"), ["fine one", "fine two"]);
});

test("when the chosen engine can't answer, the next one is tried", async () => {
  const asked = [];
  const { suggest } = createSuggest({ fetch: async (url) => {
    asked.push(new URL(url).hostname);
    if (url.includes("brave")) return { ok: false, text: async () => "slow down" };
    return answer(["from another engine"])();
  } });
  assert.deepEqual(await suggest("dinosa", "brave"), ["from another engine"]);
  assert.equal(asked[0], "search.brave.com");
  assert.equal(asked.length, 2);
});
