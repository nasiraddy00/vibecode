/* ===========================================================================
   The volatility complex: VIX and its term structure, the volatility risk
   premium, and cross-asset stress.

   Volatility is the market's own estimate of how wrong it might be. Read
   correctly it front-runs price far more often than price front-runs it.
   ========================================================================= */

import type { Bar, Provenance } from '../types';
import { clamp, scale, mean, percentileRank, stdev, realisedVol } from '../util/math';
import { closes, last } from '../indicators/core';
import { historicalVol } from '../indicators/volatility';

export interface VixComplex {
  /** Spot VIX — 30-day implied vol on SPX. */
  vix: number;
  vixChange: number;
  vixChangePct: number;
  /** 9-day VIX; spikes above VIX signal immediate event risk. */
  vix9d: number;
  /** 3-month VIX. */
  vix3m: number;
  /** 6-month VIX. */
  vix6m: number;
  /** Volatility of volatility. */
  vvix: number;
  /** VIX futures front-month basis vs spot, in points. */
  futuresBasis: number;

  /** VIX9D/VIX — above 1 means acute near-term stress. */
  ratio9d30d: number;
  /** VIX/VIX3M — the canonical term-structure gauge. Above 1 is
   *  backwardation, which historically marks panic and mean-reverts. */
  ratio30d3m: number;
  term: 'steep_contango' | 'contango' | 'flat' | 'backwardation' | 'steep_backwardation';

  /** Realised vol on SPX over the trailing 21 sessions, annualised %. */
  realised21d: number;
  /** VIX minus realised — the volatility risk premium in points. */
  vrp: number;

  /** Percentile of VIX in its own 1-year history. */
  vixPercentile: number;
  regime: VolRegime;
  /** Directional read for equity risk, [-1, 1]. */
  score: number;
  /** How much to trust the read. */
  confidence: number;
  interpretation: string;
  tradingImplication: string;
  provenance: Provenance;
}

export type VolRegime =
  | 'complacent'      // VIX < 13
  | 'calm'            // 13-16
  | 'normal'          // 16-20
  | 'elevated'        // 20-27
  | 'stressed'        // 27-35
  | 'panic';          // > 35

export function classifyVolRegime(vix: number): VolRegime {
  if (vix < 13) return 'complacent';
  if (vix < 16) return 'calm';
  if (vix < 20) return 'normal';
  if (vix < 27) return 'elevated';
  if (vix < 35) return 'stressed';
  return 'panic';
}

export const VOL_REGIME_META: Record<VolRegime, { label: string; colour: string; description: string }> = {
  complacent: {
    label: 'COMPLACENT',
    colour: 'amber',
    description: 'Volatility is priced for perfection. Hedges are cheap and the downside tail is underpriced.',
  },
  calm: {
    label: 'CALM',
    colour: 'long',
    description: 'Orderly conditions. Trend-following and premium selling both work; gaps are rare.',
  },
  normal: {
    label: 'NORMAL',
    colour: 'ink',
    description: 'Typical two-way market. No volatility edge in either direction.',
  },
  elevated: {
    label: 'ELEVATED',
    colour: 'amber',
    description: 'Risk is being repriced. Position sizes should come down; stops need more room.',
  },
  stressed: {
    label: 'STRESSED',
    colour: 'short',
    description: 'Correlations are converging toward one. Diversification stops working exactly when it is needed.',
  },
  panic: {
    label: 'PANIC',
    colour: 'short',
    description: 'Forced liquidation regime. Historically the best long-horizon entries and the worst short-horizon ones.',
  },
};

/** Build the full VIX assessment. `vixHistory` should be the trailing year of
 *  daily closes; without it the percentile falls back to a neutral 0.5. */
