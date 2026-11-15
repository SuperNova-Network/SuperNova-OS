/*
 * "What's new": the short list of new things the desktop shows after an update, written from CHANGELOG.md.
 *
 * The newest section of the changelog (the first "## " heading) has an "### Added" list. Each bullet is one thing
 * that is new: a bold title, then what it is. This turns each into { id, title, text }: the title, and its first
 * sentence without any markdown. `id` comes from the title, so a person who has seen an item never sees it again,
 * and one that is reworded counts as new. Newest first (the changelog lists the newest first).
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const MAX_ITEMS = 12;
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
    items.push({ id: createHash("sha1").update(title.toLowerCase()).digest("hex").slice(0, 10), title, text: short(firstSentence(rest.replace(/^[.:\s]+/, ""))) });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

/** A function returning the current items, re-read when the changelog file changes. */
export function createWhatsNew(file) {
  let stamp = null, items = [];
  return () => {
    try {
      const mtime = statSync(file).mtimeMs;
      if (mtime !== stamp) { items = parseWhatsNew(readFileSync(file, "utf8")); stamp = mtime; }
    } catch { items = []; }
    return items;
  };
}
