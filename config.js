/*
 * SuperNova OS server configuration.
 *
 * Everything here can be overridden with environment variables (see .env.example)
 * so deployments never need to edit source.
 */
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const env = process.env;

function port() {
  if (!env.PORT) return 3000;
  const value = Number(env.PORT);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`Invalid PORT environment variable: ${JSON.stringify(env.PORT)}`);
  }
  return value;
}

export default {
  port: port(),

  // Optional HTTP Basic auth. Disabled unless AUTH_PASS is set.
  auth: {
    user: env.AUTH_USER || "admin",
    pass: env.AUTH_PASS || "",
  },

  // URL prefixes the service worker intercepts. Both must start and end with "/".
  prefixes: {
    uv: "/service/",
    scramjet: "/scram/",
  },

  // WebSocket endpoint that carries proxied traffic (the Wisp protocol).
  wispPath: "/wisp/",
};
