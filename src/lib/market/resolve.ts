/* ===========================================================================
   Open-ended instrument resolution.

   The curated universe in ./universe.ts is what the terminal knows by heart:
   hand-set volatility calibration, a description, a place in the home panels.
   It is deliberately finite.

   This module removes the ceiling. Any ticker a vendor can find becomes a
   usable Instrument — US and international equities, ETFs, closed-end funds,
   ADRs, indexes, futures, FX pairs, bond funds, crypto. The synthesised
   entry is marked `dynamic: true` so the UI can say plainly that its
   calibration is inferred rather than curated.

   Nothing here invents a price. A dynamic instrument still gets its prices
   from the normal provider chain; the only thing inferred is the asset class
   and the simulator's fallback calibration.
   ========================================================================= */

import type { AssetClass } from '../types';
import {
  type Instrument, resolveInstrument, registerInstrument, searchInstruments,
} from './universe';
import { finnhubSearch, yahooSearch, yahooLookup, type SymbolHit } from '../providers/adapters';
import { finnhubConfigured } from '../providers/adapters';
import { cacheGet, cacheSet, isOffline } from '../providers/http';
import {
  loadDirectory, searchDirectory, lookupDirectory, type DirectoryEntry,
} from '../providers/directory';

/* --- asset-class inference ------------------------------------------------
   Symbol shape is checked before the vendor's own label because the shape is
   unambiguous where the label often is not: Yahoo reports "^VIX" and "^GSPC"
   alike as INDEX, but reports plenty of bond funds simply as ETF.
   ------------------------------------------------------------------------- */

const BOND_NAME = /\b(bond|treasury|t-bill|tips|municipal|muni|aggregate|corporate debt|fixed income|government debt|gilt|bund|senior loan|mortgage-backed|convertible|high yield|duration)\b/i;

export function inferAssetClass(symbol: string, type?: string, name?: string): AssetClass {
  const s = symbol.trim().toUpperCase();

  // Unambiguous symbol shapes.
  if (s.startsWith('^')) return 'index';
  if (s.endsWith('=F')) return 'commodity';
  if (s.endsWith('=X')) return 'fx';
  if (/-USD$/.test(s) || /^[A-Z]{3,6}USDT?$/.test(s)) return 'crypto';

  const t = (type ?? '').toUpperCase();
  if (t.includes('CRYPTO')) return 'crypto';
  if (t.includes('CURRENCY') || t === 'FX') return 'fx';
  if (t.includes('FUTURE')) return 'commodity';
  if (t.includes('INDEX')) return 'index';
  if (t.includes('BOND')) return 'bond';

  const isFund = t.includes('ETF') || t.includes('FUND') || t.includes('ETP')
    || t.includes('MUTUALFUND') || t.includes('TRUST');

  // A bond fund is an ETF to the vendor and a bond to a trader. The trader
  // is right: its behaviour is duration, not equity beta.
  if (name && BOND_NAME.test(name)) return 'bond';
  if (isFund) return 'etf';

  return 'equity';
}

/* --- fallback calibration -------------------------------------------------
   Used only to seed the simulator when every live feed is down. These are
   deliberately unremarkable class averages: a dynamic instrument should never
   look more precisely characterised than it is.
   ------------------------------------------------------------------------- */

const CLASS_DEFAULTS: Record<AssetClass, { anchor: number; vol: number; drift: number }> = {
  equity: { anchor: 100, vol: 0.32, drift: 0.07 },
  etf: { anchor: 100, vol: 0.20, drift: 0.07 },
  bond: { anchor: 100, vol: 0.06, drift: 0.04 },
  index: { anchor: 1000, vol: 0.18, drift: 0.07 },
  crypto: { anchor: 100, vol: 0.85, drift: 0.10 },
  commodity: { anchor: 100, vol: 0.28, drift: 0.02 },
  fx: { anchor: 1, vol: 0.09, drift: 0 },
  rate: { anchor: 4, vol: 0.25, drift: 0 },
};

const CONTINUOUS: ReadonlySet<AssetClass> = new Set<AssetClass>(['crypto', 'fx', 'commodity']);

/** Build an Instrument from a vendor search hit. */
export function synthesise(hit: SymbolHit): Instrument {
  const assetClass = inferAssetClass(hit.symbol, hit.type, hit.name);
  const d = CLASS_DEFAULTS[assetClass];
  const symbol = hit.symbol.trim().toUpperCase();

  return {
    symbol,
    name: hit.name || symbol,
    assetClass,
    anchor: d.anchor,
    typicalVol: d.vol,
    drift: d.drift,
    currency: hit.currency ?? 'USD',
    venue: hit.exchange ?? (hit.source === 'finnhub' ? 'US' : 'Yahoo'),
    continuous: CONTINUOUS.has(assetClass),
    yahooSymbol: symbol,
    binanceSymbol: assetClass === 'crypto' ? `${symbol.replace(/-USD$/, '')}USDT` : undefined,
    dynamic: true,
  };
}

/** The directory speaks Finnhub's vocabulary; SymbolHit is ours. */
const fromDirectory = (e: DirectoryEntry): SymbolHit => ({
  symbol: e.symbol,
  name: e.name,
  type: e.type === 'ETP' ? 'ETF' : e.type,
  exchange: e.mic,
  currency: 'USD',
  source: 'finnhub',
});

/* --- resolution ----------------------------------------------------------- */

/** Negative lookups are cached too: a typo should not re-hit the vendors on
 *  every keystroke of a retry. */
const NOT_FOUND = Symbol('not-found');
const resolveCache = new Map<string, Instrument | typeof NOT_FOUND>();

