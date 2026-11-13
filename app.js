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
import { createChat, disabledChat } from "./src/chat.js";
import { createAdmin, disabledAdmin } from "./src/admin.js";
import { createStore, disabledStore } from "./src/store.js";
import { createFriends, disabledFriends } from "./src/friends.js";
import { createLive } from "./src/live.js";
import * as roles from "./src/roles.js";
import { createSuggest, cleanQuery } from "./src/suggest.js";
import { createLimiter } from "./src/ratelimit.js";

const publicPath = fileURLToPath(new URL("./public/", import.meta.url));
const { prefixes, wispPath } = config;
// The content policy: the server's built-in list, plus what admins add in the Admin Panel.
// It is rebuilt when they change it, and Wisp reads its blacklist on every connection.
const buildPolicy = (custom) => createPolicy({
  ...config.filter,
  hosts: [...config.filter.hosts, ...custom.hosts],
  hostKeywords: [...config.filter.hostKeywords, ...custom.keywords],
  queryWords: [...config.filter.queryWords, ...custom.queryWords],
});
let policy = buildPolicy({ hosts: [], keywords: [], queryWords: [] });
const accounts = await createAccounts({ ...config.accounts, authPass: config.auth.pass });
const chat = accounts.database
  ? createChat({
    db: accounts.database,
    site: accounts.site,
    userFor: accounts.userFor,
    isAdmin: accounts.isAdmin,
    sessionActive: accounts.sessionActive,
    onBan: accounts.onBan,
    onSiteChange: accounts.onSiteChange,
    onAvatarChange: accounts.onAvatarChange,
    giphy: { key: config.chat.giphyKey, apiUrl: config.chat.giphyApiUrl, mediaUrl: config.chat.giphyMediaUrl },
  })
  : disabledChat();

// What admins change on the site (an announcement, maintenance mode) reaches every open page at once.
const live = createLive({ state: () => ({ announcement: admin.announcement(), maintenance: admin.maintenance(), terms: admin.terms() }) });

const admin = accounts.database
  ? createAdmin({
    onChange: (key, value) => {
      live.broadcast(key, key === "maintenance" ? { on: value.on, message: value.message } : key === "terms" ? { enabled: value.enabled } : value);
      if (key === "maintenance" && value.on) endProxySocketsOfNonAdmins();
      if (key === "roles") chat.rolesChanged();
    },
    db: accounts.database,
    dataDir: config.accounts.dataDir,
    userFor: accounts.userFor,
    isAdmin: accounts.isAdmin,
    serverAdmins: accounts.serverAdmins,
    kick: accounts.kick,
    applyBlocklist,
    runtime: () => ({
      chat: chat.stats?.() ?? { online: 0, streams: 0, quietStreams: 0 },
      wisp: proxySockets.size,
      filter: { enabled: policy.enabled, hosts: config.filter.hosts.length, tlds: config.filter.tlds.length, keywords: config.filter.hostKeywords.length, words: config.filter.queryWords.length },
      config: { accounts: accounts.site(), trustProxy: config.trustProxy, giphy: Boolean(config.chat.giphyKey), sitePassword: Boolean(config.auth.pass), version: info.version },
    }),
  })
  : disabledAdmin();

// The App Store checks every submission against the live policy (admins can change it any time).
const store = accounts.database
  ? createStore({ db: accounts.database, site: accounts.site, userFor: accounts.userFor, policy: () => policy, can: (user, permission) => roles.can(accounts.database, user, permission) })
  : disabledStore();

const friends = accounts.database
  ? createFriends({ db: accounts.database, site: accounts.site, userFor: accounts.userFor, isAdmin: accounts.isAdmin })
  : disabledFriends();

/** Make the admins' extra blocked sites live: the policy, and the list Wisp checks on each connection. */
function applyBlocklist(custom) {
  policy = buildPolicy(custom);
  wisp.options.hostname_blacklist = policy.wispBlacklist();
}

// Accounts can be switched off, optional or required at any time in Settings > Admin,
// so these are asked per request. When sign-in is required, the account sign-in
// screen replaces the HTTP Basic auth prompt (AUTH_PASS).
const accountsRequired = () => accounts.site().mode === "required";
const basicAuthOn = () => Boolean(config.auth.pass) && !accountsRequired();

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
applyBlocklist(admin.blocklist()); // plus anything admins added in the Admin Panel

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

if (config.auth.pass) {
  const basic = basicAuth({
    users: { [config.auth.user]: config.auth.pass },
    challenge: true,
    realm: "SuperNova OS",
  });
  app.use((req, res, next) => (basicAuthOn() ? basic(req, res, next) : next()));
}

app.use("/api/account", accounts.router);

