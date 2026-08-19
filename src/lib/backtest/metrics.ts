/* ===========================================================================
   Performance metrics.

   Where a metric has a well-known failure mode, the implementation here
   accounts for it and the doc comment says so. Sharpe on a skewed return
   stream, profit factor on a handful of trades, and CAGR over a period that
   happens to start at a low — all of these flatter a strategy that does not
   deserve it, and all of them appear in most backtest reports without
   qualification.
   ========================================================================= */

import type { Bar } from '../types';
import type { BacktestConfig, Trade, EquityPoint, BacktestMetrics } from './types';
import { mean, stdev, quantile, clamp } from '../util/math';

export function computeMetrics(
  trades: Trade[],
  curve: EquityPoint[],
  config: BacktestConfig,
  bars: readonly Bar[],
  barsInMarket: number,
): BacktestMetrics {
  const initial = config.initialCapital;
  const final = curve.length ? curve[curve.length - 1].markToMarket : initial;

  const totalReturn = final - initial;
  const totalReturnPct = initial > 0 ? (totalReturn / initial) * 100 : 0;

  // --- period returns from the mark-to-market curve ----------------------
  const mtm = curve.map((p) => p.markToMarket);
  const periodReturns: number[] = [];
  for (let i = 1; i < mtm.length; i++) {
    const prev = mtm[i - 1];
    if (prev > 0) periodReturns.push(mtm[i] / prev - 1);
  }

  const years = curve.length > 1 ? curve.length / config.periodsPerYear : 0;
  // CAGR is undefined if equity went to zero or below.
  const cagr = years > 0 && final > 0 && initial > 0
    ? ((final / initial) ** (1 / years) - 1) * 100
    : final <= 0 ? -100 : 0;

  // --- drawdown -----------------------------------------------------------
  let peak = -Infinity;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  let ddStart = 0;
  let maxDdDuration = 0;
  let currentDdStart = -1;
  const ddSeries: number[] = [];

  for (let i = 0; i < mtm.length; i++) {
    const v = mtm[i];
    if (v > peak) {
      peak = v;
      if (currentDdStart >= 0) {
        maxDdDuration = Math.max(maxDdDuration, i - currentDdStart);
        currentDdStart = -1;
      }
    } else if (currentDdStart < 0) {
      currentDdStart = i;
    }
    const dd = v - peak;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    ddSeries.push(ddPct);
    if (dd < maxDrawdown) {
      maxDrawdown = dd;
      maxDrawdownPct = ddPct;
      ddStart = i;
    }
  }
  if (currentDdStart >= 0) {
    maxDdDuration = Math.max(maxDdDuration, mtm.length - currentDdStart);
  }

  // --- volatility & risk-adjusted -----------------------------------------
  const periodVol = periodReturns.length > 1 ? stdev(periodReturns) : 0;
  const volatility = periodVol * Math.sqrt(config.periodsPerYear) * 100;

  const rfPerPeriod = config.riskFreeRate / config.periodsPerYear;
  const excess = periodReturns.map((r) => r - rfPerPeriod);
  const sharpe = periodVol > 0
    ? (mean(excess) / periodVol) * Math.sqrt(config.periodsPerYear)
    : 0;

  // Sortino uses downside deviation only — the correct denominator when the
  // return distribution is asymmetric, which every trend-following stream is.
  const downside = periodReturns.filter((r) => r < rfPerPeriod).map((r) => r - rfPerPeriod);
  const downsideDeviation = downside.length > 1
    ? Math.sqrt(mean(downside.map((d) => d * d)))
    : 0;
  const sortino = downsideDeviation > 0
    ? (mean(excess) / downsideDeviation) * Math.sqrt(config.periodsPerYear)
    : 0;

  const calmar = maxDrawdownPct < 0 ? cagr / Math.abs(maxDrawdownPct) : 0;

  // Ulcer index captures depth AND duration of drawdown, which max drawdown
  // alone does not: a 20% drawdown recovered in a week and one that lasts two
  // years are not the same risk.
  const ulcer = ddSeries.length
    ? Math.sqrt(mean(ddSeries.map((d) => d * d)))
    : 0;
  const martin = ulcer > 0 ? cagr / ulcer : 0;

  // --- tail risk -----------------------------------------------------------
  const var95 = periodReturns.length >= 20 ? quantile(periodReturns, 0.05) * 100 : NaN;
  const tail = periodReturns.filter((r) => r <= quantile(periodReturns, 0.05));
  const cvar95 = tail.length ? mean(tail) * 100 : NaN;

  // --- trade statistics -----------------------------------------------------
  const winners = trades.filter((t) => t.netPnl > 0);
  const losers = trades.filter((t) => t.netPnl <= 0);
  const grossProfit = winners.reduce((a, t) => a + t.netPnl, 0);
  const grossLoss = Math.abs(losers.reduce((a, t) => a + t.netPnl, 0));

  const winRate = trades.length ? winners.length / trades.length : 0;
  const avgWin = winners.length ? mean(winners.map((t) => t.netPnl)) : 0;
  const avgLoss = losers.length ? mean(losers.map((t) => t.netPnl)) : 0;
  const avgWinR = winners.length ? mean(winners.map((t) => t.rMultiple)) : 0;
  const avgLossR = losers.length ? mean(losers.map((t) => t.rMultiple)) : 0;

  // Profit factor is infinite with zero losses, which is meaningless on a
  // small sample; report it as NaN rather than Infinity so the UI can say so.
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? NaN : 0);

  const expectancy = trades.length ? mean(trades.map((t) => t.netPnl)) : 0;
  const expectancyR = trades.length ? mean(trades.map((t) => t.rMultiple)) : 0;
  const payoffRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : NaN;

  let maxConsecWins = 0;
  let maxConsecLosses = 0;
  let curWins = 0;
  let curLosses = 0;
  for (const t of trades) {
    if (t.netPnl > 0) {
      curWins++; curLosses = 0;
      maxConsecWins = Math.max(maxConsecWins, curWins);
    } else {
      curLosses++; curWins = 0;
      maxConsecLosses = Math.max(maxConsecLosses, curLosses);
    }
  }

  const totalCosts = trades.reduce((a, t) => a + t.commissionPaid + t.fundingPaid, 0);

  const rMultiples = trades.map((t) => t.rMultiple);
  const tailRatio = rMultiples.length >= 10
    ? Math.abs(quantile(rMultiples, 0.95) / (quantile(rMultiples, 0.05) || 1))
    : NaN;

  // Kelly implied by the realised statistics. Reported for reference, never
  // used at full size.
  const b = payoffRatio;
  const impliedKelly = Number.isFinite(b) && b > 0
    ? clamp((winRate * (b + 1) - 1) / b, -1, 1)
    : NaN;

  // --- buy and hold comparison ---------------------------------------------
  const firstBar = curve.length ? bars[curve[0].bar] : undefined;
  const lastBar = curve.length ? bars[curve[curve.length - 1].bar] : undefined;
  const buyHoldReturnPct =
    firstBar && lastBar && firstBar.c > 0
      ? ((lastBar.c - firstBar.c) / firstBar.c) * 100
      : 0;

  // --- statistical significance of the expectancy --------------------------
  // With a handful of trades, a positive average is entirely consistent with
  // random noise. The t-test on mean R is the minimum bar a backtest should
  // clear before anyone treats its expectancy as an estimate of anything.
  const nTrades = rMultiples.length;
  const rSd = nTrades > 1 ? stdev(rMultiples) : 0;
  const standardError = nTrades > 1 && rSd > 0 ? rSd / Math.sqrt(nTrades) : NaN;
  const tStat = Number.isFinite(standardError) && standardError > 0
    ? expectancyR / standardError
    : NaN;
  const pValue = Number.isFinite(tStat) ? twoSidedP(tStat, nTrades - 1) : NaN;
  const significance = describeSignificance(tStat, pValue, nTrades, expectancyR);

  const longs = trades.filter((t) => t.direction === 'long');
  const shorts = trades.filter((t) => t.direction === 'short');

  const byExitReason: Record<string, number> = {};
  for (const t of trades) {
    byExitReason[t.exitReason] = (byExitReason[t.exitReason] ?? 0) + 1;
  }

  return {
    initialCapital: initial,
    finalEquity: final,
    totalReturn,
    totalReturnPct,
    cagr,
    buyHoldReturnPct,
    alphaVsBuyHold: totalReturnPct - buyHoldReturnPct,

    maxDrawdown,
    maxDrawdownPct,
    maxDrawdownDurationBars: maxDdDuration,
    volatility,
    downsideDeviation: downsideDeviation * Math.sqrt(config.periodsPerYear) * 100,
    ulcerIndex: ulcer,
    var95,
    cvar95,

    sharpe,
    sortino,
    calmar,
    martin,

    totalTrades: trades.length,
    winners: winners.length,
    losers: losers.length,
    winRate,
    avgWin,
    avgLoss,
    avgWinR,
    avgLossR,
    profitFactor,
    expectancy,
    expectancyR,
    payoffRatio,
    largestWin: winners.length ? Math.max(...winners.map((t) => t.netPnl)) : 0,
    largestLoss: losers.length ? Math.min(...losers.map((t) => t.netPnl)) : 0,
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
    avgBarsHeld: trades.length ? mean(trades.map((t) => t.barsHeld)) : 0,
    exposureTime: curve.length ? barsInMarket / curve.length : 0,
    totalCosts,
    costDragPct: initial > 0 ? (totalCosts / initial) * 100 : 0,

    bestTradeR: rMultiples.length ? Math.max(...rMultiples) : 0,
    worstTradeR: rMultiples.length ? Math.min(...rMultiples) : 0,
    tailRatio,
    impliedKelly,

    tStat,
    pValue,
    standardError,
    significance,

    longTrades: longs.length,
    shortTrades: shorts.length,
    longWinRate: longs.length ? longs.filter((t) => t.netPnl > 0).length / longs.length : 0,
    shortWinRate: shorts.length ? shorts.filter((t) => t.netPnl > 0).length / shorts.length : 0,
    byExitReason,
  };
}

