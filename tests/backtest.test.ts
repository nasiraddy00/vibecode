import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bar } from '@/lib/types';
import { runBacktest } from '@/lib/backtest/engine';
import { computeMetrics, monteCarlo } from '@/lib/backtest/metrics';
import { DEFAULT_CONFIG, type BacktestConfig, type Trade, type EquityPoint } from '@/lib/backtest/types';
import { simulateSeries } from '@/lib/providers/simulator';
import { resolveInstrument } from '@/lib/market/universe';
import { logReturns, stdev, correlation, mean } from '@/lib/util/math';

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

/* --- simulator properties ------------------------------------------------- */

test('simulator is deterministic for a given symbol and timeframe', () => {
  const inst = resolveInstrument('BTC-USD')!;
  const a = simulateSeries(inst, { bars: 400, timeframe: '1d' });
  const b = simulateSeries(inst, { bars: 400, timeframe: '1d' });
  assert.deepEqual(a.bars.map((x) => x.c), b.bars.map((x) => x.c));
  assert.deepEqual(a.bars.map((x) => x.v), b.bars.map((x) => x.v));
});

test('simulator OHLC integrity holds on every bar', () => {
  for (const sym of ['BTC-USD', 'NVDA', 'SPX', 'GC=F', 'EURUSD=X']) {
    const inst = resolveInstrument(sym)!;
    const { bars } = simulateSeries(inst, { bars: 600, timeframe: '1d' });
    for (const b of bars) {
      assert.ok(b.h >= Math.max(b.o, b.c), `${sym}: high below body`);
      assert.ok(b.l <= Math.min(b.o, b.c), `${sym}: low above body`);
      assert.ok(b.l > 0, `${sym}: non-positive low`);
      assert.ok(b.v > 0, `${sym}: non-positive volume`);
      assert.ok(Number.isFinite(b.c), `${sym}: non-finite close`);
    }
  }
});

test('simulator realised volatility matches each instrument calibration', () => {
  for (const sym of ['BTC-USD', 'NVDA', 'SPX', 'GC=F', 'EURUSD=X']) {
    const inst = resolveInstrument(sym)!;
    const { bars } = simulateSeries(inst, { bars: 1200, timeframe: '1d' });
    const realised = stdev(logReturns(bars.map((b) => b.c))) * Math.sqrt(252);
    const ratio = realised / inst.typicalVol;
    assert.ok(ratio > 0.9 && ratio < 1.1, `${sym}: realised ${realised.toFixed(3)} vs target ${inst.typicalVol}`);
  }
});

test('simulator produces fat tails and volatility clustering', () => {
  const inst = resolveInstrument('BTC-USD')!;
  const { bars } = simulateSeries(inst, { bars: 1500, timeframe: '1d' });
  const r = logReturns(bars.map((b) => b.c));
  const m = mean(r);
  const sd = stdev(r);

  const excessKurtosis = mean(r.map((x) => ((x - m) / sd) ** 4)) - 3;
  assert.ok(excessKurtosis > 1, `expected fat tails, excess kurtosis was ${excessKurtosis.toFixed(2)}`);

  const sq = r.map((x) => x * x);
  const acf1 = correlation(sq.slice(0, -1), sq.slice(1));
  assert.ok(acf1 > 0.03, `expected volatility clustering, ACF(1) of squared returns was ${acf1.toFixed(3)}`);

  // Raw returns should stay close to uncorrelated: a simulator whose returns
  // are predictable would make any backtest against it meaningless.
  const acfRaw = correlation(r.slice(0, -1), r.slice(1));
  assert.ok(Math.abs(acfRaw) < 0.15, `returns too autocorrelated: ${acfRaw.toFixed(3)}`);
});

test('simulator anchors its final close to the reference level', () => {
  const inst = resolveInstrument('BTC-USD')!;
  const { bars } = simulateSeries(inst, { bars: 500, timeframe: '1d' });
  const final = bars[bars.length - 1].c;
  assert.ok(Math.abs(final - inst.anchor) / inst.anchor < 0.01);
});

/* --- engine correctness --------------------------------------------------- */

/** A deterministic saw-tooth series, so entries and exits are predictable. */
function sawBars(n: number): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const base = 100 + Math.sin(i / 8) * 12 + i * 0.05;
    out.push({
      t: i * 86400000,
      o: base, h: base + 1.5, l: base - 1.5, c: base + 0.3, v: 1_000_000,
    });
  }
  return out;
}

