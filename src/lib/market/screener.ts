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

export async function runScreener(): Promise<ScreenerRow[]> {
  // Rates have no tradeable price series in this universe; exclude them.
  const universe = ALL_INSTRUMENTS.filter((i) => i.assetClass !== 'rate');
  const rows = await mapLimit(universe, 6, screenOne);
  return rows
    .filter((r): r is ScreenerRow => r !== null)
    .sort((a, b) => b.conviction - a.conviction);
}
