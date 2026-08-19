/* ===========================================================================
   Volatility, bands and envelopes.
   ========================================================================= */

import type { Bar } from '../types';
import { logReturns, stdev, quantile, percentileRank, mean } from '../util/math';
import {
  closes, highs, lows, typicalPrice,
  sma, ema, rma, atr, stdevSeries, rollingMax, rollingMin, last,
} from './core';

const nanArray = (n: number): number[] => new Array(n).fill(NaN);

export interface BandResult {
  upper: number[];
  middle: number[];
  lower: number[];
  /** (upper - lower) / middle, as a percentage. */
  width: number[];
  /** Where price sits: 0 = lower band, 1 = upper band. */
  percentB: number[];
}

/** Bollinger Bands. Population stdev, per Bollinger's own specification. */
export function bollinger(src: readonly number[], period = 20, mult = 2): BandResult {
  const n = src.length;
  const middle = sma(src, period);
  const sd = stdevSeries(src, period);
  const upper = nanArray(n);
  const lower = nanArray(n);
  const width = nanArray(n);
  const percentB = nanArray(n);

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(middle[i]) || !Number.isFinite(sd[i])) continue;
    upper[i] = middle[i] + mult * sd[i];
    lower[i] = middle[i] - mult * sd[i];
    width[i] = middle[i] === 0 ? NaN : ((upper[i] - lower[i]) / middle[i]) * 100;
    const range = upper[i] - lower[i];
    percentB[i] = range === 0 ? 0.5 : (src[i] - lower[i]) / range;
  }
  return { upper, middle, lower, width, percentB };
}

/** Keltner Channels — EMA centre, ATR rails. Less prone to the "squeeze
 *  then whipsaw" failure mode of Bollinger in low-volume names. */
export function keltner(bars: readonly Bar[], period = 20, mult = 2, atrPeriod = 10): BandResult {
  const n = bars.length;
  const c = closes(bars);
  const middle = ema(c, period);
  const a = atr(bars, atrPeriod);
  const upper = nanArray(n);
  const lower = nanArray(n);
  const width = nanArray(n);
  const percentB = nanArray(n);

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(middle[i]) || !Number.isFinite(a[i])) continue;
    upper[i] = middle[i] + mult * a[i];
    lower[i] = middle[i] - mult * a[i];
    width[i] = middle[i] === 0 ? NaN : ((upper[i] - lower[i]) / middle[i]) * 100;
    const range = upper[i] - lower[i];
    percentB[i] = range === 0 ? 0.5 : (c[i] - lower[i]) / range;
  }
  return { upper, middle, lower, width, percentB };
}

/** Donchian Channels — the pure Turtle breakout system's core. */
export function donchian(bars: readonly Bar[], period = 20): BandResult {
  const n = bars.length;
  const upper = rollingMax(highs(bars), period);
  const lower = rollingMin(lows(bars), period);
  const middle = nanArray(n);
  const width = nanArray(n);
  const percentB = nanArray(n);
  const c = closes(bars);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(upper[i]) || !Number.isFinite(lower[i])) continue;
    middle[i] = (upper[i] + lower[i]) / 2;
    width[i] = middle[i] === 0 ? NaN : ((upper[i] - lower[i]) / middle[i]) * 100;
    const range = upper[i] - lower[i];
    percentB[i] = range === 0 ? 0.5 : (c[i] - lower[i]) / range;
  }
  return { upper, middle, lower, width, percentB };
}

/** Bollinger BandWidth percentile — the squeeze detector. Low percentile
 *  means compressed volatility, which historically precedes expansion. */
export function bandWidthPercentile(width: readonly number[], lookback = 252): number {
  const clean = width.filter(Number.isFinite).slice(-lookback);
  if (clean.length < 20) return 0.5;
  return percentileRank(clean, clean[clean.length - 1]);
}

/** TTM-style squeeze: Bollinger inside Keltner = coiled spring. */
export function squeeze(bars: readonly Bar[], period = 20): {
  isSqueezed: boolean[];
  barsInSqueeze: number;
  /** True on the bar the squeeze releases. */
  fired: boolean;
} {
  const bb = bollinger(closes(bars), period, 2);
  const kc = keltner(bars, period, 1.5, period);
  const isSqueezed = bars.map((_, i) => {
    if (![bb.upper[i], bb.lower[i], kc.upper[i], kc.lower[i]].every(Number.isFinite)) return false;
    return bb.upper[i] < kc.upper[i] && bb.lower[i] > kc.lower[i];
  });

  let barsInSqueeze = 0;
  for (let i = isSqueezed.length - 1; i >= 0; i--) {
    if (isSqueezed[i]) barsInSqueeze++;
    else break;
  }
  const n = isSqueezed.length;
  const fired = n >= 2 && !isSqueezed[n - 1] && isSqueezed[n - 2];

  return { isSqueezed, barsInSqueeze, fired };
}

/** Historical (close-to-close) volatility, annualised, as a series. */
export function historicalVol(src: readonly number[], period = 20, periodsPerYear = 252): number[] {
  const n = src.length;
  const out = nanArray(n);
  const lr = logReturns(src);
  const scale = Math.sqrt(periodsPerYear);
  for (let i = period; i < n; i++) {
    const seg = lr.slice(i - period, i);
    out[i] = stdev(seg) * scale;
  }
  return out;
}

/** Parkinson volatility — uses the high-low range, ~5x more efficient than
 *  close-to-close for the same sample size. */
