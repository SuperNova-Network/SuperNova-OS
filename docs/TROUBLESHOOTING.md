# Troubleshooting

Start with **Settings > Proxy > Troubleshooting > Run test**. It loads a real page through the proxy and tells you what worked or failed.

## Nothing loads, or "The proxy could not start"

- **Is the address `https://` (or `localhost`)?** Service workers do not run on plain `http://` for a real domain. See [Deployment](DEPLOYMENT.md).
- **Private or incognito window, or blocked site data.** Some browsers disable service workers there. Use a normal window and allow site data for the site.
- **Reset it.** Settings > Proxy > **Reset proxy data** removes the service worker and cached data, then reloads. This fixes most problems after an upgrade.
- **Is the Wisp server reachable?** Settings > Proxy > Wisp server > **Test**. If you run behind a reverse proxy, it must pass WebSocket upgrades (see the nginx example in Deployment).

## One site fails, others work

| What you see | Try |
| --- | --- |
| "Uh oh!" / "Error processing your request" | The other **engine** (Settings > Proxy > Engine) |
| An error mentioning `Http2`, `Hyper` or `PROTOCOL_ERROR` | Switch the **connection** to libcurl (that is Epoxy failing) |
| "You've been blocked by network security" (Reddit, others) | The site is rejecting your server's IP address. Hosting providers' addresses are often blocked; nothing in the proxy can change that |
| A CAPTCHA that never completes | Datacenter IPs are often challenged repeatedly. A different host or an external Wisp server on a residential connection can help |
| "That site is blocked by the content filter" | The [content filter](CONFIGURATION.md#content-filter) is on. An administrator can allow it by editing `config.js` |
| A video or game is choppy | The proxy adds latency to every request. Pick the region closest to you when deploying |

## The first load used to fail and the second worked

That was a bug in earlier versions and is fixed (see [Architecture](ARCHITECTURE.md#the-first-visit-and-why-it-used-to-return-404)). If you still see it, run **Reset proxy data** once, because a service worker from an old version may be cached.

## Cloaking

- **"The browser blocked the new tab".** Allow pop-ups for the site. Cloaked tabs must be opened by a click.
- **The panic key does nothing in a game.** The bundled games on `picturelements.github.io` are cross-origin, so the desktop cannot see key presses inside them. Click outside the game, or use the panic key from another window.
- **The panic key does nothing at all.** It must include Ctrl, Alt or Cmd. Re-record it in Settings > Cloaking.
- **The title or icon reverted.** Another tab changed the setting, or "No disguise" is selected. The disguise is reapplied on every load.

## Deploying

- **`npm install` prints warnings about install scripts.** Expected: nothing in this project needs them.
- **Fly.io / Render machine takes a few seconds on the first request.** The machine was asleep.
- **It works locally but not on the host.** Check that the host supports WebSockets and HTTPS, and that `PORT` is set by the platform.

Still stuck? Open an issue with the output of **Run test** and your browser, or ask on Discord: [dsc.gg/supernovaproxy](https://dsc.gg/supernovaproxy).
