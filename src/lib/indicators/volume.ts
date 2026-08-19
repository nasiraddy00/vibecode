/* ===========================================================================
   Volume, money-flow and participation.

   Volume is where intent shows. Price can be pushed by anyone; sustained
   volume at a level is the footprint of size.
   ========================================================================= */

import type { Bar } from '../types';
import { mean, stdev, linreg } from '../util/math';
import {
  closes, highs, lows, volumes, typicalPrice,
  sma, ema, rma, last, atr,
} from './core';

const nanArray = (n: number): number[] => new Array(n).fill(NaN);

/** On-Balance Volume — cumulative signed volume. */
export function obv(bars: readonly Bar[]): number[] {
  const out = nanArray(bars.length);
  let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) {
      out[i] = 0;
      continue;
    }
    const d = bars[i].c - bars[i - 1].c;
    acc += d > 0 ? bars[i].v : d < 0 ? -bars[i].v : 0;
    out[i] = acc;
  }
  return out;
}

/** Accumulation/Distribution Line (Chaikin). Uses intrabar position, so it
 *  reacts to closes near the high even on a down day. */
export function adLine(bars: readonly Bar[]): number[] {
  const out = nanArray(bars.length);
  let acc = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const range = b.h - b.l;
    const mfm = range === 0 ? 0 : ((b.c - b.l) - (b.h - b.c)) / range;
    acc += mfm * b.v;
    out[i] = acc;
  }
  return out;
}

/** Chaikin Money Flow (a.k.a. CMF / Chaikin Oscillator input). */
export function chaikinMoneyFlow(bars: readonly Bar[], period = 20): number[] {
  const n = bars.length;
  const out = nanArray(n);
  for (let i = period - 1; i < n; i++) {
    let mfv = 0;
    let vol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const b = bars[j];
      const range = b.h - b.l;
      const mfm = range === 0 ? 0 : ((b.c - b.l) - (b.h - b.c)) / range;
      mfv += mfm * b.v;
      vol += b.v;
    }
    out[i] = vol === 0 ? 0 : mfv / vol;
  }
  return out;
}

/** Chaikin Oscillator — MACD of the A/D line. */
export function chaikinOscillator(bars: readonly Bar[], fast = 3, slow = 10): number[] {
  const ad = adLine(bars);
  const f = ema(ad, fast);
  const s = ema(ad, slow);
  return ad.map((_, i) => (Number.isFinite(f[i]) && Number.isFinite(s[i]) ? f[i] - s[i] : NaN));
}

