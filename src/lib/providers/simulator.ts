/* ===========================================================================
   Deterministic market simulator.

   WHY THIS EXISTS
   ---------------
   The terminal must remain fully functional and demonstrable when upstream
   feeds are unconfigured, rate-limited, or blocked by network policy. The
   alternative — blank panels or, far worse, fabricated numbers presented as
   real quotes — is unacceptable in a tool people would risk money on. So
   every simulated figure is tagged `provenance: 'simulated'` and rendered
   with a SIM badge, and the signal engine discounts its confidence.

   WHAT IT MODELS
   --------------
   A plain geometric random walk produces series with none of the statistical
   features that make market timing hard, which would make any backtest run
   against it meaninglessly optimistic. This simulator reproduces the four
   stylised facts that matter for strategy evaluation:

     1. Volatility clustering  — GARCH(1,1) variance process
     2. Fat tails              — Student-t innovations plus a jump component
     3. Regime persistence     — a three-state Markov chain (bull/range/bear)
     4. Leverage effect        — negative returns raise next-period variance
        more than positive ones of the same size

   Determinism is by design: the same symbol and seed always produce the same
   series, so screenshots, tests and backtests are reproducible.
   ========================================================================= */

import type { Bar, Quote, AssetClass, Timeframe } from '../types';
import { mulberry32, gaussian, hashString, clamp } from '../util/math';
import type { Instrument } from '../market/universe';

export interface SimulatorOptions {
  bars: number;
  timeframe: Timeframe;
  /** Overrides the symbol-derived seed. */
  seed?: number;
  /** Ends the series at this epoch ms. Defaults to now. */
  endTime?: number;
  /** Forces the final close to this value (e.g. to match a known anchor). */
  anchorFinal?: boolean;
}

const TIMEFRAME_MS: Record<Timeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
  '1w': 604_800_000,
};

const PERIODS_PER_YEAR: Record<Timeframe, number> = {
  '1m': 252 * 390,
  '5m': 252 * 78,
  '15m': 252 * 26,
  '1h': 252 * 6.5,
  '4h': 252 * 1.625,
  '1d': 252,
  '1w': 52,
};

type Regime = 'bull' | 'range' | 'bear';

/** Row-stochastic transition matrix. Diagonal dominance gives the regime
 *  persistence real markets show — trends last, they do not alternate daily. */
const TRANSITIONS: Record<Regime, Record<Regime, number>> = {
  bull:  { bull: 0.968, range: 0.026, bear: 0.006 },
  range: { bull: 0.030, range: 0.947, bear: 0.023 },
  bear:  { bull: 0.014, range: 0.038, bear: 0.948 },
};

/** Drift and volatility multipliers applied per regime. */
const REGIME_PARAMS: Record<Regime, { driftMult: number; volMult: number }> = {
  bull:  { driftMult: 1.9, volMult: 0.82 },
  range: { driftMult: 0.0, volMult: 0.95 },
  bear:  { driftMult: -2.3, volMult: 1.55 },
};

/** Student-t innovation via the normal/chi-square mixture, normalised to unit
 *  variance so `nu` changes tail weight without changing the vol target. */
function studentT(rng: () => number, nu = 4.5): number {
  const z = gaussian(rng);
  // Chi-square with nu degrees of freedom, via a sum of squared normals.
  let chi = 0;
  const k = Math.max(3, Math.round(nu));
  for (let i = 0; i < k; i++) {
    const g = gaussian(rng);
    chi += g * g;
  }
  const t = z / Math.sqrt(chi / k);
  // Var(t_k) = k/(k-2); divide it out to keep sigma interpretable.
  return t / Math.sqrt(k / (k - 2));
}

export interface SimulatedSeries {
  bars: Bar[];
  /** The regime the series ended in — used to colour the narrative. */
  finalRegime: Regime;
  /** Regime label per bar, for diagnostics. */
  regimes: Regime[];
}

