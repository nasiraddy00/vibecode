/* ===========================================================================
   Trade plan construction: from a directional score to an executable ticket.

   A signal without a stop, a size and a target is an opinion, not a trade.
   This module turns the ensemble's conviction into all three, and decides
   whether the position is better expressed in spot or in options.
   ========================================================================= */

import type {
  Direction, Horizon, TradePlan, OptionLegSuggestion, MarketRegime,
} from '../types';
import type { IndicatorSnapshot } from '../indicators';
import { clamp, scale } from '../util/math';
import { blackScholes, strikeForDelta, expectedMove } from '../options/blackscholes';
import type { IvStats } from '../options/chain';

export interface PlanInput {
  snapshot: IndicatorSnapshot;
  score: number;            // net directional score, [-1, 1]
  conviction: number;       // 0-100
  regime: MarketRegime;
  horizon: Horizon;
  /** Account equity available for the trade. */
  equity: number;
  /** Maximum fraction of equity to risk on any single trade. */
  maxRiskFraction?: number;
  /** Historical win rate estimate for Kelly sizing, 0-1. */
  estimatedWinRate?: number;
  /** Option pricing context; when absent the plan stays in spot. */
  iv?: IvStats;
  /** Whether the instrument has a liquid options market at all. */
  optionsAvailable?: boolean;
  riskFreeRate?: number;
}

