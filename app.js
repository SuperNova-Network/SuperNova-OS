import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { hostname } from "node:os";
import { fileURLToPath } from "node:url";
import express from "express";
import compression from "compression";
import basicAuth from "express-basic-auth";
import open from "open";
import { server as wisp, logging as wispLogging } from "@mercuryworkshop/wisp-js/server";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";
import { epoxyPath } from "@mercuryworkshop/epoxy-transport";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import config from "./config.js";
import { createPolicy } from "./src/policy.js";
import { createAccounts } from "./src/accounts.js";

const publicPath = fileURLToPath(new URL("./public/", import.meta.url));
const { prefixes, wispPath } = config;
const authEnabled = Boolean(config.auth.pass);
const policy = createPolicy(config.filter);
const accounts = await createAccounts(config.accounts);

// Versions shown in Settings > About. Read once at startup.
const readVersion = (url) => {
  try { return JSON.parse(readFileSync(url, "utf8")).version; } catch { return null; }
};
const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const info = {
  name: "SuperNova OS",
  version: packageJson.version ?? null,
  // AGPL-3.0 section 13: people using a modified version over a network must be offered its source.
  source: (packageJson.repository?.url ?? "").replace(/^git\+/, "").replace(/\.git$/, "") || null,
  node: process.version,
  components: Object.fromEntries(
    [
      ["Ultraviolet", "@titaniumnetwork-dev/ultraviolet"],
      ["Scramjet", "@mercuryworkshop/scramjet"],
      ["libcurl transport", "@mercuryworkshop/libcurl-transport"],
      ["Epoxy transport", "@mercuryworkshop/epoxy-transport"],
      ["Wisp", "@mercuryworkshop/wisp-js"],
      ["bare-mux", "@mercuryworkshop/bare-mux"],
    ].map(([label, name]) => [label, readVersion(new URL(`./node_modules/${name}/package.json`, import.meta.url))])
  ),
  filter: policy.enabled,
  accounts: config.accounts.enabled,
};

// ---------------------------------------------------------------------------
// Wisp: the transport that carries all proxied traffic over one WebSocket.
// ---------------------------------------------------------------------------
wispLogging.set_level(wispLogging.WARN);
// Never let the proxy reach the server's own network (SSRF into localhost,
// the LAN, or cloud metadata endpoints such as 169.254.169.254).
wisp.options.allow_loopback_ips = false;
wisp.options.allow_private_ips = false;
// The content filter lives here so it covers every connection: links followed
// inside proxied pages and hand-typed /service/ URLs included.
wisp.options.hostname_blacklist = policy.wispBlacklist();

// ---------------------------------------------------------------------------
// HTTP app
// ---------------------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);
app.use(compression());

// Health checks (Fly.io, Render, Docker) cannot send credentials, so this sits
// in front of the auth middleware. It reveals nothing but liveness.
app.get("/healthz", (_req, res) => {
  res.type("text/plain").set("Cache-Control", "no-store").send("ok");
});

if (authEnabled) {
  app.use(basicAuth({
    users: { [config.auth.user]: config.auth.pass },
    challenge: true,
    realm: "SuperNova OS",
  }));
}

app.use("/api/account", accounts.router);

app.get("/api/info", (_req, res) => {
  res.set("Cache-Control", "no-cache").json(info);
});

// Lets the client explain *why* something is blocked before it navigates. The
// blacklist above is what actually enforces the policy.
app.post("/api/verdict", express.json({ limit: "2kb" }), (req, res) => {
  const { host, query } = req.body ?? {};
  const reason =
    (typeof host === "string" && policy.checkHost(host.slice(0, 253))) ||
    (typeof query === "string" && policy.checkQuery(query.slice(0, 500))) ||
    null;
  res.set("Cache-Control", "no-store").json({ blocked: Boolean(reason), reason });
});

// Scripts whose contents depend on the server config. They are generated so the
// prefixes live in exactly one place (config.js).
const clientConfig = { prefixes, wisp: wispPath, wispUrl: config.wispUrl };

function script(res, source) {
  res.type("js").set("Cache-Control", "no-cache").send(source);
}

app.get("/proxy/config.js", (_req, res) => {
  script(res, `self.__sn$config = ${JSON.stringify(clientConfig)};\n`);
});

app.get("/proxy/uv.config.js", (_req, res) => {
  script(res, `/*global Ultraviolet*/
self.__uv$config = {
  prefix: ${JSON.stringify(prefixes.uv)},
  encodeUrl: Ultraviolet.codec.xor.encode,
  decodeUrl: Ultraviolet.codec.xor.decode,
  handler: "/assets/uv/uv.handler.js",
  client: "/assets/uv/uv.client.js",
  bundle: "/assets/uv/uv.bundle.js",
  config: "/proxy/uv.config.js",
  sw: "/assets/uv/uv.sw.js",
};
`);
});

