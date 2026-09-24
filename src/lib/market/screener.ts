/* ===========================================================================
   Screener: run the engine across the universe and rank the results.
   ========================================================================= */

import type { AssetClass } from '../types';
import { ALL_INSTRUMENTS, type Instrument } from './universe';
import { getBars } from '../providers';
import { computeSnapshot } from '../indicators';
import { generateSignal } from '../signals';
import { closes } from '../indicators/core';

export interface ScreenerRow {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  sector?: string;
  price: number;
  changePct: number;
  ret5: number;
  ret20: number;
  ret60: number;
  rsi: number;
  adx: number;
  atrPct: number;
  relVolume: number;
  pctFrom52wHigh: number;
  pricePercentile: number;
  action: string;
  direction: string;
  score: number;
  conviction: number;
  regime: string;
  riskReward: number;
  aboveSma50: boolean;
  aboveSma200: boolean;
  squeeze: boolean;
  spark: number[];
  provenance: 'live' | 'simulated';
}

async function mapLimit<T, R>(
  items: readonly T[], limit: number, fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function screenOne(inst: Instrument): Promise<ScreenerRow | null> {
  try {
    const barsResult = await getBars(inst, '1d', 420);
    if (barsResult.bars.length < 220) return null;

    const s = computeSnapshot(barsResult.bars);
    const sig = generateSignal({
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      bars: barsResult.bars,
      provenance: barsResult.provenance === 'simulated' ? 'simulated' : 'live',
      horizon: 'swing',
      equity: 10_000,
    });

    const c = closes(barsResult.bars);
    const prev = c[c.length - 2] ?? s.price;

    return {
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      sector: inst.sector,
      price: s.price,
      changePct: prev !== 0 ? ((s.price - prev) / prev) * 100 : 0,
      ret5: s.ret5,
      ret20: s.ret20,
      ret60: s.ret60,
      rsi: s.rsi14,
      adx: s.adx14,
      atrPct: s.natr14,
      relVolume: s.relVolume,
      pctFrom52wHigh: s.pctFrom52wHigh,
      pricePercentile: s.pricePercentile,
      action: sig.action,
      direction: sig.plan.direction,
      score: sig.score,
      conviction: sig.conviction,
      regime: sig.regime.label,
      riskReward: sig.plan.riskReward,
      aboveSma50: s.price > s.sma50,
      aboveSma200: s.price > s.sma200,
      squeeze: s.squeeze.barsInSqueeze > 0 || s.squeeze.fired,
      spark: c.slice(-50),
      provenance: barsResult.provenance === 'simulated' ? 'simulated' : 'live',
    };
  } catch {
    return null;
  }
}

/* --- what the screener is allowed to look at -----------------------------
   Every name screened is one live bar request. With a few hundred
   instruments and free-tier vendors that is the difference between a screen
   that returns and one that gets the key rate-limited, so the universe is
   trimmed to what is actually screenable rather than to whatever fits.
   ------------------------------------------------------------------------- */

/** Volatility indexes: not directly tradable, and their mean reversion would
 *  dominate any momentum ranking. They inform the regime instead. */
const VOL_INDEXES = new Set(['VIX', 'VIX3M', 'VIX9D', 'VVIX', 'SKEW', 'OVX', 'GVZ']);

/** Leveraged and inverse funds are a linear function of an underlying that is
 *  already in the list. Screening both prints the same idea twice, once with
 *  three times the volatility and a decay term the ranking does not model. */
const LEVERAGED = new Set([
  'TQQQ', 'SQQQ', 'SPXL', 'SPXS', 'SOXL', 'SOXS', 'TNA', 'TZA', 'UPRO', 'LABU',
  'UVXY', 'VXX', 'SVXY',
]);

export function screenableUniverse(): Instrument[] {
  return ALL_INSTRUMENTS.filter((i) =>
    // Rates are yields, not a tradeable price series.
    i.assetClass !== 'rate'
    && !VOL_INDEXES.has(i.symbol)
    && !LEVERAGED.has(i.symbol)
    // Dynamic entries are whatever a user happened to look up; they are not
    // part of a market-wide screen.
    && !i.dynamic);
}

export async function runScreener(): Promise<ScreenerRow[]> {
  const universe = screenableUniverse();
  const rows = await mapLimit(universe, 8, screenOne);
  return rows
    .filter((r): r is ScreenerRow => r !== null)
    .sort((a, b) => b.conviction - a.conviction);
}
