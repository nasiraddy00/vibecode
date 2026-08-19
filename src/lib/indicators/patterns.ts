/* ===========================================================================
   Price structure: swings, support/resistance, pivots, candlestick patterns
   and oscillator divergence.
   ========================================================================= */

import type { Bar } from '../types';
import { mean, stdev, clamp } from '../util/math';
import { closes, highs, lows, atr, sma, last, volumes } from './core';

/* ---------------------------------------------------------------------------
   SWING STRUCTURE
   ------------------------------------------------------------------------- */

export interface Swing {
  index: number;
  price: number;
  type: 'high' | 'low';
  /** Bars of confirmation on each side. */
  strength: number;
}

/** Fractal swing points: a bar whose high exceeds `lookback` bars either side
 *  (and the mirror for lows). This is the basis of market structure. */
export function findSwings(bars: readonly Bar[], lookback = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (bars[i].h <= bars[i - j].h || bars[i].h <= bars[i + j].h) isHigh = false;
      if (bars[i].l >= bars[i - j].l || bars[i].l >= bars[i + j].l) isLow = false;
    }
    if (isHigh) out.push({ index: i, price: bars[i].h, type: 'high', strength: lookback });
    if (isLow) out.push({ index: i, price: bars[i].l, type: 'low', strength: lookback });
  }
  return out;
}

export type StructureState =
  | 'uptrend_hh_hl'      // higher highs + higher lows
  | 'downtrend_lh_ll'    // lower highs + lower lows
  | 'range_bound'
  | 'breakout_up'
  | 'breakout_down'
  | 'transition';

export interface MarketStructure {
  state: StructureState;
  lastSwingHigh: number;
  lastSwingLow: number;
  /** Higher highs / higher lows counts in the recent window. */
  hh: number;
  hl: number;
  lh: number;
  ll: number;
  description: string;
}

/** Classify market structure from the sequence of swing points — the way a
 *  discretionary trader reads a chart, made explicit. */
export function marketStructure(bars: readonly Bar[], lookback = 3, window = 8): MarketStructure {
  const swings = findSwings(bars, lookback);
  const sh = swings.filter((s) => s.type === 'high').slice(-window);
  const sl = swings.filter((s) => s.type === 'low').slice(-window);

  let hh = 0;
  let lh = 0;
  for (let i = 1; i < sh.length; i++) {
    if (sh[i].price > sh[i - 1].price) hh++;
    else lh++;
  }
  let hl = 0;
  let ll = 0;
  for (let i = 1; i < sl.length; i++) {
    if (sl[i].price > sl[i - 1].price) hl++;
    else ll++;
  }

  const lastSwingHigh = sh.length ? sh[sh.length - 1].price : NaN;
  const lastSwingLow = sl.length ? sl[sl.length - 1].price : NaN;
  const price = last(closes(bars));

  let state: StructureState = 'transition';
  let description = 'Structure unresolved — no clean swing sequence.';

  if (Number.isFinite(lastSwingHigh) && price > lastSwingHigh) {
    state = 'breakout_up';
    description = 'Price has taken out the last swing high — breakout in force.';
  } else if (Number.isFinite(lastSwingLow) && price < lastSwingLow) {
    state = 'breakout_down';
    description = 'Price has broken the last swing low — breakdown in force.';
  } else if (hh > lh && hl > ll) {
    state = 'uptrend_hh_hl';
    description = 'Higher highs and higher lows — textbook uptrend structure.';
  } else if (lh > hh && ll > hl) {
    state = 'downtrend_lh_ll';
    description = 'Lower highs and lower lows — textbook downtrend structure.';
  } else if (Math.abs(hh - lh) <= 1 && Math.abs(hl - ll) <= 1) {
    state = 'range_bound';
    description = 'Swings alternating without progress — range-bound.';
  }

  return { state, lastSwingHigh, lastSwingLow, hh, hl, lh, ll, description };
}

/* ---------------------------------------------------------------------------
   SUPPORT / RESISTANCE
   ------------------------------------------------------------------------- */

