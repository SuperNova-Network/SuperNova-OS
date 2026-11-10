# Deployment

SuperNova OS is one Node.js process (`node app.js`). Two requirements decide where it can run:

1. **WebSockets.** All proxied traffic travels over one WebSocket (`/wisp/`). Hosts that run your code as short-lived serverless functions (**Vercel, Netlify Functions, Cloudflare Pages Functions**) cannot hold it open and cannot host the server. You can still serve the site from such a host if the browsers are pointed at an external Wisp server (`WISP_URL`).
2. **HTTPS.** Service workers, which the proxy is built on, only run on `https://` addresses (and `localhost`). Over plain `http://` on a real domain the proxy will not start. Every platform below provides HTTPS.

Always give the process a `PORT` (most platforms do this for you) and consider setting `AUTH_PASS`; see [Configuration](CONFIGURATION.md).

## Docker

The included [`Dockerfile`](../Dockerfile) installs production dependencies only, runs as the unprivileged `node` user, and has a health check on `/healthz`.

```sh
docker build -t supernova-os .
docker run -d --name supernova -p 3000:3000 -e AUTH_PASS=change-me supernova-os
```

With [accounts](CONFIGURATION.md#accounts), keep the database in a volume:

```sh
docker run -d --name supernova -p 3000:3000 -e ACCOUNTS=1 -v supernova-data:/app/data supernova-os
```

## Fly.io

[`fly.toml`](../fly.toml) is included (app name `supernova-os`, region `iad`, health check on `/healthz`). Change `app` to a name you own, then:

```sh
fly launch --copy-config --no-deploy
fly secrets set AUTH_PASS=change-me      # optional
fly deploy
```

With `auto_stop_machines` the machine sleeps when idle and wakes on the next request, which adds a few seconds to the first load.

For [accounts](CONFIGURATION.md#accounts), create a volume and uncomment the `[mounts]` section in `fly.toml`:

```sh
fly volumes create supernova_data --size 1
fly secrets set ACCOUNTS=1
fly deploy
```

## Render

[`render.yaml`](../render.yaml) is a blueprint: create a **Blueprint** from the repository in the dashboard. It builds the `Dockerfile` and uses `/healthz` for health checks. Add `AUTH_PASS` under Environment if you want a password. Render's free plan spins down when idle.

[Accounts](CONFIGURATION.md#accounts) need a persistent disk, which Render's free plan does not have: on a paid plan, add a disk mounted at `/app/data` and set `ACCOUNTS=1`.

## Heroku, Railway and similar

Anything that runs `npm start` and supports WebSockets works. [`app.json`](../app.json) describes the Heroku app and its optional variables. Set `NODE_ENV=production` if the platform does not.

## A VPS with HTTPS

Run the server under a process manager and put a reverse proxy in front for HTTPS. The proxy **must pass WebSocket upgrades through**.

`/etc/systemd/system/supernova.service`:

```ini
[Unit]
Description=SuperNova OS
After=network.target

[Service]
WorkingDirectory=/opt/SuperNova-OS
Environment=PORT=3000 NODE_ENV=production
EnvironmentFile=-/opt/SuperNova-OS/.env
ExecStart=/usr/bin/node app.js
Restart=on-failure
User=supernova

[Install]
WantedBy=multi-user.target
```

nginx (HTTPS certificates with `certbot --nginx`):

```nginx
server {
    server_name example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;   # keep long-lived proxy WebSockets open
    }
}
```

Caddy needs only `reverse_proxy 127.0.0.1:3000`, as it handles upgrades and HTTPS itself.

## Static host + external Wisp server

If your site must live on a host without WebSockets, run the server somewhere that has them and set `WISP_URL=wss://that-server.example.com/wisp/` on the instance that serves the pages. The Wisp server is where the content filter and private-network guard run, so the external one needs its own.

## After deploying

1. Open the site, then **Settings > Proxy > Troubleshooting > Run test**. It should report "Working".
2. Visit `/healthz`; it should print `ok`.
3. If you set `AUTH_PASS`, confirm that a private window is asked for a login (or, with `ACCOUNTS=required`, sent to the sign-in screen).

Running a proxy publicly has consequences for your IP address's reputation and for abuse; please read [SECURITY.md](../SECURITY.md).
