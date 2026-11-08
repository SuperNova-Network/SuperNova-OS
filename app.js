import { createBareServer } from '@nebula-services/bare-server-node';
import express from "express";
import { createServer } from "node:http";
import { uvPath } from "@titaniumnetwork-dev/ultraviolet";
import { join } from "node:path";
import { hostname } from "node:os";
import { fileURLToPath } from "url";
import open from 'open';
import basicAuth from 'express-basic-auth';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const publicPath = fileURLToPath(new URL("./public/", import.meta.url));
const bare = createBareServer("/bare/");
const app = express();

// Password protection is opt-in: set AUTH_PASS (and optionally AUTH_USER) in the environment.
// Credentials must never live in source control.
if (process.env.AUTH_PASS) {
  app.use(basicAuth({
    users: { [process.env.AUTH_USER || 'admin']: process.env.AUTH_PASS },
    challenge: true,
    realm: 'SuperNova OS',
  }));
}

app.use(express.static(publicPath));
app.use("/uv/", express.static(uvPath));

// A navigation to a proxied URL only reaches the server when the service worker
// is not (yet) in front of it: first visit, cleared site data, a shared deep link.
// Instead of a 404, serve a tiny page that starts the worker and reloads.
const PROXY_PREFIX = "/supernova/";
app.get(`${PROXY_PREFIX}*splat`, (req, res, next) => {
  const dest = req.get("sec-fetch-dest");
  const isNavigation = dest ? ["document", "iframe", "frame"].includes(dest) : req.accepts("html") === "html";
  if (!isNavigation) return next();
  res.set("Cache-Control", "no-store");
  res.sendFile(join(publicPath, "proxy", "boot.html"));
});

// Error for everything else
app.use((req, res) => {
  res.status(404); 
  res.sendFile(join(publicPath, "404.html"));
});

const server = createServer();

server.on("request", (req, res) => {
  if (bare.shouldRoute(req)) {
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

server.on("upgrade", (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT environment variable: ${JSON.stringify(process.env.PORT)}`);
}

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

  bare.close();
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen({
  port,
});