export interface Level {
  price: number;
  /** How many swing points cluster here. */
  touches: number;
  /** 0-1 composite of touches, recency and volume. */
  strength: number;
  type: 'support' | 'resistance';
  /** Distance from spot as a percentage. */
  distancePct: number;
}

/** Cluster swing points into support/resistance levels. Tolerance scales with
 *  ATR so it adapts across instruments and volatility regimes. */
export function keyLevels(bars: readonly Bar[], maxLevels = 6): Level[] {
  if (bars.length < 20) return [];
  const price = last(closes(bars));
  const a = last(atr(bars, 14));
  const tol = Number.isFinite(a) && a > 0 ? a * 0.6 : price * 0.01;

  const swings = findSwings(bars, 3);
  if (!swings.length) return [];

  interface Cluster { prices: number[]; indices: number[]; }
  const clusters: Cluster[] = [];

  for (const s of swings) {
    const hit = clusters.find((c) => Math.abs(mean(c.prices) - s.price) <= tol);
    if (hit) {
      hit.prices.push(s.price);
      hit.indices.push(s.index);
    } else {
      clusters.push({ prices: [s.price], indices: [s.index] });
    }
  }

  const n = bars.length;
  const levels: Level[] = clusters
    .filter((c) => c.prices.length >= 2)
    .map((c) => {
      const lvl = mean(c.prices);
      const recency = Math.max(...c.indices) / n; // 0 = old, 1 = current
      const touches = c.prices.length;
      const strength = clamp(
        0.45 * Math.min(1, touches / 4) + 0.35 * recency + 0.2 * Math.min(1, touches / 6),
        0, 1,
      );
      return {
        price: lvl,
        touches,
        strength,
        type: (lvl > price ? 'resistance' : 'support') as 'support' | 'resistance',
        distancePct: price === 0 ? 0 : ((lvl - price) / price) * 100,
      };
    });

  // Keep the strongest levels nearest to price — those are the tradeable ones.
  return levels
    .sort((x, y) => y.strength - Math.abs(y.distancePct) / 100 - (x.strength - Math.abs(x.distancePct) / 100))
    .slice(0, maxLevels)
    .sort((x, y) => y.price - x.price);
}

export interface PivotSet {
  pivot: number;
  r1: number; r2: number; r3: number;
  s1: number; s2: number; s3: number;
  method: 'classic' | 'fibonacci' | 'camarilla' | 'woodie' | 'demark';
}

/** Pivot points across the five standard methods. Day traders anchor to these
 *  because so much of the desk world watches the same numbers. */
export function pivots(bar: Bar, method: PivotSet['method'] = 'classic'): PivotSet {
  const { h, l, c, o } = bar;
  const range = h - l;

  switch (method) {
    case 'fibonacci': {
      const p = (h + l + c) / 3;
      return {
        pivot: p,
        r1: p + 0.382 * range, r2: p + 0.618 * range, r3: p + 1.0 * range,
        s1: p - 0.382 * range, s2: p - 0.618 * range, s3: p - 1.0 * range,
        method,
      };
    }
    case 'camarilla': {
      const p = (h + l + c) / 3;
      return {
        pivot: p,
        r1: c + range * 1.1 / 12, r2: c + range * 1.1 / 6, r3: c + range * 1.1 / 4,
        s1: c - range * 1.1 / 12, s2: c - range * 1.1 / 6, s3: c - range * 1.1 / 4,
        method,
      };
    }
    case 'woodie': {
      const p = (h + l + 2 * o) / 4;
      return {
        pivot: p,
        r1: 2 * p - l, r2: p + range, r3: h + 2 * (p - l),
        s1: 2 * p - h, s2: p - range, s3: l - 2 * (h - p),
        method,
      };
    }
    case 'demark': {
      const x = c < o ? h + 2 * l + c : c > o ? 2 * h + l + c : h + l + 2 * c;
      const p = x / 4;
      return {
        pivot: p,
        r1: x / 2 - l, r2: p + range, r3: p + 2 * range,
        s1: x / 2 - h, s2: p - range, s3: p - 2 * range,
        method,
      };
    }
    default: {
      const p = (h + l + c) / 3;
      return {
        pivot: p,
        r1: 2 * p - l, r2: p + range, r3: h + 2 * (p - l),
        s1: 2 * p - h, s2: p - range, s3: l - 2 * (h - p),
        method: 'classic',
      };
    }
  }
}

