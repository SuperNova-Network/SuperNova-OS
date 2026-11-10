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

/** ACCOUNTS: "off" | "optional" | "required", or null when not set (the admin panel decides). */
function accountsMode() {
  const value = (env.ACCOUNTS ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "1" || value === "on" || value === "optional") return "optional";
  if (value === "required") return "required";
  if (value === "0" || value === "off" || value === "false") return "off";
  throw new Error(`Invalid ACCOUNTS environment variable: ${JSON.stringify(env.ACCOUNTS)} (use optional, required or off)`);
}

/** ACCOUNTS_SIGNUP: "invite" | "open" | "closed", or null when not set. */
function signupMode() {
  const value = (env.ACCOUNTS_SIGNUP ?? "").trim().toLowerCase();
  if (!value) return null;
  if (value === "0" || value === "closed" || value === "false") return "closed";
  if (value === "invite" || value === "open") return value;
  if (value === "1") return "open";
  throw new Error(`Invalid ACCOUNTS_SIGNUP environment variable: ${JSON.stringify(env.ACCOUNTS_SIGNUP)} (use invite, open or closed)`);
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

  // Accounts are managed in Settings > Admin: whether they are off, optional or
  // required, who can sign up, and who is an admin. The database lives in DATA_DIR,
  // which must be on storage that survives restarts and deploys. On a fresh site the
  // server prints a one-time setup link to create the first admin.
  //
  // These variables are optional overrides. When set, the matching option is fixed
  // (and shown locked in the admin panel):
  //   ACCOUNTS         1 or optional, required, or 0/off
  //   ACCOUNTS_SIGNUP  invite, open, or 0/closed
  //   ADMINS           usernames that are always admins, comma separated
  //   INVITE_CODE      a fixed invite code accepted besides the generated ones; with
  //                    accounts required and no INVITE_CODE, AUTH_PASS is accepted
  accounts: {
    mode: accountsMode(),
    signup: signupMode(),
    inviteCode: env.INVITE_CODE || "",
    admins: list(env.ADMINS),
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
