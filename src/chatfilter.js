/*
 * Chat spam filters. Pure functions and one small in-memory tracker, so they are
 * easy to test and the chat server (src/chat.js) only has to call them.
 *
 *   normalizeText(raw)            clean a message: control and invisible characters,
 *                                 bidi tricks, zalgo, whitespace
 *   checkMessage(raw, options)    normalize, then apply the content rules; returns
 *                                 { ok: true, text } or { ok: false, reason, strike }
 *   createSpamTracker()           per-person rate limits, slow mode, duplicates and strikes
 *
 * Admins skip the content rules (not the length limit).
 */

export const LIMITS = {
  maxLength: 500,      // characters (code points) per message
  maxLines: 8,
  burstCount: 5,       // this many messages ...
  burstMs: 10_000,     // ... inside this long is flooding
  duplicateMs: 60_000, // the same text again inside this long is spam
  strikeWindowMs: 5 * 60_000,
  strikesForTimeout: 4,
  maxWords: 200,       // entries in the blocked-word list
  maxWordLength: 32,
};

// Control characters (except newline), zero-width spaces, the soft hyphen and
// every bidirectional override (they can make text read backwards or hide it). The
// zero-width joiner (U+200D) and variation selectors stay: emoji need them.
const INVISIBLE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F­​‌‎‏‪-‮⁠-⁤⁦-⁩﻿]/g;

/** Clean up a message without judging it. */
export function normalizeText(raw) {
  let text = String(raw ?? "").normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  text = text.replace(INVISIBLE, "");
  // Zalgo: a few combining marks are normal (accents, emoji keycaps), a tower is not.
  text = text.replace(/(\p{M}{3})\p{M}+/gu, "$1");
  text = text.replace(/[  ]{2,}/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

const URL_LIKE = /(?:\bhttps?:\/\/|\bftp:\/\/|\bwww\.)\S+/i;
const DOMAIN_LIKE = /\b[a-z0-9][a-z0-9-]{1,}\.(?:com|net|org|io|gg|co|me|tv|xyz|ly|dev|app|link|site|online|club|info|biz|us|uk|ru|cn|to|cc|ws|fm|im|sh|ai|gl|be|ee|page|cloud|store|fun|top)\b/i;
const IP_LIKE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;

export function hasLink(text) {
  return URL_LIKE.test(text) || DOMAIN_LIKE.test(text) || IP_LIKE.test(text);
}

// What people type instead of letters to get past a word list.
const LEET = { "@": "a", "$": "s", "0": "o", "1": "i", "3": "e", "5": "s", "7": "t", "!": "i", "|": "i" };
const SEPARATORS = "[\\s._*\\-]*";

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Clean up an admin-entered word list: lowercase, trimmed, unique, limited. */
export function cleanWordList(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const word = String(item ?? "").normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim().slice(0, LIMITS.maxWordLength);
    if (word.replace(/\*/g, "").length >= 2 && !out.includes(word)) out.push(word);
    if (out.length >= LIMITS.maxWords) break;
  }
  return out;
}

/**
 * A matcher for a list of blocked words. Matches whole words (so "class" never trips
 * a word like "ass"), also when letters are repeated, spaced out ("f u c k", "f.u.c.k")
 * or swapped for look-alike symbols ("$h1t"). A trailing * matches longer words too:
 * "fuck*" catches "fucking". Returns a function: text -> the word that matched, or null.
 */
export function createWordFilter(words) {
  const patterns = cleanWordList(words).map((word) => {
    const prefix = word.endsWith("*");
    const letters = [...word.replace(/\*/g, "")];
    const body = letters.map((letter) => (/[\p{L}\p{N}]/u.test(letter) ? `${escapeRegex(letter)}+` : escapeRegex(letter))).join(SEPARATORS);
    return { word, regex: new RegExp(`(?<![\\p{L}\\p{N}])${body}${prefix ? "" : "(?![\\p{L}\\p{N}])"}`, "iu") };
  });
  return (text) => {
    if (!patterns.length) return null;
    const plain = text.toLowerCase();
    const mapped = plain.replace(/[@$01357!|]/g, (char) => LEET[char] ?? char);
    for (const { word, regex } of patterns) {
      if (regex.test(plain) || regex.test(mapped)) return word;
    }
    return null;
  };
}

/**
 * Check one message. options: { admin, allowLinks, matchWord } where matchWord comes
 * from createWordFilter. `strike` says whether the person earns a strike for it.
 */
export function checkMessage(raw, { admin = false, allowLinks = false, matchWord = null } = {}) {
  const text = normalizeText(raw);
  if (!text) return { ok: false, reason: "Write something first.", strike: false };
  if ([...text].length > LIMITS.maxLength) return { ok: false, reason: `Messages can be up to ${LIMITS.maxLength} characters.`, strike: false };
  if (text.split("\n").length > LIMITS.maxLines) return { ok: false, reason: `Messages can have up to ${LIMITS.maxLines} lines.`, strike: false };
  if (admin) return { ok: true, text };

  if (/(.)\1{9,}/su.test(text) || /\b(\S+)(?:\s+\1\b){5,}/iu.test(text)) return { ok: false, reason: "Too many repeated characters or words.", strike: true };
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length >= 12 && (text.match(/\p{Lu}/gu) ?? []).length / letters.length > 0.7) return { ok: false, reason: "Please don't shout. Turn off caps lock.", strike: true };
  if (!allowLinks && hasLink(text)) return { ok: false, reason: "Links aren't allowed in this chat.", strike: true };
  const hit = matchWord?.(text);
  if (hit) return { ok: false, reason: "That message contains a word that isn't allowed here.", strike: true };
  return { ok: true, text };
}