/** Fibonacci retracement levels between the swing extremes of a window. */
export function fibRetracements(bars: readonly Bar[], lookback = 60): {
  high: number; low: number; levels: { ratio: number; price: number }[];
} {
  const seg = bars.slice(-lookback);
  if (seg.length < 5) return { high: NaN, low: NaN, levels: [] };
  const high = Math.max(...seg.map((b) => b.h));
  const low = Math.min(...seg.map((b) => b.l));
  const range = high - low;
  const ratios = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];
  return {
    high,
    low,
    levels: ratios.map((r) => ({ ratio: r, price: high - range * r })),
  };
}

/* ---------------------------------------------------------------------------
   CANDLESTICK PATTERNS
   ------------------------------------------------------------------------- */

export interface CandlePattern {
  name: string;
  bias: 'bullish' | 'bearish' | 'neutral';
  /** 0-1: how textbook the formation is. */
  quality: number;
  index: number;
  note: string;
}

const body = (b: Bar): number => Math.abs(b.c - b.o);
const upperWick = (b: Bar): number => b.h - Math.max(b.o, b.c);
const lowerWick = (b: Bar): number => Math.min(b.o, b.c) - b.l;
const range = (b: Bar): number => b.h - b.l;
const isBull = (b: Bar): boolean => b.c > b.o;
const isBear = (b: Bar): boolean => b.c < b.o;

/** Detect candlestick formations on the most recent bars. Quality is scaled by
 *  how well the geometry matches the ideal AND by relative volume — a hammer
 *  on no volume is a curiosity, not a signal. */
