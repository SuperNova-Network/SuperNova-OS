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

// "a, b ,c" -> ["a", "b", "c"]
const list = (value) => (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);

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

  // Content filter, enforced on the server for every proxied connection.
  // Set CONTENT_FILTER=0 to turn it off, or add domains with BLOCKED_HOSTS=a.com,b.com.
  filter: {
    enabled: env.CONTENT_FILTER !== "0",
    hosts: [
      "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "redtube.com", "youporn.com",
      "youjizz.com", "spankbang.com", "brazzers.com", "kink.com", "chaturbate.com", "stripchat.com",
      "8tube.xxx", "fuck.com",
      ...list(env.BLOCKED_HOSTS),
    ],
    // Blocked top-level domains.
    tlds: ["xxx", "porn", "sex", "adult"],
    // Hostnames containing these are blocked. Keep this list to words that are
    // essentially never innocent: "sex" would block essex.ac.uk.
    hostKeywords: ["porn", "xxx", "hentai"],
    // Searches containing any of these whole words are refused before they are sent.
    queryWords: ["porn", "xxx", "nude", "nudes", "erotic", "fetish", "hentai"],
  },
};