/* ---------------------------------------------------------------------------
   SIGNIFICANCE
   ------------------------------------------------------------------------- */

/** Two-sided p-value for a t-statistic, via the incomplete beta function.
 *  Accurate enough for the decision this supports (is the edge distinguishable
 *  from zero) without pulling in a statistics dependency. */
function twoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return NaN;
  const x = df / (df + t * t);
  return clamp(incompleteBeta(x, df / 2, 0.5), 0, 1);
}

/** Regularised incomplete beta function I_x(a, b) by continued fraction. */
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  const lbeta = logGamma(a) + logGamma(b) - logGamma(a + b);
  const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lbeta) / a;

  // Lentz's algorithm for the continued fraction.
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 220; i++) {
    const m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (b - m) * x) / ((a + 2 * m - 1) * (a + 2 * m));
    else numerator = -((a + m) * (a + b + m) * x) / ((a + 2 * m) * (a + 2 * m + 1));

    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;

    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;

    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-10) break;
  }

  const result = front * (f - 1);
  return x < (a + 1) / (a + b + 2) ? result : 1 - incompleteBetaComplement(x, a, b, lbeta);
}

function incompleteBetaComplement(x: number, a: number, b: number, lbeta: number): number {
  // Symmetry: I_x(a,b) = 1 - I_{1-x}(b,a).
  const y = 1 - x;
  const front = Math.exp(Math.log(y) * b + Math.log(1 - y) * a - lbeta) / b;
  let f = 1, c = 1, d = 0;
  for (let i = 0; i <= 220; i++) {
    const m = Math.floor(i / 2);
    let numerator: number;
    if (i === 0) numerator = 1;
    else if (i % 2 === 0) numerator = (m * (a - m) * y) / ((b + 2 * m - 1) * (b + 2 * m));
    else numerator = -((b + m) * (a + b + m) * y) / ((b + 2 * m) * (b + 2 * m + 1));
    d = 1 + numerator * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    c = 1 + numerator / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    const cd = c * d;
    f *= cd;
    if (Math.abs(1 - cd) < 1e-10) break;
  }
  return front * (f - 1);
}