export function candlePatterns(bars: readonly Bar[], scanBars = 3): CandlePattern[] {
  const out: CandlePattern[] = [];
  const n = bars.length;
  if (n < 5) return out;

  const avgBody = mean(bars.slice(-20).map(body)) || 1;
  const avgVol = mean(bars.slice(-20).map((b) => b.v)) || 1;

  for (let k = 0; k < scanBars; k++) {
    const i = n - 1 - k;
    if (i < 3) break;
    const c0 = bars[i];
    const c1 = bars[i - 1];
    const c2 = bars[i - 2];
    const r0 = range(c0);
    if (r0 === 0) continue;
    const volBoost = clamp(c0.v / avgVol, 0.4, 2) / 2;
    const b0 = body(c0);

    // --- Doji family -----------------------------------------------------
    if (b0 <= r0 * 0.1) {
      if (lowerWick(c0) > r0 * 0.6) {
        out.push({
          name: 'Dragonfly Doji', bias: 'bullish', index: i,
          quality: clamp(0.55 + volBoost * 0.35, 0, 1),
          note: 'Sellers drove it down and were fully rejected into the close.',
        });
      } else if (upperWick(c0) > r0 * 0.6) {
        out.push({
          name: 'Gravestone Doji', bias: 'bearish', index: i,
          quality: clamp(0.55 + volBoost * 0.35, 0, 1),
          note: 'Buyers pushed up and lost the entire advance by the close.',
        });
      } else {
        out.push({
          name: 'Doji', bias: 'neutral', index: i, quality: 0.4,
          note: 'Indecision — open and close effectively equal.',
        });
      }
    }

    // --- Hammer / shooting star -------------------------------------------
    if (b0 > 0 && lowerWick(c0) > b0 * 2 && upperWick(c0) < b0 * 0.6) {
      const downtrendContext = c1.c < c2.c;
      out.push({
        name: isBull(c0) ? 'Hammer' : 'Hanging Man',
        bias: downtrendContext ? 'bullish' : 'neutral',
        index: i,
        quality: clamp((downtrendContext ? 0.6 : 0.35) + volBoost * 0.3, 0, 1),
        note: 'Long lower shadow — demand appeared beneath the market.',
      });
    }
    if (b0 > 0 && upperWick(c0) > b0 * 2 && lowerWick(c0) < b0 * 0.6) {
      const uptrendContext = c1.c > c2.c;
      out.push({
        name: isBear(c0) ? 'Shooting Star' : 'Inverted Hammer',
        bias: uptrendContext ? 'bearish' : 'neutral',
        index: i,
        quality: clamp((uptrendContext ? 0.6 : 0.35) + volBoost * 0.3, 0, 1),
        note: 'Long upper shadow — supply capped the advance.',
      });
    }

    // --- Marubozu ---------------------------------------------------------
    if (b0 > avgBody * 1.4 && upperWick(c0) < r0 * 0.06 && lowerWick(c0) < r0 * 0.06) {
      out.push({
        name: isBull(c0) ? 'Bullish Marubozu' : 'Bearish Marubozu',
        bias: isBull(c0) ? 'bullish' : 'bearish',
        index: i,
        quality: clamp(0.6 + volBoost * 0.35, 0, 1),
        note: 'Full-bodied candle with no rejection at either extreme.',
      });
    }

    // --- Engulfing --------------------------------------------------------
    if (isBull(c0) && isBear(c1) && c0.c > c1.o && c0.o < c1.c && b0 > body(c1) * 1.1) {
      out.push({
        name: 'Bullish Engulfing', bias: 'bullish', index: i,
        quality: clamp(0.62 + volBoost * 0.35, 0, 1),
        note: "Today's range swallows yesterday's down candle entirely.",
      });
    }
    if (isBear(c0) && isBull(c1) && c0.c < c1.o && c0.o > c1.c && b0 > body(c1) * 1.1) {
      out.push({
        name: 'Bearish Engulfing', bias: 'bearish', index: i,
        quality: clamp(0.62 + volBoost * 0.35, 0, 1),
        note: "Today's range swallows yesterday's up candle entirely.",
      });
    }

    // --- Harami (inside bar) ---------------------------------------------
    if (Math.max(c0.o, c0.c) < Math.max(c1.o, c1.c) && Math.min(c0.o, c0.c) > Math.min(c1.o, c1.c)) {
      out.push({
        name: isBear(c1) ? 'Bullish Harami' : 'Bearish Harami',
        bias: isBear(c1) ? 'bullish' : 'bearish',
        index: i,
        quality: 0.45,
        note: 'Inside bar — momentum of the prior candle has stalled.',
      });
    }

    // --- Piercing / dark cloud -------------------------------------------
    const mid1 = (c1.o + c1.c) / 2;
    if (isBear(c1) && isBull(c0) && c0.o < c1.c && c0.c > mid1 && c0.c < c1.o) {
      out.push({
        name: 'Piercing Line', bias: 'bullish', index: i,
        quality: clamp(0.55 + volBoost * 0.3, 0, 1),
        note: 'Gapped down then recovered past the midpoint of the prior loss.',
      });
    }
    if (isBull(c1) && isBear(c0) && c0.o > c1.c && c0.c < mid1 && c0.c > c1.o) {
      out.push({
        name: 'Dark Cloud Cover', bias: 'bearish', index: i,
        quality: clamp(0.55 + volBoost * 0.3, 0, 1),
        note: 'Gapped up then surrendered past the midpoint of the prior gain.',
      });
    }

    // --- Three soldiers / crows -------------------------------------------
    if (isBull(c0) && isBull(c1) && isBull(c2) && c0.c > c1.c && c1.c > c2.c &&
        body(c0) > avgBody * 0.6 && body(c1) > avgBody * 0.6) {
      out.push({
        name: 'Three White Soldiers', bias: 'bullish', index: i,
        quality: clamp(0.7 + volBoost * 0.25, 0, 1),
        note: 'Three consecutive strong up closes — persistent demand.',
      });
    }
    if (isBear(c0) && isBear(c1) && isBear(c2) && c0.c < c1.c && c1.c < c2.c &&
        body(c0) > avgBody * 0.6 && body(c1) > avgBody * 0.6) {
      out.push({
        name: 'Three Black Crows', bias: 'bearish', index: i,
        quality: clamp(0.7 + volBoost * 0.25, 0, 1),
        note: 'Three consecutive strong down closes — persistent supply.',
      });
    }

    // --- Morning / evening star ------------------------------------------
    if (body(c1) < avgBody * 0.4 && isBear(c2) && isBull(c0) && c0.c > (c2.o + c2.c) / 2) {
      out.push({
        name: 'Morning Star', bias: 'bullish', index: i,
        quality: clamp(0.72 + volBoost * 0.25, 0, 1),
        note: 'Down candle, indecision, then a strong reclaim — classic bottom.',
      });
    }
    if (body(c1) < avgBody * 0.4 && isBull(c2) && isBear(c0) && c0.c < (c2.o + c2.c) / 2) {
      out.push({
        name: 'Evening Star', bias: 'bearish', index: i,
        quality: clamp(0.72 + volBoost * 0.25, 0, 1),
        note: 'Up candle, indecision, then a sharp rejection — classic top.',
      });
    }

    // --- Tweezer tops/bottoms --------------------------------------------
    const tol = r0 * 0.08;
    if (Math.abs(c0.l - c1.l) < tol && isBear(c1) && isBull(c0)) {
      out.push({
        name: 'Tweezer Bottom', bias: 'bullish', index: i, quality: 0.5,
        note: 'Matched lows on consecutive bars — buyers defending a price.',
      });
    }
    if (Math.abs(c0.h - c1.h) < tol && isBull(c1) && isBear(c0)) {
      out.push({
        name: 'Tweezer Top', bias: 'bearish', index: i, quality: 0.5,
        note: 'Matched highs on consecutive bars — sellers defending a price.',
      });
    }
  }

  return out;
}

