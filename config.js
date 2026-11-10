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

// Express "trust proxy": how many proxies in front of this server to believe about the
// client's address (X-Forwarded-For) and protocol. Needed behind Fly.io, Render, nginx
// and the like, or rate limits see every visitor as the proxy.
function trustProxy() {
  const value = (env.TRUST_PROXY ?? "").trim();
  if (!value || value === "0" || value === "false") return false;
  if (value === "true") return true;
  return /^\d+$/.test(value) ? Number(value) : value; // a hop count, or addresses/subnets
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

  trustProxy: trustProxy(),

  // Accounts that carry settings between browsers. Off unless ACCOUNTS is set; then
  // DATA_DIR must be on storage that survives restarts and deploys.
  //   ACCOUNTS=1         optional: sign in from Settings to sync settings
  //   ACCOUNTS=required  the whole site needs an account; a sign-in screen replaces
  //                      the HTTP Basic auth prompt
  // INVITE_CODE, when set, is needed to create an account. With ACCOUNTS=required and
  // no INVITE_CODE, AUTH_PASS (the old site password) is used as the invite code.
  accounts: {
    enabled: env.ACCOUNTS === "1" || env.ACCOUNTS === "required",
    required: env.ACCOUNTS === "required",
    signup: env.ACCOUNTS_SIGNUP !== "0",
    inviteCode: env.INVITE_CODE || (env.ACCOUNTS === "required" ? env.AUTH_PASS || "" : ""),
    dataDir: env.DATA_DIR || "data",
  },

  // URL prefixes the service worker intercepts. Both must start and end with "/".
  prefixes: {
    uv: "/service/",
    scramjet: "/scram/",
  },

  // WebSocket endpoint that carries proxied traffic (the Wisp protocol).
  wispPath: "/wisp/",

  // Optional: send browsers to an external Wisp server instead of this one. Needed on
  // hosts without WebSocket support. Users can still override it in Settings.
  wispUrl: /^wss?:\/\//i.test(env.WISP_URL ?? "") ? env.WISP_URL : "",

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
