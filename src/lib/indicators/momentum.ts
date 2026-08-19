/* ===========================================================================
   Momentum & oscillator family.
   ========================================================================= */

import type { Bar } from '../types';
import { mean } from '../util/math';
import {
  closes, highs, lows, typicalPrice, medianPrice,
  sma, ema, rma, wma, rollingMax, rollingMin, atr,
} from './core';

const nanArray = (n: number): number[] => new Array(n).fill(NaN);

/** Relative Strength Index (Wilder). */
export function rsi(src: readonly number[], period = 14): number[] {
  const n = src.length;
  const out = nanArray(n);
  if (n <= period) return out;
  const gains = nanArray(n);
  const losses = nanArray(n);
  for (let i = 1; i < n; i++) {
    const d = src[i] - src[i - 1];
    gains[i] = d > 0 ? d : 0;
    losses[i] = d < 0 ? -d : 0;
  }
  const g = rma(gains.slice(1), period);
  const l = rma(losses.slice(1), period);
  for (let i = 0; i < g.length; i++) {
    if (!Number.isFinite(g[i]) || !Number.isFinite(l[i])) continue;
    if (l[i] === 0 && g[i] === 0) {
      // No movement in either direction. The usual "zero average loss means
      // RSI 100" convention is wrong here — it would report a motionless
      // instrument (a halted stock, an illiquid name that did not trade) as
      // maximally overbought. With no gains and no losses the honest reading
      // is the neutral midpoint.
      out[i + 1] = 50;
    } else if (l[i] === 0) {
      // Zero average loss with real gains: an unbroken win streak, RSI 100.
      out[i + 1] = 100;
    } else {
      out[i + 1] = 100 - 100 / (1 + g[i] / l[i]);
    }
  }
  return out;
}

/** Connors RSI — blends price RSI, streak RSI and percent-rank of returns.
 *  Built for short-horizon mean reversion; 0-10 is deeply oversold. */
export function connorsRsi(src: readonly number[], rsiP = 3, streakP = 2, rankP = 100): number[] {
  const n = src.length;
  const out = nanArray(n);
  const priceRsi = rsi(src, rsiP);

  const streaks = nanArray(n);
  let streak = 0;
  for (let i = 1; i < n; i++) {
    const d = src[i] - src[i - 1];
    if (d > 0) streak = streak > 0 ? streak + 1 : 1;
    else if (d < 0) streak = streak < 0 ? streak - 1 : -1;
    else streak = 0;
    streaks[i] = streak;
  }
  const streakRsi = rsi(streaks.map((v) => (Number.isFinite(v) ? v : 0)), streakP);

  for (let i = rankP; i < n; i++) {
    const cur = src[i] / src[i - 1] - 1;
    let below = 0;
    for (let j = i - rankP; j < i; j++) {
      const r = src[j] / src[j - 1] - 1;
      if (r < cur) below++;
    }
    const pctRank = (below / rankP) * 100;
    if (Number.isFinite(priceRsi[i]) && Number.isFinite(streakRsi[i])) {
      out[i] = (priceRsi[i] + streakRsi[i] + pctRank) / 3;
    }
  }
  return out;
}

export interface MacdResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

/** MACD. Default 12/26/9. */
export function macd(src: readonly number[], fast = 12, slow = 26, signalP = 9): MacdResult {
  const n = src.length;
  const ef = ema(src, fast);
  const es = ema(src, slow);
  const line = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(ef[i]) && Number.isFinite(es[i])) line[i] = ef[i] - es[i];
  }
  const firstValid = line.findIndex(Number.isFinite);
  const signal = nanArray(n);
  if (firstValid >= 0) {
    const sig = ema(line.slice(firstValid), signalP);
    for (let i = 0; i < sig.length; i++) signal[i + firstValid] = sig[i];
  }
  const histogram = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(line[i]) && Number.isFinite(signal[i])) histogram[i] = line[i] - signal[i];
  }
  return { macd: line, signal, histogram };
}

export interface StochResult {
  k: number[];
  d: number[];
}

/** Stochastic oscillator (%K smoothed, %D = SMA of %K). */
export function stochastic(bars: readonly Bar[], period = 14, kSmooth = 3, dSmooth = 3): StochResult {
  const n = bars.length;
  const hh = rollingMax(highs(bars), period);
  const ll = rollingMin(lows(bars), period);
  const raw = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(hh[i]) || !Number.isFinite(ll[i])) continue;
    const range = hh[i] - ll[i];
    raw[i] = range === 0 ? 50 : ((bars[i].c - ll[i]) / range) * 100;
  }
  const firstValid = raw.findIndex(Number.isFinite);
  const k = nanArray(n);
  if (firstValid >= 0) {
    const ks = sma(raw.slice(firstValid), kSmooth);
    for (let i = 0; i < ks.length; i++) k[i + firstValid] = ks[i];
  }
  const kFirst = k.findIndex(Number.isFinite);
  const d = nanArray(n);
  if (kFirst >= 0) {
    const ds = sma(k.slice(kFirst), dSmooth);
    for (let i = 0; i < ds.length; i++) d[i + kFirst] = ds[i];
  }
  return { k, d };
}