/* ---------------------------------------------------------------------------
   DIVERGENCE
   ------------------------------------------------------------------------- */

export interface Divergence {
  type: 'bullish_regular' | 'bearish_regular' | 'bullish_hidden' | 'bearish_hidden';
  /** 0-1 strength. */
  strength: number;
  /** Bars ago the divergence completed. */
  barsAgo: number;
  description: string;
}

/** Detect regular and hidden (a.k.a. continuation) divergence between price
 *  and an oscillator. Regular divergence warns of reversal; hidden divergence
 *  confirms the prevailing trend. */
export function detectDivergence(
  bars: readonly Bar[],
  oscillator: readonly number[],
  lookback = 40,
  swingLookback = 3,
): Divergence[] {
  const out: Divergence[] = [];
  const n = bars.length;
  if (n < lookback || oscillator.length < lookback) return out;

  const swings = findSwings(bars.slice(-lookback), swingLookback);
  const offset = n - lookback;
  const oscAt = (localIdx: number): number => oscillator[localIdx + offset];

  const lows = swings.filter((s) => s.type === 'low').slice(-3);
  const highs = swings.filter((s) => s.type === 'high').slice(-3);

  if (lows.length >= 2) {
    const [a, b] = [lows[lows.length - 2], lows[lows.length - 1]];
    const oa = oscAt(a.index);
    const ob = oscAt(b.index);
    if (Number.isFinite(oa) && Number.isFinite(ob)) {
      // Price makes a lower low, oscillator makes a higher low → bullish.
      if (b.price < a.price && ob > oa) {
        out.push({
          type: 'bullish_regular',
          strength: clamp(Math.abs(ob - oa) / 20, 0.3, 1),
          barsAgo: lookback - 1 - b.index,
          description: 'Price printed a lower low but momentum did not confirm — selling is exhausting.',
        });
      }
      // Price higher low, oscillator lower low → hidden bullish (continuation).
      if (b.price > a.price && ob < oa) {
        out.push({
          type: 'bullish_hidden',
          strength: clamp(Math.abs(ob - oa) / 25, 0.25, 0.8),
          barsAgo: lookback - 1 - b.index,
          description: 'Higher low on price against a lower momentum low — trend continuation setup.',
        });
      }
    }
  }

  if (highs.length >= 2) {
    const [a, b] = [highs[highs.length - 2], highs[highs.length - 1]];
    const oa = oscAt(a.index);
    const ob = oscAt(b.index);
    if (Number.isFinite(oa) && Number.isFinite(ob)) {
      if (b.price > a.price && ob < oa) {
        out.push({
          type: 'bearish_regular',
          strength: clamp(Math.abs(ob - oa) / 20, 0.3, 1),
          barsAgo: lookback - 1 - b.index,
          description: 'Price printed a higher high but momentum did not confirm — buying is exhausting.',
        });
      }
      if (b.price < a.price && ob > oa) {
        out.push({
          type: 'bearish_hidden',
          strength: clamp(Math.abs(ob - oa) / 25, 0.25, 0.8),
          barsAgo: lookback - 1 - b.index,
          description: 'Lower high on price against a higher momentum high — downtrend continuation setup.',
        });
      }
    }
  }

  return out;
}

