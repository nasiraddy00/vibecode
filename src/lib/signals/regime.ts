/* ===========================================================================
   Regime classification and regime-dependent weighting.

   This is the most consequential piece of the engine. The same RSI reading
   means opposite things in a trend and in a range; an ensemble that ignores
   regime will average those two interpretations into mush. Classifying the
   regime FIRST, then weighting families accordingly, is what separates a
   signal engine from an indicator dashboard.
   ========================================================================= */

import type { MarketRegime, RegimeAssessment, VoteFamily } from '../types';
import type { IndicatorSnapshot } from '../indicators';
import { clamp } from '../util/math';

export function classifyRegime(s: IndicatorSnapshot): RegimeAssessment {
  const adx = Number.isFinite(s.adx14) ? s.adx14 : 15;
  const chop = Number.isFinite(s.choppiness) ? s.choppiness : 50;
  const hurst = Number.isFinite(s.hurst) ? s.hurst : 0.5;
  const align = Number.isFinite(s.alignment.score) ? s.alignment.score : 0;
  const volPct = Number.isFinite(s.volCone.percentile) ? s.volCone.percentile : 0.5;
  const rv = Number.isFinite(s.realisedVolAnnual) ? s.realisedVolAnnual : 0.2;

  // A volatility shock overrides everything else: in a 99th-percentile vol
  // environment, correlations converge and single-name signals stop working.
  if (volPct > 0.95 && rv > 0.35) {
    return {
      regime: 'high_vol_shock',
      trendStrength: adx,
      choppiness: chop,
      realisedVol: rv,
      volPercentile: volPct,
      hurst,
      label: 'VOLATILITY SHOCK',
      description:
        `Realised volatility at ${(rv * 100).toFixed(0)}% sits in the ${(volPct * 100).toFixed(0)}th percentile of its own history. ` +
        'In this regime cross-asset correlations converge toward one, stops get run on noise, and most directional signals lose their edge. ' +
        'Size is the only variable that reliably helps here.',
    };
  }

  const trending = adx > 25 && chop < 50;
  const strongTrend = adx > 38 && chop < 40;

  let regime: MarketRegime;
  if (strongTrend && align > 0.35) regime = 'strong_uptrend';
  else if (strongTrend && align < -0.35) regime = 'strong_downtrend';
  else if (trending && align > 0.15) regime = 'uptrend';
  else if (trending && align < -0.15) regime = 'downtrend';
  else if (chop > 61.8 || adx < 18) regime = 'range';
  else if (align > 0.1) regime = 'choppy_bullish';
  else if (align < -0.1) regime = 'choppy_bearish';
  else regime = 'range';

  return {
    regime,
    trendStrength: adx,
    choppiness: chop,
    realisedVol: rv,
    volPercentile: volPct,
    hurst,
    label: REGIME_LABELS[regime],
    description: describeRegime(regime, adx, chop, hurst, rv),
  };
}

const REGIME_LABELS: Record<MarketRegime, string> = {
  strong_uptrend: 'STRONG UPTREND',
  uptrend: 'UPTREND',
  choppy_bullish: 'CHOPPY / BULLISH BIAS',
  range: 'RANGE-BOUND',
  choppy_bearish: 'CHOPPY / BEARISH BIAS',
  downtrend: 'DOWNTREND',
  strong_downtrend: 'STRONG DOWNTREND',
  high_vol_shock: 'VOLATILITY SHOCK',
};