/** Generate an OHLCV series with realistic statistical properties. */
export function simulateSeries(inst: Instrument, opts: SimulatorOptions): SimulatedSeries {
  const { bars: n, timeframe } = opts;
  const seed = opts.seed ?? hashString(`${inst.symbol}|${timeframe}`);
  const rng = mulberry32(seed);

  const ppy = PERIODS_PER_YEAR[timeframe];
  const dt = 1 / ppy;
  const stepMs = TIMEFRAME_MS[timeframe];
  const endTime = opts.endTime ?? Date.now();

  // --- GARCH(1,1) with leverage (GJR) ------------------------------------
  // Persistence must stay meaningfully below 1. The leverage term contributes
  // gamma/2 to effective persistence (it fires on roughly half of shocks), so
  // it has to be counted: alpha + beta + gamma/2 = 0.94 here. Pushing that to
  // ~0.99, as a naive parameterisation does, gives a near-unit-root variance
  // process whose sample volatility explodes under fat-tailed innovations.
  const alpha = 0.075;   // reaction to the last shock
  const beta = 0.845;    // persistence
  const gamma = 0.04;    // leverage: extra weight on negative shocks
  const persistence = alpha + beta + gamma / 2;

  // Variance is targeted on a unit scale and the whole path is rescaled to the
  // instrument's volatility afterwards (see "variance targeting" below), so the
  // GARCH recursion here only has to produce the right *shape*.
  const omega = 1 - persistence;
  let variance = 1;

  let regime: Regime = rng() < 0.55 ? 'bull' : rng() < 0.6 ? 'range' : 'bear';

  // Build the stochastic component and the drift component separately so the
  // former can be rescaled without distorting the latter.
  const shocks: number[] = [0];
  const driftMults: number[] = [1];
  const regimes: Regime[] = [regime];

  for (let i = 1; i < n; i++) {
    // --- regime transition ---------------------------------------------
    const row = TRANSITIONS[regime];
    const u = rng();
    let acc = 0;
    for (const [state, p] of Object.entries(row) as [Regime, number][]) {
      acc += p;
      if (u <= acc) {
        regime = state;
        break;
      }
    }
    regimes.push(regime);

    const rp = REGIME_PARAMS[regime];
    const sigma = Math.sqrt(variance) * rp.volMult;

    const z = studentT(rng, 4.5);
    let move = sigma * z;

    // --- jump component ---------------------------------------------------
    // Rare, large, and asymmetric: crashes are faster than melt-ups.
    const jumpProb = 0.005 * (timeframe === '1d' ? 1 : 0.4);
    if (rng() < jumpProb) {
      const down = rng() < 0.62;
      const magnitude = (1.5 + rng() * 4.5) * (down ? -1 : 0.75);
      move += magnitude;
    }

    shocks.push(move);
    driftMults.push(rp.driftMult);

    // --- GARCH update with the leverage term ------------------------------
    const eps = sigma * z;
    const leverage = eps < 0 ? gamma * eps * eps : 0;
    variance = omega + alpha * eps * eps + leverage + beta * variance;
    variance = clamp(variance, 0.08, 8);
  }

  // --- variance targeting --------------------------------------------------
  // Rescale the stochastic component so realised volatility matches the
  // instrument's calibration exactly. A constant scale factor leaves the
  // autocorrelation of squared returns, the regime runs and the tail shape
  // untouched — only the magnitude changes.
  const shockMean = shocks.reduce((a, x) => a + x, 0) / Math.max(1, shocks.length);
  const shockVar =
    shocks.reduce((a, x) => a + (x - shockMean) ** 2, 0) / Math.max(1, shocks.length - 1);
  const shockSd = Math.sqrt(Math.max(shockVar, 1e-12));
  const targetSdPerPeriod = inst.typicalVol * Math.sqrt(dt);
  const scaleFactor = targetSdPerPeriod / shockSd;

  const driftPerPeriod = inst.drift * dt;

  const logPath: number[] = [0];
  for (let i = 1; i < n; i++) {
    const scaled = shocks[i] * scaleFactor;
    // Ito correction keeps the arithmetic drift honest in log space.
    const ret = driftPerPeriod * driftMults[i] - 0.5 * targetSdPerPeriod ** 2 + scaled;
    logPath.push(logPath[i - 1] + ret);
  }

  // Scale the log path so the final close lands on the reference anchor.
  const finalLog = logPath[logPath.length - 1];
  const closes = logPath.map((lp) => inst.anchor * Math.exp(lp - finalLog));

  // Per-bar volatility estimate used to shape the wicks below.
  const barSd = targetSdPerPeriod;

  // --- derive OHLC ---------------------------------------------------------
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const c = closes[i];
    const prevC = i > 0 ? closes[i - 1] : c;

    // Open gaps from the prior close for session-bound instruments; continuous
    // markets open essentially where they closed.
    const gapScale = inst.continuous ? 0.0008 : 0.0035;
    const o = i === 0 ? c : prevC * (1 + gaussian(rng) * gapScale * (inst.typicalVol / 0.25));

    // Calibrate the intrabar range so ATR lands at a realistic multiple of
    // close-to-close volatility. Empirically ATR/price runs about 1.4x daily
    // sigma for liquid instruments; deriving the wicks from |c-o| as well as
    // sigma double-counts the daily move and inflates ATR badly, which then
    // propagates into absurd stop distances downstream.
    const barVol = Math.abs(c) * barSd * (0.7 + rng() * 0.6);
    const wickUp = Math.abs(gaussian(rng)) * barVol * 0.38;
    const wickDn = Math.abs(gaussian(rng)) * barVol * 0.38;

    const h = Math.max(o, c) + wickUp;
    const l = Math.max(1e-9, Math.min(o, c) - wickDn);

    // Volume rises with absolute return — the empirical volume/volatility link.
    const absRet = prevC !== 0 ? Math.abs(c / prevC - 1) : 0;
    const baseVol = baseVolumeFor(inst);
    const v = Math.max(
      1,
      baseVol * (0.55 + rng() * 0.55) * (1 + absRet * 42),
    );

    out.push({
      t: endTime - (n - 1 - i) * stepMs,
      o: round(o, inst.anchor),
      h: round(h, inst.anchor),
      l: round(l, inst.anchor),
      c: round(c, inst.anchor),
      v: Math.round(v),
    });
  }

  return { bars: out, finalRegime: regime, regimes };
}

