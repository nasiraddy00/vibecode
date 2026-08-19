/* ===========================================================================
   Options chain analytics: IV surface, skew, term structure, positioning.

   These are the numbers that tell you what the options market *believes*,
   which is frequently a better forward indicator than what the tape has
   already done.
   ========================================================================= */

import type { Provenance } from '../types';
import { blackScholes, impliedVolatility, expectedMove, strikeForDelta, type OptionType } from './blackscholes';
import { clamp, mean, percentileRank, quantile, scale, squash } from '../util/math';

export interface OptionContract {
  symbol: string;
  type: OptionType;
  strike: number;
  expiry: number;          // epoch ms
  dte: number;             // days to expiry
  bid: number;
  ask: number;
  last: number;
  mid: number;
  volume: number;
  openInterest: number;
  impliedVol: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  inTheMoney: boolean;
}

export interface OptionChain {
  symbol: string;
  spot: number;
  contracts: OptionContract[];
  expiries: number[];
  provenance: Provenance;
  source: string;
  asOf: number;
}

/* ---------------------------------------------------------------------------
   IV RANK / PERCENTILE
   ------------------------------------------------------------------------- */

export interface IvStats {
  /** Current 30-day at-the-money implied volatility, as a decimal. */
  iv30: number;
  /** Where iv30 sits in its own 1-year range: (iv - min) / (max - min). */
  ivRank: number;
  /** Fraction of the last year's readings below the current one. */
  ivPercentile: number;
  ivHigh52w: number;
  ivLow52w: number;
  /** Realised volatility over the matching window. */
  realisedVol: number;
  /** IV minus RV — the volatility risk premium. Positive means options are
   *  expensive relative to what the underlying has actually delivered. */
  vrp: number;
  /** Trader-facing verdict on option pricing. */
  state: 'very_cheap' | 'cheap' | 'fair' | 'rich' | 'very_rich';
  /** Whether the structure favours buying or selling premium. */
  premiumBias: 'buy' | 'neutral' | 'sell';
  note: string;
}

export function ivStats(iv30: number, ivHistory: readonly number[], realised: number): IvStats {
  const hist = ivHistory.filter(Number.isFinite);
  const ivHigh52w = hist.length ? Math.max(...hist) : NaN;
  const ivLow52w = hist.length ? Math.min(...hist) : NaN;

  const span = ivHigh52w - ivLow52w;
  const ivRank = span > 0 ? clamp((iv30 - ivLow52w) / span, 0, 1) : 0.5;
  const ivPercentile = hist.length >= 20 ? percentileRank(hist, iv30) : 0.5;
  const vrp = iv30 - realised;

  const state =
    ivRank < 0.15 ? 'very_cheap'
    : ivRank < 0.35 ? 'cheap'
    : ivRank < 0.65 ? 'fair'
    : ivRank < 0.85 ? 'rich'
    : 'very_rich';

  // Buying premium is attractive when IV is low AND not far above realised.
  const premiumBias: IvStats['premiumBias'] =
    ivRank < 0.3 && vrp < 0.06 ? 'buy'
    : ivRank > 0.7 && vrp > 0.04 ? 'sell'
    : 'neutral';

  const note =
    premiumBias === 'buy'
      ? `IV rank ${(ivRank * 100).toFixed(0)} — options are cheap; long premium (debit structures) is favoured over spot.`
      : premiumBias === 'sell'
        ? `IV rank ${(ivRank * 100).toFixed(0)} with a ${(vrp * 100).toFixed(1)}pt risk premium — sellers are being paid; prefer spreads over naked long options.`
        : `IV rank ${(ivRank * 100).toFixed(0)} — option pricing is unremarkable; direction matters more than vol here.`;

  return {
    iv30, ivRank, ivPercentile, ivHigh52w, ivLow52w,
    realisedVol: realised, vrp, state, premiumBias, note,
  };
}

/* ---------------------------------------------------------------------------
   SKEW
   ------------------------------------------------------------------------- */

