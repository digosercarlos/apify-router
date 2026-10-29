import { createApp } from './app';
import { loadConfig } from './config';
import { KVStore, MemoryStore } from './store';
import type { KVLike } from './store';

// Used when no KV namespace is bound. Per isolate, so it forgets often; routing still works
// because balances come from Apify and unknown owners are found by probing.
const fallback = new MemoryStore();

export default {
  fetch(request: Request, env: Record<string, unknown>): Promise<Response> | Response {
    const config = loadConfig(env);
    const kv = env.KV as KVLike | undefined;
    return createApp({ config, store: kv ? new KVStore(kv) : fallback }).fetch(request);
  },
};