/** Price rounding that respects the instrument's natural tick scale. */
function round(x: number, scaleRef: number): number {
  if (scaleRef >= 1000) return Math.round(x * 100) / 100;
  if (scaleRef >= 10) return Math.round(x * 100) / 100;
  if (scaleRef >= 1) return Math.round(x * 10000) / 10000;
  return Math.round(x * 1000000) / 1000000;
}

function baseVolumeFor(inst: Instrument): number {
  switch (inst.assetClass) {
    case 'crypto': return inst.anchor > 1000 ? 28_000 : 4_200_000;
    case 'index': return 2_400_000_000;
    case 'etf': return 42_000_000;
    case 'commodity': return 240_000;
    case 'fx': return 180_000;
    case 'rate': return 1;
    default: return 24_000_000;
  }
}

/** Build a quote from a simulated series. */
export function simulateQuote(inst: Instrument, bars: Bar[]): Quote {
  const cur = bars[bars.length - 1];
  const prev = bars[bars.length - 2] ?? cur;
  const change = cur.c - prev.c;

  const avgVolume =
    bars.length >= 20
      ? bars.slice(-20).reduce((a, b) => a + b.v, 0) / 20
      : cur.v;

  return {
    symbol: inst.symbol,
    name: inst.name,
    assetClass: inst.assetClass,
    price: cur.c,
    change,
    changePct: prev.c !== 0 ? (change / prev.c) * 100 : 0,
    open: cur.o,
    high: cur.h,
    low: cur.l,
    prevClose: prev.c,
    volume: cur.v,
    avgVolume,
    marketCap: estimateMarketCap(inst, cur.c),
    currency: inst.currency,
    provenance: 'simulated',
    source: 'simulator',
    asOf: cur.t,
  };
}

function estimateMarketCap(inst: Instrument, price: number): number | undefined {
  if (inst.assetClass !== 'equity' && inst.assetClass !== 'crypto') return undefined;
  // Derived from the anchor so the figure stays internally consistent as the
  // simulated price moves. Not a real share count.
  const impliedShares = SHARE_COUNTS[inst.symbol];
  return impliedShares ? impliedShares * price : undefined;
}

/** Approximate share/supply counts, used only to keep simulated market caps
 *  internally consistent. Replaced wholesale by live provider data. */
const SHARE_COUNTS: Record<string, number> = {
  'AAPL': 15.2e9, 'MSFT': 7.44e9, 'NVDA': 24.5e9, 'GOOGL': 12.3e9,
  'AMZN': 10.5e9, 'META': 2.53e9, 'TSLA': 3.21e9, 'AVGO': 4.68e9,
  'JPM': 2.85e9, 'BRK-B': 2.16e9, 'LLY': 0.95e9, 'UNH': 0.92e9,
  'V': 1.94e9, 'MA': 0.92e9, 'XOM': 4.4e9, 'CVX': 1.83e9,
  'WMT': 8.04e9, 'COST': 0.444e9, 'HD': 0.99e9, 'PG': 2.36e9,
  'JNJ': 2.41e9, 'ABBV': 1.77e9, 'MRK': 2.53e9, 'PEP': 1.37e9,
  'KO': 4.31e9, 'AMD': 1.62e9, 'INTC': 4.27e9, 'CRM': 0.96e9,
  'ORCL': 2.79e9, 'ADBE': 0.44e9, 'NFLX': 0.43e9, 'DIS': 1.81e9,
  'BA': 0.75e9, 'CAT': 0.49e9, 'GE': 1.08e9, 'GS': 0.31e9,
  'MS': 1.62e9, 'BAC': 7.7e9, 'WFC': 3.4e9, 'PLTR': 2.26e9,
  'COIN': 0.25e9, 'MSTR': 0.23e9, 'SMCI': 0.59e9, 'MU': 1.11e9,
  'QCOM': 1.11e9, 'TXN': 0.91e9, 'AMAT': 0.82e9, 'ARM': 1.04e9,
  'UBER': 2.09e9, 'ABNB': 0.63e9,
  'BTC-USD': 19.8e6, 'ETH-USD': 120.4e6, 'SOL-USD': 470e6,
  'XRP-USD': 57.2e9, 'BNB-USD': 145e6, 'DOGE-USD': 146e9,
  'ADA-USD': 35.1e9, 'AVAX-USD': 409e6, 'LINK-USD': 626e6,
  'MATIC-USD': 9.9e9,
};

export { SHARE_COUNTS };
