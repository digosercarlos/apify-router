export interface Store {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSec?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryStore implements Store {
  private m = new Map<string, { v: string; exp: number | null }>();
  constructor(private now: () => number = Date.now) {}

  async get(key: string) {
    const e = this.m.get(key);
    if (!e) return null;
    if (e.exp !== null && e.exp <= this.now()) {
      this.m.delete(key);
      return null;
    }
    return e.v;
  }

  async put(key: string, value: string, ttlSec?: number) {
    this.m.set(key, { v: value, exp: ttlSec ? this.now() + ttlSec * 1000 : null });
  }

  async delete(key: string) {
    this.m.delete(key);
  }
}

/** Minimal shape of a Cloudflare KV namespace, so we do not depend on its types. */
export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export class KVStore implements Store {
  constructor(private kv: KVLike) {}

  get(key: string) {
    return this.kv.get(key);
  }

  // KV rejects TTLs under 60 seconds.
  put(key: string, value: string, ttlSec?: number) {
    return this.kv.put(key, value, ttlSec ? { expirationTtl: Math.max(60, ttlSec) } : undefined);
  }

  delete(key: string) {
    return this.kv.delete(key);
  }
}
