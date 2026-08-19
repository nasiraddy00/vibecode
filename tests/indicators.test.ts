import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bar } from '@/lib/types';
import {
  sma, ema, rma, wma, hma, atr, trueRange, last, rollingMax, rollingMin,
  crossedAbove, crossedBelow, heikinAshi,
} from '@/lib/indicators/core';
import {
  rsi, macd, stochastic, cci, williamsR, roc, choppinessIndex, efficiencyRatio,
} from '@/lib/indicators/momentum';
import { adx, aroon, superTrend, regressionChannel, trendAlignment } from '@/lib/indicators/trend';
import { bollinger, keltner, donchian, historicalVol, ulcerIndex } from '@/lib/indicators/volatility';
import { obv, mfi, volumeProfile, rollingVwap, relativeVolume } from '@/lib/indicators/volume';
import { findSwings, marketStructure, pivots, gapAnalysis, closeStreak } from '@/lib/indicators/patterns';

const close = (n: number): number => Math.round(n * 1e8) / 1e8;
const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

const flatBars = (n: number, price = 100): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ t: i * 86400000, o: price, h: price + 1, l: price - 1, c: price, v: 1000 }));

const trendBars = (n: number, step = 1): Bar[] =>
  Array.from({ length: n }, (_, i) => ({
    t: i * 86400000, o: 100 + i * step, h: 100 + i * step + 1,
    l: 100 + i * step - 0.5, c: 100 + i * step + 0.8, v: 1000,
  }));

/* --- moving averages ---------------------------------------------------- */

test('sma computes the arithmetic mean of the window', () => {
  const s = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(last(sma(s, 3)), 9);
  assert.equal(last(sma(s, 5)), 8);
  assert.equal(last(sma(s, 10)), 5.5);
});

test('sma is NaN-padded to the input length', () => {
  const out = sma([1, 2, 3, 4, 5], 3);
  assert.equal(out.length, 5);
  assert.ok(Number.isNaN(out[0]) && Number.isNaN(out[1]));
  assert.equal(out[2], 2);
});

test('wma weights the most recent bar heaviest', () => {
  // weights 1,2,3 over [8,9,10] = (8 + 18 + 30) / 6
  assert.ok(near(last(wma([1,2,3,4,5,6,7,8,9,10], 3)), 56 / 6));
});

test("rma follows Wilder's recursion, not an EMA of the same period", () => {
  const r = rma([1,2,3,4,5,6,7,8,9,10], 3);
  // seed = mean(1,2,3) = 2; then (prev*(p-1) + x)/p
  assert.ok(near(r[3], (2 * 2 + 4) / 3));
  assert.ok(near(r[4], (2 * ((2 * 2 + 4) / 3) + 5) / 3));
  // and it is materially different from an EMA(3)
  assert.notEqual(close(last(r)), close(last(ema([1,2,3,4,5,6,7,8,9,10], 3))));
});

test('ema converges toward a constant series', () => {
  const out = ema(new Array(60).fill(42), 10);
  assert.ok(near(last(out), 42, 1e-9));
});

test('hma returns finite values and tracks a trend', () => {
  const rising = Array.from({ length: 80 }, (_, i) => 100 + i);
  const h = hma(rising, 21);
  assert.ok(Number.isFinite(last(h)));
  assert.ok(last(h) > h[h.length - 10]);
});

/* --- range & volatility -------------------------------------------------- */

test('trueRange accounts for gaps beyond the bar range', () => {
  const bars: Bar[] = [
    { t: 0, o: 100, h: 101, l: 99, c: 100, v: 1 },
    { t: 1, o: 110, h: 112, l: 109, c: 111, v: 1 },
  ];
  // |112 - 100| = 12 exceeds the 3-point intrabar range
  assert.equal(last(trueRange(bars)), 12);
});

test('atr equals the constant range when every bar is identical', () => {
  assert.ok(near(last(atr(flatBars(40), 14)), 2));
});

