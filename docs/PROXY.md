# Proxy engines and transports

Two independent choices decide how a page loads: the **engine** that rewrites it and the **transport** that carries the request. Both can be changed at any time in **Settings > Proxy**; the Browser's address bar also has a one-click engine switcher.

## Engines

| | Scramjet *(default)* | Ultraviolet |
| --- | --- | --- |
| Prefix | `/scram/` | `/service/` |
| Strength | Newest design; the best compatibility with modern, script-heavy sites | Lightweight, long established |
| Maintenance | Actively developed | Its last release was in October 2024 |

In our testing both engines loaded Wikipedia, DuckDuckGo, GitHub, YouTube and Discord. Neither works on every site, so if one misbehaves, **try the other**.

Switching the engine in the Browser re-opens the current page with the new one. Other tabs keep the engine they were opened with until they are reloaded.

## Transports

| | libcurl *(default)* | Epoxy |
| --- | --- | --- |
| Implementation | libcurl compiled to WebAssembly | A Rust TLS client compiled to WebAssembly |
| Compatibility | Broad, including HTTP/2-heavy sites | Good, but see below |

Both talk the [Wisp](https://github.com/MercuryWorkshop/wisp-protocol) protocol over one WebSocket (`/wisp/` on this server).

**Why libcurl is the default:** when we probed real sites, Epoxy failed on `https://www.youtube.com/` with an HTTP/2 `PROTOCOL_ERROR` under *both* engines, while libcurl loaded YouTube and Discord. If you hit a site that fails with an error mentioning `Http2`, `Hyper` or `PROTOCOL_ERROR`, you are on Epoxy; switch to libcurl. Conversely, if libcurl is slow on your network, Epoxy is worth a try.

### Using a different Wisp server

By default the browser connects to `/wisp/` on this site. You can send it elsewhere in two ways:

- **For everyone:** set `WISP_URL=wss://your-wisp.example.com/wisp/` on the server (useful when the host cannot hold WebSockets open).
- **For one person:** Settings > Proxy > **Wisp server**, with a **Test** button that reports whether it is reachable. A value set here wins over `WISP_URL`.

The content filter and private-network guard run on the Wisp server, so an external server must enforce its own.

## Searching

Anything typed into the Browser's address bar, the new-tab page or the taskbar's **Web** box goes through one resolver:

- Text with spaces, bare numbers and plain words are a **search**. `what is 3.14` searches; it is not treated as a website.
- A bare domain (`example.com`), an `http(s)://` address, `localhost`, an IP address, or an internationalised domain is an **address**. Bare domains get `https://`.
- Only `http` and `https` are ever opened. `javascript:`, `data:`, `file:` and `about:` are searched for instead.
- `name@host` is never treated as an address, which defeats the `google.com@evil.example` trick.
- Search text is URL-encoded, so `&`, `#` and `%` in a query are safe.

**Search engines:** Brave Search *(default)*, DuckDuckGo, Google, Bing, Startpage, Ecosia, or a custom address containing `%s` (for example `https://example.org/search?q=%s`).

**Safe search** (on by default) appends the engine's strict-mode parameter where one is documented: Brave, DuckDuckGo, Google and Bing. Startpage, Ecosia and custom addresses are left unchanged.

## Testing and resetting

Settings > Proxy > Troubleshooting:

- **Run test** starts the service worker and connection, loads a real page through the proxy, and reports timings and which engine and transport were used.
- **Reset proxy data** removes the service worker, cached data and Scramjet's database, then reloads. Use it if pages stop loading after changing settings or upgrading.

For failures, see [Troubleshooting](TROUBLESHOOTING.md).