app.get("/proxy/scramjet.config.js", (_req, res) => {
  script(res, `self.__scramjet$config = {
  prefix: ${JSON.stringify(prefixes.scramjet)},
  codec: {
    encode: (url) => url && encodeURIComponent(url),
    decode: (url) => url && decodeURIComponent(url),
  },
  files: {
    wasm: "/assets/scramjet/scramjet.wasm.wasm",
    all: "/assets/scramjet/scramjet.all.js",
    sync: "/assets/scramjet/scramjet.sync.js",
  },
  flags: {
    rewriterLogs: false,
    scramitize: false,
    cleanErrors: true,
    sourcemaps: false,
  },
};
`);
});

// Allow the worker (served from /) to control every path.
const scriptHeaders = {
  setHeaders(res, filePath) {
    if (/\.m?js$/.test(filePath)) res.setHeader("Service-Worker-Allowed", "/");
  },
};

// The service worker must always be revalidated so fixes reach users quickly.
app.get("/sw.js", (_req, res) => {
  res.set("Cache-Control", "no-cache").set("Service-Worker-Allowed", "/");
  res.sendFile(join(publicPath, "sw.js"));
});

app.use("/assets/uv/", express.static(uvPath, scriptHeaders));
app.use("/assets/scramjet/", express.static(scramjetPath, scriptHeaders));
app.use("/baremux/", express.static(baremuxPath, scriptHeaders));
app.use("/epoxy/", express.static(epoxyPath, scriptHeaders));
app.use("/libcurl/", express.static(libcurlPath, scriptHeaders));
app.use(express.static(publicPath, { dotfiles: "ignore" }));

// Links created by older versions used /supernova/<encoded>; the encoding is the
// same, so keep them working.
app.get("/supernova/*splat", (req, res) => {
  res.redirect(308, req.originalUrl.replace(/^\/supernova\//, prefixes.uv));
});

// A navigation to a proxied URL only reaches the server when the service worker
// is not (yet) in front of it: first visit, cleared site data, a shared deep link.
// Instead of a 404, serve a tiny page that starts the worker and reloads.
for (const prefix of Object.values(prefixes)) {
  app.get(`${prefix}*splat`, (req, res, next) => {
    const dest = req.get("sec-fetch-dest");
    const isNavigation = dest ? ["document", "iframe", "frame"].includes(dest) : req.accepts("html") === "html";
    if (!isNavigation) return next();
    res.set("Cache-Control", "no-store");
    res.sendFile(join(publicPath, "proxy", "boot.html"));
  });
}

// Error for everything else
app.use((_req, res) => {
  res.status(404).sendFile(join(publicPath, "404.html"));
});

app.use((err, req, res, _next) => {
  const status = err.status >= 400 && err.status < 500 ? err.status : 500;
  if (status === 500) console.error(err);
  if (req.path.startsWith("/api/")) return res.status(status).json({ error: status === 500 ? "Internal error" : "Bad request" });
  res.status(status).sendFile(join(publicPath, "404.html"));
});

// ---------------------------------------------------------------------------
// HTTP server (+ Wisp WebSocket upgrade)
// ---------------------------------------------------------------------------
const server = createServer(app);

function safeEqual(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// The Express auth middleware does not see WebSocket upgrades, so check here.
function isAuthorized(req) {
  if (!authEnabled) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const [user, ...rest] = Buffer.from(header.slice(6), "base64").toString().split(":");
  return safeEqual(user, config.auth.user) && safeEqual(rest.join(":"), config.auth.pass);
}

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname !== wispPath) return socket.destroy();
  if (!isAuthorized(req)) {
    socket.end("HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm=\"SuperNova OS\"\r\nConnection: close\r\n\r\n");
    return;
  }
  wisp.routeRequest(req, socket, head);
});

server.on("listening", async () => {
  const address = server.address();

  // by default we are listening on 0.0.0.0 (every interface)
  // we just need to list a few
  console.log("Listening on:");
  console.log(`\thttp://localhost:${address.port}`);
  console.log(`\thttp://${hostname()}:${address.port}`);
  console.log(
    `\thttp://${
      address.family === "IPv6" ? `[${address.address}]` : address.address
    }:${address.port}`
  );
  if (authEnabled) console.log(`Password protection is ON (user: ${config.auth.user})`);
  if (config.accounts.enabled) console.log(`Accounts are ON (data in ${config.accounts.dataDir}${config.accounts.signup ? "" : ", sign-up closed"})`);

  // Only open a browser when explicitly asked to (local development). Doing it
  // unconditionally breaks headless hosts such as Docker, Fly.io and Render.
  if (process.env.OPEN_BROWSER === "1") {
    try {
      await open(`http://localhost:${address.port}`);
    } catch (err) {
      console.warn(`Could not open a browser: ${err.message}`);
    }
  }
});

// https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received: closing HTTP server`);

  // Don't hang forever on keep-alive or upgraded (WebSocket) connections.
  const force = setTimeout(() => process.exit(1), 5000);
  force.unref();

  server.close(() => { accounts.close(); process.exit(0); });
  server.closeAllConnections?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen({ port: config.port });
