# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem. Use GitHub's private advisory form (Security > Report a vulnerability) on this repository, or contact the maintainers on Discord ([dsc.gg/supernovaproxy](https://dsc.gg/supernovaproxy)) and ask for a private channel. Include steps to reproduce and the version shown in Settings > System > About.

## What the project defends against

- **Server-side request forgery.** The Wisp server refuses streams to loopback, private, link-local and reserved addresses, so the proxy cannot be used to reach the server's own network or a cloud metadata endpoint (`169.254.169.254`). This is covered by tests.
- **Unauthenticated access** (optional). With `AUTH_PASS` set, the pages, the APIs *and* the WebSocket upgrade require credentials, checked in constant time. With accounts required (Settings > Admin) they require a signed-in account session instead, and creating an account requires an invite code. Covered by tests.
- **Claiming a fresh site.** The first admin is created at `/setup` with a one-time code that only appears in the server's log; the page closes once an admin exists.
- **Secrets in the repository.** Earlier versions shipped a hardcoded Basic-auth password in `app.js`. It is gone, but it remains in git history: **change it if you ever used it.**
- **Injection through settings.** App names, wallpaper addresses, custom tab icons and panic destinations are validated or escaped (only `http(s)` addresses; no `javascript:` or `data:`).
- **The proxy's own scripts being served as HTML.** Subresource requests under a proxy prefix get a real 404.
- **Unwanted members** (with accounts required). Sign-up needs an invite code; admins' codes are limited in uses and time, stored only as hashes, and revocable. A ban ends every session of the account and closes its open proxy connections.
- **Account attacks. Passwords are hashed with scrypt; session tokens are stored only as hashes; the session cookie is `HttpOnly` and `SameSite=Strict`; account requests must be JSON and same-origin; sign-in, sign-up and recovery are rate limited; a wrong username and a wrong password get the same answer in the same time. Covered by tests.

## What it does not defend against

- **Proxied sites share the desktop's origin.** This is how service-worker proxies work. Engines virtualise storage and `location` per site, but a malicious *proxied* page is not isolated the way a separate origin would be. Do not log in to anything you would not trust a page on the same site with.
- **A proxied page using the visitor's account.** Because proxied pages share the origin, a page that escaped its engine's rewriting could call `/api/account` with the visitor's session. It cannot read the session cookie (`HttpOnly`) and cannot change the password or delete the account without the password, but it could read or change the visitor's synced *settings*. That is why accounts hold settings only, and why browsing history is never synced.
- **Abuse of your IP address.** People browse *from your server*. Sites see its address, and abuse (scraping, spam, worse) is attributed to it. Expect to be blocklisted by some services, and consider rate limiting, a password, or running it only for people you know.
- **The content filter is a layer, not a guarantee.** It is hostname-based; see [Configuration](docs/CONFIGURATION.md#content-filter).
- **Cloaking hides nothing from the network** or from software on the device; see [Cloaking](docs/CLOAKING.md#what-cloaking-does-not-do).

## Running a public instance

1. Serve it over HTTPS only.
2. Set `AUTH_PASS`, or require accounts (Settings > Admin) with invite codes, or accept that anyone can use your server as a proxy.
3. Finish setup (the link in the server's log) before sharing the address.
4. Keep dependencies current (`npm outdated`, `npm audit`): the proxy engines are third-party code that handles untrusted pages.
5. Do not run it on a machine that has access to private networks you care about, even though the proxy refuses to connect to them.
6. Understand your hosting provider's terms: many forbid open proxies.
7. With accounts on, keep `DATA_DIR` on persistent storage, back up `accounts.db`, and set `TRUST_PROXY` behind a reverse proxy so rate limits see real addresses.
