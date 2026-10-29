export type Strategy = 'fill' | 'balanced';

export interface KeyConfig {
  id: string;
  token: string;
  /** Fallback monthly limit when Apify does not report one. */
  limitUsd: number;
}

export interface RouterConfig {
  keys: KeyConfig[];
  routerToken: string;
  strategy: Strategy;
  /** A key is skipped when its remaining balance is below this. */
  headroomUsd: number;
  apifyBase: string;
  /** How long a key rests after Apify says it is out of credits. */
  cooldownSec: number;
}

/**
 * APIFY_KEYS accepts either a list separated by commas, spaces or newlines,
 * or a JSON array of strings / { token, label?, limitUsd? }.
 */
export function parseKeys(raw: string, defaultLimit = 5): KeyConfig[] {
  const text = raw.trim();
  if (!text) return [];

  let entries: Array<{ token: string; label?: string; limitUsd?: number }>;
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text) as Array<string | { token: string; label?: string; limitUsd?: number }>;
    entries = parsed.map((e) => (typeof e === 'string' ? { token: e } : e));
  } else {
    entries = text.split(/[\s,;]+/).filter(Boolean).map((token) => ({ token }));
  }

  const seen = new Set<string>();
  const keys: KeyConfig[] = [];
  for (const e of entries) {
    const token = e.token?.trim();
    if (!token || seen.has(token)) continue;
    seen.add(token);
    keys.push({
      id: e.label?.trim() || `key-${keys.length + 1}`,
      token,
      limitUsd: typeof e.limitUsd === 'number' ? e.limitUsd : defaultLimit,
    });
  }
  return keys;
}

export function loadConfig(env: Record<string, unknown>): RouterConfig {
  const str = (k: string) => (typeof env[k] === 'string' ? (env[k] as string) : undefined);

  const keys = parseKeys(str('APIFY_KEYS') ?? '');
  if (keys.length === 0) throw new Error('APIFY_KEYS is empty: add at least one Apify API token');

  const routerToken = str('ROUTER_TOKEN');
  if (!routerToken) throw new Error('ROUTER_TOKEN is required: it is the token clients use to call the router');

  const strategy = str('STRATEGY') === 'balanced' ? 'balanced' : 'fill';
  return {
    keys,
    routerToken,
    strategy,
    headroomUsd: Number(str('MIN_HEADROOM_USD') ?? '0.5'),
    apifyBase: (str('APIFY_BASE') ?? 'https://api.apify.com').replace(/\/+$/, ''),
    cooldownSec: Number(str('COOLDOWN_SEC') ?? '3600'),
  };
}