/** Stochastic RSI — stochastic applied to the RSI series. Far more sensitive
 *  than raw RSI; useful for timing entries inside an established trend. */
export function stochRsi(src: readonly number[], rsiP = 14, stochP = 14, kS = 3, dS = 3): StochResult {
  const r = rsi(src, rsiP);
  const clean = r.filter(Number.isFinite);
  const offset = src.length - clean.length;
  const hh = rollingMax(clean, stochP);
  const ll = rollingMin(clean, stochP);
  const raw: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    if (!Number.isFinite(hh[i]) || !Number.isFinite(ll[i])) {
      raw.push(NaN);
      continue;
    }
    const range = hh[i] - ll[i];
    raw.push(range === 0 ? 50 : ((clean[i] - ll[i]) / range) * 100);
  }
  const rawFirst = raw.findIndex(Number.isFinite);
  const kLocal = rawFirst >= 0 ? sma(raw.slice(rawFirst), kS) : [];
  const k = nanArray(src.length);
  for (let i = 0; i < kLocal.length; i++) k[i + rawFirst + offset] = kLocal[i];
  const kFirst = k.findIndex(Number.isFinite);
  const d = nanArray(src.length);
  if (kFirst >= 0) {
    const ds = sma(k.slice(kFirst), dS);
    for (let i = 0; i < ds.length; i++) d[i + kFirst] = ds[i];
  }
  return { k, d };
}

/** Commodity Channel Index. ±100 marks the edges of the normal band. */
export function cci(bars: readonly Bar[], period = 20): number[] {
  const n = bars.length;
  const tp = typicalPrice(bars);
  const ma = sma(tp, period);
  const out = nanArray(n);
  for (let i = period - 1; i < n; i++) {
    if (!Number.isFinite(ma[i])) continue;
    let dev = 0;
    for (let j = i - period + 1; j <= i; j++) dev += Math.abs(tp[j] - ma[i]);
    const meanDev = dev / period;
    out[i] = meanDev === 0 ? 0 : (tp[i] - ma[i]) / (0.015 * meanDev);
  }
  return out;
}

/** Williams %R — inverted stochastic, range [-100, 0]. */
export function williamsR(bars: readonly Bar[], period = 14): number[] {
  const n = bars.length;
  const hh = rollingMax(highs(bars), period);
  const ll = rollingMin(lows(bars), period);
  const out = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(hh[i]) || !Number.isFinite(ll[i])) continue;
    const range = hh[i] - ll[i];
    out[i] = range === 0 ? -50 : ((hh[i] - bars[i].c) / range) * -100;
  }
  return out;
}

/** Rate of change, in percent. */
export function roc(src: readonly number[], period = 12): number[] {
  const out = nanArray(src.length);
  for (let i = period; i < src.length; i++) {
    const base = src[i - period];
    if (base !== 0) out[i] = ((src[i] - base) / base) * 100;
  }
  return out;
}

/** Absolute momentum: price now minus price `period` bars ago. */
export function momentum(src: readonly number[], period = 10): number[] {
  const out = nanArray(src.length);
  for (let i = period; i < src.length; i++) out[i] = src[i] - src[i - period];
  return out;
}

/** TRIX — triple-smoothed EMA rate of change; a very clean trend oscillator. */
export function trix(src: readonly number[], period = 15, signalP = 9): MacdResult {
  const e1 = ema(src, period);
  const c1 = e1.filter(Number.isFinite);
  const e2 = ema(c1, period);
  const c2 = e2.filter(Number.isFinite);
  const e3 = ema(c2, period);

  const out = nanArray(src.length);
  const offset = src.length - e3.length;
  for (let i = 1; i < e3.length; i++) {
    if (Number.isFinite(e3[i]) && Number.isFinite(e3[i - 1]) && e3[i - 1] !== 0) {
      out[i + offset] = ((e3[i] - e3[i - 1]) / e3[i - 1]) * 10000;
    }
  }
  const firstValid = out.findIndex(Number.isFinite);
  const signal = nanArray(src.length);
  if (firstValid >= 0) {
    const sig = ema(out.slice(firstValid), signalP);
    for (let i = 0; i < sig.length; i++) signal[i + firstValid] = sig[i];
  }
  const histogram = out.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN,
  );
  return { macd: out, signal, histogram };
}

