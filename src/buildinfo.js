/*
 * Which version of the project this is: the nearest release tag, how many commits it is ahead of that tag, and
 * the commit. It comes from build-info.json (written by `npm run build-info`, which a deploy runs first, because
 * the image has no .git) or, on a checkout, from git itself. The taskbar shows it in faint text.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** "v3.4.0-12-gb4a455e" (or with -dirty) -> { tag, ahead, commit, dirty }. A bare hash has no tag. */
export function parseDescribe(text) {
  const raw = String(text ?? "").trim();
  const dirty = /-dirty$/.test(raw);
  const clean = raw.replace(/-dirty$/, "");
  const withTag = /^(.+?)-(\d+)-g([0-9a-f]{4,40})$/.exec(clean);
  if (withTag) return { tag: withTag[1], ahead: Number(withTag[2]), commit: withTag[3], dirty };
  if (/^[0-9a-f]{4,40}$/.test(clean)) return { tag: null, ahead: 0, commit: clean, dirty };
  return clean ? { tag: clean, ahead: 0, commit: null, dirty } : null; // exactly on a tag
}

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}

/** Read the build info from git (throws if there is no git or no repository). */
export function fromGit(root) {
  const described = parseDescribe(git(root, "describe", "--tags", "--always", "--dirty"));
  const commit = described?.commit ?? git(root, "rev-parse", "--short", "HEAD");
  return { tag: described?.tag ?? null, ahead: described?.ahead ?? 0, commit, dirty: Boolean(described?.dirty), date: git(root, "log", "-1", "--format=%cI") };
}

export function writeBuildInfo(root) {
  const info = fromGit(root);
  writeFileSync(join(root, "build-info.json"), `${JSON.stringify(info, null, 2)}\n`);
  return info;
}

/** What the server reports: build-info.json if there is one, else git, else just the package's version. */
export function readBuildInfo(root, packageVersion = null) {
  for (const load of [() => JSON.parse(readFileSync(join(root, "build-info.json"), "utf8")), () => fromGit(root)]) {
    try {
      const info = load();
      if (info && (info.commit || info.tag)) return { tag: info.tag ?? null, ahead: Number(info.ahead) || 0, commit: info.commit ?? null, dirty: Boolean(info.dirty), date: info.date ?? null };
    } catch { /* try the next source */ }
  }
  return { tag: packageVersion ? `v${packageVersion}` : null, ahead: 0, commit: null, dirty: false, date: null };
}
