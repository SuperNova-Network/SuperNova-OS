/*
 * "What's new": the short list of new things the desktop shows after an update, written from CHANGELOG.md.
 *
 * The newest section of the changelog (the first "## " heading) has an "### Added" list. Each bullet is one thing
 * that is new: a bold title, then what it is. This turns each into { id, title, text }: the title, and its first
 * sentence without any markdown. `id` comes from the title, so a person who has seen an item never sees it again,
 * and one that is reworded counts as new. Newest first (the changelog lists the newest first).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";

const MAX_ITEMS = 30;
const MAX_FULL = 1200; // the whole description, for when an item is opened
const MAX_FIXES = 3; // the newest few fixes with a bold title are worth telling people about too
const MAX_TEXT = 220;

/** Markdown out of a piece of text: bold, code and links keep their words. */
const plain = (text) => String(text)
  .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
  .replace(/[`*_]{1,3}/g, "")
  .replace(/\s+/g, " ")
  .trim();

/** The first sentence (a full stop followed by a space, after a few words, so "e.g." doesn't end it). */
function firstSentence(text) {
  const clean = plain(text);
  const stop = /[.!?](?=\s|$)/g;
  let match;
  while ((match = stop.exec(clean))) {
    if (match.index >= 14 && !/\b(e\.g|i\.e|etc|vs)$/i.test(clean.slice(0, match.index))) {
      return clean.slice(0, match.index + 1);
    }
  }
  return clean;
}

const short = (text) => (Array.from(text).length > MAX_TEXT ? `${Array.from(text).slice(0, MAX_TEXT - 1).join("").trimEnd()}…` : text);

/** The whole description of an item, if it says more than the one sentence shown. */
function fullOf(rest, shown) {
  const all = plain(rest.replace(/^[.:\s]+/, ""));
  if (!all || all === shown) return {};
  return { full: Array.from(all).length > MAX_FULL ? `${Array.from(all).slice(0, MAX_FULL - 1).join("").trimEnd()}\u2026` : all };
}

/** The items of the newest changelog section. */
export function parseWhatsNew(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^## /.test(line));
  if (start === -1) return [];
  let end = lines.findIndex((line, i) => i > start && /^## /.test(line));
  if (end === -1) end = lines.length;
  const section = lines.slice(start + 1, end);
  const added = section.findIndex((line) => /^### Added\s*$/.test(line));
  if (added === -1) return [];
  const items = [];
  for (let i = added + 1; i < section.length && !/^### /.test(section[i]); i++) {
    const bullet = /^- (.+)$/.exec(section[i]);
    if (!bullet) continue;
    const bold = /^\*\*(.+?)\*\*\s*(.*)$/.exec(bullet[1]);
    const title = plain((bold ? bold[1] : firstSentence(bullet[1])).replace(/[.:]+$/, ""));
    // "**Title** (where to find it). What it does." keeps the sentence about what it does, not just the signpost.
    let rest = bold ? bold[2] : "";
    if (rest.startsWith("(")) { const close = rest.indexOf(")"); if (close !== -1 && /\S/.test(rest.slice(close + 1).replace(/^[.:\s]+/, ""))) rest = rest.slice(close + 1); }
    if (!title) continue;
    const text = short(firstSentence(rest.replace(/^[.:\s]+/, "")));
    items.push({ id: createHash("sha1").update(title.toLowerCase()).digest("hex").slice(0, 10), title, text, ...fullOf(rest, text) });
    if (items.length >= MAX_ITEMS) break;
  }
  // The newest fixes that have a bold title, after the new things.
  const fixed = section.findIndex((line) => /^### Fixed\s*$/.test(line));
  let taken = 0;
  for (let i = fixed + 1; fixed !== -1 && i < section.length && !/^### /.test(section[i]) && taken < MAX_FIXES; i++) {
    const bullet = /^- \*\*(.+?)\*\*\s*(.*)$/.exec(section[i]);
    if (!bullet) continue;
    const title = plain(bullet[1].replace(/[.:]+$/, ""));
    const text = short(firstSentence(bullet[2].replace(/^[.:\s]+/, "")));
    items.push({ id: createHash("sha1").update(title.toLowerCase()).digest("hex").slice(0, 10), title, text, ...fullOf(bullet[2], text) });
    taken++;
  }
  return items;
}

/**
 * When each item was written: the date of the commit that added its line to the changelog (from git), as { id: "2026-11-15" }.
 * Items git doesn't know are left out. The Docker image has no .git, so a deploy writes this beforehand (npm run build-info).
 */
export function datesOf(items, changelogFile) {
  const out = {};
  for (const item of items) {
    try {
      const first = execFileSync("git", ["log", "--reverse", "--format=%cs", `-S**${item.title}`, "--", changelogFile], { cwd: dirname(changelogFile), timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).toString().split("\n")[0].trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(first)) out[item.id] = first;
    } catch { /* no git, or not a repository: no dates */ }
  }
  return out;
}

/** A function returning the current items (with their dates), re-read when the changelog file changes. */
export function createWhatsNew(file, datesFile = null) {
  let stamp = null, items = [];
  return () => {
    try {
      const mtime = statSync(file).mtimeMs;
      if (mtime !== stamp) {
        const parsed = parseWhatsNew(readFileSync(file, "utf8"));
        let dates = {};
        try { dates = datesFile ? JSON.parse(readFileSync(datesFile, "utf8")) : {}; } catch { dates = null; }
        if (!dates || !Object.keys(dates).length) dates = datesOf(parsed, file); // a checkout: ask git
        items = parsed.map((item) => (dates[item.id] ? { ...item, date: dates[item.id] } : item));
        stamp = mtime;
      }
    } catch { items = []; }
    return items;
  };
}