test('backtest never fills on the bar that generated the signal', () => {
  const bars = sawBars(500);
  const result = runBacktest({
    bars, config: { symbol: 'TEST', warmupBars: 260, initialCapital: 10_000 },
    assetClass: 'equity',
  });
  for (const t of result.trades) {
    assert.ok(t.exitBar > t.entryBar, `trade ${t.id} exited on its entry bar`);
    assert.ok(t.entryBar >= 260, `trade ${t.id} entered inside the warmup`);
  }
});

test('backtest charges commission and slippage on every trade', () => {
  const bars = sawBars(500);
  const result = runBacktest({
    bars,
    config: { symbol: 'TEST', warmupBars: 260, commission: 0.002, slippage: 0.001 },
    assetClass: 'equity',
  });
  for (const t of result.trades) {
    assert.ok(t.commissionPaid > 0, `trade ${t.id} paid no commission`);
    assert.ok(t.netPnl <= t.grossPnl, `trade ${t.id} net exceeds gross`);
  }
});

test('a zero-cost run outperforms an identical run with costs', () => {
  const bars = sawBars(500);
  const cfg = { symbol: 'TEST', warmupBars: 260, initialCapital: 10_000 };
  const free = runBacktest({
    bars, assetClass: 'equity',
    config: { ...cfg, commission: 0, slippage: 0, fundingRate: 0 },
  });
  const costly = runBacktest({
    bars, assetClass: 'equity',
    config: { ...cfg, commission: 0.005, slippage: 0.002, fundingRate: 0.2 },
  });
  if (free.trades.length > 0 && costly.trades.length > 0) {
    assert.ok(
      free.metrics.finalEquity >= costly.metrics.finalEquity,
      'costs should never improve the result',
    );
  }
});

test('long-only configuration produces no short trades', () => {
  const bars = sawBars(500);
  const result = runBacktest({
    bars, assetClass: 'equity',
    config: { symbol: 'TEST', warmupBars: 260, allowShorts: false },
  });
  assert.equal(result.trades.filter((t) => t.direction === 'short').length, 0);
});

test('equity curve is continuous and matches the final trade equity', () => {
  const bars = sawBars(500);
  const result = runBacktest({
    bars, assetClass: 'equity',
    config: { symbol: 'TEST', warmupBars: 260, initialCapital: 10_000 },
  });
  assert.ok(result.equityCurve.length > 0);
  for (const p of result.equityCurve) {
    assert.ok(Number.isFinite(p.markToMarket), 'non-finite mark-to-market');
    assert.ok(p.drawdownPct <= 0.0001, 'drawdown must be non-positive');
  }
  if (result.trades.length) {
    const lastTrade = result.trades[result.trades.length - 1];
    assert.ok(near(lastTrade.equityAfter, result.metrics.finalEquity, 1e-6));
  }
});

test('a flat series generates no trades and preserves capital exactly', () => {
  const flat: Bar[] = Array.from({ length: 500 }, (_, i) => ({
    t: i * 86400000, o: 100, h: 100, l: 100, c: 100, v: 1000,
  }));
  const result = runBacktest({
    bars: flat, assetClass: 'equity',
    config: { symbol: 'FLAT', warmupBars: 260, initialCapital: 10_000 },
  });
  assert.equal(result.trades.length, 0);
  assert.ok(near(result.metrics.finalEquity, 10_000, 1e-9));
  assert.equal(result.metrics.totalTrades, 0);
});

test('R multiple sign always agrees with net P&L sign', () => {
  const inst = resolveInstrument('NVDA')!;
  const { bars } = simulateSeries(inst, { bars: 900, timeframe: '1d' });
  const result = runBacktest({
    bars, assetClass: 'equity',
    config: { symbol: 'NVDA', warmupBars: 260, initialCapital: 10_000 },
  });
  for (const t of result.trades) {
    if (Math.abs(t.netPnl) > 1e-9) {
      assert.equal(Math.sign(t.rMultiple), Math.sign(t.netPnl), `trade ${t.id} R/PnL sign mismatch`);
    }
  }
});

test('reported caveats always disclose simulated price data', () => {
  const inst = resolveInstrument('BTC-USD')!;
  const { bars } = simulateSeries(inst, { bars: 600, timeframe: '1d' });
  const result = runBacktest({
    bars, assetClass: 'crypto',
    config: { symbol: 'BTC-USD', warmupBars: 260 },
    dataProvenance: 'simulated',
  });
  assert.ok(result.caveats.some((c) => c.includes('SYNTHETIC')), 'simulated run must disclose it');
});