test('historical volatility of a constant series is zero', () => {
  assert.ok(near(last(historicalVol(new Array(60).fill(100), 20)), 0));
});

test('ulcer index is zero for a monotonically rising series', () => {
  const rising = Array.from({ length: 40 }, (_, i) => 100 + i);
  assert.ok(near(last(ulcerIndex(rising, 14)), 0, 1e-9));
});

/* --- oscillators ---------------------------------------------------------- */

test('rsi saturates at 100 and 0 on monotonic series', () => {
  const up = Array.from({ length: 40 }, (_, i) => 100 + i);
  const down = Array.from({ length: 40 }, (_, i) => 100 - i);
  assert.equal(last(rsi(up, 14)), 100);
  assert.equal(last(rsi(down, 14)), 0);
});

test('rsi sits near 50 on an alternating series', () => {
  const alt = Array.from({ length: 80 }, (_, i) => 100 + (i % 2 === 0 ? 1 : -1));
  const v = last(rsi(alt, 14));
  assert.ok(v > 40 && v < 60, `expected ~50, got ${v}`);
});

test('rsi is bounded in [0, 100] across random walks', () => {
  let seed = 7;
  const rand = (): number => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const walk = [100];
  for (let i = 1; i < 300; i++) walk.push(Math.max(1, walk[i - 1] * (1 + (rand() - 0.5) * 0.08)));
  for (const v of rsi(walk, 14)) {
    if (Number.isFinite(v)) assert.ok(v >= 0 && v <= 100, `RSI out of bounds: ${v}`);
  }
});

test('macd histogram is positive in a compounding uptrend', () => {
  const up = Array.from({ length: 120 }, (_, i) => 100 * 1.01 ** i);
  assert.ok(last(macd(up).histogram) > 0);
});

test('stochastic pins to 100 when the close is the period high', () => {
  const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({
    t: i, o: 10, h: 10 + i, l: 5, c: 10 + i, v: 1,
  }));
  assert.ok(near(last(stochastic(bars, 14, 1, 1).k), 100, 1e-9));
});

test('williams %R is bounded in [-100, 0]', () => {
  for (const v of williamsR(trendBars(60), 14)) {
    if (Number.isFinite(v)) assert.ok(v >= -100 && v <= 0);
  }
});

test('roc measures percentage change over the lookback', () => {
  const s = [100, 100, 100, 100, 100, 110];
  assert.ok(near(last(roc(s, 5)), 10));
});

test('choppiness is low in a clean trend and high in a range', () => {
  const trend = last(choppinessIndex(trendBars(80, 2), 14));
  const range = last(choppinessIndex(flatBars(80), 14));
  assert.ok(trend < range, `trend ${trend} should be below range ${range}`);
});

test('efficiency ratio approaches 1 for a straight line', () => {
  const straight = Array.from({ length: 60 }, (_, i) => 100 + i);
  assert.ok(near(last(efficiencyRatio(straight, 20)), 1, 1e-9));
});

/* --- trend ---------------------------------------------------------------- */

test('adx is high and +DI dominates in a clean uptrend', () => {
  const a = adx(trendBars(90), 14);
  assert.ok(last(a.adx) > 40, `ADX was ${last(a.adx)}`);
  assert.ok(last(a.plusDi) > last(a.minusDi));
});

test('adx +DI/-DI reverse in a clean downtrend', () => {
  const down = trendBars(90, -1);
  const a = adx(down, 14);
  assert.ok(last(a.minusDi) > last(a.plusDi));
});

test('aroon oscillator is positive when highs are recent', () => {
  assert.ok(last(aroon(trendBars(60), 25).oscillator) > 0);
});

test('superTrend flips direction and its stop trails behind price', () => {
  const st = superTrend(trendBars(80), 10, 3);
  assert.equal(last(st.direction), 1);
  // In an uptrend the trailing stop must sit below the last close.
  assert.ok(last(st.trend) < trendBars(80)[79].c);
});