/** Resolve any symbol: curated first, then a vendor lookup.
 *
 *  Returns undefined only when the symbol is not curated AND no vendor could
 *  confirm it exists — which, with the network down, means every
 *  non-curated symbol. That is the honest answer: we cannot invent an
 *  instrument we have never heard of. */
export async function resolveAny(raw: string): Promise<Instrument | undefined> {
  if (!raw?.trim()) return undefined;

  const curated = resolveInstrument(raw);
  if (curated) return curated;

  const key = raw.trim().toUpperCase();
  const memo = resolveCache.get(key);
  if (memo) return memo === NOT_FOUND ? undefined : memo;

  if (isOffline()) return undefined;

  // The full US directory answers instantly once loaded and covers every
  // listed symbol, so it is tried before any per-symbol vendor call.
  try {
    const entries = await loadDirectory();
    const hit = lookupDirectory(entries, key);
    if (hit) {
      const inst = registerInstrument(synthesise(fromDirectory(hit)));
      resolveCache.set(key, inst);
      return inst;
    }
  } catch {
    // No directory (no key, or the fetch failed) — fall through to search.
  }

  for (const lookup of vendorLookups(key)) {
    try {
      const hit = await lookup();
      if (hit) {
        const inst = registerInstrument(synthesise(hit));
        resolveCache.set(key, inst);
        return inst;
      }
    } catch {
      // Try the next vendor; a dead feed is not a missing symbol.
    }
  }

  resolveCache.set(key, NOT_FOUND);
  return undefined;
}

function vendorLookups(symbol: string): (() => Promise<SymbolHit | undefined>)[] {
  const out: (() => Promise<SymbolHit | undefined>)[] = [];
  if (finnhubConfigured()) {
    out.push(async () => {
      const hits = await finnhubSearch(symbol);
      return hits.find((h) => h.symbol.toUpperCase() === symbol);
    });
  }
  out.push(() => yahooLookup(symbol));
  return out;
}

/** Synchronous best effort, for render paths that cannot await: curated
 *  entries and anything a previous async resolution already registered. */
export const resolveKnown = (raw: string): Instrument | undefined => resolveInstrument(raw);

/* --- search --------------------------------------------------------------- */

export interface SearchHit {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** Curated entries carry hand-set calibration and a description. */
  curated: boolean;
  exchange?: string;
}

const toHit = (i: Instrument): SearchHit => ({
  symbol: i.symbol,
  name: i.name,
  assetClass: i.assetClass,
  curated: !i.dynamic,
  exchange: i.venue,
});

/** Search the curated universe first, then top it up with vendor results so
 *  the command bar reaches every listed security. Curated matches keep their
 *  ranking; vendor hits fill the remainder. */
export async function searchAll(query: string, limit = 14): Promise<SearchHit[]> {
  const q = query.trim();
  if (!q) return [];

  let local = searchInstruments(q, limit).map(toHit);
  if (local.length >= limit || isOffline()) return local.slice(0, limit);

  // The directory is the main event: 30,000+ listed symbols, searched in
  // memory with no round trip. Vendor search is only a backstop for when it
  // is unavailable, or for symbols outside US exchanges.
  try {
    const entries = await loadDirectory();
    const fromDir = searchDirectory(entries, q, limit).map((e) => toHit(synthesise(fromDirectory(e))));
    const merged = merge(local, fromDir, limit);
    if (merged.length >= limit) return merged;
    local = merged;
  } catch {
    // Fall through to the per-query vendor search.
  }

  const cacheKey = `search:${q.toUpperCase()}`;
  const cached = cacheGet<SearchHit[]>(cacheKey);
  if (cached) return merge(local, cached.value, limit);

  const vendorHits: SymbolHit[] = [];
  const lookups: Promise<SymbolHit[]>[] = [yahooSearch(q)];
  if (finnhubConfigured()) lookups.push(finnhubSearch(q));

  const settled = await Promise.allSettled(lookups);
  for (const r of settled) if (r.status === 'fulfilled') vendorHits.push(...r.value);

  const remote = vendorHits.map((h) => {
    const inst = synthesise(h);
    return toHit(inst);
  });

  cacheSet(cacheKey, remote, 600_000);
  return merge(local, remote, limit);
}

function merge(local: SearchHit[], remote: SearchHit[], limit: number): SearchHit[] {
  const seen = new Set(local.map((h) => h.symbol.toUpperCase()));
  const out = [...local];
  for (const h of remote) {
    const k = h.symbol.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

/* --- calibration refinement -----------------------------------------------
   A dynamic instrument starts on class-average calibration. Once real bars
   have been seen, replace it with what the series actually did, so that a
   LATER feed outage degrades to a plausible simulation rather than a
   generic one. Curated instruments are left alone — their calibration was
   set by hand and is not a guess to be overwritten.
   ------------------------------------------------------------------------- */

export function calibrateFromBars(inst: Instrument, bars: { c: number }[]): void {
  if (!inst.dynamic || bars.length < 30) return;

  const closes = bars.map((b) => b.c).filter((c) => Number.isFinite(c) && c > 0);
  if (closes.length < 30) return;

  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));

  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (rets.length - 1);

  inst.anchor = closes[closes.length - 1];
  inst.typicalVol = Math.sqrt(variance) * Math.sqrt(252);
  // Cap the inferred drift: extrapolating one window's trend as a permanent
  // expected return is how a simulator ends up promising 400% a year.
  inst.drift = Math.max(-0.5, Math.min(0.5, mean * 252));
}
