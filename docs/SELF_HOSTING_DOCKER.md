# Self-hosting with Docker

## Compose

```bash
git clone https://github.com/digosercarlos/apify-router.git
cd apify-router
cp .env.example .env
```

Edit `.env` and fill the two required values:

```
APIFY_KEYS=apify_api_xxx,apify_api_yyy,apify_api_zzz
ROUTER_TOKEN=<output of: openssl rand -hex 32>
```

Start it:

```bash
docker compose up -d
curl http://localhost:8787/health
```

Logs and updates:

```bash
docker compose logs -f
git pull && docker compose up -d --build
```

## Plain docker

```bash
docker build -t apify-router .
docker run -d --name apify-router --restart unless-stopped --env-file .env -p 8787:8787 apify-router
```

## Putting it on the internet

The router is plain HTTP. Put it behind a reverse proxy with TLS (Caddy, Traefik, nginx) or a tunnel such as Cloudflare Tunnel or Tailscale before exposing it. Anyone with `ROUTER_TOKEN` can spend your Apify credits, so treat it like a password.

## State

The container keeps its memory in the process. After a restart it forgets which key owns which run and finds out again by trying each key on the next read. Balances come from Apify, so nothing important is lost.