test('regression channel reports a positive slope and high R2 on a line', () => {
  const straight = Array.from({ length: 80 }, (_, i) => 100 + i);
  const rc = regressionChannel(straight, 60);
  assert.ok(rc.slope > 0);
  assert.ok(rc.r2 > 0.99);
});

test('trend alignment is positive above a rising stack, negative below', () => {
  const up = Array.from({ length: 260 }, (_, i) => 100 + i);
  const down = Array.from({ length: 260 }, (_, i) => 400 - i);
  assert.ok(trendAlignment(up).score > 0.5);
  assert.ok(trendAlignment(down).score < -0.5);
});

/* --- bands ---------------------------------------------------------------- */

test('bollinger bands collapse onto the mean for a constant series', () => {
  const bb = bollinger(new Array(50).fill(100), 20, 2);
  assert.ok(near(last(bb.upper), 100));
  assert.ok(near(last(bb.lower), 100));
  assert.ok(near(last(bb.width), 0));
});

test('bollinger %B exceeds 1 when price closes above the upper band', () => {
  const s = [...new Array(30).fill(100), 140];
  assert.ok(last(bollinger(s, 20, 2).percentB) > 1);
});

test('donchian channel equals the rolling extremes', () => {
  const bars = trendBars(60);
  const dc = donchian(bars, 20);
  assert.ok(near(last(dc.upper), last(rollingMax(bars.map((b) => b.h), 20))));
  assert.ok(near(last(dc.lower), last(rollingMin(bars.map((b) => b.l), 20))));
});

test('keltner channel is centred on the EMA', () => {
  const bars = flatBars(60);
  const kc = keltner(bars, 20, 2, 10);
  assert.ok(near(last(kc.middle), 100, 1e-6));
});

/* --- volume ---------------------------------------------------------------- */

test('obv accumulates on up closes and subtracts on down closes', () => {
  const bars: Bar[] = [
    { t: 0, o: 10, h: 11, l: 9, c: 10, v: 100 },
    { t: 1, o: 10, h: 12, l: 10, c: 11, v: 200 },
    { t: 2, o: 11, h: 11, l: 9, c: 9, v: 300 },
  ];
  assert.deepEqual(obv(bars), [0, 200, -100]);
});

test('mfi is bounded in [0, 100]', () => {
  for (const v of mfi(trendBars(80), 14)) {
    if (Number.isFinite(v)) assert.ok(v >= 0 && v <= 100);
  }
});

test('volume profile places the POC inside the traded range', () => {
  const bars = trendBars(80);
  const vp = volumeProfile(bars, 30);
  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  assert.ok(vp.poc >= lo && vp.poc <= hi);
  assert.ok(vp.val <= vp.poc && vp.poc <= vp.vah);
});

test('rolling vwap stays inside the price range, unlike an all-history anchor', () => {
  // A series that runs 20 -> 138 would give an all-history VWAP far below spot.
  const bars: Bar[] = Array.from({ length: 300 }, (_, i) => {
    const p = 20 + i * 0.4;
    return { t: i, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 1000 };
  });
  const v = last(rollingVwap(bars, 20).vwap);
  const spot = bars[bars.length - 1].c;
  assert.ok(Math.abs(v - spot) / spot < 0.1, `rolling VWAP ${v} too far from spot ${spot}`);
});

test('relative volume is 1 when volume matches its average', () => {
  assert.ok(near(relativeVolume(flatBars(40), 20), 1));
});

/* --- structure -------------------------------------------------------------- */

test('findSwings identifies a local high', () => {
  const bars: Bar[] = [
    ...flatBars(5, 100),
    { t: 5, o: 100, h: 120, l: 99, c: 110, v: 1 },
    ...flatBars(5, 100).map((b, i) => ({ ...b, t: 6 + i })),
  ];
  const swings = findSwings(bars, 3);
  assert.ok(swings.some((s) => s.type === 'high' && s.price === 120));
});

