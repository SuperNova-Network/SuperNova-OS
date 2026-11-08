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

`GET /healthz` returns `ok` without authentication, for platform health checks.

## Authentication

Set `AUTH_PASS` to password-protect the whole site. The credentials are checked with a constant-time comparison, and the **Wisp WebSocket upgrade is checked too**; Express middleware never sees WebSocket upgrades, so without this the proxy itself would stay open.

Basic auth sends the password with every request, so only use it over HTTPS (all the platforms in [Deployment](DEPLOYMENT.md) provide it). The original project shipped a hardcoded `admin` / password pair in the source; if you ever used it, change it, because it remains in the git history.

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
