# Development

## Setup

```sh
git clone https://github.com/SuperNova-Network/SuperNova-OS.git
cd SuperNova-OS
npm install
npm run dev      # restarts the server on file changes; http://localhost:3000
npm test
```

Node.js 20 or newer. The test suite is verified on Node 20, 22 and 26, and CI runs it on 20, 22 and 24.

## Tests

`npm test` runs Node's built-in test runner over [`test/`](../test). There are no browser dependencies.

| File | What it covers |
| --- | --- |
| `resolve.test.js` | Address-or-search decisions, search engines, safe search |
| `policy.test.js` | Content filter rules, including the innocent hostnames that must stay allowed |
| `store.test.js` | The settings store, cross-window events, blocked storage |
| `cloak.test.js` | Key combinations, URL and icon safety, preset selection |
| `server.test.js` | Routes, generated configs, the boot page, redirects, `/api/*`, `WISP_URL` |
| `auth.test.js` | Basic auth on pages, APIs **and the WebSocket upgrade** |
| `wisp.test.js` | The server refusing blocked and private destinations, over the real Wisp protocol |

Two helpers in `test/helpers.js` keep this simple:

- `loadBrowserScript("public/…")` runs a browser script (they are plain scripts that attach to `self`) inside a Node `vm` sandbox, so `resolve.js`, `store.js` and `cloak.js` are unit-tested without a browser.
- `startServer(env)` launches the real `app.js` on a free port, so integration tests exercise exactly what ships.

Behaviour that needs a real browser (the first-visit flow, engine switching, the desktop) was verified with Playwright against Chrome. When you test the proxy, **assert that the page finishes loading and paints** (`document.readyState === 'complete'`), not just that its `<title>` arrived: the title comes with the first bytes, and several serious bugs here only showed on sub-resources. Those scripts are not part of the repository, because they download a browser and depend on live websites. If you change `core.js`, `sw.js` or the transport setup, please test on a **fresh browser profile**: most bugs in this area only appear on the first load.

## Layout

See [Architecture](ARCHITECTURE.md#files) for the file map. In short: `app.js` and `config.js` are the server; `public/proxy/` is the client core shared by every page; `public/apps/` holds the Browser and Settings apps; `public/resources/` is the desktop shell.

## Recipes

### Add an app to the desktop

Edit `programData` at the top of [`main.js`](../public/resources/scripts/main.js). Keep the last five entries (Viewer, Console, Prompt, Settings, File Explorer) last.

```js
// A page embedded as-is (cross-origin pages cannot use the panic key):
{ name: "Sweeper", url: "https://example.com/game/", icon: { url: "minesweeper" }, keywords: "mine,game" },

// A site opened *through the proxy*, with the engine chosen in Settings:
{ name: "Reddit", url: "", proxy: "https://www.reddit.com", icon: { url: "Reddit" }, keywords: "reddit,social" },
```

Icons are PNGs in `public/resources/media/app_icons/` (the `icon.url` value is the file name without `.png`). `keywords` drive the launcher search.

### Add a search engine

Add an entry to `SEARCH_ENGINES` in [`resolve.js`](../public/proxy/resolve.js): a `url` with `%s` for the query and a `safe` suffix if the engine documents a strict-mode parameter (otherwise `""`). It appears in Settings automatically. Add a case to `test/resolve.test.js`.

### Add a tab disguise

Add an entry to `PRESETS` in [`cloak.js`](../public/resources/scripts/cloak.js): `id`, `name`, `title`, and `icon` (`favicon("example.com")` uses a stable favicon service).

### Block or allow hostnames

Edit `filter` in [`config.js`](../config.js), or set `BLOCKED_HOSTS`. Add a case to `test/policy.test.js`, especially for hostnames that must stay allowed.

### Add a server route

In `app.js`, before the 404 handler. Routes placed before the `basicAuth` middleware are public; keep it that way only for liveness checks like `/healthz`.

## Conventions

- **Server code** is ES modules (`"type": "module"`), no build step.
- **Browser scripts** are plain scripts, not modules, so they work in the service worker and in pages that load them with `<script>`. Legacy desktop code (`main.js`, `console.js`) is ES5-style; the apps (`browser.js`, `settings.js`) use modern syntax.
- **Settings** go through `SnStore` (`sn.<key>` in `localStorage`); register a default with `SnStore.defaults({...})`.
- **Anything inserted with `innerHTML` must be escaped** (`escapeHtml` in `main.js`). Prefer `textContent`.
- **The desktop is meant to look and feel like Windows 10.** Do not add hover lifts, springs, glows, ripples or window animations to it; keep to the flat, instant behaviour of `styles.css`. The Browser and Settings apps follow the same rule and take their colours from [`tokens.css`](../public/resources/css/tokens.css).
- **Commits** are small and describe the *why*: what was wrong, what caused it, how it was verified.

## Upgrading the proxy libraries

The libraries are served from `node_modules`, so `npm update` updates the proxy. Before you do:

1. Read [the workarounds](ARCHITECTURE.md#workarounds-for-upstream-bugs); several exist because of specific upstream bugs and may no longer be needed (or may break).
2. Note that **bare-mux is deprecated upstream** in favour of `@mercuryworkshop/proxy-transports`, and the Epoxy 3.x and libcurl 2.x transports target that newer interface. They are pinned (`epoxy-transport` 2.x, `libcurl-transport` 1.x) to stay compatible with Ultraviolet and Scramjet 1.x. Moving to Scramjet 2 means moving all of it together.
3. Test on a fresh profile with both engines and both transports.