export function assessVix(input: {
  vix: number;
  vixPrev?: number;
  vix9d?: number;
  vix3m?: number;
  vix6m?: number;
  vvix?: number;
  futuresFront?: number;
  vixHistory?: readonly number[];
  spxBars?: readonly Bar[];
  provenance?: Provenance;
}): VixComplex {
  const {
    vix, vixPrev = vix, vix9d = NaN, vix3m = NaN, vix6m = NaN,
    vvix = NaN, futuresFront = NaN, vixHistory = [], spxBars = [],
    provenance = 'derived',
  } = input;

  const vixChange = vix - vixPrev;
  const vixChangePct = vixPrev !== 0 ? (vixChange / vixPrev) * 100 : 0;

  const ratio9d30d = Number.isFinite(vix9d) && vix > 0 ? vix9d / vix : NaN;
  const ratio30d3m = Number.isFinite(vix3m) && vix3m > 0 ? vix / vix3m : NaN;

  const term: VixComplex['term'] =
    !Number.isFinite(ratio30d3m) ? 'flat'
    : ratio30d3m > 1.10 ? 'steep_backwardation'
    : ratio30d3m > 1.00 ? 'backwardation'
    : ratio30d3m > 0.95 ? 'flat'
    : ratio30d3m > 0.88 ? 'contango'
    : 'steep_contango';

  const realised21d = spxBars.length >= 22
    ? realisedVol(closes(spxBars).slice(-22)) * 100
    : NaN;
  const vrp = Number.isFinite(realised21d) ? vix - realised21d : NaN;

  const hist = vixHistory.filter(Number.isFinite);
  const vixPercentile = hist.length >= 30 ? percentileRank(hist, vix) : 0.5;

  const regime = classifyVolRegime(vix);

  // --- directional score ---------------------------------------------------
  // Equity risk appetite is inversely related to volatility, but the
  // relationship is strongly non-linear and reverses at the extremes:
  // extreme panic is the single best contrarian long signal in the dataset,
  // while complacency is a slow-burn warning rather than an immediate sell.
  let score = 0;
  if (vix < 13) score = -0.15;                       // complacency: mild caution
  else if (vix < 16) score = 0.25;                   // calm: constructive
  else if (vix < 20) score = 0.1;
  else if (vix < 27) score = -0.3;                   // repricing: defensive
  else if (vix < 35) score = -0.15;                  // stressed but stretching
  else score = 0.45;                                 // panic: contrarian long

  // Term structure adjusts the read.
  if (term === 'steep_backwardation') score += 0.2;  // capitulation footprint
  else if (term === 'backwardation') score -= 0.15;
  else if (term === 'steep_contango') score += 0.1;

  // A fast spike from a low base is more bearish than a high, stable level.
  if (vixChangePct > 20 && vix < 30) score -= 0.2;
  if (vixChangePct < -12 && vix > 25) score += 0.15; // vol crush = relief rally

  score = clamp(score, -1, 1);

  const confidence = provenance === 'simulated' ? 0.3 : Number.isFinite(ratio30d3m) ? 0.8 : 0.6;

  const interpretation = [
    `VIX ${vix.toFixed(2)} (${vixChangePct >= 0 ? '+' : ''}${vixChangePct.toFixed(1)}%) sits in the ${VOL_REGIME_META[regime].label.toLowerCase()} band`,
    hist.length >= 30 ? `, the ${(vixPercentile * 100).toFixed(0)}th percentile of the past year` : '',
    Number.isFinite(ratio30d3m)
      ? `. The 30d/3m ratio of ${ratio30d3m.toFixed(3)} puts the curve in ${term.replace('_', ' ')}`
      : '',
    Number.isFinite(vrp)
      ? `, with implied running ${vrp >= 0 ? '' : '-'}${Math.abs(vrp).toFixed(1)} points ${vrp >= 0 ? 'above' : 'below'} realised`
      : '',
    '.',
  ].join('');

  const tradingImplication = buildImplication(regime, term, vrp, vixChangePct);

  return {
    vix, vixChange, vixChangePct, vix9d, vix3m, vix6m, vvix,
    futuresBasis: Number.isFinite(futuresFront) ? futuresFront - vix : NaN,
    ratio9d30d, ratio30d3m, term,
    realised21d, vrp, vixPercentile, regime,
    score, confidence, interpretation, tradingImplication, provenance,
  };
}

function buildImplication(
  regime: VolRegime,
  term: VixComplex['term'],
  vrp: number,
  changePct: number,
): string {
  if (regime === 'panic') {
    return 'Size down hard or stand aside intraday. Historically this band contains the best multi-week long entries and the worst same-day ones — patience beats precision here.';
  }
  if (regime === 'stressed') {
    return term.includes('backwardation')
      ? 'Backwardated curve under stress: sharp counter-trend rallies are likely but unreliable. Trade smaller, take profits faster, and do not hold naked short premium.'
      : 'Elevated but orderly. Widen stops to survive noise and cut position size proportionally.';
  }
  if (regime === 'elevated') {
    return 'Risk is being repriced. Favour defined-risk structures over naked exposure and expect intraday ranges to run above their 20-day average.';
  }
  if (regime === 'complacent') {
    return Number.isFinite(vrp) && vrp < 2
      ? 'Volatility is cheap relative to what the index is actually delivering — long premium and portfolio hedges are unusually well priced here.'
      : 'Low volatility favours trend continuation and premium selling, but tail hedges are cheap and worth carrying.';
  }
  if (changePct > 15) {
    return 'Volatility is expanding quickly from a calm base. Trend-following signals degrade first in this transition — tighten risk before conviction.';
  }
  return 'Conditions support normal position sizing. Let the directional signal, not the volatility signal, drive the decision.';
}