/* ---------------------------------------------------------------------------
   GAPS
   ------------------------------------------------------------------------- */

export interface GapInfo {
  hasGap: boolean;
  /** Signed gap size as a percentage of the prior close. */
  gapPct: number;
  type: 'up' | 'down' | 'none';
  /** True if the session has already traded back through the prior close. */
  filled: boolean;
  /** How much of the gap has been retraced, 0-1. */
  fillFraction: number;
}

/** Overnight gap analysis on the latest bar. Gap-and-go versus gap-fill is one
 *  of the highest-expectancy day-trading decisions there is. */
export function gapAnalysis(bars: readonly Bar[], minPct = 0.4): GapInfo {
  if (bars.length < 2) {
    return { hasGap: false, gapPct: 0, type: 'none', filled: false, fillFraction: 0 };
  }
  const cur = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  if (prev.c === 0) {
    return { hasGap: false, gapPct: 0, type: 'none', filled: false, fillFraction: 0 };
  }

  const gapPct = ((cur.o - prev.c) / prev.c) * 100;
  const hasGap = Math.abs(gapPct) >= minPct;
  const type = !hasGap ? 'none' : gapPct > 0 ? 'up' : 'down';

  let filled = false;
  let fillFraction = 0;
  if (hasGap) {
    const gapSize = Math.abs(cur.o - prev.c);
    if (type === 'up') {
      filled = cur.l <= prev.c;
      fillFraction = gapSize === 0 ? 1 : clamp((cur.o - cur.l) / gapSize, 0, 1);
    } else {
      filled = cur.h >= prev.c;
      fillFraction = gapSize === 0 ? 1 : clamp((cur.h - cur.o) / gapSize, 0, 1);
    }
  }

  return { hasGap, gapPct, type, filled, fillFraction };
}

/** Consecutive-close streak; long streaks mean-revert more often than not. */
export function closeStreak(bars: readonly Bar[]): { direction: 1 | -1 | 0; length: number } {
  if (bars.length < 2) return { direction: 0, length: 0 };
  const dir = bars[bars.length - 1].c > bars[bars.length - 2].c ? 1 : bars[bars.length - 1].c < bars[bars.length - 2].c ? -1 : 0;
  if (dir === 0) return { direction: 0, length: 0 };
  let len = 0;
  for (let i = bars.length - 1; i >= 1; i--) {
    const d = bars[i].c > bars[i - 1].c ? 1 : bars[i].c < bars[i - 1].c ? -1 : 0;
    if (d === dir) len++;
    else break;
  }
  return { direction: dir, length: len };
}