/** Build the full trade plan. */
export function buildTradePlan(input: PlanInput): TradePlan {
  const {
    snapshot: s, score, conviction, regime, horizon, equity,
    maxRiskFraction = 0.02, estimatedWinRate, iv, optionsAvailable = false,
    riskFreeRate = 0.045,
  } = input;

  const price = s.price;
  const rawAtr = s.atr14;
  const notes: string[] = [];

  // An instrument that is not moving cannot be traded: there is no edge to
  // capture and no honest place to put a stop. This is a backstop against
  // degenerate inputs (a halted name, an illiquid series, a padded feed)
  // producing a confident-looking ticket out of numerical artefacts.
  const MIN_ATR_PCT = 0.0005;   // 5bp of price
  if (!(price > 0) || !Number.isFinite(rawAtr) || rawAtr / price < MIN_ATR_PCT) {
    return {
      direction: 'flat',
      instrument: 'none',
      entry: price,
      stop: NaN,
      targets: [],
      riskReward: NaN,
      riskFraction: 0,
      size: 0,
      notional: 0,
      horizon,
      expectedBars: 0,
      notes: [
        `No trade: average true range is ${Number.isFinite(rawAtr) ? `${((rawAtr / price) * 100).toFixed(3)}% of price` : 'unmeasurable'}, below the ${(MIN_ATR_PCT * 100).toFixed(2)}% floor. ` +
        'An instrument this static offers nothing to trade and no defensible stop distance — any signal here is a numerical artefact, not a read on the market.',
      ],
    };
  }

  const atr = rawAtr;

  // --- direction ----------------------------------------------------------
  // A conviction floor prevents the engine from issuing a directional
  // instruction it does not actually believe. Below it, FLAT is the honest
  // answer, and saying so is more valuable than manufacturing a trade.
  const CONVICTION_FLOOR = 32;
  const direction: Direction =
    conviction < CONVICTION_FLOOR ? 'flat' : score > 0 ? 'long' : 'short';

  if (direction === 'flat') {
    notes.push(
      `Conviction of ${conviction.toFixed(0)} is below the ${CONVICTION_FLOOR} threshold required to commit capital. ` +
      'The signals in this instrument disagree with each other; taking no position is the correct response, not a failure of the model.',
    );
    return {
      direction: 'flat',
      instrument: 'none',
      entry: price,
      stop: NaN,
      targets: [],
      riskReward: NaN,
      riskFraction: 0,
      size: 0,
      notional: 0,
      horizon,
      expectedBars: 0,
      notes,
    };
  }

  const isLong = direction === 'long';

  // --- stop placement ------------------------------------------------------
  // ATR sets the floor; structure sets the real level. A stop should sit just
  // beyond a level the market must break to invalidate the thesis, but never
  // so close that ordinary noise takes it out.
  const atrMultiple = stopMultiple(regime, horizon);
  const atrStop = isLong ? price - atr * atrMultiple : price + atr * atrMultiple;

  const structuralStop = findStructuralStop(s, isLong, price, atr);
  let stop = atrStop;
  if (Number.isFinite(structuralStop)) {
    // Use the structural level when it is close enough to be the real
    // invalidation point. Note this REPLACES the ATR stop rather than being
    // combined with it: taking min/max against the ATR stop would let the ATR
    // distance act as a floor on width, so structure could only ever widen the
    // stop and never tighten it — which defeats the entire purpose and, in a
    // high-volatility regime, produces stops absurdly far from price.
    const structuralDistance = Math.abs(price - structuralStop);
    if (structuralDistance <= atr * atrMultiple * 1.8 && structuralDistance >= atr * 0.5) {
      stop = isLong ? structuralStop - atr * 0.15 : structuralStop + atr * 0.15;
      notes.push(
        `Stop anchored to structure at ${structuralStop.toFixed(2)} with a ${(atr * 0.15).toFixed(2)} buffer, rather than to a raw ATR multiple. ` +
        'Stops placed at round ATR distances sit exactly where everyone else\'s sit, which is where price goes to find liquidity.',
      );
    } else {
      notes.push(`Stop set at ${atrMultiple.toFixed(1)}x ATR (${Math.abs(price - atrStop).toFixed(2)}) — no usable structural level within range.`);
    }
  } else {
    notes.push(`Stop set at ${atrMultiple.toFixed(1)}x ATR — no swing or level structure identified.`);
  }

  // A stop wider than a third of the instrument's price is not a stop, it is a
  // position with no exit plan. Rather than truncate it — which would silently
  // move the invalidation point somewhere the analysis never justified — the
  // engine declines the trade and says why.
  const maxStopPct = 0.35;
  if (Math.abs(price - stop) / price > maxStopPct) {
    return {
      direction: 'flat',
      instrument: 'none',
      entry: price,
      stop: NaN,
      targets: [],
      riskReward: NaN,
      riskFraction: 0,
      size: 0,
      notional: 0,
      horizon,
      expectedBars: 0,
      notes: [
        ...notes,
        `No trade: the volatility-implied stop sits ${((Math.abs(price - stop) / price) * 100).toFixed(0)}% from entry, beyond the ${(maxStopPct * 100).toFixed(0)}% ceiling. ` +
        `With ATR at ${((atr / price) * 100).toFixed(1)}% of price, any stop tight enough to size around would be inside the noise, and any stop outside the noise is too far to define risk. ` +
        'This instrument is currently too disorderly for a defined-risk position at this horizon.',
      ],
    };
  }

  const riskPerUnit = Math.abs(price - stop);
  if (!(riskPerUnit > 0)) {
    return {
      direction: 'flat', instrument: 'none', entry: price, stop: NaN, targets: [],
      riskReward: NaN, riskFraction: 0, size: 0, notional: 0, horizon,
      expectedBars: 0,
      notes: ['Unable to establish a valid stop distance; no trade.'],
    };
  }

  // --- targets -------------------------------------------------------------
  const targets = buildTargets(s, isLong, price, atr, riskPerUnit, regime);
  const riskReward = targets.length ? Math.abs(targets[0] - price) / riskPerUnit : NaN;

  if (Number.isFinite(riskReward) && riskReward < 1.2) {
    notes.push(
      `First target offers only ${riskReward.toFixed(2)}:1 against the stop. ` +
      'Positive expectancy at this ratio requires a win rate above 45%, which few short-horizon systems sustain. Consider waiting for a better entry level.',
    );
  }

  // --- position sizing -----------------------------------------------------
  const riskFraction = sizeRisk(conviction, regime, maxRiskFraction, estimatedWinRate, riskReward, notes);
  const riskCapital = equity * riskFraction;
  const rawSize = riskCapital / riskPerUnit;
  const notionalCap = equity * leverageCap(regime);
  const size = Math.max(0, Math.min(rawSize, notionalCap / price));
  const notional = size * price;

  if (size < rawSize * 0.99) {
    notes.push(
      `Position capped by notional exposure limit (${(leverageCap(regime) * 100).toFixed(0)}% of equity) rather than by the risk budget. ` +
      'A tight stop can imply an enormous position; the notional cap is what stops a "low risk" trade from becoming a concentration problem.',
    );
  }

  // --- expression: spot or options ----------------------------------------
  let instrument: TradePlan['instrument'] = 'spot';
  let optionLeg: OptionLegSuggestion | undefined;

  if (optionsAvailable && iv) {
    const chosen = chooseOptionStructure({
      price, isLong, iv, horizon, conviction, atr, riskFreeRate, targets, notes,
    });
    if (chosen) {
      instrument = chosen.instrument;
      optionLeg = chosen.leg;
    }
  }

  const expectedBars = expectedHoldingBars(horizon, regime);

  return {
    direction,
    instrument,
    entry: price,
    stop,
    targets,
    riskReward,
    riskFraction,
    size,
    notional,
    horizon,
    expectedBars,
    optionLeg,
    notes,
  };
}