export interface SkewAnalysis {
  /** IV of the 25-delta put minus IV of the 25-delta call, in vol points. */
  skew25: number;
  putIv25: number;
  callIv25: number;
  atmIv: number;
  /** Positive = puts bid (fear); negative = calls bid (chase/squeeze). */
  direction: 'put_skew' | 'flat' | 'call_skew';
  /** How extreme the skew is versus a typical equity smile. */
  severity: 'extreme' | 'elevated' | 'normal' | 'inverted';
  /** Directional read in [-1, 1] for the ensemble. */
  score: number;
  note: string;
}

/** Skew from a single expiry's contracts. Equity index skew is normally
 *  positive (puts bid) — the informative signal is a *change* in that, and
 *  especially call skew, which shows up before squeezes. */
export function analyseSkew(contracts: readonly OptionContract[], spot: number): SkewAnalysis {
  const calls = contracts.filter((c) => c.type === 'call' && c.impliedVol > 0);
  const puts = contracts.filter((c) => c.type === 'put' && c.impliedVol > 0);

  const nearest = (list: readonly OptionContract[], targetDelta: number): OptionContract | undefined =>
    list.length
      ? list.reduce((best, c) =>
          Math.abs(Math.abs(c.delta) - targetDelta) < Math.abs(Math.abs(best.delta) - targetDelta) ? c : best)
      : undefined;

  const c25 = nearest(calls, 0.25);
  const p25 = nearest(puts, 0.25);
  const atmC = nearest(calls, 0.5);
  const atmP = nearest(puts, 0.5);

  const callIv25 = c25?.impliedVol ?? NaN;
  const putIv25 = p25?.impliedVol ?? NaN;
  const atmIv = mean([atmC?.impliedVol ?? NaN, atmP?.impliedVol ?? NaN].filter(Number.isFinite));

  const skew25 = (putIv25 - callIv25) * 100;

  const direction: SkewAnalysis['direction'] =
    !Number.isFinite(skew25) ? 'flat' : skew25 > 1.5 ? 'put_skew' : skew25 < -1.5 ? 'call_skew' : 'flat';

  const severity: SkewAnalysis['severity'] =
    !Number.isFinite(skew25) ? 'normal'
    : skew25 > 12 ? 'extreme'
    : skew25 > 6 ? 'elevated'
    : skew25 < -1.5 ? 'inverted'
    : 'normal';

  // Very heavy put skew is contrarian-bullish (hedges already bought);
  // call skew signals upside chase, which tends to persist short-term.
  const score =
    !Number.isFinite(skew25) ? 0
    : skew25 > 12 ? 0.35
    : skew25 > 6 ? -0.15
    : skew25 < -3 ? 0.45
    : 0;

  const note =
    severity === 'extreme'
      ? `Put skew at ${skew25.toFixed(1)} vol points is extreme — downside protection is already crowded, which historically marks capitulation more often than the start of a decline.`
      : severity === 'inverted'
        ? `Calls bid over puts by ${Math.abs(skew25).toFixed(1)} vol points — upside is being chased, a squeeze/momentum footprint.`
        : severity === 'elevated'
          ? `Puts bid by ${skew25.toFixed(1)} vol points — the market is paying up for downside protection.`
          : 'Skew is within its normal band; no strong positioning signal.';

  return { skew25, putIv25, callIv25, atmIv, direction, severity, score, note };
}

/* ---------------------------------------------------------------------------
   TERM STRUCTURE
   ------------------------------------------------------------------------- */

export interface TermStructure {
  points: { dte: number; iv: number }[];
  /** Front-month IV minus back-month IV, in vol points. */
  frontBackSpread: number;
  shape: 'contango' | 'flat' | 'backwardation';
  /** Backwardation = near-term stress. Directional read for the ensemble. */
  score: number;
  note: string;
}

