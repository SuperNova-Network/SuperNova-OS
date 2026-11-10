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
| `ACCOUNTS` | *(empty)* | `1` turns on optional [accounts](#accounts); `required` makes the whole site need one, with a sign-in screen instead of the Basic auth prompt. Needs Node.js 22.13+ and a persistent `DATA_DIR` |
| `ADMINS` | *(empty)* | Usernames, comma separated, that get Settings > Admin: [invite codes and bans](#invite-codes-and-bans) |
| `ACCOUNTS_SIGNUP` | see below | Who can create an account: `invite` (needs an invite code), `open` (anyone) or `0` (nobody). Default `invite` with `ACCOUNTS=required` or an `INVITE_CODE`, otherwise `open` |
| `INVITE_CODE` | *(empty)* | A fixed invite code accepted besides the ones admins make. With `ACCOUNTS=required` and no `INVITE_CODE`, `AUTH_PASS` is accepted |
| `DATA_DIR` | `data` | Where the accounts database (`accounts.db`) is kept |
| `TRUST_PROXY` | *(empty)* | Proxies in front of the server to trust for the visitor's address and protocol: a hop count (`1`), `true`, or addresses. Set it behind Fly.io, Render, nginx and the like |

`GET /healthz` returns `ok` without authentication, for platform health checks.

## Authentication

There are two ways to keep the site to the people you choose: one shared password (HTTP Basic auth, below), or [accounts with a sign-in screen](#signing-in-to-the-whole-site) (`ACCOUNTS=required`), which replaces it.

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

### Signing in to the whole site

`ACCOUNTS=required` puts the whole site behind an account. Instead of the browser's Basic auth prompt, visitors get a sign-in screen (sign in, create an account, forgot password) and land on the desktop, or the page they were heading to, once signed in. Pages, APIs and the proxy's WebSocket all need a signed-in session; only the sign-in screen, its static files, `/healthz` and `/api/info` stay open. Signing out returns to the sign-in screen.

Creating an account needs an invite code (see below). The fixed code `INVITE_CODE`, or if that is empty the existing `AUTH_PASS`, is always accepted, so a site that used a shared password switches over by setting `ACCOUNTS=required` and nothing else: share the old password, and everyone picks their own login. Wrong codes count towards the sign-up rate limit. `ACCOUNTS_SIGNUP=open` lets anyone sign up (the server warns about it), and `ACCOUNTS_SIGNUP=0` closes sign-up entirely.

### Invite codes and bans

List admins by username in `ADMINS` (for example `ADMINS=ms-rivera,it-dept`). They get an **Admin** page in Settings:

- **Invite codes.** Create a code for one person or a whole class: a label, how many sign-ups it allows (1 to 1000) and when it expires (1, 7 or 30 days, or never). The code is shown once, when created, and stored only as a hash; the list shows its last four characters, how many times it has been used and by whom it was made, and **Revoke** stops it at once. A sign-up that fails (a taken name, say) doesn't use the code up. Each account remembers which code it joined with.
- **Accounts.** Search everyone, see when they joined and were last seen, and **ban** with an optional reason. A ban deletes all of that person's sessions, closes their open proxy connections immediately, and refuses their sign-in with the reason; it is only revealed after a correct password. **Unban** lets them back in. Admins can't be banned (remove them from `ADMINS` first), and can't ban themselves.

With `ACCOUNTS=1` (optional accounts) the proxy itself stays open to everyone, so a ban only keeps someone out of their account; use `ACCOUNTS=required` to keep them off the site.

The same works from the command line, on the server, also while it is running (a ban there reaches open connections within 30 seconds). It needs no admin account, so it is also how you get the first invite code or recover from a mistake:

```sh
npm run admin -- invite --uses 30 --days 7 --label "Period 3"
npm run admin -- invites
npm run admin -- revoke 4
npm run admin -- users [search]
npm run admin -- ban some-name Sharing the link
npm run admin -- unban some-name
```

On Fly.io, run it on the machine: `fly ssh console -C "npm run admin -- invite"`.

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
