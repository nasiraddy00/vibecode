/* ===========================================================================
   Base series operations and moving averages.

   Convention followed throughout the indicator library: every function
   returns an array the SAME LENGTH as its input, front-padded with NaN for
   the warm-up period. This makes indicators freely composable — you can feed
   one into another without index bookkeeping — and lets the UI plot from a
   single x-axis. Callers use `last()` / `lastN()` to read the settled tail.
   ========================================================================= */

import type { Bar } from '../types';
import { mean, stdev } from '../util/math';

export const closes = (bars: readonly Bar[]): number[] => bars.map((b) => b.c);
export const opens = (bars: readonly Bar[]): number[] => bars.map((b) => b.o);
export const highs = (bars: readonly Bar[]): number[] => bars.map((b) => b.h);
export const lows = (bars: readonly Bar[]): number[] => bars.map((b) => b.l);
export const volumes = (bars: readonly Bar[]): number[] => bars.map((b) => b.v);

/** (h + l) / 2 */
export const medianPrice = (bars: readonly Bar[]): number[] => bars.map((b) => (b.h + b.l) / 2);
/** (h + l + c) / 3 */
export const typicalPrice = (bars: readonly Bar[]): number[] => bars.map((b) => (b.h + b.l + b.c) / 3);
/** (h + l + 2c) / 4 */
export const weightedClose = (bars: readonly Bar[]): number[] =>
  bars.map((b) => (b.h + b.l + 2 * b.c) / 4);
/** (o + h + l + c) / 4 */
export const ohlc4 = (bars: readonly Bar[]): number[] =>
  bars.map((b) => (b.o + b.h + b.l + b.c) / 4);

const nanArray = (n: number): number[] => new Array(n).fill(NaN);

/** Last settled (non-NaN) value of a series, or NaN. */
export function last(series: readonly number[]): number {
  for (let i = series.length - 1; i >= 0; i--) {
    if (Number.isFinite(series[i])) return series[i];
  }
  return NaN;
}

/** Value `n` bars back from the end, skipping nothing. */
export function at(series: readonly number[], back: number): number {
  const i = series.length - 1 - back;
  return i >= 0 ? series[i] : NaN;
}

/** The trailing `n` settled values, oldest first. */
export function lastN(series: readonly number[], n: number): number[] {
  const out: number[] = [];
  for (let i = series.length - 1; i >= 0 && out.length < n; i--) {
    if (Number.isFinite(series[i])) out.push(series[i]);
  }
  return out.reverse();
}

/* ---------------------------------------------------------------------------
   MOVING AVERAGES
   ------------------------------------------------------------------------- */

