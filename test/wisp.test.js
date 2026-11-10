import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { client as wisp } from "@mercuryworkshop/wisp-js/client";
import { startServer } from "./helpers.js";

let server;
before(async () => { server = await startServer({ BLOCKED_HOSTS: "blocked.example" }); });
after(async () => { await server.stop(); });

/** Open a Wisp connection to the test server and resolve once it is ready. */
async function connect() {
  const connection = new wisp.ClientConnection(`ws://127.0.0.1:${server.port}/wisp/`);
  await new Promise((resolve, reject) => {
    connection.onopen = resolve;
    connection.onerror = () => reject(new Error("Wisp connection failed"));
  });
  return connection;
}

/** The close reason the server gives for an attempted stream, or "timeout". */
async function closeReasonFor(host, port = 443) {
  const connection = await connect();
  try {
    const stream = connection.create_stream(host, port);
    return await new Promise((resolve) => {
      stream.onclose = resolve;
      stream.onopen = () => resolve("open");
      setTimeout(() => resolve("timeout"), 3000);
    });
  } finally {
    connection.close();
  }
}

// Wisp close reasons (see wisp-protocol): HostBlocked is a deliberate refusal.
// The server resolves DNS *before* it applies its filter, so a blacklisted name
// that does not resolve (these tests must work offline) closes with NetworkError
// instead. Either way the connection is refused.
const HOST_BLOCKED = 0x48;
const NETWORK_ERROR = 0x03;

test("streams to hosts on the content-filter blacklist are never opened", async () => {
  for (const host of ["blocked.example", "cdn.blocked.example", "www.pornhub.com", "anything.xxx", "free-porn-tube.net"]) {
    const reason = await closeReasonFor(host);
    assert.notEqual(reason, "open", `${host} must not connect`);
    assert.notEqual(reason, "timeout", `${host} should be refused promptly`);
    assert.ok([HOST_BLOCKED, NETWORK_ERROR].includes(reason), `${host}: unexpected close reason 0x${Number(reason).toString(16)}`);
  }
});

test("streams to the server's own loopback and private networks are refused (SSRF guard)", async () => {
  // IP literals and localhost resolve without a network, so the refusal is deterministic.
  for (const host of ["127.0.0.1", "localhost", "10.0.0.1", "192.168.1.1", "169.254.169.254"]) {
    assert.equal(await closeReasonFor(host, server.port), HOST_BLOCKED, host);
  }
});