function describeRegime(
  regime: MarketRegime, adx: number, chop: number, hurst: number, rv: number,
): string {
  const hurstNote =
    hurst > 0.57 ? ` The Hurst exponent of ${hurst.toFixed(2)} confirms persistent, trending behaviour.`
    : hurst < 0.43 ? ` The Hurst exponent of ${hurst.toFixed(2)} indicates anti-persistence — moves are being retraced, which favours fading extremes over following them.`
    : ` The Hurst exponent of ${hurst.toFixed(2)} is close to a random walk, so neither trend-following nor mean-reversion has a structural edge.`;

  switch (regime) {
    case 'strong_uptrend':
      return `ADX at ${adx.toFixed(0)} with choppiness at ${chop.toFixed(0)} describes a powerful, well-organised advance. Pullbacks are for buying; oscillator overbought readings will fire repeatedly and should be ignored as reversal signals.${hurstNote}`;
    case 'uptrend':
      return `A genuine but less emphatic uptrend (ADX ${adx.toFixed(0)}). Trend-following works, though entries matter more than in a runaway move — buy weakness rather than strength.${hurstNote}`;
    case 'choppy_bullish':
      return `Directionally positive but poorly organised (ADX ${adx.toFixed(0)}, choppiness ${chop.toFixed(0)}). Expect false breakouts. Reduce size and demand better entry levels.${hurstNote}`;
    case 'range':
      return `Choppiness at ${chop.toFixed(0)} and ADX at ${adx.toFixed(0)} mark a range. Breakout systems will bleed here; fading the edges of the range is the higher-expectancy approach until it resolves.${hurstNote}`;
    case 'choppy_bearish':
      return `Directionally negative but disorganised (ADX ${adx.toFixed(0)}, choppiness ${chop.toFixed(0)}). Short-side breakdowns will fail frequently.${hurstNote}`;
    case 'downtrend':
      return `A genuine downtrend (ADX ${adx.toFixed(0)}). Rallies are for selling. Note that downtrends carry higher realised volatility than uptrends of equal magnitude, so stops need proportionally more room.${hurstNote}`;
    case 'strong_downtrend':
      return `ADX at ${adx.toFixed(0)} with low choppiness describes a decisive decline. Oversold readings will persist and should not be treated as buy signals — this is where "catching the falling knife" does its damage.${hurstNote}`;
    default:
      return `Realised volatility at ${(rv * 100).toFixed(0)}% dominates the picture.${hurstNote}`;
  }
}

/* ---------------------------------------------------------------------------
   FAMILY WEIGHTS BY REGIME
   ------------------------------------------------------------------------- */

type WeightMap = Partial<Record<VoteFamily, number>>;

const BASE_WEIGHTS: Record<VoteFamily, number> = {
  trend: 1.0,
  momentum: 0.9,
  meanreversion: 0.7,
  volatility: 0.6,
  volume: 0.7,
  structure: 0.9,
  pattern: 0.45,
  fundamental: 0.6,
  valuation: 0.5,
  quality: 0.5,
  earnings: 0.6,
  insider: 0.55,
  institutional: 0.35,
  social: 0.3,
  news: 0.5,
  macro: 0.6,
  options: 0.65,
  seasonality: 0.2,
  intermarket: 0.5,
};

/** Multipliers applied to the base weights per regime. In a trend the
 *  trend-following families are amplified and mean-reversion is suppressed;
 *  in a range the reverse. In a volatility shock almost everything is damped
 *  except the volatility and options families, which are the only ones with
 *  genuine information in that environment. */
const REGIME_MULTIPLIERS: Record<MarketRegime, WeightMap> = {
  strong_uptrend: {
    trend: 1.5, momentum: 1.35, meanreversion: 0.3, pattern: 0.7,
    structure: 1.1, volume: 1.05, seasonality: 0.8,
  },
  uptrend: {
    trend: 1.3, momentum: 1.2, meanreversion: 0.55, structure: 1.05,
  },
  choppy_bullish: {
    trend: 0.85, momentum: 0.85, meanreversion: 1.1, pattern: 1.1, volatility: 1.15,
  },
  range: {
    trend: 0.45, momentum: 0.6, meanreversion: 1.6, structure: 1.25,
    pattern: 1.2, volatility: 1.2,
  },
  choppy_bearish: {
    trend: 0.85, momentum: 0.85, meanreversion: 1.1, pattern: 1.1, volatility: 1.15,
  },
  downtrend: {
    trend: 1.3, momentum: 1.2, meanreversion: 0.55, structure: 1.05, volatility: 1.1,
  },
  strong_downtrend: {
    trend: 1.5, momentum: 1.35, meanreversion: 0.3, pattern: 0.7,
    structure: 1.1, volatility: 1.15,
  },
  high_vol_shock: {
    trend: 0.5, momentum: 0.5, meanreversion: 0.6, pattern: 0.4,
    volatility: 1.5, options: 1.4, macro: 1.3, social: 0.5,
    fundamental: 0.8, valuation: 0.9,
  },
};

/** Resolve the effective weight for a family under a regime. */
export function familyWeight(family: VoteFamily, regime: MarketRegime): number {
  const base = BASE_WEIGHTS[family] ?? 0.5;
  const mult = REGIME_MULTIPLIERS[regime]?.[family] ?? 1;
  return base * mult;
}

/** Horizon multipliers — an intraday trader should not be swung by a
 *  position-horizon valuation vote, and vice versa. */
export const HORIZON_WEIGHTS: Record<
  'intraday' | 'swing' | 'position',
  Record<'intraday' | 'swing' | 'position', number>
> = {
  intraday: { intraday: 1.4, swing: 0.85, position: 0.3 },
  swing:    { intraday: 0.7, swing: 1.3, position: 0.75 },
  position: { intraday: 0.25, swing: 0.85, position: 1.5 },
};
