/* ===========================================================================
   Trend, direction and structure-following indicators.
   ========================================================================= */

import type { Bar } from '../types';
import { linreg } from '../util/math';
import {
  closes, highs, lows, medianPrice,
  sma, ema, rma, atr, trueRange, rollingMax, rollingMin, last,
} from './core';

const nanArray = (n: number): number[] => new Array(n).fill(NaN);

export interface AdxResult {
  adx: number[];
  plusDi: number[];
  minusDi: number[];
}

/** Average Directional Index with the +DI/-DI pair (Wilder).
 *  ADX > 25 = trending, < 20 = directionless. The DI cross gives the side. */
export function adx(bars: readonly Bar[], period = 14): AdxResult {
  const n = bars.length;
  if (n < period * 2) {
    return { adx: nanArray(n), plusDi: nanArray(n), minusDi: nanArray(n) };
  }

  const plusDm = nanArray(n);
  const minusDm = nanArray(n);
  for (let i = 1; i < n; i++) {
    const upMove = bars[i].h - bars[i - 1].h;
    const downMove = bars[i - 1].l - bars[i].l;
    // Only the larger of the two directional moves counts; ties count as zero.
    plusDm[i] = upMove > downMove && upMove > 0 ? upMove : 0;
    minusDm[i] = downMove > upMove && downMove > 0 ? downMove : 0;
  }

  const tr = trueRange(bars);
  const atrS = rma(tr.slice(1), period);
  const plusSm = rma(plusDm.slice(1), period);
  const minusSm = rma(minusDm.slice(1), period);

  const plusDi = nanArray(n);
  const minusDi = nanArray(n);
  const dx = nanArray(n);

  for (let i = 0; i < atrS.length; i++) {
    const gi = i + 1;
    if (!Number.isFinite(atrS[i]) || atrS[i] === 0) continue;
    const p = (plusSm[i] / atrS[i]) * 100;
    const m = (minusSm[i] / atrS[i]) * 100;
    plusDi[gi] = p;
    minusDi[gi] = m;
    const denom = p + m;
    dx[gi] = denom === 0 ? 0 : (Math.abs(p - m) / denom) * 100;
  }

  const dxClean = dx.filter(Number.isFinite);
  const adxLocal = rma(dxClean, period);
  const adxOut = nanArray(n);
  const offset = n - dxClean.length;
  for (let i = 0; i < adxLocal.length; i++) adxOut[i + offset] = adxLocal[i];

  return { adx: adxOut, plusDi, minusDi };
}

export interface AroonResult {
  up: number[];
  down: number[];
  oscillator: number[];
}

/** Aroon — how recently the period high/low was set. Excellent at spotting
 *  the *start* of a trend, which ADX is structurally late to. */
export function aroon(bars: readonly Bar[], period = 25): AroonResult {
  const n = bars.length;
  const up = nanArray(n);
  const down = nanArray(n);
  const oscillator = nanArray(n);
  for (let i = period; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    let hiIdx = i;
    let loIdx = i;
    for (let j = i - period; j <= i; j++) {
      if (bars[j].h >= hi) {
        hi = bars[j].h;
        hiIdx = j;
      }
      if (bars[j].l <= lo) {
        lo = bars[j].l;
        loIdx = j;
      }
    }
    up[i] = ((period - (i - hiIdx)) / period) * 100;
    down[i] = ((period - (i - loIdx)) / period) * 100;
    oscillator[i] = up[i] - down[i];
  }
  return { up, down, oscillator };
}

export interface SuperTrendResult {
  trend: number[];
  /** +1 uptrend, -1 downtrend. */
  direction: number[];
  upperBand: number[];
  lowerBand: number[];
}

/** SuperTrend — ATR-offset trailing stop that flips when price closes
 *  through the opposing band. One of the most reliable single-line regime
 *  filters in practice.
 *
 *  Canonical construction: the "final" bands ratchet — an upper band may only
 *  move down (or reset after a breach), a lower band may only move up. That
 *  ratchet is what turns a volatility envelope into a trailing stop. */
export function superTrend(bars: readonly Bar[], period = 10, multiplier = 3): SuperTrendResult {
  const n = bars.length;
  const a = atr(bars, period);
  const mp = medianPrice(bars);
  const trend = nanArray(n);
  const direction = nanArray(n);
  const upperBand = nanArray(n);
  const lowerBand = nanArray(n);

  let finalUpper = NaN;
  let finalLower = NaN;
  let dir = 1;
  let started = false;

  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(a[i])) continue;

    const basicUpper = mp[i] + multiplier * a[i];
    const basicLower = mp[i] - multiplier * a[i];
    const prevClose = i > 0 ? bars[i - 1].c : bars[i].c;

    if (!started) {
      finalUpper = basicUpper;
      finalLower = basicLower;
      dir = bars[i].c >= mp[i] ? 1 : -1;
      started = true;
    } else {
      finalUpper =
        basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
      finalLower =
        basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;

      // Flip only on a close beyond the band that was containing price.
      if (dir === 1 && bars[i].c < finalLower) dir = -1;
      else if (dir === -1 && bars[i].c > finalUpper) dir = 1;
    }

    upperBand[i] = finalUpper;
    lowerBand[i] = finalLower;
    direction[i] = dir;
    trend[i] = dir === 1 ? finalLower : finalUpper;
  }

  return { trend, direction, upperBand, lowerBand };
}

