# Changelog

All notable changes. The project follows [Semantic Versioning](https://semver.org/); this section has not been released yet.

## Unreleased

A ground-up modernisation of the proxy, the settings, the cloak and the interface. Highlights first; every change is its own commit in the history.

### Fixed

- Pin to taskbar from a desktop icon threw, and pinned nothing, whenever an unpinned window was open.
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
- The File Explorer taskbar icon did nothing and threw an error: it was pinned twice by default, which rewrote its click handler to a call that crashes. Settings now has that permanent slot.
- Wrong search keywords on most apps (copied from the PeOS template).
- Web search navigated the *whole desktop* away to the site.
- Cross-origin app windows could not use fullscreen, gamepads or autoplay.
- `package.json` declared an ISC license although the project is AGPL-3.0.

### Added

- **The Admin Panel.** A desktop app for admins (Admin in the start menu, or Settings > Admin > Open the Admin Panel) with a dashboard (accounts, new and active people, who is in the chat, proxy connections, 14-day charts), an account manager (search, filter, sort, bulk ban, unban and sign-out, and for each account its browsers with where they came from, recent messages and chat history, plus make or remove admin, ban, sign out everywhere, set a password, chat timeout or ban, delete), every signed-in session, making up to 50 invite codes at once, a chat message browser that finds deleted messages and the chat rules, extra blocked sites, keywords and search words that apply at once, announcements (shown as a notification on everyone's desktop), maintenance mode (everyone but admins gets a "back soon" page), an audit log of everything admins do merged with the chat's moderation log, server health, a database tidy-up and backup download, and CSV exports. The start menu's Power button, which went missing when the Chat was added, is back.
- **A Windows 10 lock screen for signing in.** The sign-in page is now a lock screen (a different wallpaper each visit, drifting slowly, with floating dust, a big clock and date, and live network and battery icons) that unlocks with a click, any key, scrolling or dragging up, then the sign-in screen (frosted wallpaper, the avatar showing your initial as you type, an eye to check the password, a shake when it is wrong), then a Welcome screen with Windows' ring of five spinning dots and a changing greeting before the screen swells into the desktop. Create account, forgot password, the recovery code and first-run setup share the look. Esc, or a minute of nobody there, returns to the lock screen. A power menu has Sleep and Restart, and Ease of access has Reduce motion (on by default if your system asks for less motion). It runs at 60 fps and the whole page is under 400 KB.
- **Live chat.** A Chat icon on the taskbar (and in the start menu) opens one public room for everyone who is signed in, with your name and profile picture, who is online, an emoji picker and GIFs (upload one, or search GIPHY when the server has a `GIPHY_API_KEY`; the server relays the pictures, so browsers never contact GIPHY). Messages are delivered live over Server-Sent Events and shown as text, never HTML. Spam is filtered (length, repeats, shouting, links, an admin-editable blocked-word list, slow mode, bursts and repeats), and someone who keeps tripping the filters gets an automatic timeout. Admins have a gold name and an ADMIN badge, and can delete messages, time out or ban people from the chat (with a reason, and optionally removing their recent messages), lift them, clear, lock or switch off the chat, tune the rules and read a moderation log, all from the Chat window. Needs accounts.
- **The App Store.** A taskbar app, pinned by default for everyone right after Chat (the Admin Panel stays last), where people publish apps for the community: a name, web address, category, description and optional picture. Browse by category, search and sort by installs, and add an app to your desktop with one click. Whether new apps wait for an admin or go live at once is an Admin Panel setting; the approval queue lives in the Admin Panel (approve, reject with a reason, take down, delete, with a count on the nav item and dashboard). Apps are only web addresses, so nothing a person publishes runs on this site, and they follow the content filter. Everyone who already had taskbar pins gets the Store pinned once.
- **Profile pictures.** Choose or remove one in Settings > Account. It is cropped square and shrunk in the browser, saved to your account (PNG, JPEG or WebP, judged from the bytes, up to 120 KB and 1024 px) and follows you to any browser. The Chat shows a new picture right away.
- **Notifications.** Small, flat pop-ups in the style of Windows 10's, at a corner of the desktop: an app name line, a picture, a bold title and the text. They stack, slide in and fade away after 5 seconds to 5 minutes, and when the stack would reach more than three quarters of the way up the lower half of the screen the oldest fade first. Settings > Notifications has the master switch, Do not disturb, a switch per sender, dark, light or colour-scheme styling, small or standard size, which corner, banners, pictures, message previews, sound and duration, and a test button, all saved with the account.
- **Chat notifications.** Off until turned on, in the Chat's own settings or in Settings > Notifications. Then a new message from somebody else shows a notification titled "Messaging app" with the sender's picture, name and what they said, unless you are looking at the Chat, even when its window is closed. A quiet connection (not counted as being in the chat) is open only while the setting is on.
- **Site settings in the admin panel.** Accounts (off, optional, required) and who can sign up are chosen in Settings > Admin and apply at once, with no restart; switching to required disconnects everyone who isn't signed in. Admins are a role given in the account list. A fresh site prints a one-time setup link with a code in the server's log to create the first admin. `ACCOUNTS`, `ACCOUNTS_SIGNUP` and `ADMINS` still work, as overrides the panel shows locked, and `npm run admin` gains `status`, `accounts`, `signup`, `make-admin` and `remove-admin`.
- **Invite codes and bans.** In Settings > Admin: create invite codes with a label, a number of uses and an expiry, see how each is used, and revoke them; search accounts and ban (with a reason the person sees) or unban. A ban signs the person out everywhere and closes their open proxy connections at once. `npm run admin -- invite|invites|revoke|users|ban|unban` does the same on the server. Existing account databases are upgraded in place.
- **A sign-in screen for the whole site** (Settings > Admin > Accounts > Required), replacing the HTTP Basic auth prompt. Pages, APIs and the proxy's WebSocket need a signed-in account; creating one needs the invite code (`INVITE_CODE`, or the existing `AUTH_PASS`), so a password-protected site switches over with one variable and everyone gets their own login.
- **Accounts** (off by default; turned on in Settings > Admin). Sign in under Settings > Account and your desktop apps, wallpaper, colours, bookmarks and preferences follow you to any browser. Changes sync key by key, so two browsers editing different settings never undo each other; browsing history stays on the device. No email: a one-time recovery code resets a forgotten password. Signing out removes the settings from that browser. Stored in one SQLite file under `DATA_DIR`; passwords hashed with scrypt, sessions in an `HttpOnly`, `SameSite=Strict` cookie, sign-in and sign-up rate limited. `ACCOUNTS_SIGNUP=0` closes sign-up and `TRUST_PROXY` makes rate limits see real visitor addresses behind a proxy.
- **Back up and restore settings.** Settings > System > Backup exports your apps, bookmarks, wallpaper, colours, and proxy and cloak preferences to a JSON file, and imports one again, here or on another SuperNova site. Import shows what it will replace before changing anything, and warns when a backup would send traffic through a different Wisp server. Browsing history stays on the device.
- **Add your own apps to the desktop.** Right-click the desktop > Add an app…, or use Add to desktop in the browser menu to add the page you are on. Custom apps open in their own window through the proxy, and can be renamed, pinned to the taskbar, found in the start menu and search, and removed (right-click > Remove from desktop). They get a coloured letter icon rather than the site's favicon, so the desktop never contacts the site directly. The content filter is checked when an app is added and again each time it opens.
- Ten new wallpapers (six space photographs, four generated gaming ones) and a small "Show more" button in Settings > Appearance, which lists the first ten and reveals the rest.

- **Scramjet** as a second engine beside Ultraviolet, switchable at runtime in Settings or from the Browser.
- **libcurl** and **Epoxy** transports over Wisp, switchable in Settings, with a custom Wisp server option and a connection test.
- **SuperNova Browser**: tabs, real-URL address bar, shortcuts, new-tab page, engine switcher, friendly blocked/error pages.
- **Settings app** with Proxy, Cloaking, Appearance and System sections, a proxy self-test and a reset button.
- **Cloaking:** 13 tab disguise presets plus custom, applied on every load; `about:blank` and `blob:` launchers with auto-launch; a panic key that works inside windows and proxied pages; a leave-page prompt.
- **Search:** smart address-or-search detection, six search engines plus custom, safe search.
- **Content filter enforced on the server**, with hostname-based rules, `BLOCKED_HOSTS` and a verdict API.
- **Interface:** the desktop keeps its original Windows 10 look; Settings is styled like the Windows 10 Settings app (Home page, Find a setting, Windows toggles, Reveal highlight) and the Browser app has its own animated, Chrome-style design; the colour scheme sets the apps' accent colour; a small-screen fallback.
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