/**
 * Remembers what each person recently did so it can enforce the rate limits.
 * `key` is any stable id (the account id). Everything is in memory and forgotten
 * after a while: a restart gives everyone a clean slate, which is fine for rate limits.
 */
export function createSpamTracker({ now = Date.now } = {}) {
  const people = new Map(); // key -> { times: number[], recent: { text, at }[], last: number, strikes: number[], seen: number }

  const entry = (key) => {
    let person = people.get(key);
    if (!person) people.set(key, person = { times: [], recent: [], last: 0, strikes: [], seen: now() });
    return person;
  };

  return {
    /**
     * Whether `text` may be sent now. Returns null, or { reason, retryMs, strike }.
     * slowMs: the admin-set slow mode (0 = off).
     */
    check(key, text, { slowMs = 0 } = {}) {
      const person = entry(key), at = now();
      person.seen = at;
      if (slowMs && at - person.last < slowMs) {
        const retryMs = slowMs - (at - person.last);
        return { reason: `Slow mode is on. Wait ${Math.ceil(retryMs / 1000)}s.`, retryMs, strike: false };
      }
      person.times = person.times.filter((time) => at - time < LIMITS.burstMs);
      if (person.times.length >= LIMITS.burstCount) {
        return { reason: "You're sending messages too fast.", retryMs: LIMITS.burstMs - (at - person.times[0]), strike: true };
      }
      person.recent = person.recent.filter((item) => at - item.at < LIMITS.duplicateMs);
      const same = text.toLowerCase();
      if (person.recent.some((item) => item.text === same)) return { reason: "Don't repeat yourself.", retryMs: 0, strike: true };
      return null;
    },
    /** Call after a message was accepted. */
    record(key, text) {
      const person = entry(key), at = now();
      person.times.push(at);
      person.last = at;
      person.recent.push({ text: text.toLowerCase(), at });
      if (person.recent.length > 5) person.recent.shift();
      person.seen = at;
    },
    /** Add a strike; returns how many the person has in the last few minutes. */
    strike(key) {
      const person = entry(key), at = now();
      person.strikes = person.strikes.filter((time) => at - time < LIMITS.strikeWindowMs);
      person.strikes.push(at);
      person.seen = at;
      return person.strikes.length;
    },
    /** Wipe a person's strikes (after an automatic timeout, so it doesn't repeat at once). */
    clearStrikes(key) {
      const person = people.get(key);
      if (person) person.strikes = [];
    },
    forget(key) { people.delete(key); },
    /** Drop people who have been quiet for ten minutes. */
    sweep() {
      const at = now();
      for (const [key, person] of people) if (at - person.seen > 10 * 60_000) people.delete(key);
    },
    get size() { return people.size; },
  };
}