export interface PsarResult {
  psar: number[];
  direction: number[];
}

/** Parabolic SAR (Wilder), with acceleration factor stepping on new extremes. */
export function parabolicSar(bars: readonly Bar[], step = 0.02, max = 0.2): PsarResult {
  const n = bars.length;
  const psar = nanArray(n);
  const direction = nanArray(n);
  if (n < 3) return { psar, direction };

  let isLong = bars[1].c > bars[0].c;
  let af = step;
  let ep = isLong ? bars[0].h : bars[0].l;
  let sar = isLong ? bars[0].l : bars[0].h;

  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);

    if (isLong) {
      // SAR may never rise above the prior two lows.
      sar = Math.min(sar, bars[i - 1].l, bars[Math.max(0, i - 2)].l);
      if (bars[i].l < sar) {
        isLong = false;
        sar = ep;
        ep = bars[i].l;
        af = step;
      } else if (bars[i].h > ep) {
        ep = bars[i].h;
        af = Math.min(af + step, max);
      }
    } else {
      sar = Math.max(sar, bars[i - 1].h, bars[Math.max(0, i - 2)].h);
      if (bars[i].h > sar) {
        isLong = true;
        sar = ep;
        ep = bars[i].h;
        af = step;
      } else if (bars[i].l < ep) {
        ep = bars[i].l;
        af = Math.min(af + step, max);
      }
    }

    psar[i] = sar;
    direction[i] = isLong ? 1 : -1;
  }

  return { psar, direction };
}

export interface IchimokuResult {
  tenkan: number[];
  kijun: number[];
  senkouA: number[];
  senkouB: number[];
  chikou: number[];
  /** Cloud thickness at the current bar; wide cloud = strong support/resist. */
  cloudTop: number[];
  cloudBottom: number[];
}

/** Ichimoku Kinko Hyo. Full five-line system; senkou spans are returned
 *  shifted forward by `displacement` (the canonical 26). */
export function ichimoku(
  bars: readonly Bar[],
  conversion = 9,
  base = 26,
  spanB = 52,
  displacement = 26,
): IchimokuResult {
  const n = bars.length;
  const donchianMid = (period: number): number[] => {
    const hh = rollingMax(highs(bars), period);
    const ll = rollingMin(lows(bars), period);
    return hh.map((v, i) => (Number.isFinite(v) && Number.isFinite(ll[i]) ? (v + ll[i]) / 2 : NaN));
  };

  const tenkan = donchianMid(conversion);
  const kijun = donchianMid(base);
  const rawA = tenkan.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(kijun[i]) ? (v + kijun[i]) / 2 : NaN,
  );
  const rawB = donchianMid(spanB);

  // Leading spans are plotted `displacement` bars ahead of price.
  const senkouA = nanArray(n);
  const senkouB = nanArray(n);
  for (let i = 0; i < n; i++) {
    const target = i + displacement;
    if (target < n) {
      senkouA[target] = rawA[i];
      senkouB[target] = rawB[i];
    }
  }

  // Lagging span: today's close plotted `displacement` bars back.
  const chikou = nanArray(n);
  for (let i = displacement; i < n; i++) chikou[i - displacement] = bars[i].c;

  const cloudTop = senkouA.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(senkouB[i]) ? Math.max(v, senkouB[i]) : NaN,
  );
  const cloudBottom = senkouA.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(senkouB[i]) ? Math.min(v, senkouB[i]) : NaN,
  );

  return { tenkan, kijun, senkouA, senkouB, chikou, cloudTop, cloudBottom };
}

export interface VortexResult {
  plusVi: number[];
  minusVi: number[];
}

/** Vortex Indicator — captures trend via the distance between the current
 *  extreme and the prior opposite extreme. Crossovers are early and clean. */
export function vortex(bars: readonly Bar[], period = 14): VortexResult {
  const n = bars.length;
  const plusVi = nanArray(n);
  const minusVi = nanArray(n);
  const tr = trueRange(bars);
  for (let i = period; i < n; i++) {
    let vmPlus = 0;
    let vmMinus = 0;
    let sumTr = 0;
    for (let j = i - period + 1; j <= i; j++) {
      vmPlus += Math.abs(bars[j].h - bars[j - 1].l);
      vmMinus += Math.abs(bars[j].l - bars[j - 1].h);
      sumTr += tr[j];
    }
    if (sumTr > 0) {
      plusVi[i] = vmPlus / sumTr;
      minusVi[i] = vmMinus / sumTr;
    }
  }
  return { plusVi, minusVi };
}

