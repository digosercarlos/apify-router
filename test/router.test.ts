import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { parseKeys } from '../src/config';
import { MemoryStore } from '../src/store';
import { auth, cfg, fakeApify } from './helpers';
import type { FakeAccount } from './helpers';

function setup(accounts: Record<string, FakeAccount>, over = {}) {
  const upstream = fakeApify(accounts);
  const app = createApp({ config: cfg(Object.keys(accounts), over), store: new MemoryStore(), fetchFn: upstream.fn });
  const call = (path: string, init: RequestInit = {}) =>
    app.request(path, { ...init, headers: { ...auth, ...(init.headers as object) } });
  return { app, call, upstream };
}

const START_RUN = '/v2/acts/user~scraper/runs';

describe('parseKeys', () => {
  it('reads a plain list and drops duplicates', () => {
    expect(parseKeys('a, b\nc a').map((k) => k.token)).toEqual(['a', 'b', 'c']);
  });
  it('reads JSON with labels and limits', () => {
    const [k] = parseKeys('[{"token":"x","label":"main","limitUsd":9}]');
    expect(k).toEqual({ id: 'main', token: 'x', limitUsd: 9 });
  });
});

describe('auth', () => {
  it('rejects a call without the router token', async () => {
    const { app } = setup({ a: { used: 0, max: 5 } });
    expect((await app.request(START_RUN, { method: 'POST' })).status).toBe(401);
  });
  it('accepts ?token= and never forwards it', async () => {
    const { app, upstream } = setup({ a: { used: 0, max: 5 } });
    const res = await app.request(`${START_RUN}?token=router-secret&memory=512`, { method: 'POST' });
    expect(res.status).toBe(201);
    const run = upstream.calls.find((c) => c.method === 'POST')!;
    expect(run.path).toBe(`${START_RUN}?memory=512`);
    expect(run.token).toBe('a');
  });
});

describe('choosing a key', () => {
  it('fill: uses the first key while it has headroom', async () => {
    const { call } = setup({ a: { used: 1, max: 5 }, b: { used: 0, max: 5 } });
    expect((await call(START_RUN, { method: 'POST' })).headers.get('x-apify-router-key')).toBe('acct-1');
  });
  it('fill: skips a key below the headroom', async () => {
    const { call } = setup({ a: { used: 4.8, max: 5 }, b: { used: 0, max: 5 } });
    expect((await call(START_RUN, { method: 'POST' })).headers.get('x-apify-router-key')).toBe('acct-2');
  });
  it('balanced: uses the key with the most balance', async () => {
    const { call } = setup({ a: { used: 3, max: 5 }, b: { used: 0, max: 5 } }, { strategy: 'balanced' });
    expect((await call(START_RUN, { method: 'POST' })).headers.get('x-apify-router-key')).toBe('acct-2');
  });
});

describe('running out of credits', () => {
  it('retries on the next key and rests the exhausted one', async () => {
    const { call, upstream } = setup({ a: { used: 0, max: 5, blocked: true }, b: { used: 0, max: 5 } });
    const first = await call(START_RUN, { method: 'POST' });
    expect(first.status).toBe(201);
    expect(first.headers.get('x-apify-router-key')).toBe('acct-2');

    const before = upstream.calls.filter((c) => c.token === 'a' && c.method === 'POST').length;
    await call(START_RUN, { method: 'POST' });
    const after = upstream.calls.filter((c) => c.token === 'a' && c.method === 'POST').length;
    expect(after).toBe(before);
  });
  it('answers 503 router_exhausted when every key is out', async () => {
    const { call } = setup({ a: { used: 0, max: 5, blocked: true }, b: { used: 0, max: 5, blocked: true } });
    const res = await call(START_RUN, { method: 'POST' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { type: string } }).error.type).toBe('router_exhausted');
  });
});

describe('resources stay with the key that created them', () => {
  it('reads the dataset with the key that ran the actor', async () => {
    const { call, upstream } = setup({ a: { used: 0, max: 5, blocked: true }, b: { used: 0, max: 5 } });
    await call(START_RUN, { method: 'POST' });
    const res = await call('/v2/datasets/ds-b/items');
    expect(res.status).toBe(200);
    expect(upstream.calls.at(-1)!.token).toBe('b');
  });
  it('finds the owner by probing when it was forgotten, then remembers it', async () => {
    const { call, upstream } = setup({ a: { used: 0, max: 5 }, b: { used: 0, max: 5 } });
    const res = await call('/v2/datasets/ds-b/items');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-apify-router-key')).toBe('acct-2');
    const probes = upstream.calls.length;
    await call('/v2/datasets/ds-b/items');
    expect(upstream.calls.length).toBe(probes + 1);
  });
  it('refuses to write to a resource with an unknown owner', async () => {
    const { call } = setup({ a: { used: 0, max: 5 } });
    expect((await call('/v2/actor-runs/run-zzz/abort', { method: 'POST' })).status).toBe(404);
  });
});

describe('status', () => {
  it('shows masked tokens and balances', async () => {
    const { call } = setup({ 'apify_api_1234567890abcdef': { used: 1, max: 5 } });
    const body = (await (await call('/_router/status')).json()) as { keys: Array<{ token: string; remainingUsd: number }> };
    expect(body.keys[0].token).toBe('apify_api_…cdef');
    expect(body.keys[0].remainingUsd).toBe(4);
  });
});
