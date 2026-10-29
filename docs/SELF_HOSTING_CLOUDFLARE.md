# Self-hosting on Cloudflare Workers

The free plan is enough. You end up with a URL like `https://apify-router.<you>.workers.dev`.

## 1. Install and log in

```bash
git clone https://github.com/digosercarlos/apify-router.git
cd apify-router
npm install
npx wrangler login
```

## 2. Create the storage (optional, recommended)

The router uses one KV namespace to remember which key owns which run.

```bash
npx wrangler kv namespace create KV
```

Copy the id it prints, then uncomment the block in `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "<the id you just got>"
```

Skip this step and the router keeps that memory in the Worker instance. It still routes correctly, it just has to look for the owner more often.

## 3. Add your secrets

```bash
npx wrangler secret put APIFY_KEYS
```

Paste your Apify tokens on a single line, separated by commas: `apify_api_aaa,apify_api_bbb,apify_api_ccc`. A JSON array also works, for example `[{"token":"apify_api_...","label":"main"}]`.

```bash
npx wrangler secret put ROUTER_TOKEN
```

Paste any long random string. `openssl rand -hex 32` makes a good one. Clients send it instead of an Apify token.

## 4. Deploy

```bash
npx wrangler deploy
```

Check it:

```bash
curl https://apify-router.<you>.workers.dev/health
curl -H "Authorization: Bearer $ROUTER_TOKEN" https://apify-router.<you>.workers.dev/_router/status
```

## Optional settings

Set `STRATEGY`, `MIN_HEADROOM_USD` and `COOLDOWN_SEC` under `[vars]` in `wrangler.toml` or as secrets. See the table in the README.

## Adding or rotating keys later

Run `npx wrangler secret put APIFY_KEYS` again with the full list. No redeploy is needed.