export function analyseTermStructure(chain: OptionChain): TermStructure {
  const byExpiry = new Map<number, number[]>();
  for (const c of chain.contracts) {
    if (!(c.impliedVol > 0)) continue;
    // ATM-ish contracts only — otherwise the smile pollutes the term read.
    if (Math.abs(Math.abs(c.delta) - 0.5) > 0.15) continue;
    const arr = byExpiry.get(c.expiry) ?? [];
    arr.push(c.impliedVol);
    byExpiry.set(c.expiry, arr);
  }

  const now = Date.now();
  const points = [...byExpiry.entries()]
    .map(([expiry, ivs]) => ({ dte: Math.max(0, (expiry - now) / 86400000), iv: mean(ivs) }))
    .filter((p) => Number.isFinite(p.iv))
    .sort((a, b) => a.dte - b.dte);

  if (points.length < 2) {
    return { points, frontBackSpread: NaN, shape: 'flat', score: 0, note: 'Insufficient expiries for a term structure read.' };
  }

  const front = points[0].iv;
  const back = points[points.length - 1].iv;
  const frontBackSpread = (front - back) * 100;

  const shape: TermStructure['shape'] =
    frontBackSpread > 1.5 ? 'backwardation' : frontBackSpread < -1.5 ? 'contango' : 'flat';

  // Backwardation means the market expects near-term turbulence. It resolves
  // upward far more often than not once the event passes, but it is a warning
  // for anyone holding through it.
  const score = shape === 'backwardation' ? -0.3 : shape === 'contango' ? 0.15 : 0;

  const note =
    shape === 'backwardation'
      ? `Front-month IV exceeds back-month by ${frontBackSpread.toFixed(1)} points — the market is pricing a near-term event. Expect elevated realised movement and decay in the front once it passes.`
      : shape === 'contango'
        ? `Normal upward-sloping term structure (${Math.abs(frontBackSpread).toFixed(1)} points) — no near-term stress priced.`
        : 'Term structure is flat.';

  return { points, frontBackSpread, shape, score, note };
}

/* ---------------------------------------------------------------------------
   POSITIONING: put/call, max pain, gamma exposure
   ------------------------------------------------------------------------- */

export interface Positioning {
  putCallVolume: number;
  putCallOi: number;
  /** Strike where the most option value expires worthless. */
  maxPain: number;
  maxPainDistancePct: number;
  /** Net dealer gamma in $ per 1% move. Positive = dealers dampen moves. */
  gammaExposure: number;
  /** The strike with the largest gamma concentration — a magnet/pin level. */
  gammaFlip: number;
  /** Strikes with outsized open interest, which act as magnets into expiry. */
  oiWalls: { strike: number; oi: number; type: OptionType }[];
  totalCallOi: number;
  totalPutOi: number;
  score: number;
  note: string;
}