/* ---------------------------------------------------------------------------
   STOPS
   ------------------------------------------------------------------------- */

function stopMultiple(regime: MarketRegime, horizon: Horizon): number {
  const base =
    horizon === 'intraday' ? 1.3 : horizon === 'swing' ? 2.2 : 3.2;
  const regimeAdj =
    regime === 'high_vol_shock' ? 1.6
    : regime === 'range' ? 0.85
    : regime.includes('strong') ? 1.15
    : 1;
  return base * regimeAdj;
}

/** Find the nearest meaningful level beyond which the thesis is wrong. */
function findStructuralStop(
  s: IndicatorSnapshot, isLong: boolean, price: number, atr: number,
): number {
  const candidates: number[] = [];

  // Support/resistance clusters.
  for (const lvl of s.levels) {
    if (isLong && lvl.price < price && lvl.type === 'support') candidates.push(lvl.price);
    if (!isLong && lvl.price > price && lvl.type === 'resistance') candidates.push(lvl.price);
  }

  // Swing structure.
  if (isLong && Number.isFinite(s.structure.lastSwingLow) && s.structure.lastSwingLow < price) {
    candidates.push(s.structure.lastSwingLow);
  }
  if (!isLong && Number.isFinite(s.structure.lastSwingHigh) && s.structure.lastSwingHigh > price) {
    candidates.push(s.structure.lastSwingHigh);
  }

  // The SuperTrend rail is a purpose-built trailing stop.
  if (Number.isFinite(s.stLevel)) {
    if (isLong && s.stLevel < price) candidates.push(s.stLevel);
    if (!isLong && s.stLevel > price) candidates.push(s.stLevel);
  }

  // Value-area edge.
  if (Number.isFinite(s.profile.val) && isLong && s.profile.val < price) candidates.push(s.profile.val);
  if (Number.isFinite(s.profile.vah) && !isLong && s.profile.vah > price) candidates.push(s.profile.vah);

  if (!candidates.length) return NaN;

  // Nearest level that is at least half an ATR away — anything closer is
  // inside the noise band and will be taken out by ordinary movement.
  const valid = candidates.filter((c) => Math.abs(price - c) >= atr * 0.5);
  if (!valid.length) return NaN;

  return isLong ? Math.max(...valid) : Math.min(...valid);
}

/* ---------------------------------------------------------------------------
   TARGETS
   ------------------------------------------------------------------------- */

function buildTargets(
  s: IndicatorSnapshot, isLong: boolean, price: number,
  atr: number, risk: number, regime: MarketRegime,
): number[] {
  const targets: number[] = [];

  // Target 1: the nearest opposing structural level, if it offers enough room.
  const opposing = s.levels
    .filter((l) => (isLong ? l.price > price && l.type === 'resistance' : l.price < price && l.type === 'support'))
    .sort((a, b) => (isLong ? a.price - b.price : b.price - a.price));

  if (opposing.length && Math.abs(opposing[0].price - price) > risk * 1.1) {
    targets.push(opposing[0].price);
  } else {
    // Otherwise a measured R multiple, scaled by how well the regime trends.
    const mult = regime.includes('strong') ? 2.4 : regime === 'range' ? 1.4 : 1.9;
    targets.push(isLong ? price + risk * mult : price - risk * mult);
  }

  // Target 2: a further extension.
  const extMult = regime.includes('strong') ? 4.0 : regime === 'range' ? 2.2 : 3.1;
  targets.push(isLong ? price + risk * extMult : price - risk * extMult);

  // Target 3: the range extreme, when it is beyond target 2.
  const extreme = isLong ? s.high52w : s.low52w;
  if (Number.isFinite(extreme)) {
    const beyond = isLong ? extreme > targets[1] : extreme < targets[1];
    if (beyond) targets.push(extreme);
  }

  // A short target below zero is arithmetic, not analysis. Floor short targets
  // at a fraction of spot and drop any that collapse onto the entry.
  const floor = price * 0.05;
  return targets
    .map((t) => (isLong ? t : Math.max(t, floor)))
    .filter((t, i, arr) => Number.isFinite(t) && t > 0 && arr.indexOf(t) === i)
    .filter((t) => Math.abs(t - price) > price * 0.002);
}

