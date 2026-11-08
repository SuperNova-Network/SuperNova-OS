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

dotenv.config();

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

const port = parseInt(process.env.PORT, 10) || 3000;
if (isNaN(port)) {
  throw new Error("Invalid PORT environment variable");
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

  // Open the server address in the default browser
  await open(`http://localhost:${address.port}`);
});

// https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close();
  bare.close();
  process.exit(0);
}

server.listen({
  port,
});