/** Know Sure Thing — Pring's weighted sum of four smoothed ROCs. */
export function kst(src: readonly number[]): MacdResult {
  const n = src.length;
  const r1 = sma(roc(src, 10), 10);
  const r2 = sma(roc(src, 15), 10);
  const r3 = sma(roc(src, 20), 10);
  const r4 = sma(roc(src, 30), 15);
  const line = nanArray(n);
  for (let i = 0; i < n; i++) {
    if ([r1[i], r2[i], r3[i], r4[i]].every(Number.isFinite)) {
      line[i] = r1[i] * 1 + r2[i] * 2 + r3[i] * 3 + r4[i] * 4;
    }
  }
  const firstValid = line.findIndex(Number.isFinite);
  const signal = nanArray(n);
  if (firstValid >= 0) {
    const s = sma(line.slice(firstValid), 9);
    for (let i = 0; i < s.length; i++) signal[i + firstValid] = s[i];
  }
  const histogram = line.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN,
  );
  return { macd: line, signal, histogram };
}

/** Ultimate Oscillator (Williams) — blends 7/14/28 buying pressure so it is
 *  far less prone to the false divergences of single-period oscillators. */
export function ultimateOscillator(bars: readonly Bar[], p1 = 7, p2 = 14, p3 = 28): number[] {
  const n = bars.length;
  const out = nanArray(n);
  const bp = nanArray(n);
  const tr = nanArray(n);
  for (let i = 1; i < n; i++) {
    const trueLow = Math.min(bars[i].l, bars[i - 1].c);
    bp[i] = bars[i].c - trueLow;
    tr[i] = Math.max(bars[i].h, bars[i - 1].c) - trueLow;
  }
  const maxP = Math.max(p1, p2, p3);
  for (let i = maxP; i < n; i++) {
    const avg = (p: number): number => {
      let sbp = 0;
      let str = 0;
      for (let j = i - p + 1; j <= i; j++) {
        sbp += bp[j];
        str += tr[j];
      }
      // A zero true range over the window means no trading activity to
      // measure; NaN propagates and the vote abstains rather than reading 0
      // (which the scale would interpret as maximally oversold).
      return str === 0 ? NaN : sbp / str;
    };
    const composite = (4 * avg(p1) + 2 * avg(p2) + avg(p3)) / 7;
    out[i] = Number.isFinite(composite) ? composite * 100 : NaN;
  }
  return out;
}

/** Awesome Oscillator — 5/34 SMA spread of median price. */
export function awesomeOscillator(bars: readonly Bar[]): number[] {
  const mp = medianPrice(bars);
  const f = sma(mp, 5);
  const s = sma(mp, 34);
  return mp.map((_, i) => (Number.isFinite(f[i]) && Number.isFinite(s[i]) ? f[i] - s[i] : NaN));
}

/** Percentage Price Oscillator — MACD normalised, so comparable across names. */
export function ppo(src: readonly number[], fast = 12, slow = 26, signalP = 9): MacdResult {
  const n = src.length;
  const ef = ema(src, fast);
  const es = ema(src, slow);
  const line = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(ef[i]) && Number.isFinite(es[i]) && es[i] !== 0) {
      line[i] = ((ef[i] - es[i]) / es[i]) * 100;
    }
  }
  const firstValid = line.findIndex(Number.isFinite);
  const signal = nanArray(n);
  if (firstValid >= 0) {
    const sig = ema(line.slice(firstValid), signalP);
    for (let i = 0; i < sig.length; i++) signal[i + firstValid] = sig[i];
  }
  const histogram = line.map((v, i) =>
    Number.isFinite(v) && Number.isFinite(signal[i]) ? v - signal[i] : NaN,
  );
  return { macd: line, signal, histogram };
}

/** Chande Momentum Oscillator — range [-100, 100]. */
export function cmo(src: readonly number[], period = 14): number[] {
  const n = src.length;
  const out = nanArray(n);
  for (let i = period; i < n; i++) {
    let up = 0;
    let down = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = src[j] - src[j - 1];
      if (d > 0) up += d;
      else down -= d;
    }
    const total = up + down;
    out[i] = total === 0 ? 0 : ((up - down) / total) * 100;
  }
  return out;
}

/** Relative Vigour Index — where the close sits within the bar's range,
 *  smoothed. Confirms momentum with the body rather than just the close. */
export function rvi(bars: readonly Bar[], period = 10): StochResult {
  const n = bars.length;
  const num = nanArray(n);
  const den = nanArray(n);
  for (let i = 0; i < n; i++) {
    num[i] = bars[i].c - bars[i].o;
    den[i] = bars[i].h - bars[i].l;
  }
  const sNum = sma(num, period);
  const sDen = sma(den, period);
  const k = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(sNum[i]) && Number.isFinite(sDen[i]) && sDen[i] !== 0) {
      k[i] = sNum[i] / sDen[i];
    }
  }
  const kFirst = k.findIndex(Number.isFinite);
  const d = nanArray(n);
  if (kFirst >= 0) {
    const ds = wma(k.slice(kFirst), 4);
    for (let i = 0; i < ds.length; i++) d[i + kFirst] = ds[i];
  }
  return { k, d };
}

