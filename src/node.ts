import { serve } from '@hono/node-server';
import { createApp } from './app';
import { loadConfig } from './config';
import { MemoryStore } from './store';

const config = loadConfig(process.env);
const port = Number(process.env.PORT ?? 8787);

serve({ fetch: createApp({ config, store: new MemoryStore() }).fetch, port }, () => {
  console.log(`apify-router listening on :${port} with ${config.keys.length} key(s), strategy=${config.strategy}`);
});
