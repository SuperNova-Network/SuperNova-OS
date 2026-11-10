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

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Start app.js on a free port with extra environment variables and wait until it
 * is listening. Returns { url, port, stop() }.
 */
export async function startServer(env = {}) {
  const port = await freePort();
  // Every server opens an accounts database; keep it out of the repository.
  const ownDataDir = env.DATA_DIR ? null : mkdtempSync(join(tmpdir(), "sn-test-"));
  const child = spawn(process.execPath, [root + "app.js"], {
    env: {
      ...process.env, PORT: String(port), AUTH_PASS: "", OPEN_BROWSER: "0",
      ACCOUNTS: "", ACCOUNTS_SIGNUP: "", ADMINS: "", INVITE_CODE: "",
      DATA_DIR: ownDataDir ?? env.DATA_DIR,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server did not start:\n${output}`)), 10000);
    const onData = (chunk) => {
      output += chunk;
      if (output.includes("Listening on")) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server exited with ${code}:\n${output}`)); });
  });

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    /** Everything the server has printed so far. */
    get output() { return output; },
    stop: () => new Promise((resolve) => {
      child.once("exit", () => {
        if (ownDataDir) rmSync(ownDataDir, { recursive: true, force: true });
        resolve();
      });
      child.kill("SIGTERM");
    }),
  };
}
