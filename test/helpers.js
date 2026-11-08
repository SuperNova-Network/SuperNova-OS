import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

/**
 * Load one of the browser scripts in public/ into a fresh sandbox and return the
 * sandbox's global object. The scripts are plain (non-module) files that attach
 * themselves to `self`, so they cannot be imported directly.
 */
export function loadBrowserScript(relativePath, globals = {}) {
  const sandbox = { URL, console, ...globals };
  sandbox.self = sandbox;
  runInNewContext(readFileSync(root + relativePath, "utf8"), sandbox, { filename: relativePath });
  return sandbox;
}
