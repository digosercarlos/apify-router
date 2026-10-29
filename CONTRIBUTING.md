# Contributing

Clear issues are the best contribution. Say what you ran, what you expected and what happened.

## Setup

```bash
git clone https://github.com/digosercarlos/apify-router.git
cd apify-router
npm install
npm test
npm run typecheck
```

Tests use a fake Apify, so they need no tokens and cost nothing. Please keep it that way: no real tokens, account names or client data in tests, fixtures or docs.

## Where things live

| Path | What |
|---|---|
| `src/app.ts` | The proxy: auth, choosing a key, retry, ownership |
| `src/pool.ts` | Balances, resting keys, who owns which resource |
| `src/store.ts` | Memory and Cloudflare KV storage |
| `src/config.ts` | Reading `APIFY_KEYS` and settings |
| `scripts/install-rules.mjs` | Writes the rule block into agent files |
| `test/` | Tests and the fake Apify |

## Ideas that would help

- Retry on 401 when a key is revoked.
- Per-actor cost estimates instead of a flat margin.
- An MCP endpoint, so MCP clients can use the router.
- Other storage backends (Redis, Upstash).

Open an issue before starting on a big one.