/* --- metrics --------------------------------------------------------------- */

function mkTrades(rs: number[], initial = 1000): Trade[] {
  let eq = initial;
  return rs.map((r, i) => {
    const pnl = r * 10;
    eq += pnl;
    return {
      id: i + 1, direction: 'long', entryBar: i, entryTime: i, entryPrice: 100, entryFill: 100,
      exitBar: i + 1, exitTime: i + 1, exitPrice: 100, exitFill: 100, size: 1, notional: 100,
      stop: 90, target: 120, exitReason: 'target', grossPnl: pnl, commissionPaid: 0,
      fundingPaid: 0, netPnl: pnl, pnlPct: 0, rMultiple: r, barsHeld: 1, equityAfter: eq,
      convictionAtEntry: 50, scoreAtEntry: 0.3, regimeAtEntry: 'uptrend',
      maxAdverseR: 0, maxFavourableR: 0,
    } as Trade;
  });
}

const stubCurve: EquityPoint[] = [
  { bar: 0, time: 0, equity: 1000, markToMarket: 1000, drawdown: 0, drawdownPct: 0, exposure: 0, price: 100 },
];
const stubCfg: BacktestConfig = { ...DEFAULT_CONFIG, symbol: 'T', initialCapital: 1000 };

test('p-value matches published t-distribution critical values', () => {
  // Construct samples with an exact target t-statistic.
  const calibrated = (n: number, targetT: number): number[] => {
    const base = Array.from({ length: n }, (_, i) => i - (n - 1) / 2);
    const m0 = base.reduce((a, b) => a + b, 0) / n;
    const sd0 = Math.sqrt(base.reduce((a, b) => a + (b - m0) ** 2, 0) / (n - 1));
    const targetMean = targetT / Math.sqrt(n);
    return base.map((v) => (v - m0) / sd0 + targetMean);
  };

  for (const [n, t, expected] of [
    [11, 2.228, 0.05], [31, 2.042, 0.05], [101, 1.984, 0.05], [31, 3.646, 0.001],
  ] as [number, number, number][]) {
    const m = computeMetrics(mkTrades(calibrated(n, t)), stubCurve, stubCfg, [], 0);
    assert.ok(near(m.tStat, t, 1e-3), `t mismatch at n=${n}`);
    assert.ok(near(m.pValue, expected, 6e-3), `p=${m.pValue} expected ~${expected} at n=${n}`);
  }
});

test('a zero-mean sample yields a p-value of 1', () => {
  const symmetric = [-2, -1, 0, 1, 2, -2, -1, 0, 1, 2];
  const m = computeMetrics(mkTrades(symmetric), stubCurve, stubCfg, [], 0);
  assert.ok(near(m.pValue, 1, 1e-6));
});

test('profit factor and win rate are computed correctly', () => {
  // three wins of +2R (=$20 each), two losses of -1R (=-$10 each)
  const m = computeMetrics(mkTrades([2, 2, 2, -1, -1]), stubCurve, stubCfg, [], 0);
  assert.equal(m.winners, 3);
  assert.equal(m.losers, 2);
  assert.ok(near(m.winRate, 0.6));
  assert.ok(near(m.profitFactor, 60 / 20));
  assert.ok(near(m.expectancyR, (2 + 2 + 2 - 1 - 1) / 5));
});

test('profit factor is NaN rather than Infinity when there are no losses', () => {
  const m = computeMetrics(mkTrades([1, 2, 3]), stubCurve, stubCfg, [], 0);
  assert.ok(Number.isNaN(m.profitFactor));
});

test('monte carlo bootstrap produces a non-degenerate distribution', () => {
  // Permutation alone would return an identical value at every percentile,
  // because multiplicative returns commute. Bootstrap must not.
  const mc = monteCarlo(mkTrades([2, -1, 1.5, -1, 3, -1, 0.5, -1, 2, -1]), 1000, 2000);
  assert.ok(mc.runs > 0);
  assert.ok(mc.p95 > mc.p5, 'distribution collapsed to a point');
  assert.ok(mc.median >= mc.p25 && mc.p75 >= mc.median);
  assert.ok(mc.probLoss >= 0 && mc.probLoss <= 1);
});

test('monte carlo declines to report on too few trades', () => {
  const mc = monteCarlo(mkTrades([1, -1]), 1000, 500);
  assert.equal(mc.runs, 0);
  assert.ok(mc.note.includes('Too few'));
});