// Maintenance mode (Admin Panel > Site): everyone but admins gets a "back soon" page, and the
// proxy is closed to them too. Only what sign-in and the health check need stays reachable.
{
  const stillOpen = /^\/(?:signin|setup)$|^\/(?:resources\/|signin\.(?:css|js)$|proxy\/(?:store|backup|account)\.js$|manifest\.webmanifest$|robots\.txt$|healthz$|api\/(?:info|live|terms)$)/;
  app.use((req, res, next) => {
    const maintenance = admin.maintenance();
    if (!maintenance.on || stillOpen.test(req.path) || accounts.userFor(req)?.admin) return next();
    res.set("Cache-Control", "no-store").set("Retry-After", "300");
    const dest = req.get("sec-fetch-dest");
    const navigation = req.method === "GET" && (dest ? ["document", "iframe", "frame"].includes(dest) : (req.get("accept") ?? "").includes("text/html"));
    if (!navigation) return res.status(503).json({ error: maintenance.message, maintenance: true });
    const text = maintenance.message.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
    res.status(503).type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Back soon</title><style>*{box-sizing:border-box}html,body{height:100%;margin:0;overflow:hidden;background:#0b0b14;color:#fff;font:16px "Segoe UI",system-ui,sans-serif}body{display:grid;place-items:center;text-align:center;padding:24px}img{display:block;width:96px;height:96px;margin:0 auto 22px}h1{font-weight:300;font-size:34px;margin:0 0 10px}p{margin:0;color:#b8b8c8;max-width:420px;line-height:1.5}a{color:#fff;display:inline-block;margin-top:22px}</style></head><body><main><img src="/resources/media/app_icons/SuperNova.png" alt="SuperNova OS" width="96" height="96"><h1>We'll be right back</h1><p>${text}</p><a href="/signin">Admin sign-in</a></main><script>try{var m=document.querySelector("p"),e=new EventSource("/api/live");e.addEventListener("maintenance",function(v){var d=JSON.parse(v.data);if(!d.on)location.reload();else m.textContent=d.message});e.addEventListener("hello",function(v){if(!JSON.parse(v.data).maintenance.on)location.reload()})}catch(x){}</script></body></html>`);
  });
}

app.get("/api/live", live.handler);

app.use("/api/admin", admin.router);
app.use("/api/chat", chat.router);
app.use("/api/store", store.router);
app.use("/api/friends", friends.router);

// Search suggestions for the taskbar's web search: the server asks the engine, so the visitor never does.
const suggestions = createSuggest({ policy: () => policy });
const suggestLimit = createLimiter({ limit: 60, windowMs: 60_000 });
app.get("/api/suggest", async (req, res) => {
  res.set("Cache-Control", "no-store");
  const wait = suggestLimit.hit(req.ip);
  if (wait) return res.set("Retry-After", String(wait)).status(429).json({ error: "Slow down a little." });
  res.json({ suggestions: await suggestions.suggest(cleanQuery(req.query.q), String(req.query.engine ?? "")) });
});

// The taskbar's network graph polls this: running totals, from which the page works out the speed.
app.get("/api/traffic", (req, res) => {
  const key = trafficKey(accounts.userFor(req)?.id, req.socket.remoteAddress);
  res.set("Cache-Control", "no-store").json({ ...trafficFor(key), at: Date.now() });
});

app.get("/api/info", (_req, res) => {
  res.set("Cache-Control", "no-cache").json({ ...info, accounts: accounts.site().mode });
});

// Where "next" may send someone after signing in: a path on this site, nothing else.
function safeNext(value) {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) && !value.startsWith("/signin") ? value : "/";
}

app.get("/signin", (req, res) => {
  if (accounts.userFor(req)) return res.redirect(303, safeNext(req.query.next));
  res.set("Cache-Control", "no-store").sendFile(join(publicPath, "signin.html"));
});

// First run: create the first admin (the code is in the server's log). The same page
// as the sign-in screen, which shows the setup form on this path.
app.get("/setup", (_req, res) => {
  if (!accounts.setupCode) return res.redirect(303, "/signin");
  res.set("Cache-Control", "no-store").sendFile(join(publicPath, "signin.html"));
});

{
  // When sign-in is required: open without an account are the sign-in screen and the
  // static files it uses (none of them private). Everything else, the proxy's
  // WebSocket included (see the upgrade handler), needs a signed-in session.
  const open = /^\/(?:resources\/|signin\.(?:css|js)$|proxy\/(?:store|backup|account)\.js$|manifest\.webmanifest$|robots\.txt$|api\/terms$)/;
  app.use((req, res, next) => {
    if (!accountsRequired() || open.test(req.path) || accounts.userFor(req)) return next();
    const dest = req.get("sec-fetch-dest");
    // Without fetch metadata (old browsers, scripts), only an explicit text/html counts.
    const navigation = req.method === "GET" && (dest ? ["document", "iframe", "frame"].includes(dest) : (req.get("accept") ?? "").includes("text/html"));
    res.set("Cache-Control", "no-store");
    if (navigation) return res.redirect(303, `/signin?next=${encodeURIComponent(req.originalUrl)}`);
    res.status(401).json({ error: "Sign in first." });
  });
}

// The announcement an admin posted (Admin Panel > Site): the desktop shows it as a notification.
app.get("/api/announcement", (_req, res) => {
  const { id, text, level, active } = admin.announcement();
  res.set("Cache-Control", "no-store").json({ announcement: active ? { id, text, level } : null });
});