export function analysePositioning(chain: OptionChain, nearestExpiryOnly = true): Positioning {
  let contracts = chain.contracts;
  if (nearestExpiryOnly && chain.expiries.length) {
    const front = Math.min(...chain.expiries);
    contracts = contracts.filter((c) => c.expiry === front);
  }

  const calls = contracts.filter((c) => c.type === 'call');
  const puts = contracts.filter((c) => c.type === 'put');

  const callVol = calls.reduce((a, c) => a + c.volume, 0);
  const putVol = puts.reduce((a, c) => a + c.volume, 0);
  const callOi = calls.reduce((a, c) => a + c.openInterest, 0);
  const putOi = puts.reduce((a, c) => a + c.openInterest, 0);

  // --- max pain: the strike minimising total in-the-money option value ----
  const strikes = [...new Set(contracts.map((c) => c.strike))].sort((a, b) => a - b);
  let maxPain = chain.spot;
  let minPain = Infinity;
  for (const k of strikes) {
    let pain = 0;
    for (const c of calls) pain += Math.max(0, k - c.strike) * c.openInterest;
    for (const p of puts) pain += Math.max(0, p.strike - k) * p.openInterest;
    if (pain < minPain) {
      minPain = pain;
      maxPain = k;
    }
  }

  // --- dealer gamma exposure ---------------------------------------------
  // Convention: dealers are short calls and long puts against customer flow,
  // so call gamma contributes positively and put gamma negatively to the
  // dealer book. Positive total GEX means dealers hedge *against* moves,
  // suppressing realised volatility; negative GEX amplifies it.
  let gex = 0;
  let maxGammaStrike = chain.spot;
  let maxGamma = -Infinity;
  const gammaByStrike = new Map<number, number>();

  for (const c of contracts) {
    const sign = c.type === 'call' ? 1 : -1;
    const contribution = c.gamma * c.openInterest * 100 * chain.spot * chain.spot * 0.01 * sign;
    gex += contribution;
    const prev = gammaByStrike.get(c.strike) ?? 0;
    const agg = prev + Math.abs(c.gamma * c.openInterest);
    gammaByStrike.set(c.strike, agg);
    if (agg > maxGamma) {
      maxGamma = agg;
      maxGammaStrike = c.strike;
    }
  }

  const oiWalls = contracts
    .filter((c) => c.openInterest > 0)
    .sort((a, b) => b.openInterest - a.openInterest)
    .slice(0, 5)
    .map((c) => ({ strike: c.strike, oi: c.openInterest, type: c.type }));

  const putCallOi = callOi > 0 ? putOi / callOi : NaN;
  const putCallVolume = callVol > 0 ? putVol / callVol : NaN;

  // Put/call ratio is a contrarian gauge at extremes.
  let score = 0;
  if (Number.isFinite(putCallVolume)) {
    if (putCallVolume > 1.3) score += 0.3;       // heavy put buying = washed out
    else if (putCallVolume < 0.5) score -= 0.25; // heavy call buying = froth
  }
  if (gex < 0) score -= 0.1;                     // negative gamma = trend-amplifying

  const maxPainDistancePct = chain.spot > 0 ? ((maxPain - chain.spot) / chain.spot) * 100 : NaN;

  const note = [
    Number.isFinite(putCallVolume) ? `Put/call volume ${putCallVolume.toFixed(2)}` : null,
    `max pain ${maxPain.toFixed(2)} (${maxPainDistancePct >= 0 ? '+' : ''}${maxPainDistancePct.toFixed(1)}%)`,
    gex >= 0
      ? 'positive dealer gamma — hedging flow dampens intraday range'
      : 'negative dealer gamma — hedging flow amplifies moves, expect wider swings',
  ].filter(Boolean).join(', ');

  return {
    putCallVolume,
    putCallOi,
    maxPain,
    maxPainDistancePct,
    gammaExposure: gex,
    gammaFlip: maxGammaStrike,
    oiWalls,
    totalCallOi: callOi,
    totalPutOi: putOi,
    score: clamp(score, -1, 1),
    note,
  };
}

/* ---------------------------------------------------------------------------
   OPTIONS BASKET — the user-tracked portfolio of option positions
   ------------------------------------------------------------------------- */

export interface BasketPosition {
  id: string;
  symbol: string;
  type: OptionType;
  strike: number;
  expiry: number;
  quantity: number;        // contracts; negative = short
  entryPrice: number;      // premium per share
  entryDate: number;
  underlyingEntry: number;
}

export interface BasketPositionValuation extends BasketPosition {
  dte: number;
  spot: number;
  iv: number;
  markPrice: number;
  costBasis: number;
  marketValue: number;
  pnl: number;
  pnlPct: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  /** Dollar delta: exposure equivalent in underlying terms. */
  dollarDelta: number;
  /** Theta as a percentage of position value per day. */
  thetaDecayPct: number;
  breakeven: number;
  probItm: number;
}

export interface BasketSummary {
  positions: BasketPositionValuation[];
  totalCost: number;
  totalValue: number;
  totalPnl: number;
  totalPnlPct: number;
  netDelta: number;
  netGamma: number;
  netTheta: number;
  netVega: number;
  netDollarDelta: number;
  /** Average IV across the basket, OI-weighted by position size. */
  avgIv: number;
  /** Portfolio-level warnings a risk manager would raise. */
  warnings: string[];
}

/** Mark a basket of option positions to model and aggregate the greeks.
 *  This is what turns a list of tickets into a risk position you can manage. */