/* ---------------------------------------------------------------------------
   SIZING
   ------------------------------------------------------------------------- */

/** Risk fraction from conviction, tempered by a fractional Kelly cap.
 *
 *  Full Kelly is the growth-optimal bet size and it is also far too
 *  aggressive to survive: it assumes the win rate and payoff are known
 *  exactly, and the drawdowns it produces are unbearable in practice. A
 *  quarter-Kelly cap is the standard professional compromise, and it is
 *  applied here as a ceiling on top of a conviction-scaled base. */
function sizeRisk(
  conviction: number,
  regime: MarketRegime,
  maxRiskFraction: number,
  winRate: number | undefined,
  riskReward: number,
  notes: string[],
): number {
  // Base: conviction 32 -> 25% of max, conviction 100 -> 100% of max.
  const convictionScale = clamp(scale(conviction, 32, 100, 0.25, 1), 0.15, 1);
  let fraction = maxRiskFraction * convictionScale;

  // Regime damping.
  const regimeMult =
    regime === 'high_vol_shock' ? 0.4
    : regime === 'range' ? 0.7
    : regime.includes('choppy') ? 0.75
    : regime.includes('strong') ? 1.1
    : 1;
  fraction *= regimeMult;

  if (regime === 'high_vol_shock') {
    notes.push(
      'Position size cut to 40% of normal for the volatility regime. In a shock, the distribution of outcomes widens far faster than the edge does.',
    );
  }

  // Fractional Kelly ceiling where a win rate and payoff are both available.
  if (winRate != null && Number.isFinite(riskReward) && riskReward > 0) {
    const b = riskReward;
    const pWin = clamp(winRate, 0.01, 0.99);
    const kelly = (pWin * (b + 1) - 1) / b;
    if (kelly > 0) {
      const quarterKelly = kelly * 0.25;
      if (quarterKelly < fraction) {
        notes.push(
          `Risk capped at quarter-Kelly (${(quarterKelly * 100).toFixed(2)}% of equity) given an estimated ${(pWin * 100).toFixed(0)}% win rate at ${b.toFixed(1)}:1. ` +
          'Full Kelly is growth-optimal only if the edge is known exactly; in practice it produces drawdowns nobody survives.',
        );
        fraction = quarterKelly;
      }
    } else {
      notes.push(
        `Kelly criterion returns a negative fraction at a ${(pWin * 100).toFixed(0)}% win rate and ${b.toFixed(1)}:1 payoff — this configuration has no mathematical edge. Size reduced to the minimum.`,
      );
      fraction = Math.min(fraction, maxRiskFraction * 0.15);
    }
  }

  return clamp(fraction, 0, maxRiskFraction);
}

/** Maximum notional as a multiple of equity, by regime. */
function leverageCap(regime: MarketRegime): number {
  if (regime === 'high_vol_shock') return 0.35;
  if (regime === 'range') return 0.6;
  if (regime.includes('strong')) return 1.0;
  return 0.8;
}

function expectedHoldingBars(horizon: Horizon, regime: MarketRegime): number {
  const base = horizon === 'intraday' ? 6 : horizon === 'swing' ? 12 : 45;
  return Math.round(base * (regime.includes('strong') ? 1.4 : regime === 'range' ? 0.7 : 1));
}

/* ---------------------------------------------------------------------------
   OPTION STRUCTURE SELECTION
   ------------------------------------------------------------------------- */

interface OptionChoice {
  instrument: TradePlan['instrument'];
  leg: OptionLegSuggestion;
}