/** Money Flow Index — RSI weighted by volume; 80/20 are the classic bands. */
export function mfi(bars: readonly Bar[], period = 14): number[] {
  const n = bars.length;
  const out = nanArray(n);
  const tp = typicalPrice(bars);
  for (let i = period; i < n; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const flow = tp[j] * bars[j].v;
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

/** Force Index (Elder) — price change x volume, smoothed. */
export function forceIndex(bars: readonly Bar[], period = 13): number[] {
  const n = bars.length;
  const raw = nanArray(n);
  for (let i = 1; i < n; i++) raw[i] = (bars[i].c - bars[i - 1].c) * bars[i].v;
  const clean = raw.slice(1);
  const e = ema(clean, period);
  const out = nanArray(n);
  for (let i = 0; i < e.length; i++) out[i + 1] = e[i];
  return out;
}

/** Ease of Movement — how far price moved per unit of volume. */
export function easeOfMovement(bars: readonly Bar[], period = 14): number[] {
  const n = bars.length;
  const raw = nanArray(n);
  for (let i = 1; i < n; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    const distance = (b.h + b.l) / 2 - (prev.h + prev.l) / 2;
    const range = b.h - b.l;
    const boxRatio = range === 0 || b.v === 0 ? 0 : b.v / 100000000 / range;
    raw[i] = boxRatio === 0 ? 0 : distance / boxRatio;
  }
  const s = sma(raw.slice(1), period);
  const out = nanArray(n);
  for (let i = 0; i < s.length; i++) out[i + 1] = s[i];
  return out;
}

/** Session-anchored VWAP with standard-deviation bands. `anchorEvery` bars
 *  restarts the accumulation (e.g. 390 one-minute bars = one RTH session). */
export interface VwapResult {
  vwap: number[];
  upper1: number[];
  lower1: number[];
  upper2: number[];
  lower2: number[];
}

export function vwap(bars: readonly Bar[], anchorEvery = 0): VwapResult {
  const n = bars.length;
  const vwapS = nanArray(n);
  const upper1 = nanArray(n);
  const lower1 = nanArray(n);
  const upper2 = nanArray(n);
  const lower2 = nanArray(n);

  let cumPV = 0;
  let cumV = 0;
  let cumPV2 = 0;
  const tp = typicalPrice(bars);

  for (let i = 0; i < n; i++) {
    if (anchorEvery > 0 && i % anchorEvery === 0) {
      cumPV = 0;
      cumV = 0;
      cumPV2 = 0;
    }
    const v = bars[i].v || 1;
    cumPV += tp[i] * v;
    cumPV2 += tp[i] * tp[i] * v;
    cumV += v;

    const vw = cumV === 0 ? tp[i] : cumPV / cumV;
    vwapS[i] = vw;
    // Volume-weighted variance around VWAP.
    const varr = cumV === 0 ? 0 : Math.max(0, cumPV2 / cumV - vw * vw);
    const sd = Math.sqrt(varr);
    upper1[i] = vw + sd;
    lower1[i] = vw - sd;
    upper2[i] = vw + 2 * sd;
    lower2[i] = vw - 2 * sd;
  }
  return { vwap: vwapS, upper1, lower1, upper2, lower2 };
}

/** Rolling VWAP over a fixed lookback, with standard-deviation bands.
 *
 *  The session-anchored VWAP above is the right construction for intraday
 *  bars. On a DAILY series it is the wrong tool: accumulating from the first
 *  bar of a multi-year history produces a "VWAP" hundreds of percent below
 *  spot for any instrument that has trended, which is arithmetically true and
 *  analytically worthless. Traders working daily charts use a rolling or
 *  event-anchored VWAP instead, which is what this provides. */
export function rollingVwap(bars: readonly Bar[], period = 20): VwapResult {
  const n = bars.length;
  const tp = typicalPrice(bars);
  const vwapS = nanArray(n);
  const upper1 = nanArray(n);
  const lower1 = nanArray(n);
  const upper2 = nanArray(n);
  const lower2 = nanArray(n);

  for (let i = period - 1; i < n; i++) {
    let pv = 0;
    let pv2 = 0;
    let vol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const v = bars[j].v || 1;
      pv += tp[j] * v;
      pv2 += tp[j] * tp[j] * v;
      vol += v;
    }
    const vw = vol === 0 ? tp[i] : pv / vol;
    const varr = vol === 0 ? 0 : Math.max(0, pv2 / vol - vw * vw);
    const sd = Math.sqrt(varr);
    vwapS[i] = vw;
    upper1[i] = vw + sd;
    lower1[i] = vw - sd;
    upper2[i] = vw + 2 * sd;
    lower2[i] = vw - 2 * sd;
  }
  return { vwap: vwapS, upper1, lower1, upper2, lower2 };
}

/** Relative volume: today's volume against the average of the last `period`. */
export function relativeVolume(bars: readonly Bar[], period = 20): number {
  if (bars.length < period + 1) return NaN;
  const hist = bars.slice(-(period + 1), -1).map((b) => b.v);
  const avg = mean(hist);
  return avg === 0 ? NaN : bars[bars.length - 1].v / avg;
}

/** Volume trend: OLS slope of volume, normalised — is participation growing? */
export function volumeTrend(bars: readonly Bar[], period = 20): number {
  const v = bars.slice(-period).map((b) => b.v);
  if (v.length < 5) return 0;
  const { slope } = linreg(v);
  const avg = mean(v);
  return avg === 0 ? 0 : (slope * period) / avg;
}

/** Volume-price confirmation: correlation of signed volume with returns.
 *  Positive = volume expands on up moves (healthy trend). */
export function volumePriceConfirmation(bars: readonly Bar[], period = 20): number {
  const seg = bars.slice(-(period + 1));
  if (seg.length < 6) return 0;
  const rets: number[] = [];
  const vols: number[] = [];
  for (let i = 1; i < seg.length; i++) {
    const prev = seg[i - 1].c;
    if (prev === 0) continue;
    rets.push(seg[i].c / prev - 1);
    vols.push(seg[i].v);
  }
  const avgV = mean(vols);
  if (avgV === 0) return 0;
  // Correlate |return| direction with normalised volume.
  let acc = 0;
  for (let i = 0; i < rets.length; i++) {
    acc += Math.sign(rets[i]) * (vols[i] / avgV - 1);
  }
  return Math.max(-1, Math.min(1, acc / rets.length));
}

export interface VolumeProfileLevel {
  price: number;
  volume: number;
  /** Share of total volume in the window. */
  share: number;
}

export interface VolumeProfile {
  levels: VolumeProfileLevel[];
  /** Point of control: the price with the most traded volume. */
  poc: number;
  /** Value-area high/low bounding 70% of volume around the POC. */
  vah: number;
  val: number;
  /** Where price sits relative to the value area. */
  position: 'above_value' | 'in_value' | 'below_value';
}

/** Volume-by-price profile. Distributes each bar's volume evenly across the
 *  buckets its range covers — a reasonable proxy when tick data is absent. */
export function volumeProfile(bars: readonly Bar[], buckets = 40): VolumeProfile {
  const empty: VolumeProfile = {
    levels: [], poc: NaN, vah: NaN, val: NaN, position: 'in_value',
  };
  if (bars.length < 5) return empty;

  let hi = -Infinity;
  let lo = Infinity;
  for (const b of bars) {
    if (b.h > hi) hi = b.h;
    if (b.l < lo) lo = b.l;
  }
  if (!Number.isFinite(hi) || !Number.isFinite(lo) || hi <= lo) return empty;

  const step = (hi - lo) / buckets;
  const acc = new Array(buckets).fill(0);

  for (const b of bars) {
    const startIdx = Math.max(0, Math.min(buckets - 1, Math.floor((b.l - lo) / step)));
    const endIdx = Math.max(0, Math.min(buckets - 1, Math.floor((b.h - lo) / step)));
    const span = endIdx - startIdx + 1;
    const per = b.v / span;
    for (let k = startIdx; k <= endIdx; k++) acc[k] += per;
  }

  const total = acc.reduce((s, v) => s + v, 0);
  const levels: VolumeProfileLevel[] = acc.map((v, i) => ({
    price: lo + step * (i + 0.5),
    volume: v,
    share: total === 0 ? 0 : v / total,
  }));

  let pocIdx = 0;
  for (let i = 1; i < acc.length; i++) if (acc[i] > acc[pocIdx]) pocIdx = i;

  // Grow outward from the POC until 70% of volume is enclosed.
  let lower = pocIdx;
  let upper = pocIdx;
  let captured = acc[pocIdx];
  const target = total * 0.7;
  while (captured < target && (lower > 0 || upper < buckets - 1)) {
    const nextDown = lower > 0 ? acc[lower - 1] : -1;
    const nextUp = upper < buckets - 1 ? acc[upper + 1] : -1;
    if (nextUp >= nextDown) {
      upper++;
      captured += Math.max(0, nextUp);
    } else {
      lower--;
      captured += Math.max(0, nextDown);
    }
  }

  const poc = levels[pocIdx].price;
  const val = levels[lower].price;
  const vah = levels[upper].price;
  const price = last(closes(bars));
  const position = price > vah ? 'above_value' : price < val ? 'below_value' : 'in_value';

  return { levels, poc, vah, val, position };
}

/** Klinger Volume Oscillator — volume force with trend direction. */
export function klinger(bars: readonly Bar[], fast = 34, slow = 55, signalP = 13): {
  kvo: number[];
  signal: number[];
} {
  const n = bars.length;
  const vf = nanArray(n);
  let trend = 0;
  let cumMeasure = 0;

  for (let i = 1; i < n; i++) {
    const b = bars[i];
    const prev = bars[i - 1];
    const hlc = b.h + b.l + b.c;
    const prevHlc = prev.h + prev.l + prev.c;
    const newTrend = hlc > prevHlc ? 1 : -1;
    const dm = b.h - b.l;
    if (newTrend !== trend) {
      cumMeasure = dm;
      trend = newTrend;
    } else {
      cumMeasure += dm;
    }
    const cm = cumMeasure === 0 ? dm : cumMeasure;
    vf[i] = cm === 0 ? 0 : b.v * trend * Math.abs((2 * dm) / cm - 1) * 100;
  }

  const clean = vf.slice(1).map((v) => (Number.isFinite(v) ? v : 0));
  const f = ema(clean, fast);
  const s = ema(clean, slow);
  const kvo = nanArray(n);
  for (let i = 0; i < clean.length; i++) {
    if (Number.isFinite(f[i]) && Number.isFinite(s[i])) kvo[i + 1] = f[i] - s[i];
  }
  const kFirst = kvo.findIndex(Number.isFinite);
  const signal = nanArray(n);
  if (kFirst >= 0) {
    const sg = ema(kvo.slice(kFirst), signalP);
    for (let i = 0; i < sg.length; i++) signal[i + kFirst] = sg[i];
  }
  return { kvo, signal };
}

/** Volume-Weighted MACD: MACD computed on VWAP-like weighted price. */
export function volumeWeightedMacd(bars: readonly Bar[], fast = 12, slow = 26): number[] {
  const n = bars.length;
  const weighted = nanArray(n);
  for (let i = 0; i < n; i++) {
    weighted[i] = typicalPrice(bars)[i];
  }
  const f = ema(weighted, fast);
  const s = ema(weighted, slow);
  return weighted.map((_, i) => (Number.isFinite(f[i]) && Number.isFinite(s[i]) ? f[i] - s[i] : NaN));
}

/** Dollar volume (turnover) — liquidity screen. A signal is untradeable if
 *  the name does not turn over enough dollars to absorb the position. */
export function dollarVolume(bars: readonly Bar[], period = 20): number {
  const seg = bars.slice(-period);
  if (!seg.length) return NaN;
  return mean(seg.map((b) => b.c * b.v));
}
