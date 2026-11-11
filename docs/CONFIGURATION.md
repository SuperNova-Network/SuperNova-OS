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
| `DATA_DIR` | `data` | Where the accounts database (`accounts.db`) is kept, including the choices made in Settings > Admin. Put it on persistent storage |
| `ACCOUNTS` | *(empty)* | Optional override: `optional`, `required` or `off`. When set, the choice is fixed and shown locked in [Settings > Admin](#accounts) |
| `ACCOUNTS_SIGNUP` | *(empty)* | Optional override: `invite`, `open` or `closed` |
| `ADMINS` | *(empty)* | Usernames that are always admins, comma separated, besides those made admin in the panel |
| `GIPHY_API_KEY` | *(empty)* | Turns on GIF search in the [chat](#chat). A free key from developers.giphy.com. Without it people can still upload GIFs |
| `INVITE_CODE` | *(empty)* | A fixed invite code accepted besides the ones admins make. With accounts required and no `INVITE_CODE`, `AUTH_PASS` is accepted |
| `TRUST_PROXY` | *(empty)* | Proxies in front of the server to trust for the visitor's address and protocol: a hop count (`1`), `true`, or addresses. Set it behind Fly.io, Render, nginx and the like |

`GET /healthz` returns `ok` without authentication, for platform health checks.

## Authentication

There are two ways to keep the site to the people you choose: one shared password (HTTP Basic auth, below), or [accounts with a sign-in screen](#what-each-choice-does) (Settings > Admin > Accounts > Required), which replaces it while it is on.

Set `AUTH_PASS` to password-protect the whole site. The credentials are checked with a constant-time comparison, and the **Wisp WebSocket upgrade is checked too**; Express middleware never sees WebSocket upgrades, so without this the proxy itself would stay open.

Basic auth sends the password with every request, so only use it over HTTPS (all the platforms in [Deployment](DEPLOYMENT.md) provide it). The original project shipped a hardcoded `admin` / password pair in the source; if you ever used it, change it, because it remains in the git history.

## Accounts

Accounts are managed in **Settings > Admin**, with no restart: whether they are **off** (the default), **optional** (people can sign in from Settings > Account so their desktop apps and names, wallpaper and colours, bookmarks, and proxy, search and cloaking preferences follow them to any browser), or **required** (the whole site is behind a sign-in screen). Browsing history is never sent to the server.

### First run

On a fresh site nobody can open Settings > Admin yet, so the server prints a one-time setup link in its log:

```
Set up this site: create the first admin account at
	http://localhost:3000/setup   with the code   ABCDE-FGHJK
```

Open it, enter the code and choose a username and password: that account is the site's first admin. Only someone who can read the server's log has the code, so a stranger who finds `/setup` can't claim the site. The code changes each time the server starts until an admin exists, and the page disappears once one does. On Fly.io the log is `fly logs`; on Render, the Logs tab. Alternatively, `npm run admin -- make-admin <name>` on the server makes any existing account an admin.

Admins can sign in at `/signin` even while accounts are off, and give others the admin role from the account list (**Make admin**). The last admin can't be removed.

### What each choice does

- **Off.** No accounts: the site works as it always did, open to anyone (or behind `AUTH_PASS`). Other people's sessions pause and resume when accounts come back on; their data stays.
- **Optional.** Settings > Account offers sign-in; the site itself stays open (and behind `AUTH_PASS`, if set).
- **Required.** Instead of the browser's Basic auth prompt, visitors get a Windows 10 style lock screen that opens onto a sign-in screen (sign in, create an account, forgot password), with a short "Welcome" animation, and land on the desktop, or the page they were heading to, once signed in. Pages, APIs and the proxy's WebSocket all need a signed-in session; only the sign-in screen, its static files, `/setup`, `/healthz` and `/api/info` stay open. Switching to required disconnects everyone who isn't signed in at once.

**Who can create an account:** people with an **invite code** (the default; see below), **anyone**, or **nobody** (existing accounts keep working). A fixed code from `INVITE_CODE`, or, with accounts required and no `INVITE_CODE`, the old `AUTH_PASS`, is always accepted too. Wrong codes count towards the sign-up rate limit.

**Environment variables still work** and win over the panel: `ACCOUNTS` and `ACCOUNTS_SIGNUP` fix those choices (the panel shows them locked), and `ADMINS` names accounts that are always admins. Leave them unset to manage everything in the panel.

### How accounts work

- **Storage.** One SQLite file, `DATA_DIR/accounts.db` (the built-in `node:sqlite` of Node.js 22.13+, so no extra dependency), which also holds the choices made in the admin panel. Put `DATA_DIR` on storage that survives restarts and deploys: a Fly.io volume, a Render disk, a Docker volume, or a VPS's own disk. On an ephemeral filesystem every account, and the admin panel's choices, disappear on the next deploy. Back the file up like any database. Without `node:sqlite` the site runs without accounts or an admin panel.
- **No email.** Sign-up shows a one-time recovery code; with it a person can set a new password (and gets a new code). Without it, a forgotten password cannot be recovered.
- **Passwords** are hashed with scrypt. Sessions are random tokens (only their hashes are stored) in an `HttpOnly`, `SameSite=Strict` cookie that lasts 30 days and renews while in use. Changing the password or using the recovery code signs out every other browser.
- **Limits.** Sign-in is limited to 10 tries per username and 20 per address every 10 minutes, sign-up to 5 accounts per address per hour, and an account's settings to 512 KB. Behind a reverse proxy, set `TRUST_PROXY`, or every visitor shares the proxy's address and these limits.
- **Signing out** removes the account's settings from that browser, which matters on shared computers. A factory reset signs out first, so it resets the browser without touching the account.

### Invite codes and bans

Admins also find these in Settings > Admin:

- **Invite codes.** Create a code for one person or a whole class: a label, how many sign-ups it allows (1 to 1000) and when it expires (1, 7 or 30 days, or never). The code is shown once, when created, and stored only as a hash; the list shows its last four characters, how many times it has been used and by whom it was made, and **Revoke** stops it at once. A sign-up that fails (a taken name, say) doesn't use the code up. Each account remembers which code it joined with.
- **Accounts.** Search everyone, see when they joined and were last seen, and **ban** with an optional reason. A ban deletes all of that person's sessions, closes their open proxy connections immediately, and refuses their sign-in with the reason; it is only revealed after a correct password. **Unban** lets them back in. Admins can't be banned (remove their admin role first), and can't ban themselves.

With optional accounts the proxy itself stays open to everyone, so a ban only keeps someone out of their account; require sign-in to keep them off the site.

The same works from the command line, on the server, also while it is running (setting changes reach it within seconds, a ban reaches open connections within 30). It needs no admin account, so it is also how you get the first invite code or recover from a mistake:

```sh
npm run admin -- status
npm run admin -- accounts off|optional|required
npm run admin -- signup invite|open|closed
npm run admin -- make-admin some-name
npm run admin -- remove-admin some-name
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

## Chat

The Chat icon on the taskbar opens one public room for everyone who is signed in, so it needs [accounts](#accounts) to be on (optional or required). It uses the account's name and profile picture, and admins moderate from inside the Chat window (the **Moderation** button, and **Delete** and **Moderate…** beside each message).

- **Live delivery** is a Server-Sent Events stream (`/api/chat/stream`) plus ordinary POSTs, so it needs no extra service or dependency. An open Chat window keeps one connection open, and so does a desktop with Chat notifications turned on (a quiet one that isn't counted as being in the chat), so on a host that stops idle machines (Fly.io's `auto_stop_machines`) the machine can stay running, and keep costing, while anyone has either. Chat notifications are off by default, so only people who turn them on do this when the Chat window is closed.
- **Storage.** Messages (the latest 2000), uploaded GIFs, timeouts, bans, the settings below and a moderation log are in `DATA_DIR/accounts.db` with the accounts, and go when an account is deleted.
- **Spam rules** apply to everyone except admins: 500 characters and 8 lines, no long runs of one character or word, no shouting, no links (unless allowed), a blocked-word list (matches whole words, also when spaced out or disguised, so "class" never trips "ass"; end a word with `*` to catch longer ones, like `fuck*`), slow mode, at most 5 messages in 10 seconds, and no repeating the same message within a minute. Four breaks of these in 5 minutes is an automatic timeout (2 minutes, then 10, then an hour).
- **Admin tools.** Delete a message; time out (5 minutes to 7 days) or ban someone from the chat, with a reason they see and an option to remove their last 10 minutes of messages; lift either; clear the chat; lock it to admins only; turn GIFs or the whole chat off; set slow mode, whether links are allowed, how long a new account must wait before posting, and the blocked words. Every action is in the log. Admins can't be timed out or banned from the chat, nor can you do it to yourself. **Ban from the whole site** is the same account ban as in Settings > Admin. **Admin look** (Moderation > Admin look) sets how every admin's name and tag appear: the tag text (up to 12 characters), style, colour, shield and sparkle, saved with the chat settings and sent to every page.
- **Profile pictures.** Anyone signed in can set one in Settings > Account (it is not changed from inside the Chat). It is saved to the account, so it follows the person to any browser, and the Chat shows a new one at once. Only PNG, JPEG and WebP up to 120 KB and 1024 px are accepted, judged from the file's bytes.
- **GIFs.** Anyone can upload a GIF up to 2 MB (up to 2000 px; the type and size are read from the bytes). With `GIPHY_API_KEY` set the picker also searches GIPHY (rated PG). The server does the searching and relays the pictures, so people's browsers never contact GIPHY, and the picker says "Powered by GIPHY".

### Notifications

The desktop shows small pop-ups in the style of Windows 10's. Each person sets them up in **Settings > Notifications** (saved with their account): the master switch, Do not disturb, a switch for each sender, the theme (dark, light or the desktop's colour scheme), size, which corner they appear in, whether to show banners, pictures, message previews and a sound, and how long they stay (5 seconds to 5 minutes). Notifications pile up from their corner and never reach higher than three quarters of the way up the lower half of the screen (3/8 of the screen's height); the oldest fade away first.

The Chat is the first sender, called "Messaging app". Its notifications are **off until turned on**, either in the Chat's own settings (the Notifications button in its header) or in Settings > Notifications. Each one shows the sender's picture, their name and what they said, and clicking it opens the Chat. They don't show while the Chat window is in front and being looked at, and a person's own messages never notify them. This needs no setting on the server.

## App Store

The **App Store** is a taskbar app, pinned by default after Chat, where people publish apps for each other. It needs accounts and goes through `/api/store`.

- **An app is a web address**, with a name, a description, a category and an optional picture. SuperNova never hosts anyone's page, so an app can't run script on this site; adding one puts it on your desktop like a site you add yourself, and it opens through the proxy. Addresses must be public: no IP addresses, `localhost`, or sign-in details in the address. Each address can be in the store once.
- **Approval** is the admin's choice (Admin Panel > App Store): every new app waits for an admin, or new apps go live at once. Admins can always take an app down or delete it. With approval on, changing a live app sends it back to the queue. A rejected app shows its reason to the maker, who can fix and send it again.
- **Rules.** The content filter's blocked sites and search words apply to what people publish. Limits: 5 apps in the store per person (changeable), 12 publish or edit requests an hour, pictures are PNG, JPEG or WebP up to 120 KB (the app shrinks them to 256 px).
- **Installs** are counted once per person and shown on each app. They are kept in the same `accounts.db` (tables `store_apps`, `store_icons`, `store_installs`).

## Admin Panel

Admins open the **Admin Panel** from the start menu (Admin) or Settings > Admin. Everything in it goes through `/api/admin`, which refuses anyone who isn't an admin, and every change is written to the audit log.

- **Dashboard.** Accounts, new and active people, who is in the chat, open proxy connections, signed-in browsers, usable invite codes, chat activity, and 14-day charts of new accounts and chat messages.
- **Accounts.** Search, filter (admins, banned, new, active, inactive), sort and page through everyone. Each account shows its browsers (the address and browser each session started from, kept so you can spot abuse and end a session), recent chat messages, chat timeouts and bans, and what admins did to it. You can make or remove admin, ban or unban, sign out everywhere, set a new password (they are signed out and should change it), time out or ban from the chat, or delete the account (you type its name to confirm; admins and yourself are protected). Bulk actions ban, unban or sign out many at once and report each account separately.
- **Sessions.** Every browser that is signed in, each of which can be ended.
- **Invites.** Make up to 50 codes at once (they are shown only once), list them, revoke them.
- **Chat.** Search all messages, also deleted ones, and delete from there; change the chat's rules and blocked words; lift timeouts and bans.
- **App Store.** The approval queue (waiting, in the store, not approved) with approve, reject (with a reason the maker sees), take down and delete, and the settings: **approve each app** or **approve automatically**, whether people can publish at all, and how many apps each person can have in the store. Admins' own apps always go live at once. The queue count shows on the nav item and the dashboard.
- **Content filter.** Add blocked sites (with all their subdomains), hostname keywords and search words on top of the server's built-in list. They apply at once, with no restart, and the page can check whether something would be blocked. Remove an entry to unblock it; the built-in list (and `BLOCKED_HOSTS`) is never touched.
- **Site.** The accounts mode and who can sign up (locked when `ACCOUNTS` or `ACCOUNTS_SIGNUP` is set on the server), **maintenance mode** and the **announcement**. In maintenance mode everyone but admins gets a "we'll be right back" page with your message and the proxy closes to them, while sign-in and `/healthz` stay open so admins can get in and hosts can still check the app. An announcement is shown once to everyone signed in, as a notification on their desktop (if their notification settings allow it), and again whenever you change it.
- **Audit log.** What admins did on the site and the chat's moderation actions, newest first, searchable and filterable. The latest 5000 site entries are kept.
- **System.** Uptime, memory, load, connections, the database's size and row counts (and the Fly.io app, region and machine when on Fly), a **tidy up** (ends expired sessions, drops chat messages deleted more than a week ago, shrinks the file) and a **backup download**. A backup is a copy of the whole database, including password hashes: keep it safe. To restore one, stop the server and put it back as `accounts.db` in `DATA_DIR`.
- **Exports.** Accounts, the audit log and recent chat messages as CSV, with anything a spreadsheet could run as a formula made harmless.

The panel needs no setting on the server. It is stored in the same `accounts.db` as the accounts.