/** Simple moving average. */
export function sma(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = nanArray(n);
  if (period <= 0 || n < period) return out;
  let running = 0;
  for (let i = 0; i < n; i++) {
    running += src[i];
    if (i >= period) running -= src[i - period];
    if (i >= period - 1) out[i] = running / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period`. */
export function ema(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = nanArray(n);
  if (period <= 0 || n < period) return out;
  const k = 2 / (period + 1);
  let prev = mean(src.slice(0, period));
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = src[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder's smoothing (a.k.a. RMA / SMMA). Used by RSI, ATR, ADX — it is
 *  NOT the same as an EMA of the same period (k = 1/p, not 2/(p+1)). */
export function rma(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = nanArray(n);
  if (period <= 0 || n < period) return out;
  let prev = mean(src.slice(0, period));
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = (prev * (period - 1) + src[i]) / period;
    out[i] = prev;
  }
  return out;
}

/** Linearly-weighted moving average — heaviest weight on the newest bar. */
export function wma(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = nanArray(n);
  if (period <= 0 || n < period) return out;
  const denom = (period * (period + 1)) / 2;
  for (let i = period - 1; i < n; i++) {
    let acc = 0;
    for (let j = 0; j < period; j++) acc += src[i - period + 1 + j] * (j + 1);
    out[i] = acc / denom;
  }
  return out;
}

/** Double EMA — 2*EMA - EMA(EMA); reduces lag. */
export function dema(src: readonly number[], period: number): number[] {
  const e1 = ema(src, period);
  const e2 = ema(e1.filter(Number.isFinite), period);
  const out = nanArray(src.length);
  const offset = src.length - e2.length;
  for (let i = 0; i < e2.length; i++) {
    const gi = i + offset;
    if (Number.isFinite(e2[i]) && Number.isFinite(e1[gi])) out[gi] = 2 * e1[gi] - e2[i];
  }
  return out;
}

/** Triple EMA — 3*e1 - 3*e2 + e3; least lag of the EMA family. */
export function tema(src: readonly number[], period: number): number[] {
  const e1 = ema(src, period);
  const c1 = e1.filter(Number.isFinite);
  const e2 = ema(c1, period);
  const c2 = e2.filter(Number.isFinite);
  const e3 = ema(c2, period);
  const out = nanArray(src.length);
  for (let i = 0; i < src.length; i++) {
    const i1 = i;
    const i2 = i - (src.length - c1.length);
    const i3 = i - (src.length - c1.length) - (c1.length - c2.length);
    if (i2 >= 0 && i3 >= 0 && Number.isFinite(e1[i1]) && Number.isFinite(e2[i2]) && Number.isFinite(e3[i3])) {
      out[i] = 3 * e1[i1] - 3 * e2[i2] + e3[i3];
    }
  }
  return out;
}

/** Hull moving average — WMA(2*WMA(n/2) - WMA(n), sqrt(n)). Very responsive
 *  while staying smooth; a favourite for intraday trend filters. */
export function hma(src: readonly number[], period: number): number[] {
  const half = Math.max(1, Math.floor(period / 2));
  const sqrtP = Math.max(1, Math.round(Math.sqrt(period)));
  const wHalf = wma(src, half);
  const wFull = wma(src, period);
  const diff = src.map((_, i) =>
    Number.isFinite(wHalf[i]) && Number.isFinite(wFull[i]) ? 2 * wHalf[i] - wFull[i] : NaN,
  );
  const firstValid = diff.findIndex(Number.isFinite);
  if (firstValid < 0) return nanArray(src.length);
  const smoothed = wma(diff.slice(firstValid), sqrtP);
  const out = nanArray(src.length);
  for (let i = 0; i < smoothed.length; i++) out[i + firstValid] = smoothed[i];
  return out;
}

/** Volume-weighted moving average. */
export function vwma(src: readonly number[], vol: readonly number[], period: number): number[] {
  const n = src.length;
  const out = nanArray(n);
  if (n < period) return out;
  for (let i = period - 1; i < n; i++) {
    let pv = 0;
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) {
      pv += src[j] * vol[j];
      v += vol[j];
    }
    out[i] = v === 0 ? src[i] : pv / v;
  }
  return out;
}

/** Kaufman Adaptive MA — speeds up in trends, slows in noise. */
export function kama(src: readonly number[], period = 10, fast = 2, slow = 30): number[] {
  const n = src.length;
  const out = nanArray(n);
  if (n <= period) return out;
  const fastSC = 2 / (fast + 1);
  const slowSC = 2 / (slow + 1);
  let prev = src[period - 1];
  out[period - 1] = prev;
  for (let i = period; i < n; i++) {
    const change = Math.abs(src[i] - src[i - period]);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) volatility += Math.abs(src[j] - src[j - 1]);
    const er = volatility === 0 ? 0 : change / volatility;
    const sc = (er * (fastSC - slowSC) + slowSC) ** 2;
    prev = prev + sc * (src[i] - prev);
    out[i] = prev;
  }
  return out;
}

/** Zero-lag EMA — de-lagged by extrapolating the momentum of the EMA. */
export function zlema(src: readonly number[], period: number): number[] {
  const lag = Math.floor((period - 1) / 2);
  const adjusted = src.map((v, i) => (i >= lag ? 2 * v - src[i - lag] : NaN));
  const firstValid = adjusted.findIndex(Number.isFinite);
  if (firstValid < 0) return nanArray(src.length);
  const e = ema(adjusted.slice(firstValid), period);
  const out = nanArray(src.length);
  for (let i = 0; i < e.length; i++) out[i + firstValid] = e[i];
  return out;
}

/** Rolling standard deviation (population, matching Bollinger convention). */
export function stdevSeries(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = nanArray(n);
  for (let i = period - 1; i < n; i++) {
    out[i] = stdev(src.slice(i - period + 1, i + 1), false);
  }
  return out;
}

/* ---------------------------------------------------------------------------
   RANGE / TRUE RANGE
   ------------------------------------------------------------------------- */

/** True range: max(h-l, |h-prevClose|, |l-prevClose|). */
export function trueRange(bars: readonly Bar[]): number[] {
  const out = nanArray(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (i === 0) {
      out[i] = b.h - b.l;
      continue;
    }
    const pc = bars[i - 1].c;
    out[i] = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  return out;
}

/** Average true range (Wilder). */
export const atr = (bars: readonly Bar[], period = 14): number[] => rma(trueRange(bars), period);

/** Normalised ATR, as a percentage of close — comparable across instruments. */
export function natr(bars: readonly Bar[], period = 14): number[] {
  const a = atr(bars, period);
  return a.map((v, i) => (Number.isFinite(v) && bars[i].c !== 0 ? (v / bars[i].c) * 100 : NaN));
}

/* ---------------------------------------------------------------------------
   ROLLING EXTREMA
   ------------------------------------------------------------------------- */

export function rollingMax(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = nanArray(n);
  for (let i = period - 1; i < n; i++) {
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (src[j] > m) m = src[j];
    out[i] = m;
  }
  return out;
}

export function rollingMin(src: readonly number[], period: number): number[] {
  const n = src.length;
  const out = nanArray(n);
  for (let i = period - 1; i < n; i++) {
    let m = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (src[j] < m) m = src[j];
    out[i] = m;
  }
  return out;
}

/* ---------------------------------------------------------------------------
   CROSS DETECTION
   ------------------------------------------------------------------------- */

/** True if `a` crossed above `b` on the final bar. */
export function crossedAbove(a: readonly number[], b: readonly number[]): boolean {
  const n = Math.min(a.length, b.length);
  if (n < 2) return false;
  const a1 = a[n - 1];
  const a0 = a[n - 2];
  const b1 = b[n - 1];
  const b0 = b[n - 2];
  if (![a0, a1, b0, b1].every(Number.isFinite)) return false;
  return a0 <= b0 && a1 > b1;
}

export function crossedBelow(a: readonly number[], b: readonly number[]): boolean {
  const n = Math.min(a.length, b.length);
  if (n < 2) return false;
  const a1 = a[n - 1];
  const a0 = a[n - 2];
  const b1 = b[n - 1];
  const b0 = b[n - 2];
  if (![a0, a1, b0, b1].every(Number.isFinite)) return false;
  return a0 >= b0 && a1 < b1;
}

/** Bars since `a` last crossed `b` in either direction; -1 if never. */
export function barsSinceCross(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = n - 1; i >= 1; i--) {
    const above = a[i] > b[i];
    const wasAbove = a[i - 1] > b[i - 1];
    if (Number.isFinite(a[i]) && Number.isFinite(b[i]) && above !== wasAbove) return n - 1 - i;
  }
  return -1;
}

/* ---------------------------------------------------------------------------
   HEIKIN-ASHI — smoothed candles that suppress noise and expose trend runs.
   ------------------------------------------------------------------------- */

export function heikinAshi(bars: readonly Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const haClose = (b.o + b.h + b.l + b.c) / 4;
    const prev = out[i - 1];
    const haOpen = prev ? (prev.o + prev.c) / 2 : (b.o + b.c) / 2;
    out.push({
      t: b.t,
      o: haOpen,
      h: Math.max(b.h, haOpen, haClose),
      l: Math.min(b.l, haOpen, haClose),
      c: haClose,
      v: b.v,
    });
  }
  return out;
}

/** Resample bars to a coarser timeframe by fixed bucket count. */
export function resample(bars: readonly Bar[], factor: number): Bar[] {
  if (factor <= 1) return [...bars];
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i += factor) {
    const chunk = bars.slice(i, i + factor);
    if (!chunk.length) break;
    out.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map((b) => b.h)),
      l: Math.min(...chunk.map((b) => b.l)),
      c: chunk[chunk.length - 1].c,
      v: chunk.reduce((s, b) => s + b.v, 0),
    });
  }
  return out;
}