/* ---------------------------------------------------------------------------
   CROSS-ASSET STRESS
   ------------------------------------------------------------------------- */

export interface StressGauge {
  /** 0-100. Higher = more systemic stress. */
  level: number;
  components: { name: string; value: number; contribution: number; note: string }[];
  state: 'risk_on' | 'neutral' | 'risk_off' | 'crisis';
  note: string;
}

/** A composite risk-appetite gauge assembled from the cross-asset signals a
 *  macro desk actually watches. Each component is normalised to 0-100 where
 *  100 is maximum stress. */
export function stressGauge(input: {
  vix?: number;
  vixTermRatio?: number;
  /** High-yield credit spread over treasuries, in basis points. */
  creditSpread?: number;
  /** 10y minus 2y treasury yield, in percent. */
  yieldCurve?: number;
  /** Dollar index level change over 20 sessions, percent. */
  dollarMomentum?: number;
  /** Gold vs SPX 20-day relative performance, percent. */
  goldRelative?: number;
  /** Percentage of index members above their 50-day MA. */
  breadth?: number;
}): StressGauge {
  const components: StressGauge['components'] = [];

  const add = (name: string, value: number, stress: number, weight: number, note: string): void => {
    if (!Number.isFinite(value)) return;
    components.push({ name, value, contribution: clamp(stress, 0, 100) * weight, note });
  };

  if (Number.isFinite(input.vix ?? NaN)) {
    const v = input.vix as number;
    add('VIX', v, scale(v, 11, 45, 0, 100), 0.3, `${v.toFixed(1)}`);
  }
  if (Number.isFinite(input.vixTermRatio ?? NaN)) {
    const r = input.vixTermRatio as number;
    add('VIX term structure', r, scale(r, 0.85, 1.15, 0, 100), 0.15, r > 1 ? 'backwardated' : 'contango');
  }
  if (Number.isFinite(input.creditSpread ?? NaN)) {
    const c = input.creditSpread as number;
    add('HY credit spread', c, scale(c, 280, 800, 0, 100), 0.2, `${c.toFixed(0)}bp`);
  }
  if (Number.isFinite(input.yieldCurve ?? NaN)) {
    const y = input.yieldCurve as number;
    add('10y-2y curve', y, scale(y, 1.2, -0.8, 0, 100), 0.1, `${y.toFixed(2)}%`);
  }
  if (Number.isFinite(input.dollarMomentum ?? NaN)) {
    const d = input.dollarMomentum as number;
    add('Dollar momentum', d, scale(d, -3, 5, 0, 100), 0.1, `${d >= 0 ? '+' : ''}${d.toFixed(1)}% 20d`);
  }
  if (Number.isFinite(input.goldRelative ?? NaN)) {
    const g = input.goldRelative as number;
    add('Gold vs equities', g, scale(g, -6, 8, 0, 100), 0.05, `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`);
  }
  if (Number.isFinite(input.breadth ?? NaN)) {
    const b = input.breadth as number;
    add('Breadth (% > 50DMA)', b, scale(b, 75, 20, 0, 100), 0.1, `${b.toFixed(0)}%`);
  }

  // Weighted average over the components that were actually available, so a
  // missing feed rescales the gauge rather than silently dragging it to zero.
  const weights: Record<string, number> = {
    'VIX': 0.3, 'VIX term structure': 0.15, 'HY credit spread': 0.2,
    '10y-2y curve': 0.1, 'Dollar momentum': 0.1, 'Gold vs equities': 0.05,
    'Breadth (% > 50DMA)': 0.1,
  };
  const availableWeight = components.reduce((a, c) => a + (weights[c.name] ?? 0), 0);
  const level = availableWeight > 0
    ? clamp(components.reduce((a, c) => a + c.contribution, 0) / availableWeight, 0, 100)
    : 50;

  const state: StressGauge['state'] =
    level < 30 ? 'risk_on' : level < 55 ? 'neutral' : level < 75 ? 'risk_off' : 'crisis';

  const note =
    state === 'risk_on' ? 'Cross-asset signals are aligned for risk-taking. Long exposure is supported.'
    : state === 'neutral' ? 'Mixed cross-asset signals. Trade the instrument, not the macro.'
    : state === 'risk_off' ? 'Multiple stress channels are firing together. Reduce gross exposure and favour quality.'
    : 'Systemic stress across asset classes. Capital preservation dominates; correlations converge and most hedges fail together.';

  return { level, components, state, note };
}