test('market structure reads an uptrend as higher highs and higher lows', () => {
  // A rising staircase produces a clean HH/HL sequence.
  const bars: Bar[] = [];
  for (let i = 0; i < 100; i++) {
    const base = 100 + i * 0.6;
    const wobble = Math.sin(i / 3) * 2;
    bars.push({ t: i, o: base, h: base + wobble + 2, l: base + wobble - 2, c: base + wobble, v: 1000 });
  }
  const ms = marketStructure(bars);
  assert.ok(['uptrend_hh_hl', 'breakout_up'].includes(ms.state), `got ${ms.state}`);
});

test('classic pivots satisfy the standard relations', () => {
  const bar: Bar = { t: 0, o: 100, h: 110, l: 90, c: 105, v: 1 };
  const p = pivots(bar, 'classic');
  assert.ok(near(p.pivot, (110 + 90 + 105) / 3));
  assert.ok(near(p.r1, 2 * p.pivot - 90));
  assert.ok(near(p.s1, 2 * p.pivot - 110));
  assert.ok(p.s3 < p.s2 && p.s2 < p.s1 && p.s1 < p.r1 && p.r1 < p.r2 && p.r2 < p.r3);
});

test('gap analysis detects an unfilled gap up', () => {
  const bars: Bar[] = [
    { t: 0, o: 100, h: 101, l: 99, c: 100, v: 1 },
    { t: 1, o: 105, h: 107, l: 104, c: 106, v: 1 },
  ];
  const g = gapAnalysis(bars, 0.4);
  assert.equal(g.hasGap, true);
  assert.equal(g.type, 'up');
  assert.equal(g.filled, false);
  assert.ok(near(g.gapPct, 5));
});

test('gap analysis marks a gap filled when price trades back through', () => {
  const bars: Bar[] = [
    { t: 0, o: 100, h: 101, l: 99, c: 100, v: 1 },
    { t: 1, o: 105, h: 106, l: 98, c: 99, v: 1 },
  ];
  assert.equal(gapAnalysis(bars, 0.4).filled, true);
});

test('close streak counts consecutive same-direction closes', () => {
  const bars: Bar[] = [100, 101, 102, 103].map((c, i) => ({ t: i, o: c, h: c, l: c, c, v: 1 }));
  const s = closeStreak(bars);
  assert.equal(s.direction, 1);
  assert.equal(s.length, 3);
});

/* --- crosses ---------------------------------------------------------------- */

test('cross detection fires exactly on the crossing bar', () => {
  const a = [1, 2, 3, 4];
  const b = [4, 3, 2, 1];
  assert.equal(crossedAbove(a.slice(0, 2), b.slice(0, 2)), false);
  assert.equal(crossedAbove(a.slice(0, 3), b.slice(0, 3)), true);
  assert.equal(crossedBelow(b.slice(0, 3), a.slice(0, 3)), true);
});

/* --- heikin ashi ------------------------------------------------------------- */

test('heikin-ashi close is the ohlc average and the bar count is preserved', () => {
  const bars = trendBars(20);
  const ha = heikinAshi(bars);
  assert.equal(ha.length, bars.length);
  assert.ok(near(ha[5].c, (bars[5].o + bars[5].h + bars[5].l + bars[5].c) / 4));
  for (const b of ha) {
    assert.ok(b.h >= Math.max(b.o, b.c) - 1e-9);
    assert.ok(b.l <= Math.min(b.o, b.c) + 1e-9);
  }
});

/* --- degenerate input --------------------------------------------------------- */

test('indicators tolerate empty and single-element input without throwing', () => {
  const empty: Bar[] = [];
  const one: Bar[] = [{ t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 }];
  assert.doesNotThrow(() => {
    sma([], 5); ema([], 5); rma([], 5); rsi([], 14); atr(empty, 14);
    adx(empty, 14); bollinger([], 20); obv(empty); volumeProfile(empty);
    marketStructure(empty); gapAnalysis(empty); closeStreak(empty);
    adx(one, 14); atr(one, 14); superTrend(one); volumeProfile(one);
  });
});