export function valueBasket(
  positions: readonly BasketPosition[],
  spots: Record<string, number>,
  ivs: Record<string, number>,
  riskFree = 0.045,
  now = Date.now(),
): BasketSummary {
  const valued: BasketPositionValuation[] = [];

  for (const p of positions) {
    const spot = spots[p.symbol] ?? p.underlyingEntry;
    const iv = ivs[p.symbol] ?? 0.35;
    const dte = Math.max(0, (p.expiry - now) / 86400000);
    const T = dte / 365;

    const g = blackScholes(spot, p.strike, T, riskFree, iv, p.type);
    const multiplier = 100;
    const costBasis = p.entryPrice * p.quantity * multiplier;
    const marketValue = g.price * p.quantity * multiplier;
    const pnl = marketValue - costBasis;

    valued.push({
      ...p,
      dte,
      spot,
      iv,
      markPrice: g.price,
      costBasis,
      marketValue,
      pnl,
      pnlPct: costBasis !== 0 ? (pnl / Math.abs(costBasis)) * 100 : 0,
      delta: g.delta * p.quantity * multiplier,
      gamma: g.gamma * p.quantity * multiplier,
      theta: g.theta * p.quantity * multiplier,
      vega: g.vega * p.quantity * multiplier,
      dollarDelta: g.delta * p.quantity * multiplier * spot,
      thetaDecayPct: marketValue !== 0 ? (g.theta * p.quantity * multiplier / Math.abs(marketValue)) * 100 : 0,
      breakeven: p.type === 'call' ? p.strike + p.entryPrice : p.strike - p.entryPrice,
      probItm: g.probItm,
    });
  }

  const totalCost = valued.reduce((a, v) => a + v.costBasis, 0);
  const totalValue = valued.reduce((a, v) => a + v.marketValue, 0);
  const netTheta = valued.reduce((a, v) => a + v.theta, 0);
  const netVega = valued.reduce((a, v) => a + v.vega, 0);
  const netDelta = valued.reduce((a, v) => a + v.delta, 0);

  const warnings: string[] = [];
  const shortDated = valued.filter((v) => v.dte < 7 && v.quantity > 0);
  if (shortDated.length) {
    warnings.push(
      `${shortDated.length} long position${shortDated.length > 1 ? 's' : ''} inside 7 DTE — gamma and theta both go vertical here.`,
    );
  }
  if (totalValue !== 0 && Math.abs(netTheta / totalValue) > 0.05) {
    warnings.push(
      `Basket is bleeding ${Math.abs((netTheta / totalValue) * 100).toFixed(1)}% of its value per day to time decay.`,
    );
  }
  const concentration = new Map<string, number>();
  for (const v of valued) {
    concentration.set(v.symbol, (concentration.get(v.symbol) ?? 0) + Math.abs(v.marketValue));
  }
  for (const [sym, val] of concentration) {
    if (Math.abs(totalValue) > 0 && val / Math.abs(totalValue) > 0.5) {
      warnings.push(`${sym} is over half the basket's market value — single-name concentration risk.`);
    }
  }
  if (netVega !== 0 && Math.abs(netVega) > Math.abs(totalValue) * 0.5) {
    warnings.push('Basket is heavily vega-exposed — a volatility crush would dominate any directional gain.');
  }

  const ivWeights = valued.map((v) => Math.abs(v.marketValue));
  const ivWeightSum = ivWeights.reduce((a, b) => a + b, 0);
  const avgIv = ivWeightSum > 0
    ? valued.reduce((a, v, i) => a + v.iv * ivWeights[i], 0) / ivWeightSum
    : NaN;

  return {
    positions: valued,
    totalCost,
    totalValue,
    totalPnl: totalValue - totalCost,
    totalPnlPct: totalCost !== 0 ? ((totalValue - totalCost) / Math.abs(totalCost)) * 100 : 0,
    netDelta,
    netGamma: valued.reduce((a, v) => a + v.gamma, 0),
    netTheta,
    netVega,
    netDollarDelta: valued.reduce((a, v) => a + v.dollarDelta, 0),
    avgIv,
    warnings,
  };
}