/** Detrended Price Oscillator — removes trend to expose cycle length. */
export function dpo(src: readonly number[], period = 20): number[] {
  const shift = Math.floor(period / 2) + 1;
  const ma = sma(src, period);
  const out = nanArray(src.length);
  for (let i = 0; i < src.length; i++) {
    const mi = i - shift;
    if (mi >= 0 && Number.isFinite(ma[mi])) out[i] = src[i] - ma[mi];
  }
  return out;
}

export interface RegressionChannel {
  mid: number;
  upper: number;
  lower: number;
  slope: number;
  /** Annualised slope as a percentage of price. */
  slopePctAnnual: number;
  r2: number;
  /** Where price sits in the channel: -1 lower rail, +1 upper rail. */
  position: number;
}

/** Linear-regression channel over the trailing `period` closes, with rails at
 *  `sd` standard errors. Slope + R² together give trend *and* trend quality. */
export function regressionChannel(
  src: readonly number[],
  period = 60,
  sd = 2,
  periodsPerYear = 252,
): RegressionChannel {
  const seg = src.slice(-period).filter(Number.isFinite);
  if (seg.length < 5) {
    return { mid: NaN, upper: NaN, lower: NaN, slope: 0, slopePctAnnual: 0, r2: 0, position: 0 };
  }
  const { slope, intercept, r2, stderr } = linreg(seg);
  const endX = seg.length - 1;
  const mid = intercept + slope * endX;
  const upper = mid + sd * stderr;
  const lower = mid - sd * stderr;
  const price = seg[endX];
  const halfWidth = sd * stderr;
  return {
    mid,
    upper,
    lower,
    slope,
    slopePctAnnual: mid !== 0 ? (slope / mid) * periodsPerYear * 100 : 0,
    r2,
    position: halfWidth === 0 ? 0 : Math.max(-1.5, Math.min(1.5, (price - mid) / halfWidth)),
  };
}

/** Mass Index (Dorsey) — reversal-bulge detector from range volatility. */
export function massIndex(bars: readonly Bar[], fast = 9, slow = 25): number[] {
  const n = bars.length;
  const range = bars.map((b) => b.h - b.l);
  const e1 = ema(range, fast);
  const e1Clean = e1.filter(Number.isFinite);
  const e2 = ema(e1Clean, fast);
  const ratio = nanArray(n);
  const off = n - e1Clean.length;
  for (let i = 0; i < e2.length; i++) {
    const gi = i + off;
    if (Number.isFinite(e2[i]) && e2[i] !== 0 && Number.isFinite(e1[gi])) {
      ratio[gi] = e1[gi] / e2[i];
    }
  }
  const rClean = ratio.filter(Number.isFinite);
  const s = sma(rClean, slow).map((v) => v * slow);
  const out = nanArray(n);
  const off2 = n - rClean.length;
  for (let i = 0; i < s.length; i++) out[i + off2] = s[i];
  return out;
}

/** Multi-timeframe trend alignment. Returns a score in [-1, 1] measuring how
 *  many of the standard MA horizons agree, weighted toward the slower ones —
 *  the single most useful "is this a trade or a fight" gate. */
export function trendAlignment(src: readonly number[]): {
  score: number;
  detail: { period: number; above: boolean; slope: number }[];
} {
  const periods = [10, 20, 50, 100, 200];
  const weights = [0.12, 0.18, 0.25, 0.20, 0.25];
  const price = last(src);
  let score = 0;
  let usedWeight = 0;
  const detail: { period: number; above: boolean; slope: number }[] = [];

  periods.forEach((p, idx) => {
    if (src.length < p + 5) return;
    const maSeries = ema(src, p);
    const cur = last(maSeries);
    const prev = maSeries[maSeries.length - 6];
    if (!Number.isFinite(cur)) return;
    // Exact equality (a motionless series, or price sitting precisely on the
    // average) is neutral. Treating it as "below" reports a flat instrument as
    // a full-strength downtrend.
    const eps = Math.abs(cur) * 1e-9;
    const position = price > cur + eps ? 0.5 : price < cur - eps ? -0.5 : 0;
    const above = position > 0;
    const slope = Number.isFinite(prev) && prev !== 0 ? (cur - prev) / prev : 0;
    // Half the weight for price-vs-MA, half for the MA itself rising.
    const component = position + Math.max(-0.5, Math.min(0.5, slope * 40));
    score += weights[idx] * component * 2;
    usedWeight += weights[idx];
    detail.push({ period: p, above, slope });
  });

  return { score: usedWeight > 0 ? Math.max(-1, Math.min(1, score / usedWeight)) : 0, detail };
}
