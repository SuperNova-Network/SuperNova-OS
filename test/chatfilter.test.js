import { test } from "node:test";
import assert from "node:assert/strict";
import { LIMITS, checkMessage, cleanWordList, createSpamTracker, createWordFilter, hasLink, normalizeText } from "../src/chatfilter.js";

test("normalizeText removes invisible and bidi characters but keeps emoji sequences", () => {
  assert.equal(normalizeText("he​ll‮o\u0000"), "hello");
  assert.equal(normalizeText("  a \t  b \r\n\r\n\r\n\r\n c  "), "a b\n\nc");
  const family = "👨‍👩‍👧";
  assert.equal(normalizeText(family), family);
  assert.equal(normalizeText("1️⃣"), "1️⃣");
});

test("normalizeText flattens zalgo towers", () => {
  const zalgo = "e" + "́̂̃̄̅̆̇";
  assert.equal([...normalizeText(zalgo)].length, 4);
});

test("hasLink finds addresses however they are written", () => {
  for (const text of ["go to https://evil.example/x", "www.thing.org", "discord.gg/abc", "visit cool-site.io now", "1.2.3.4"]) assert.ok(hasLink(text), text);
  for (const text of ["hello there", "that costs 3.50", "see you at 5.30pm", "e.g. this"]) assert.ok(!hasLink(text), text);
});

test("word filter matches whole words, spaced and disguised, and honours the * suffix", () => {
  const match = createWordFilter(["bad", "worse*", "no way"]);
  assert.equal(match("this is bad"), "bad");
  assert.equal(match("b a d"), "bad");
  assert.equal(match("b.a.d"), "bad");
  assert.equal(match("baaaad"), "bad");
  assert.equal(match("B@D"), "bad");
  assert.equal(match("it is worse"), "worse*");
  assert.equal(match("it is worsening"), "worse*", "a trailing * also matches longer words");
  assert.equal(match("a worship song"), null);
  assert.equal(match("badminton"), null, "whole words only: no false hit inside another word");
  assert.equal(match("class"), null);
  assert.equal(match("fine"), null);
  assert.equal(createWordFilter([])("anything"), null);
});

test("cleanWordList trims, lowercases, de-duplicates and limits", () => {
  assert.deepEqual(cleanWordList([" Bad ", "bad", "", "x", "a*", "Two  Words"]), ["bad", "two words"]);
  assert.equal(cleanWordList(Array.from({ length: 500 }, (_, i) => `word${i}`)).length, LIMITS.maxWords);
  assert.deepEqual(cleanWordList("nope"), []);
});

test("checkMessage applies the content rules, and admins skip all but the length rules", () => {
  const matchWord = createWordFilter(["bad"]);
  const rules = { matchWord };
  assert.equal(checkMessage("hello world", rules).ok, true);
  assert.equal(checkMessage("   ", rules).ok, false);
  assert.equal(checkMessage("x".repeat(LIMITS.maxLength + 1), rules).ok, false);
  assert.equal(checkMessage("ok\n".repeat(LIMITS.maxLines + 1), rules).ok, false);
  assert.equal(checkMessage("aaaaaaaaaaaa", rules).ok, false);
  assert.equal(checkMessage("go go go go go go go", rules).ok, false);
  assert.equal(checkMessage("THIS IS ALL SHOUTING NOW", rules).ok, false);
  assert.equal(checkMessage("OK LOL", rules).ok, true, "short caps are fine");
  assert.equal(checkMessage("see https://x.example", rules).ok, false);
  assert.equal(checkMessage("see https://x.example", { ...rules, allowLinks: true }).ok, true);
  assert.equal(checkMessage("that is bad", rules).ok, false);
  const blocked = checkMessage("that is bad", rules);
  assert.equal(blocked.strike, true);
  assert.equal(checkMessage("   ", rules).strike, false, "an empty message is not a strike");
  assert.equal(checkMessage("see https://x.example BAD AAAAAAAAAAAAAAAA", { ...rules, admin: true }).ok, true);
  assert.equal(checkMessage("x".repeat(LIMITS.maxLength + 1), { ...rules, admin: true }).ok, false);
  assert.equal(checkMessage("hi​ there", rules).text, "hi there");
});

test("spam tracker: slow mode, bursts, duplicates, strikes", () => {
  let time = 1_000_000;
  const spam = createSpamTracker({ now: () => time });
  assert.equal(spam.check(1, "hello"), null);
  spam.record(1, "hello");

  const slow = spam.check(1, "again", { slowMs: 5000 });
  assert.equal(slow.strike, false);
  assert.match(slow.reason, /Slow mode/);
  time += 5000;
  assert.equal(spam.check(1, "later", { slowMs: 5000 }), null);

  const dup = spam.check(1, "HELLO");
  assert.equal(dup.strike, true);
  assert.match(dup.reason, /repeat/);

  for (let i = 0; i < LIMITS.burstCount; i++) { spam.record(2, `m${i}`); time += 100; }
  const burst = spam.check(2, "one more");
  assert.equal(burst.strike, true);
  assert.match(burst.reason, /too fast/);
  time += LIMITS.burstMs;
  assert.equal(spam.check(2, "one more"), null);

  assert.equal(spam.strike(3), 1);
  assert.equal(spam.strike(3), 2);
  time += LIMITS.strikeWindowMs + 1;
  assert.equal(spam.strike(3), 1, "old strikes expire");
  spam.clearStrikes(3);
  assert.equal(spam.strike(3), 1);

  time += 11 * 60_000;
  spam.sweep();
  assert.equal(spam.size, 0);
});