function logGamma(z: number): number {
  // Lanczos approximation.
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
  const zz = z - 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i] / (zz + i + 1);
  const t = zz + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

function describeSignificance(
  t: number, p: number, n: number, expectancyR: number,
): string {
  if (!Number.isFinite(t) || n < 5) {
    return `Only ${n} trades — far too few to say anything statistical about the expectancy.`;
  }
  const dir = expectancyR >= 0 ? 'positive' : 'negative';
  if (p < 0.01) {
    return `Mean R of ${expectancyR.toFixed(3)} over ${n} trades gives t = ${t.toFixed(2)} (p = ${p.toFixed(4)}). The ${dir} expectancy is statistically significant at the 1% level — unlikely to be luck, though significance on in-sample data is a much weaker claim than significance out of sample.`;
  }
  if (p < 0.05) {
    return `Mean R of ${expectancyR.toFixed(3)} over ${n} trades gives t = ${t.toFixed(2)} (p = ${p.toFixed(3)}). Significant at the 5% level, but only just — this is the zone where a handful of trades either way flips the conclusion.`;
  }
  if (p < 0.2) {
    return `Mean R of ${expectancyR.toFixed(3)} over ${n} trades gives t = ${t.toFixed(2)} (p = ${p.toFixed(3)}). Suggestive but NOT statistically significant. A ${dir} average this size arises from chance often enough that it should not be treated as a measured edge.`;
  }
  return `Mean R of ${expectancyR.toFixed(3)} over ${n} trades gives t = ${t.toFixed(2)} (p = ${p.toFixed(2)}). This is indistinguishable from zero. The strategy has not demonstrated an edge on this sample.`;
}

