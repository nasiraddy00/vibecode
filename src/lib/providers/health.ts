/* ===========================================================================
   Provider health tracking. The status strip shows this so the operator can
   always see which feeds are live and which are degraded.
   ========================================================================= */

export type FeedState = 'live' | 'degraded' | 'down' | 'unconfigured' | 'offline';

export interface FeedHealth {
  id: string;
  label: string;
  state: FeedState;
  lastSuccess: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
  successCount: number;
  failureCount: number;
  avgLatencyMs: number;
}

const registry = new Map<string, FeedHealth>();

export function registerFeed(id: string, label: string, configured: boolean): void {
  if (registry.has(id)) return;
  registry.set(id, {
    id, label,
    state: configured ? 'down' : 'unconfigured',
    lastSuccess: null, lastError: null, lastErrorAt: null,
    successCount: 0, failureCount: 0, avgLatencyMs: 0,
  });
}

export function recordSuccess(id: string, latencyMs: number): void {
  const h = registry.get(id);
  if (!h) return;
  h.state = 'live';
  h.lastSuccess = Date.now();
  h.successCount++;
  h.avgLatencyMs = h.avgLatencyMs === 0 ? latencyMs : h.avgLatencyMs * 0.7 + latencyMs * 0.3;
}

export function recordFailure(id: string, error: string): void {
  const h = registry.get(id);
  if (!h) return;
  h.failureCount++;
  h.lastError = error;
  h.lastErrorAt = Date.now();
  // One failure after recent success is a blip; sustained failure is "down".
  const recentlyGood = h.lastSuccess != null && Date.now() - h.lastSuccess < 120_000;
  h.state = recentlyGood ? 'degraded' : 'down';
}

export function setFeedState(id: string, state: FeedState): void {
  const h = registry.get(id);
  if (h) h.state = state;
}

export const allFeeds = (): FeedHealth[] => [...registry.values()];

export function feedSummary(): { live: number; total: number; anyLive: boolean } {
  const feeds = allFeeds();
  const live = feeds.filter((f) => f.state === 'live').length;
  return { live, total: feeds.length, anyLive: live > 0 };
}
