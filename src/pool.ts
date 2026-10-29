import type { KeyConfig, RouterConfig } from './config';
import type { Store } from './store';

const USAGE_TTL_SEC = 60;
const OWNER_TTL_SEC = 30 * 24 * 3600;

export interface KeyStatus {
  id: string;
  remainingUsd: number | null;
  cooling: boolean;
}

export class KeyPool {
  constructor(
    private cfg: RouterConfig,
    private store: Store,
    private fetchFn: typeof fetch,
  ) {}

  /** Remaining monthly USD for a key, cached for a minute. null = unknown. */
  async remaining(k: KeyConfig): Promise<number | null> {
    const cacheKey = `usage:${k.id}`;
    const cached = await this.store.get(cacheKey);
    if (cached !== null) return (JSON.parse(cached) as { remaining: number | null }).remaining;

    let remaining: number | null = null;
    try {
      const res = await this.fetchFn(`${this.cfg.apifyBase}/v2/users/me/limits`, {
        headers: { authorization: `Bearer ${k.token}` },
      });
      if (res.ok) {
        const j = (await res.json()) as {
          data?: { current?: { monthlyUsageUsd?: number }; limits?: { maxMonthlyUsageUsd?: number } };
        };
        const used = j.data?.current?.monthlyUsageUsd;
        const apifyMax = j.data?.limits?.maxMonthlyUsageUsd;
        const max = typeof apifyMax === 'number' && apifyMax > 0 ? apifyMax : k.limitUsd;
        if (typeof used === 'number') remaining = max - used;
      }
    } catch {
      // Unknown balance: the key stays eligible but ranks last.
    }
    await this.store.put(cacheKey, JSON.stringify({ remaining }), USAGE_TTL_SEC);
    return remaining;
  }

  async isCooling(id: string): Promise<boolean> {
    return (await this.store.get(`cool:${id}`)) !== null;
  }

  async markCooling(id: string, sec: number): Promise<void> {
    await this.store.put(`cool:${id}`, '1', sec);
    await this.store.delete(`usage:${id}`);
  }

  async invalidate(id: string): Promise<void> {
    await this.store.delete(`usage:${id}`);
  }

  async statuses(): Promise<KeyStatus[]> {
    return Promise.all(
      this.cfg.keys.map(async (k) => ({
        id: k.id,
        remainingUsd: await this.remaining(k),
        cooling: await this.isCooling(k.id),
      })),
    );
  }

  /** Keys that can take a new run, best first. */
  async ranked(): Promise<KeyConfig[]> {
    const rows = await Promise.all(
      this.cfg.keys.map(async (k) => ({
        k,
        cooling: await this.isCooling(k.id),
        rem: await this.remaining(k),
      })),
    );
    const live = rows.filter((r) => !r.cooling && (r.rem === null || r.rem >= this.cfg.headroomUsd));
    if (this.cfg.strategy === 'balanced') {
      live.sort((a, b) => (b.rem ?? -Infinity) - (a.rem ?? -Infinity));
    }
    return live.map((r) => r.k);
  }

  /** For requests that are not tied to a run: any key that is not resting. */
  async firstLive(): Promise<KeyConfig> {
    for (const k of this.cfg.keys) if (!(await this.isCooling(k.id))) return k;
    return this.cfg.keys[0];
  }

  async setOwner(resourceIds: string[], keyId: string): Promise<void> {
    await Promise.all(resourceIds.map((id) => this.store.put(`own:${id}`, keyId, OWNER_TTL_SEC)));
  }

  async getOwner(resourceId: string): Promise<KeyConfig | undefined> {
    const id = await this.store.get(`own:${resourceId}`);
    return id ? this.cfg.keys.find((k) => k.id === id) : undefined;
  }
}