export function parkinsonVol(bars: readonly Bar[], period = 20, periodsPerYear = 252): number[] {
  const n = bars.length;
  const out = nanArray(n);
  const k = 1 / (4 * Math.log(2));
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    let count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].l > 0 && bars[j].h > 0) {
        acc += Math.log(bars[j].h / bars[j].l) ** 2;
        count++;
      }
    }
    if (count > 0) out[i] = Math.sqrt((k * acc) / count) * Math.sqrt(periodsPerYear);
  }
  return out;
}

/** Garman-Klass volatility — incorporates open and close as well as the
 *  range; the most efficient of the classical OHLC estimators. */
export function garmanKlassVol(bars: readonly Bar[], period = 20, periodsPerYear = 252): number[] {
  const n = bars.length;
  const out = nanArray(n);
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    let count = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const b = bars[j];
      if (b.l <= 0 || b.h <= 0 || b.o <= 0 || b.c <= 0) continue;
      const hl = Math.log(b.h / b.l);
      const co = Math.log(b.c / b.o);
      acc += 0.5 * hl * hl - (2 * Math.log(2) - 1) * co * co;
      count++;
    }
    if (count > 0 && acc > 0) out[i] = Math.sqrt(acc / count) * Math.sqrt(periodsPerYear);
  }
  return out;
}

/** Yang-Zhang volatility — handles overnight gaps, the best estimator for
 *  equities that trade in sessions. */
export function yangZhangVol(bars: readonly Bar[], period = 20, periodsPerYear = 252): number {
  const seg = bars.slice(-(period + 1));
  if (seg.length < 5) return NaN;
  const n = seg.length - 1;

  const overnight: number[] = [];
  const openClose: number[] = [];
  let rs = 0;

  for (let i = 1; i < seg.length; i++) {
    const b = seg[i];
    const prev = seg[i - 1];
    if ([b.o, b.h, b.l, b.c, prev.c].some((v) => v <= 0)) continue;
    overnight.push(Math.log(b.o / prev.c));
    openClose.push(Math.log(b.c / b.o));
    rs +=
      Math.log(b.h / b.c) * Math.log(b.h / b.o) + Math.log(b.l / b.c) * Math.log(b.l / b.o);
  }
  if (overnight.length < 3) return NaN;

  const sigmaO = stdev(overnight) ** 2;
  const sigmaC = stdev(openClose) ** 2;
  const sigmaRs = rs / overnight.length;
  const k = 0.34 / (1.34 + (n + 1) / (n - 1));
  const v = sigmaO + k * sigmaC + (1 - k) * sigmaRs;
  return v > 0 ? Math.sqrt(v * periodsPerYear) : NaN;
}

/** Volatility cone: the distribution of realised vol over a lookback, used to
 *  judge whether current vol is cheap or dear. */
export interface VolCone {
  current: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  percentile: number;
  /** 'compressed' | 'normal' | 'elevated' | 'extreme' */
  state: 'compressed' | 'normal' | 'elevated' | 'extreme';
}

export function volCone(src: readonly number[], period = 20, lookback = 252): VolCone {
  const hv = historicalVol(src, period).filter(Number.isFinite).slice(-lookback);
  const current = hv.length ? hv[hv.length - 1] : NaN;
  if (hv.length < 30) {
    return {
      current, p10: NaN, p25: NaN, median: NaN, p75: NaN, p90: NaN,
      percentile: 0.5, state: 'normal',
    };
  }
  const pct = percentileRank(hv, current);
  const state =
    pct < 0.2 ? 'compressed' : pct < 0.7 ? 'normal' : pct < 0.9 ? 'elevated' : 'extreme';
  return {
    current,
    p10: quantile(hv, 0.1),
    p25: quantile(hv, 0.25),
    median: quantile(hv, 0.5),
    p75: quantile(hv, 0.75),
    p90: quantile(hv, 0.9),
    percentile: pct,
    state,
  };
}

/** Ulcer Index — depth AND duration of drawdown. A far better risk proxy
 *  than stdev for asymmetric, trend-following return streams. */
export function ulcerIndex(src: readonly number[], period = 14): number[] {
  const n = src.length;
  const out = nanArray(n);
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    let peak = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (src[j] > peak) peak = src[j];
      const dd = peak === 0 ? 0 : ((src[j] - peak) / peak) * 100;
      acc += dd * dd;
    }
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

/** Average daily range in percent — the intraday trader's opportunity gauge:
 *  if ADR is 0.6% there is no 2% scalp to be had. */
export function averageDailyRangePct(bars: readonly Bar[], period = 20): number {
  const seg = bars.slice(-period);
  if (!seg.length) return NaN;
  const ranges = seg.filter((b) => b.c > 0).map((b) => ((b.h - b.l) / b.c) * 100);
  return ranges.length ? mean(ranges) : NaN;
}

/** Realised-vs-expected range: how much of today's typical range is already
 *  used up. >1 means the instrument has already travelled its average day. */
export function rangeUsage(bars: readonly Bar[], period = 20): number {
  if (bars.length < 2) return NaN;
  const cur = bars[bars.length - 1];
  const adr = averageDailyRangePct(bars.slice(0, -1), period);
  if (!Number.isFinite(adr) || adr === 0 || cur.c === 0) return NaN;
  const todayRange = ((cur.h - cur.l) / cur.c) * 100;
  return todayRange / adr;
}
