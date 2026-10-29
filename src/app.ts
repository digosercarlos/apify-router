import { Hono } from 'hono';
import type { Context } from 'hono';
import type { KeyConfig, RouterConfig } from './config';
import { KeyPool } from './pool';
import type { Store } from './store';

// POST that starts a run: the router chooses which key pays for it.
const START = /^\/v2\/(acts|actor-tasks)\/[^/]+\/(runs|run-sync|run-sync-get-dataset-items)\/?$/;
// Anything addressed by id belongs to the account that created it.
const OWNED = /^\/v2\/(actor-runs|datasets|key-value-stores|request-queues|logs)\/([^/]+)/;
const EXHAUSTED_HINT = /usage|limit|credit|payment|insufficient|not-enough/i;
const DROP_REQ = new Set(['host', 'authorization', 'content-length', 'connection', 'accept-encoding']);
const DROP_RES = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

export interface AppDeps {
  config: RouterConfig;
  store: Store;
  fetchFn?: typeof fetch;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const mask = (t: string) => (t.length > 16 ? `${t.slice(0, 10)}…${t.slice(-4)}` : `…${t.slice(-4)}`);

export function createApp({ config, store, fetchFn = fetch }: AppDeps) {
  const pool = new KeyPool(config, store, fetchFn);
  const app = new Hono();

  const jsonError = (c: Context, status: 401 | 404 | 503, type: string, message: string, extra: object = {}) =>
    c.json({ error: { type, message, ...extra } }, status);

  app.get('/health', (c) => c.json({ ok: true }));

  app.use('*', async (c, next) => {
    const bearer = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
    const supplied = bearer || new URL(c.req.url).searchParams.get('token') || '';
    if (!safeEqual(supplied, config.routerToken)) {
      return jsonError(c, 401, 'unauthorized', 'Missing or wrong router token');
    }
    await next();
  });

  app.get('/_router/status', async (c) => {
    const rows = await pool.statuses();
    return c.json({
      strategy: config.strategy,
      headroomUsd: config.headroomUsd,
      keys: config.keys.map((k) => ({
        id: k.id,
        token: mask(k.token),
        ...rows.find((r) => r.id === k.id),
      })),
    });
  });

  app.all('/v2/*', async (c) => {
    const url = new URL(c.req.url);
    const path = url.pathname;
    const method = c.req.method;
    const body = method === 'GET' || method === 'HEAD' ? undefined : await c.req.arrayBuffer();

    const params = new URLSearchParams(url.search);
    params.delete('token');
    const qs = params.toString();
    const target = `${config.apifyBase}${path}${qs ? `?${qs}` : ''}`;

    const send = (k: KeyConfig) => {
      const headers = new Headers();
      c.req.raw.headers.forEach((v, name) => {
        if (!DROP_REQ.has(name.toLowerCase())) headers.set(name, v);
      });
      headers.set('authorization', `Bearer ${k.token}`);
      return fetchFn(target, { method, headers, body });
    };

    const pass = (res: Response, k: KeyConfig) => {
      const headers = new Headers();
      res.headers.forEach((v, name) => {
        if (!DROP_RES.has(name.toLowerCase())) headers.set(name, v);
      });
      headers.set('x-apify-router-key', k.id);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    };

    // 1) Starting a run: rotate until a key accepts it.
    if (method === 'POST' && START.test(path)) {
      const candidates = await pool.ranked();
      const tried: string[] = [];
      for (const k of candidates) {
        tried.push(k.id);
        const res = await send(k);
        const rest = await restSeconds(res, config.cooldownSec);
        if (rest) {
          await pool.markCooling(k.id, rest);
          continue;
        }
        if (res.ok && /\/runs\/?$/.test(path)) await recordOwnership(res, k, pool);
        await pool.invalidate(k.id);
        return pass(res, k);
      }
      return jsonError(c, 503, 'router_exhausted', 'No Apify key has credits left right now', { tried });
    }

    // 2) Something created earlier: it must go to the key that created it.
    const owned = OWNED.exec(path);
    if (owned) {
      const id = owned[2];
      const owner = await pool.getOwner(id);
      if (owner) return pass(await send(owner), owner);

      // Owner forgotten (restart, expired): reads can probe, writes cannot.
      if (method !== 'GET' && method !== 'HEAD') {
        return jsonError(c, 404, 'unknown_owner', `Router does not know which key owns ${id}`);
      }
      let last: { res: Response; k: KeyConfig } | undefined;
      for (const k of config.keys) {
        const res = await send(k);
        if (![401, 403, 404].includes(res.status)) {
          await pool.setOwner([id], k.id);
          return pass(res, k);
        }
        last = { res, k };
      }
      return last ? pass(last.res, last.k) : jsonError(c, 404, 'not-found', 'No key can see this resource');
    }

    // 3) Everything else (store search, account-level calls): any live key.
    const k = await pool.firstLive();
    return pass(await send(k), k);
  });

  app.all('*', (c) => jsonError(c, 404, 'not-found', 'Only /v2/* is proxied'));
  return app;
}

/** Seconds this key should rest if Apify says it is out of credits, else 0. */
async function restSeconds(res: Response, cooldownSec: number): Promise<number> {
  if (res.status === 402) return cooldownSec;
  if (res.status === 429) return 60;
  if (res.status === 403) {
    const text = await res.clone().text();
    if (EXHAUSTED_HINT.test(text)) return cooldownSec;
  }
  return 0;
}

async function recordOwnership(res: Response, k: KeyConfig, pool: KeyPool): Promise<void> {
  try {
    const j = (await res.clone().json()) as { data?: Record<string, unknown> };
    const d = j.data ?? {};
    const ids = [d.id, d.defaultDatasetId, d.defaultKeyValueStoreId, d.defaultRequestQueueId].filter(
      (v): v is string => typeof v === 'string',
    );
    await pool.setOwner(ids, k.id);
  } catch {
    // Body was not JSON: nothing to record, probing will cover reads.
  }
}
