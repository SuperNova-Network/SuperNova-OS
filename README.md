<div align="center">

<img width="260px" src="public/resources/media/images/image1.webp" alt="SuperNova OS">

# SuperNova OS

**A web proxy with a desktop-style interface.**
Windows, a launcher, a built-in browser with tabs, two switchable proxy engines, and tab cloaking, all in one Node.js server.

<img width="900px" src="public/resources/media/images/Preview.png" alt="SuperNova OS desktop">

</div>

<br/>

## Features

- **Two proxy engines you can switch between:** [Scramjet](https://github.com/MercuryWorkshop/scramjet) (newest, best compatibility) and [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet) (lightweight, a solid fallback). Switch in Settings or from the Browser's address bar, with no restart.
- **Two transports:** libcurl (default) and Epoxy, carried over one [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) WebSocket. Point it at your own Wisp server if you like.
- **SuperNova Browser:** Chrome-style tabs (drag to reorder, pin, duplicate, reopen closed ones, right-click menu), **fullscreen per tab**, zoom, bookmarks bar, address suggestions from bookmarks and history, an address bar that shows the real URL, keyboard shortcuts and an animated new-tab page.
- **Smart search:** type an address or just words. Choose Brave, DuckDuckGo, Google, Bing, Startpage, Ecosia or your own search URL, with optional safe search.
- **Cloaking:** 13 tab disguises (Google Classroom, Docs, Canvas, Schoology, Khan Academy, ...), an `about:blank` / `blob:` launcher, a panic key that works inside windows and proxied pages, and an optional leave-page prompt. See [docs/CLOAKING.md](docs/CLOAKING.md).
- **A real content filter:** enforced on the *server*, so it covers every connection, not just the search box. See [docs/CONFIGURATION.md](docs/CONFIGURATION.md#content-filter).
- **Windows 10-style Settings:** a Home page of category tiles, "Find a setting" search, Windows toggles, and the Fluent Reveal highlight. Settings is pinned to the taskbar.
- **A desktop to go with it:** draggable, resizable windows, taskbar, launcher, wallpapers, colour schemes, a terminal and a file explorer, in the look and feel of Windows 10.
- **Sensible security defaults:** the proxy refuses connections to the server's own network (no SSRF), password protection is one environment variable away, and no credentials live in the repository.

## Quick start

```sh
git clone https://github.com/SuperNova-Network/SuperNova-OS.git
cd SuperNova-OS
npm install
npm start
```

Open <http://localhost:3000>. Requires **Node.js 20 or newer**.

For development, `npm run dev` restarts the server when files change. Run the tests with `npm test`.

## Using it

| To... | Do this |
| --- | --- |
| Browse the web | Open **SuperNova** on the desktop, or switch the taskbar search to **Web** and type an address or a search |
| Switch engine | Settings > **Proxy** > Engine, or the engine badge in the Browser's address bar |
| Change the connection | Settings > **Proxy** > Connection (libcurl / Epoxy), or set a custom Wisp server |
| Check that it works | Settings > Proxy > Troubleshooting > **Run test** |
| Disguise the tab | Settings > **Cloaking** > Tab disguise |
| Hide instantly | Settings > Cloaking > **Panic key** (pick a combination such as `Ctrl+Alt+P`) |
| Open in `about:blank` | Settings > Cloaking > **Open in about:blank** |
| Change wallpaper or colours | Settings > **Appearance**, or right-click the desktop |

## Configuration

Everything is optional. Copy `.env.example` to `.env`, or set these in your host's dashboard.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on |
| `AUTH_PASS` | *(empty)* | Set to require a login (HTTP Basic). Empty keeps the site public |
| `AUTH_USER` | `admin` | Username when `AUTH_PASS` is set |
| `CONTENT_FILTER` | `1` | `0` turns the content filter off |
| `BLOCKED_HOSTS` | *(empty)* | Extra domains to block, comma separated |
| `WISP_URL` | *(empty)* | Use an external Wisp server (`wss://...`) instead of this one |
| `OPEN_BROWSER` | *(empty)* | `1` opens your browser on start (local development) |

The full reference is in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Deploying

The proxy runs over a WebSocket, so it needs a host that supports long-lived connections: Fly.io, Render, Railway, Heroku, any VPS or any container platform. **Vercel and Netlify functions cannot hold WebSockets open**; use one of the above, or a static host plus an external Wisp server (`WISP_URL`). A `Dockerfile`, `fly.toml` and `render.yaml` are included. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

> **Running a public instance?** Read [SECURITY.md](SECURITY.md) first. A proxy lets people browse *from your server's IP address*.

## Documentation

| | |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | How a page load travels through the system, and every workaround and why |
| [Proxy engines and transports](docs/PROXY.md) | Choosing and switching them, search and safe search |
| [Cloaking](docs/CLOAKING.md) | Tab disguise, panic key, `about:blank`, and their limits |
| [Configuration](docs/CONFIGURATION.md) | Environment variables, the content filter, authentication |
| [Deployment](docs/DEPLOYMENT.md) | Docker, Fly.io, Render, a VPS with HTTPS |
| [Development](docs/DEVELOPMENT.md) | Project layout, tests, adding an app to the desktop |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | When a page will not load |
| [Changelog](CHANGELOG.md) | What changed from the original project |

## Contributing

Bug reports, ideas and pull requests are welcome. Start with [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md), and join the community on Discord: [dsc.gg/supernovaproxy](https://dsc.gg/supernovaproxy).

## License

SuperNova OS is free software under the **GNU Affero General Public License v3.0** ([LICENSE](LICENSE)). If you run a modified version for others over a network, you must offer them its source code; Settings > System > About links to this repository for that reason.

SuperNova OS builds on [Ultraviolet](https://github.com/titaniumnetwork-dev/Ultraviolet), [Scramjet](https://github.com/MercuryWorkshop/scramjet), [bare-mux](https://github.com/MercuryWorkshop/bare-mux), [libcurl.js](https://github.com/ading2210/libcurl.js), [epoxy-tls](https://github.com/MercuryWorkshop/epoxy-tls) and [wisp-js](https://github.com/MercuryWorkshop/wisp-js). The desktop shell is derived from PeOS by [PicturElements](https://github.com/PicturElements).