/** Fisher Transform — sharpens turning points by gaussianising price. */
export function fisherTransform(bars: readonly Bar[], period = 9): number[] {
  const n = bars.length;
  const mp = medianPrice(bars);
  const hh = rollingMax(mp, period);
  const ll = rollingMin(mp, period);
  const out = nanArray(n);
  let value = 0;
  let fish = 0;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(hh[i]) || !Number.isFinite(ll[i])) continue;
    const range = hh[i] - ll[i];
    const raw = range === 0 ? 0 : (2 * ((mp[i] - ll[i]) / range) - 1);
    value = 0.33 * 2 * raw + 0.67 * value;
    value = Math.max(-0.999, Math.min(0.999, value));
    fish = 0.5 * Math.log((1 + value) / (1 - value)) + 0.5 * fish;
    out[i] = fish;
  }
  return out;
}

/** Coppock Curve — a long-horizon bottom-spotter (monthly by design, but
 *  informative on dailies for position-horizon votes). */
export function coppock(src: readonly number[]): number[] {
  const n = src.length;
  const r14 = roc(src, 14);
  const r11 = roc(src, 11);
  const combined = nanArray(n);
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(r14[i]) && Number.isFinite(r11[i])) combined[i] = r14[i] + r11[i];
  }
  const firstValid = combined.findIndex(Number.isFinite);
  const out = nanArray(n);
  if (firstValid < 0) return out;
  const w = wma(combined.slice(firstValid), 10);
  for (let i = 0; i < w.length; i++) out[i + firstValid] = w[i];
  return out;
}

/** Efficiency ratio (Kaufman) — net move over summed absolute moves. Near 1
 *  means a clean directional run, near 0 means chop. */
export function efficiencyRatio(src: readonly number[], period = 20): number[] {
  const n = src.length;
  const out = nanArray(n);
  for (let i = period; i < n; i++) {
    const net = Math.abs(src[i] - src[i - period]);
    let path = 0;
    for (let j = i - period + 1; j <= i; j++) path += Math.abs(src[j] - src[j - 1]);
    out[i] = path === 0 ? 0 : net / path;
  }
  return out;
}

/** Relative strength versus a benchmark series, normalised to 100 at start. */
export function relativeStrength(src: readonly number[], bench: readonly number[]): number[] {
  const n = Math.min(src.length, bench.length);
  const out = nanArray(src.length);
  const offA = src.length - n;
  const offB = bench.length - n;
  if (n < 2) return out;
  const base = src[offA] / bench[offB];
  for (let i = 0; i < n; i++) {
    const b = bench[i + offB];
    if (b !== 0 && base !== 0) out[i + offA] = (src[i + offA] / b / base) * 100;
  }
  return out;
}

/** Squeeze Momentum (Lazybear) — momentum of price vs its Donchian/SMA mean,
 *  linear-regression smoothed. Pairs with the Bollinger/Keltner squeeze. */
export function squeezeMomentum(bars: readonly Bar[], period = 20): number[] {
  const n = bars.length;
  const c = closes(bars);
  const hh = rollingMax(highs(bars), period);
  const ll = rollingMin(lows(bars), period);
  const basis = sma(c, period);
  const out = nanArray(n);
  for (let i = period - 1; i < n; i++) {
    if (![hh[i], ll[i], basis[i]].every(Number.isFinite)) continue;
    const mid = ((hh[i] + ll[i]) / 2 + basis[i]) / 2;
    out[i] = c[i] - mid;
  }
  return out;
}

/** Choppiness Index — 100*log10(sum(TR)/range)/log10(n). >61.8 chop,
 *  <38.2 trend. The single best regime gate in the library. */
export function choppinessIndex(bars: readonly Bar[], period = 14): number[] {
  const n = bars.length;
  const out = nanArray(n);
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      tr.push(bars[0].h - bars[0].l);
      continue;
    }
    const pc = bars[i - 1].c;
    tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - pc), Math.abs(bars[i].l - pc)));
  }
  const denom = Math.log10(period);
  for (let i = period; i < n; i++) {
    let sumTr = 0;
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      sumTr += tr[j];
      if (bars[j].h > hi) hi = bars[j].h;
      if (bars[j].l < lo) lo = bars[j].l;
    }
    const range = hi - lo;
    if (range > 0 && sumTr > 0) out[i] = (100 * Math.log10(sumTr / range)) / denom;
  }
  return out;
}
