# Changelog

All notable changes. The project follows [Semantic Versioning](https://semver.org/); this section has not been released yet.

## Unreleased

A ground-up modernisation of the proxy, the settings, the cloak and the interface. Highlights first; every change is its own commit in the history.

### Fixed

- **The proxy returned a 404 the first time it was used** and worked on the second try. The service worker was registered but not yet active when the page navigated. Navigations now wait for activation, the worker takes control immediately, and a navigation that still arrives without it gets a page that starts the worker and reloads instead of a 404. Desktop apps (YouTube, Reddit, ...) never registered the worker at all.
- About one fresh visit in five failed with `wasm not loaded yet` (libcurl's start-up race), a second "fails the first time" bug found by repeated fresh-profile testing.
- Scramjet never finished loading large sites (Wikipedia, GitHub, DuckDuckGo, ...): sub-resources whose responses set cookies deadlocked against the page's message queue. Small pages worked, which hid it.
- Scramjet could not start when its worker won a race to create its IndexedDB schema, and failed every request when its config arrived by message.
- Typing `(` or `[` into the launcher search threw on every keystroke.
- Renaming an app threw on every keystroke (a call to a function that no longer existed), and names were inserted as HTML.
- The battery indicator threw in Firefox and Safari; the low-battery popup contained profanity.
- A saved custom wallpaper was never restored on reload.
- The File Explorer sidebar called the GitHub API on every page load (60 requests/hour per IP).
- The 404 page referenced missing files, called `play()` unguarded and contained profanity.
- Wrong search keywords on most apps (copied from the PeOS template).
- Web search navigated the *whole desktop* away to the site.
- Cross-origin app windows could not use fullscreen, gamepads or autoplay.
- `package.json` declared an ISC license although the project is AGPL-3.0.

### Added

- **Scramjet** as a second engine beside Ultraviolet, switchable at runtime in Settings or from the Browser.
- **libcurl** and **Epoxy** transports over Wisp, switchable in Settings, with a custom Wisp server option and a connection test.
- **SuperNova Browser**: tabs, real-URL address bar, shortcuts, new-tab page, engine switcher, friendly blocked/error pages.
- **Settings app** with Proxy, Cloaking, Appearance and System sections, a proxy self-test and a reset button.
- **Cloaking:** 13 tab disguise presets plus custom, applied on every load; `about:blank` and `blob:` launchers with auto-launch; a panic key that works inside windows and proxied pages; a leave-page prompt.
- **Search:** smart address-or-search detection, six search engines plus custom, safe search.
- **Content filter enforced on the server**, with hostname-based rules, `BLOCKED_HOSTS` and a verdict API.
- **Interface:** design tokens, glass taskbar, hover/press effects, click ripples, window open/close animations, accent colour from the colour scheme, reduced-motion support, a small-screen fallback.
- `/healthz`, `WISP_URL`, `/api/info`, web app manifest, `robots.txt`.
- A test suite (58 tests), GitHub Actions CI on Node 20, 22 and 24, and documentation under `docs/`.

### Changed

- **The proxy runs on Wisp and bare-mux** instead of the legacy Bare server, with Ultraviolet 3.2 served from `node_modules` instead of a stale vendored copy.
- The server is configured from environment variables (`config.js`).
- The Dockerfile, Fly.io, Render and Heroku configs were rewritten and corrected.
- The proxy URL prefix is `/service/` (old `/supernova/` links redirect).
- Settings and the browser replace the old inline-script settings page and one-box search.

### Security

- **Removed the hardcoded Basic-auth password** from `app.js`. Authentication is opt-in through `AUTH_PASS` and also protects the WebSocket. *If you used the old password anywhere else, change it; it remains in git history.*
- The proxy refuses connections to loopback, private and link-local addresses (SSRF).
- `.env` is no longer tracked.
- App names, wallpaper URLs, custom icons and panic destinations are escaped or validated.

### Removed

- `vercel.json`: serverless functions cannot hold the proxy's WebSocket open (see [Deployment](docs/DEPLOYMENT.md)).
- The vendored Ultraviolet copy, the Bare server, and the unused `chalk`, `cors` and `node-fetch` dependencies.
- Orphaned pages: `proxyApps/`, `cloak.html` (a saved third-party homepage that loaded Google Tag Manager), `&.html`.
