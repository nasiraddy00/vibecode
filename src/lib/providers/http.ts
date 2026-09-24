/* ===========================================================================
   Shared fetch plumbing: timeouts, retry with backoff, and an in-process
   cache. Providers never call fetch directly.
   ========================================================================= */

export interface CacheEntry<T> { value: T; expires: number; storedAt: number; }

const cache = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = Number(process.env.MERIDIAN_CACHE_TTL ?? 45) * 1000;

export function cacheGet<T>(key: string): { value: T; age: number } | undefined {
  const hit = cache.get(key) as CacheEntry<T> | undefined;
  if (!hit) return undefined;
  if (Date.now() > hit.expires) {
    cache.delete(key);
    return undefined;
  }
  return { value: hit.value, age: Date.now() - hit.storedAt };
}

export function cacheSet<T>(key: string, value: T, ttlMs = DEFAULT_TTL_MS): void {
  cache.set(key, { value, expires: Date.now() + ttlMs, storedAt: Date.now() });
  // Bound the cache so a long-running server cannot leak memory.
  if (cache.size > 800) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].storedAt - b[1].storedAt).slice(0, 200);
    for (const [k] of oldest) cache.delete(k);
  }
}

export function cacheClear(): void { cache.clear(); }

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly status?: number,
    readonly retriable = false,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface FetchOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  provider: string;
}

/** True when the environment has explicitly disabled outbound calls. */
export const isOffline = (): boolean =>
  process.env.MERIDIAN_OFFLINE === '1' || process.env.MERIDIAN_OFFLINE === 'true';

/** Which environment variable, if any, carries this provider's key. Providers
 *  absent from this map need no key at all, which makes a 403 from them
 *  almost certainly a network policy rather than a credential problem. */
const PROVIDER_KEY_VAR: Record<string, string> = {
  finnhub: 'FINNHUB_API_KEY',
  coingecko: 'COINGECKO_API_KEY',
  'sec-edgar': 'SEC_USER_AGENT',
};

/** Say precisely why a request was refused.
 *
 *  "403" is the same status whether the vendor rejected the key or an egress
 *  proxy refused to open the tunnel, and those need opposite fixes. We cannot
 *  always tell them apart, but we know which of the two is even possible: a
 *  keyless provider cannot have a credential problem, and a 407 is always the
 *  proxy. Saying so turns an unactionable error into a next step. */
export function describeDenial(provider: string, status: number): string {
  const keyVar = PROVIDER_KEY_VAR[provider];
  const hasKey = keyVar ? Boolean(process.env[keyVar]) : false;
  const proxied = Boolean(process.env.HTTPS_PROXY ?? process.env.https_proxy);

  if (status === 407) {
    return `${provider}: the network proxy refused to open the tunnel (407). `
      + 'This is an egress policy, not a data problem — allow the host and retry.';
  }
  if (keyVar && !hasKey) {
    return `${provider}: refused (${status}) and no ${keyVar} is set. Add the key to .env.local.`;
  }
  if (proxied) {
    return `${provider}: refused (${status}). `
      + (keyVar
        ? `${keyVar} is set, so this is either an invalid/over-quota key or the network policy blocking the host.`
        : `${provider} needs no key, so this is the network policy blocking the host.`);
  }
  return keyVar
    ? `${provider}: refused (${status}) — check that ${keyVar} is valid and within quota.`
    : `${provider}: refused (${status}).`;
}

/** JSON fetch with timeout and bounded exponential backoff.
 *  Policy denials (401/403/407) are never retried — an egress policy or a
 *  missing key will not resolve itself, and hammering it is antisocial. */
export async function fetchJson<T>(url: string, opts: FetchOptions): Promise<T> {
  if (isOffline()) {
    throw new ProviderError('Offline mode is enabled (MERIDIAN_OFFLINE=1)', opts.provider);
  }

  const { timeoutMs = 8000, retries = 2, headers = {}, provider } = opts;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': process.env.SEC_USER_AGENT || 'Meridian Terminal/1.0',
          ...headers,
        },
      });
      clearTimeout(timer);

      if (res.status === 401 || res.status === 403 || res.status === 407) {
        throw new ProviderError(describeDenial(provider, res.status), provider, res.status, false);
      }
      if (res.status === 429) {
        throw new ProviderError(`${provider} rate limit reached`, provider, 429, true);
      }
      if (!res.ok) {
        throw new ProviderError(`${provider} returned ${res.status}`, provider, res.status, res.status >= 500);
      }
      return (await res.json()) as T;
    } catch (err) {
      clearTimeout(timer);
      lastError = err as Error;
      if (err instanceof ProviderError && !err.retriable) throw err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
  }
  throw lastError ?? new ProviderError('Unknown fetch failure', opts.provider);
}

/** Text fetch, for CSV endpoints. */
export async function fetchText(url: string, opts: FetchOptions): Promise<string> {
  if (isOffline()) {
    throw new ProviderError('Offline mode is enabled (MERIDIAN_OFFLINE=1)', opts.provider);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': process.env.SEC_USER_AGENT || 'Meridian Terminal/1.0',
        ...(opts.headers ?? {}),
      },
    });
    if (!res.ok) throw new ProviderError(`${opts.provider} returned ${res.status}`, opts.provider, res.status);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}
