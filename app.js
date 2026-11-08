import { createServer } from "node:http";
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

const publicPath = fileURLToPath(new URL("./public/", import.meta.url));
const { prefixes, wispPath } = config;
const authEnabled = Boolean(config.auth.pass);

// ---------------------------------------------------------------------------
// Wisp: the transport that carries all proxied traffic over one WebSocket.
// ---------------------------------------------------------------------------
wispLogging.set_level(wispLogging.WARN);
// Never let the proxy reach the server's own network (SSRF into localhost,
// the LAN, or cloud metadata endpoints such as 169.254.169.254).
wisp.options.allow_loopback_ips = false;
wisp.options.allow_private_ips = false;

// ---------------------------------------------------------------------------
// HTTP app
// ---------------------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.use(compression());

if (authEnabled) {
  app.use(basicAuth({
    users: { [config.auth.user]: config.auth.pass },
    challenge: true,
    realm: "SuperNova OS",
  }));
}

// Scripts whose contents depend on the server config. They are generated so the
// prefixes live in exactly one place (config.js).
const clientConfig = { prefixes, wisp: wispPath };

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

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).sendFile(join(publicPath, "404.html"));
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

  server.close(() => process.exit(0));
  server.closeAllConnections?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen({ port: config.port });