// Whether the red acceptable use screen is on (Admin Panel > Site). Public: signed-out visitors see it too.
app.get("/api/terms", (_req, res) => {
  res.set("Cache-Control", "no-store").json({ enabled: admin.terms().enabled });
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
  req.account = accounts.userFor(req); // remembered so the socket can be tracked
  if (admin.maintenance().on && !req.account?.admin) return false;
  if (accountsRequired()) return Boolean(req.account);
  if (!basicAuthOn()) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) return false;
  const [user, ...rest] = Buffer.from(header.slice(6), "base64").toString().split(":");
  return safeEqual(user, config.auth.user) && safeEqual(rest.join(":"), config.auth.pass);
}

server.on("upgrade", (req, socket, head) => {
  const { pathname } = new URL(req.url, "http://localhost");
  if (pathname !== wispPath) return socket.destroy();
  if (!isAuthorized(req)) {
    const challenge = basicAuthOn() ? "WWW-Authenticate: Basic realm=\"SuperNova OS\"\r\n" : "";
    socket.end(`HTTP/1.1 401 Unauthorized\r\n${challenge}Connection: close\r\n\r\n`);
    return;
  }
  trackSocket(socket, req.account?.id ?? null, req.account ? req.sessionHash : null, trafficKey(req.account?.id, socket.remoteAddress));
  wisp.routeRequest(req, socket, head);
});

// Every proxy WebSocket, with the account session it was opened under (if any). While
// sign-in is required, a socket needs a live session: a ban from the admin page closes
// that person's sockets at once, switching to "required" closes everyone else's, and
// every 30 seconds the rest are checked, which catches bans from the command line,
// sign-outs and expiry.
const proxySockets = new Map(); // socket -> { userId, sessionHash, key }

// How much proxy traffic each person has used, for the speed graph in their taskbar: bytes sent to
// them (down) and from them (up) over every proxy connection, with those of closed connections kept.
// A person is their account, or (with no account) their address, so behind a shared proxy those share one count.
const closedTraffic = new Map(); // key -> { down, up }
const trafficKey = (userId, address) => (userId ? `u${userId}` : `a${address ?? ""}`);

function trackSocket(socket, userId, sessionHash, key) {
  proxySockets.set(socket, { userId, sessionHash, key });
  socket.once("close", () => {
    proxySockets.delete(socket);
    const total = closedTraffic.get(key) ?? { down: 0, up: 0 };
    total.down += socket.bytesWritten; total.up += socket.bytesRead;
    closedTraffic.delete(key); closedTraffic.set(key, total); // most recently used last
    if (closedTraffic.size > 5000) closedTraffic.delete(closedTraffic.keys().next().value);
  });
}

function trafficFor(key) {
  const total = { ...(closedTraffic.get(key) ?? { down: 0, up: 0 }) };
  for (const [socket, owner] of proxySockets) if (owner.key === key) { total.down += socket.bytesWritten; total.up += socket.bytesRead; }
  return total;
}

/** Maintenance mode begins: everyone but admins loses their proxy connections now, not at their next one. */
function endProxySocketsOfNonAdmins() {
  const row = accounts.database?.prepare("SELECT username, is_admin FROM users WHERE id = ?");
  for (const [socket, owner] of proxySockets) {
    const user = owner.userId && row ? row.get(owner.userId) : null;
    if (!user || !accounts.isAdmin(user)) socket.destroy();
  }
}

function closeUnauthorizedSockets() {
  if (!accountsRequired()) return;
  for (const [socket, owner] of proxySockets) if (!accounts.sessionActive(owner.sessionHash)) socket.destroy();
}

accounts.onBan((userId) => {
  for (const [socket, owner] of proxySockets) if (owner.userId === userId) socket.destroy();
});
accounts.onSiteChange(closeUnauthorizedSockets);
setInterval(closeUnauthorizedSockets, 30_000).unref();

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
  const { mode, signup } = accounts.site();
  if (basicAuthOn()) console.log(`Password protection is ON (user: ${config.auth.user})`);
  const signupText = { open: "anyone can sign up", invite: "sign-up needs an invite code", closed: "sign-up closed" }[signup];
  console.log(`Accounts: ${mode}${mode === "off" ? "" : `, ${signupText}`} (change in Settings > Admin; data in ${config.accounts.dataDir})`);
  if (mode === "required" && signup === "open") {
    console.warn("Warning: anyone who finds this site can create an account and use the proxy.");
  }
  if (accounts.setupCode) {
    // First run: whoever can read this log creates the first admin.
    console.log("");
    console.log("Set up this site: create the first admin account at");
    console.log(`\thttp://localhost:${address.port}/setup   with the code   ${accounts.setupCode}`);
    console.log("(The code is new each time the server starts, until an admin exists.)");
    console.log("");
  }

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

  chat.close(); // ends the live streams, or server.close() would wait for them
  friends.close();
  live.close();
  server.close(() => { accounts.close(); process.exit(0); });
  server.closeAllConnections?.();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

server.listen({ port: config.port });
