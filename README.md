<div align="center">
  <img width="120" src="public/resources/media/app_icons/SuperNova.png" alt="SuperNova">
  <h1>SuperNova OS</h1>
  <p>A web proxy with a Windows 10 style desktop.</p>

  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue" alt="License"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-20%2B-green" alt="Node 20+"></a>
  <a href="https://dsc.gg/supernovaproxy"><img src="https://img.shields.io/badge/discord-join-5865f2" alt="Discord"></a>
</div>

<br>

![SuperNova OS desktop](docs/img/desktop.webp)

SuperNova OS is a web proxy that runs inside a Windows 10 style desktop. It has a tabbed browser, games on the desktop, tab cloaking and a server side content filter, all from one Node.js app.

## Features

- Two proxy engines, [Scramjet](https://github.com/MercuryWorkshop/scramjet) and [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet). Switch between them in Settings or from the address bar, no restart needed.
- Two transports, libcurl (default) and Epoxy, both over one [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) WebSocket. You can point it at your own Wisp server.
- Chrome style browser with draggable tabs, pinning, duplicate and reopen, fullscreen per tab, zoom, a bookmarks bar, address suggestions, real URLs in the address bar and an animated new tab page.
- 13 games on the desktop that run through the proxy: Bloxd.io, Slither.io, Diep.io, Krunker, Paper.io 2, Skribbl.io, Zombs.io, 2048, Survev.io, Minecraft, Cookie Clicker, Smash Karts and MooMoo.io.
- Tab cloaking with 13 disguises, an about:blank / blob: launcher, a panic key that works inside windows and proxied pages, and an optional leave page prompt.
- Content filter that runs on the server, so it covers every connection and not just the search box.
- Windows 10 style Settings app with a tile home page, setting search, toggles and the Fluent Reveal hover effect.
- 21 wallpapers (space and gaming). Click "Show more" in Settings > Appearance to see all of them.
- Search with Brave, DuckDuckGo, Google, Bing, Startpage, Ecosia or a custom URL, with optional safe search.
- Draggable and resizable windows, a launcher, a terminal and a file explorer.
- Blocks connections to the server's own network (SSRF protection), optional password through one env variable, and no credentials in the repo.

<p>
  <img src="docs/img/browser.webp" width="49%" alt="SuperNova Browser">
  <img src="docs/img/settings.webp" width="49%" alt="Settings app">
</p>

## Getting started

You need Node.js 20 or newer, or 22.13 or newer for accounts and the admin panel (they use its built-in SQLite).

```sh
git clone https://github.com/SuperNova-Network/SuperNova-OS.git
cd SuperNova-OS
npm install
npm start
```

Then open http://localhost:3000.

To manage the site (accounts, sign-up, invite codes, bans), use the setup link the server prints on its first start: it creates the first admin, who gets Settings > Admin.

Other scripts:

- `npm run dev` restarts the server when files change
- `npm test` runs the tests

## Usage

- Browse: open SuperNova on the desktop, or switch the taskbar search to Web and type a URL or search.
- Games: double click the icon on the desktop.
- Your own apps: right click the desktop > Add an app…, or open the browser menu > Add to desktop. Right click an app you added to rename or remove it.
- Switch engine: Settings > Proxy > Engine, or click the engine badge in the browser's address bar.
- Change transport: Settings > Proxy > Connection. You can also set a custom Wisp server there.
- Test the connection: Settings > Proxy > Troubleshooting > Run test.
- Cloaking: Settings > Cloaking for the tab disguise, panic key (e.g. `Ctrl+Alt+P`) and open in about:blank.
- Wallpaper and colors: Settings > Appearance, or right click the desktop.
- Accounts (when the site has them on): Settings > Account to create one or sign in. Your apps, wallpaper, bookmarks and preferences follow you to any browser you sign in on.
- Chat (needs accounts): the Chat icon on the taskbar opens a live room for everyone signed in, with emoji and GIFs. Click your name there to set a profile picture. Admins moderate from the same window.
- Back up or move your setup: Settings > System > Backup exports your apps, bookmarks and preferences to a file and imports it again, on any SuperNova site.

<details>
<summary>Browser shortcuts</summary>

| Keys | Action |
| --- | --- |
| `Alt+T` / `Alt+W` | New tab / close tab |
| `Alt+Shift+T` | Reopen last closed tab |
| `Alt+L` | Focus address bar |
| `Alt+D` | Bookmark page |
| `Alt+Left` / `Alt+Right` | Back / forward |
| `F5` | Reload |
| `F11` | Fullscreen tab |
| `Alt+1` to `Alt+9` | Jump to tab |
| `Ctrl+Tab` | Next tab |
| `Alt++` / `Alt+-` / `Alt+0` | Zoom in / out / reset |

</details>

## How it works

Page requests go through a service worker, which rewrites them using whichever engine you picked. The transport (libcurl or Epoxy) sends that traffic over a Wisp WebSocket to the Node server. The server checks it against the content filter and SSRF guard, then relays it. It doesn't rewrite anything itself, it just passes bytes along and serves the desktop.

```mermaid
flowchart LR
    A[Browser] --> B[Service worker]
    B --> C{Scramjet / Ultraviolet}
    C --> D[libcurl / Epoxy]
    D <-->|Wisp| E[Node server]
    E <--> F[(Web)]
```

More detail, including the workarounds and why they're there, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Configuration

Everything is optional. Copy `.env.example` to `.env` or set these on your host.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `AUTH_PASS` | empty | Set this to require a login (HTTP Basic). Leave empty for a public site |
| `AUTH_USER` | `admin` | Username when `AUTH_PASS` is set |
| `CONTENT_FILTER` | `1` | Set to `0` to turn the filter off |
| `BLOCKED_HOSTS` | empty | Extra domains to block, comma separated |
| `WISP_URL` | empty | Use an external Wisp server (`wss://...`) |
| `OPEN_BROWSER` | empty | Set to `1` to open your browser on start |
| `DATA_DIR` | `data` | Where accounts and the admin panel's choices are stored. Put it on a persistent disk |
| `ACCOUNTS` / `ACCOUNTS_SIGNUP` / `ADMINS` | empty | Optional overrides for what Settings > Admin manages. Leave them unset to choose in the panel |
| `TRUST_PROXY` | empty | Set to `1` behind a hosting platform's proxy (Fly.io, Render, nginx) |

Full reference: [docs/CONFIGURATION.md](docs/CONFIGURATION.md)

## Deploying

The proxy runs over WebSockets, so you need a host that keeps connections open: Fly.io, Render, Railway, Heroku, a VPS or any container platform. A `Dockerfile`, `fly.toml` and `render.yaml` are included.

**Vercel and Netlify won't work** since their functions can't hold WebSockets open. If you want to use one of them, host the static files there and set `WISP_URL` to an external Wisp server.

If you're running a public instance, read [SECURITY.md](SECURITY.md) first. Anyone using it is browsing from your server's IP.

Step by step guides are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Proxy engines and transports](docs/PROXY.md)
- [Cloaking](docs/CLOAKING.md)
- [Configuration](docs/CONFIGURATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Development](docs/DEVELOPMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [Changelog](CHANGELOG.md)
- [Security](SECURITY.md)

## Contributing

Issues and PRs are welcome. Check [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) before you start. You can also find us on [Discord](https://dsc.gg/supernovaproxy).

## License

AGPL-3.0, see [LICENSE](LICENSE). If you host a modified version for other people you have to make the source available to them, which is why Settings > System > About links back to this repo.

## Credits

Built on [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet), [Scramjet](https://github.com/MercuryWorkshop/scramjet), [bare-mux](https://github.com/MercuryWorkshop/bare-mux), [libcurl.js](https://github.com/ading2210/libcurl.js), [epoxy-tls](https://github.com/MercuryWorkshop/epoxy-tls) and [wisp-js](https://github.com/MercuryWorkshop/wisp-js). The desktop is based on PeOS by [PicturElements](https://github.com/PicturElements).

Space wallpapers are public domain images from NASA, ESA, Hubble and Webb (via Wikimedia Commons), except the Andromeda Galaxy photo by Adam Evans, used under [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/). The gaming wallpapers were generated for this project.