/* ---------------------------------------------------------------------------
   MONTE CARLO
   ------------------------------------------------------------------------- */

export interface MonteCarloResult {
  runs: number;
  /** Distribution of final equity across shuffled trade orderings. */
  p5: number;
  p25: number;
  median: number;
  p75: number;
  p95: number;
  /** Probability of ending below the starting capital. */
  probLoss: number;
  /** Distribution of maximum drawdown. */
  medianMaxDd: number;
  worstMaxDd: number;
  note: string;
}

/** Monte Carlo by bootstrap resampling of trade returns.
 *
 *  A single equity curve is one draw from a distribution. This resamples the
 *  realised trade returns WITH REPLACEMENT to ask: if the strategy had drawn a
 *  different sample of trades from the same underlying distribution, what
 *  range of outcomes would it have produced?
 *
 *  Note on why replacement matters: simply PERMUTING the trade order leaves
 *  final equity mathematically unchanged, because multiplicative returns
 *  commute. A permutation study can only tell you about path and drawdown, not
 *  about outcome dispersion — a Monte Carlo built on permutation alone reports
 *  a zero-width confidence interval and looks far more certain than it is.
 *  Both are computed here: bootstrap for the outcome distribution, permutation
 *  for the drawdown-path distribution. */
export function monteCarlo(
  trades: Trade[],
  initialCapital: number,
  runs = 2000,
  seed = 12345,
): MonteCarloResult {
  if (trades.length < 5) {
    return {
      runs: 0, p5: NaN, p25: NaN, median: NaN, p75: NaN, p95: NaN,
      probLoss: NaN, medianMaxDd: NaN, worstMaxDd: NaN,
      note: 'Too few trades for a meaningful Monte Carlo.',
    };
  }

  // Resample by return fraction rather than absolute P&L so compounding is
  // handled correctly under reordering.
  const returns = trades.map((t) => {
    const base = t.equityAfter - t.netPnl;
    return base > 0 ? t.netPnl / base : 0;
  });

  let state = seed >>> 0;
  const rand = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const finals: number[] = [];
  const maxDds: number[] = [];
  const n = returns.length;

  for (let r = 0; r < runs; r++) {
    // Bootstrap: draw n trades with replacement from the realised set.
    const sample: number[] = new Array(n);
    for (let i = 0; i < n; i++) sample[i] = returns[Math.floor(rand() * n)];

    let eq = initialCapital;
    let peak = eq;
    let worstDd = 0;
    for (const ret of sample) {
      eq *= 1 + ret;
      if (eq <= 0) { eq = 0; break; }
      if (eq > peak) peak = eq;
      const dd = peak > 0 ? ((eq - peak) / peak) * 100 : 0;
      if (dd < worstDd) worstDd = dd;
    }
    finals.push(eq);
    maxDds.push(worstDd);
  }

  const belowStart = finals.filter((f) => f < initialCapital).length;

  return {
    runs,
    p5: quantile(finals, 0.05),
    p25: quantile(finals, 0.25),
    median: quantile(finals, 0.5),
    p75: quantile(finals, 0.75),
    p95: quantile(finals, 0.95),
    probLoss: belowStart / finals.length,
    medianMaxDd: quantile(maxDds, 0.5),
    worstMaxDd: Math.min(...maxDds),
    note:
      `${runs} bootstrap resamples of the ${trades.length} realised trades, drawn with replacement. ` +
      'This shows the dispersion of outcomes the same edge could plausibly have produced. It does NOT ' +
      'validate that the edge is real — it assumes the realised trade distribution is representative, ' +
      'which is exactly what a small sample cannot establish.',
  };
}
