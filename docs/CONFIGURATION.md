# Configuration

Server settings come from environment variables, read in [`config.js`](../config.js). For local use, copy [`.env.example`](../.env.example) to `.env`; on a host, set them in its dashboard. `.env` is git-ignored: never commit real values.

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | Port to listen on. An invalid value stops the server with an error |
| `AUTH_PASS` | *(empty)* | When set, every page, API and the Wisp WebSocket require HTTP Basic auth |
| `AUTH_USER` | `admin` | Username for Basic auth |
| `CONTENT_FILTER` | `1` | `0` disables the content filter |
| `BLOCKED_HOSTS` | *(empty)* | Extra blocked domains, comma separated. Subdomains are included |
| `WISP_URL` | *(empty)* | Send browsers to an external Wisp server (`ws://` or `wss://` only) |
| `OPEN_BROWSER` | *(empty)* | `1` opens a browser when the server starts. Never use it on a host |
| `ACCOUNTS` | *(empty)* | `1` turns on [accounts](#accounts). Needs Node.js 22.13+ and a persistent `DATA_DIR` |
| `ACCOUNTS_SIGNUP` | `1` | `0` stops new sign-ups; existing accounts keep working |
| `DATA_DIR` | `data` | Where the accounts database (`accounts.db`) is kept |
| `TRUST_PROXY` | *(empty)* | Proxies in front of the server to trust for the visitor's address and protocol: a hop count (`1`), `true`, or addresses. Set it behind Fly.io, Render, nginx and the like |

`GET /healthz` returns `ok` without authentication, for platform health checks.

## Authentication

Set `AUTH_PASS` to password-protect the whole site. The credentials are checked with a constant-time comparison, and the **Wisp WebSocket upgrade is checked too**; Express middleware never sees WebSocket upgrades, so without this the proxy itself would stay open.

Basic auth sends the password with every request, so only use it over HTTPS (all the platforms in [Deployment](DEPLOYMENT.md) provide it). The original project shipped a hardcoded `admin` / password pair in the source; if you ever used it, change it, because it remains in the git history.

## Accounts

Off by default. With `ACCOUNTS=1`, people can create an account under Settings > Account, and their settings follow them to any browser they sign in on: desktop apps and names, wallpaper and colours, bookmarks, and proxy, search and cloaking preferences. Browsing history is never sent to the server.

- **Storage.** One SQLite file, `DATA_DIR/accounts.db` (the built-in `node:sqlite`, so no extra dependency). Put `DATA_DIR` on storage that survives restarts and deploys: a Fly.io volume, a Render disk, a Docker volume, or a VPS's own disk. On an ephemeral filesystem every account disappears on the next deploy. Back the file up like any database.
- **No email.** Sign-up shows a one-time recovery code; with it a person can set a new password (and gets a new code). Without it, a forgotten password cannot be recovered.
- **Passwords** are hashed with scrypt. Sessions are random tokens (only their hashes are stored) in an `HttpOnly`, `SameSite=Strict` cookie that lasts 30 days and renews while in use. Changing the password or using the recovery code signs out every other browser.
- **Limits.** Sign-in is limited to 10 tries per username and 20 per address every 10 minutes, sign-up to 5 accounts per address per hour, and an account's settings to 512 KB. Behind a reverse proxy, set `TRUST_PROXY`, or every visitor shares the proxy's address and these limits.
- **Closing sign-up.** `ACCOUNTS_SIGNUP=0` keeps existing accounts working but refuses new ones, for example once everyone in a class has an account.
- **Signing out** removes the account's settings from that browser, which matters on shared computers. A factory reset signs out first, so it resets the browser without touching the account.

## Content filter

On by default, designed for use in schools. It is **enforced on the server**, as the hostname blacklist of the Wisp server, so it applies to every connection from every engine: links followed inside proxied pages, direct `/service/…` URLs, scripts. The Browser asks `POST /api/verdict` first only so it can show a friendly message instead of a network error.

Rules live in `config.js` under `filter`:

| Rule | Matches | Example |
| --- | --- | --- |
| `hosts` | The domain and all its subdomains | `pornhub.com` blocks `www.pornhub.com` and `a.b.pornhub.com`, not `notpornhub.com` |
| `tlds` | A top-level domain | `xxx`, `porn`, `sex`, `adult` |
| `hostKeywords` | A substring of the *hostname* | `porn`, `xxx`, `hentai` |
| `queryWords` | A whole *word* in a typed search | `porn`, `nude` |

Design notes:

- Matching is by **hostname**, never against a whole URL. Matching words inside URLs blocks innocent sites (`essex.ac.uk`, `sussex.edu`, `adult-education.org`). That is also why `sex` and `adult` are *not* keywords. Health-education searches work.
- Typed searches also get the engine's strict **safe search** parameter (Settings > Proxy > Safe search).
- Add domains without editing code with `BLOCKED_HOSTS`. For other changes edit `config.js`.

Limits to be honest about: a hostname list cannot recognise a new site, a mirror on an unlisted domain, or content on an otherwise allowed site. Treat it as one layer, not a guarantee. The Wisp server resolves a hostname's DNS *before* it applies its blacklist, so a blocked name is still looked up (it is never connected to).

## Prefixes and paths

URL prefixes live in `config.js` as `prefixes.uv` (`/service/`) and `prefixes.scramjet` (`/scram/`), and `wispPath` (`/wisp/`). The client configuration is generated from them, so they can be changed in one place. Both prefixes must start and end with `/`.
