import type { RouterConfig } from '../src/config';

export interface FakeAccount {
  used: number;
  max: number;
  /** Apify refuses new runs with 402. */
  blocked?: boolean;
}

export function fakeApify(accounts: Record<string, FakeAccount>) {
  const calls: Array<{ method: string; path: string; token: string }> = [];

  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
    const method = init?.method ?? 'GET';
    calls.push({ method, path: url.pathname + url.search, token });
    const acc = accounts[token];
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    if (!acc) return json({ error: { type: 'user-or-token-not-found' } }, 401);
    if (url.pathname === '/v2/users/me/limits') {
      return json({ data: { current: { monthlyUsageUsd: acc.used }, limits: { maxMonthlyUsageUsd: acc.max } } });
    }
    if (method === 'POST' && /\/runs$/.test(url.pathname)) {
      if (acc.blocked) return json({ error: { type: 'not-enough-usage-to-run-paid-actor', message: 'out of credits' } }, 402);
      return json(
        { data: { id: `run-${token}`, defaultDatasetId: `ds-${token}`, defaultKeyValueStoreId: `kv-${token}` } },
        201,
      );
    }
    const owned = /^\/v2\/(datasets|key-value-stores|actor-runs)\/(?:ds|kv|run)-([^/]+)/.exec(url.pathname);
    if (owned) return owned[2] === token ? json({ data: { ok: true } }) : json({ error: { type: 'record-not-found' } }, 404);
    return json({ data: { echo: url.pathname } });
  }) as typeof fetch;

  return { fn, calls };
}

export function cfg(tokens: string[], over: Partial<RouterConfig> = {}): RouterConfig {
  return {
    keys: tokens.map((t, i) => ({ id: `acct-${i + 1}`, token: t, limitUsd: 5 })),
    routerToken: 'router-secret',
    strategy: 'fill',
    headroomUsd: 0.5,
    apifyBase: 'https://api.apify.test',
    cooldownSec: 3600,
    ...over,
  };
}

export const auth = { authorization: 'Bearer router-secret' };