/** Decide whether to express the view in options, and which structure.
 *
 *  The decision rests on implied volatility rather than on direction. Buying
 *  a call because you are bullish, without checking what you are paying for
 *  volatility, is how most retail option buyers lose money even when they get
 *  the direction right. */
function chooseOptionStructure(args: {
  price: number;
  isLong: boolean;
  iv: IvStats;
  horizon: Horizon;
  conviction: number;
  atr: number;
  riskFreeRate: number;
  targets: number[];
  notes: string[];
}): OptionChoice | null {
  const { price, isLong, iv, horizon, conviction, riskFreeRate, notes } = args;

  const dte = horizon === 'intraday' ? 7 : horizon === 'swing' ? 30 : 75;
  const T = dte / 365;
  const type: 'call' | 'put' = isLong ? 'call' : 'put';

  // Expensive volatility argues for spreads (or for spot); cheap volatility
  // argues for outright long premium.
  const premiumRich = iv.premiumBias === 'sell';
  const premiumCheap = iv.premiumBias === 'buy';

  if (premiumRich && conviction < 70) {
    notes.push(
      `Options are not the right expression here: IV rank is ${(iv.ivRank * 100).toFixed(0)} and implied is running ${(iv.vrp * 100).toFixed(1)} points above realised. ` +
      'Buying premium at these levels means the underlying has to move more than the market expects just to break even. Spot is the cleaner trade.',
    );
    return null;
  }

  // Delta selection: higher conviction takes more delta (closer to the money),
  // lower conviction takes cheaper, further-out strikes.
  const targetDelta = clamp(scale(conviction, 32, 100, 0.28, 0.62), 0.2, 0.7);
  const sigma = iv.iv30 > 0 ? iv.iv30 : 0.35;
  const strike = strikeForDelta(price, T, riskFreeRate, sigma, targetDelta, type);
  const roundedStrike = roundStrike(strike, price);

  const g = blackScholes(price, roundedStrike, T, riskFreeRate, sigma, type);
  const breakeven = type === 'call' ? roundedStrike + g.price : roundedStrike - g.price;
  const em = expectedMove(price, T, sigma);

  const structure: TradePlan['instrument'] =
    premiumRich ? (isLong ? 'call_spread' : 'put_spread') : type;

  const reason = premiumCheap
    ? `IV rank ${(iv.ivRank * 100).toFixed(0)} makes long premium unusually cheap. A ${(targetDelta * 100).toFixed(0)}-delta ${type} gives leveraged directional exposure with risk capped at the premium paid, and the low IV means less of the position is spent on volatility that has to be given back.`
    : premiumRich
      ? `IV rank ${(iv.ivRank * 100).toFixed(0)} makes outright premium expensive, so this is structured as a debit spread: selling a further strike against the long leg finances part of the position and cuts the vega exposure that would otherwise dominate the trade.`
      : `IV is mid-range (rank ${(iv.ivRank * 100).toFixed(0)}). A ${(targetDelta * 100).toFixed(0)}-delta ${type} at ${dte} DTE balances leverage against decay.`;

  notes.push(
    `Expected move over ${dte} days at ${(sigma * 100).toFixed(0)}% IV is ±${em.pct.toFixed(1)}% (${em.lower.toFixed(2)}-${em.upper.toFixed(2)}). ` +
    `The breakeven of ${breakeven.toFixed(2)} sits ${Math.abs((breakeven - price) / price * 100).toFixed(1)}% away, which is ${Math.abs(breakeven - price) < em.absolute ? 'inside' : 'outside'} the one-standard-deviation move — ` +
    `${Math.abs(breakeven - price) < em.absolute ? 'a reasonable place to be' : 'meaning this needs an outsized move just to break even'}.`,
  );

  return {
    instrument: structure,
    leg: {
      type,
      strike: roundedStrike,
      dte,
      expiry: new Date(Date.now() + dte * 86400000).toISOString().slice(0, 10),
      targetDelta,
      estimatedIV: sigma,
      estimatedPremium: g.price,
      breakeven,
      reason,
    },
  };
}

/** Round to a plausible listed strike increment. */
function roundStrike(strike: number, spot: number): number {
  const increment =
    spot < 25 ? 0.5
    : spot < 100 ? 1
    : spot < 250 ? 2.5
    : spot < 1000 ? 5
    : spot < 5000 ? 25
    : 500;
  return Math.round(strike / increment) * increment;
}
