/* ===========================================================================
   Indicator barrel + the single-pass snapshot the signal engine consumes.
   ========================================================================= */

export * from './core';
export * from './momentum';
export * from './trend';
export * from './volatility';
export * from './volume';
export * from './patterns';

import type { Bar } from '../types';
import { hurstExponent, realisedVol, correlation, percentileRank } from '../util/math';
import {
  closes, highs, lows, volumes, sma, ema, hma, kama, atr, natr, last, at,
  crossedAbove, crossedBelow, barsSinceCross, heikinAshi,
} from './core';
import {
  rsi, connorsRsi, macd, stochastic, stochRsi, cci, williamsR, roc, momentum,
  trix, kst, ultimateOscillator, awesomeOscillator, ppo, cmo, rvi,
  fisherTransform, coppock, efficiencyRatio, squeezeMomentum, choppinessIndex,
  type MacdResult, type StochResult,
} from './momentum';
import {
  adx, aroon, superTrend, parabolicSar, ichimoku, vortex, dpo,
  regressionChannel, massIndex, trendAlignment,
  type AdxResult, type AroonResult, type SuperTrendResult, type PsarResult,
  type IchimokuResult, type VortexResult, type RegressionChannel,
} from './trend';
import {
  bollinger, keltner, donchian, bandWidthPercentile, squeeze, historicalVol,
  parkinsonVol, garmanKlassVol, yangZhangVol, volCone, ulcerIndex,
  averageDailyRangePct, rangeUsage, type BandResult, type VolCone,
} from './volatility';
import {
  obv, adLine, chaikinMoneyFlow, chaikinOscillator, mfi, forceIndex,
  easeOfMovement, vwap, relativeVolume, volumeTrend, volumePriceConfirmation,
  volumeProfile, klinger, dollarVolume, type VolumeProfile, type VwapResult,
} from './volume';
import {
  findSwings, marketStructure, keyLevels, pivots, fibRetracements,
  candlePatterns, detectDivergence, gapAnalysis, closeStreak,
  type MarketStructure, type Level, type PivotSet, type CandlePattern,
  type Divergence, type GapInfo,
} from './patterns';

/** Everything the signal engine needs, computed once per symbol per request.
 *  Series are kept alongside scalars so the UI can plot without recomputing. */
export interface IndicatorSnapshot {
  bars: readonly Bar[];
  price: number;
  barCount: number;

  // --- moving averages -------------------------------------------------
  sma10: number; sma20: number; sma50: number; sma100: number; sma200: number;
  ema9: number; ema21: number; ema50: number; ema200: number;
  hma21: number; kama20: number;
  sma20Series: number[]; sma50Series: number[]; sma200Series: number[];
  ema9Series: number[]; ema21Series: number[];
  goldenCross: boolean; deathCross: boolean; barsSince50_200: number;

  // --- momentum ---------------------------------------------------------
  rsi14: number; rsi2: number; rsi14Prev: number; rsi14Series: number[];
  connorsRsi: number;
  macd: MacdResult; macdCrossUp: boolean; macdCrossDown: boolean;
  stoch: StochResult; stochRsi: StochResult;
  cci20: number; williamsR14: number;
  roc10: number; roc20: number; mom10: number;
  trix: MacdResult; kst: MacdResult;
  uo: number; ao: number; ppo: MacdResult; cmo14: number;
  rvi: StochResult; fisher: number; coppock: number;
  efficiency20: number; squeezeMom: number;

  // --- trend -------------------------------------------------------------
  adx: AdxResult; adx14: number; plusDi: number; minusDi: number;
  aroon: AroonResult; aroonOsc: number;
  superTrend: SuperTrendResult; stDirection: number; stLevel: number;
  psar: PsarResult; psarDirection: number; psarLevel: number;
  ichimoku: IchimokuResult;
  ichimokuBias: 'above_cloud' | 'in_cloud' | 'below_cloud';
  vortex: VortexResult; viPlus: number; viMinus: number;
  dpo20: number; regression: RegressionChannel; mass: number;
  alignment: { score: number; detail: { period: number; above: boolean; slope: number }[] };
  choppiness: number;

  // --- volatility ---------------------------------------------------------
  atr14: number; natr14: number; atrSeries: number[];
  bb: BandResult; bbWidthPct: number; bbPercentB: number;
  kc: BandResult; dc: BandResult;
  squeeze: { isSqueezed: boolean[]; barsInSqueeze: number; fired: boolean };
  hv20: number; hv60: number; parkinson20: number; garmanKlass20: number; yangZhang20: number;
  volCone: VolCone; ulcer14: number;
  adrPct: number; rangeUsed: number;
  realisedVolAnnual: number; hurst: number;

  // --- volume -------------------------------------------------------------
  obvSeries: number[]; obvSlope: number;
  adSeries: number[]; cmf20: number; chaikinOsc: number;
  mfi14: number; force13: number; eom14: number;
  vwapSession: VwapResult; vwapValue: number; vwapDistancePct: number;
  relVolume: number; volTrend: number; volConfirm: number;
  profile: VolumeProfile; klinger: { kvo: number[]; signal: number[] };
  dollarVol: number;

  // --- structure ----------------------------------------------------------
  structure: MarketStructure;
  levels: Level[];
  pivotsClassic: PivotSet; pivotsFib: PivotSet; pivotsCamarilla: PivotSet;
  fib: { high: number; low: number; levels: { ratio: number; price: number }[] };
  candles: CandlePattern[];
  rsiDivergence: Divergence[];
  macdDivergence: Divergence[];
  gap: GapInfo;
  streak: { direction: 1 | -1 | 0; length: number };

  // --- positional ---------------------------------------------------------
  /** Distance from the 52-week (or full-history) high/low, in percent. */
  pctFrom52wHigh: number;
  pctFrom52wLow: number;
  high52w: number;
  low52w: number;
  /** Percentile of price within its own 1y range, 0-1. */
  pricePercentile: number;
  /** Trailing returns. */
  ret1: number; ret5: number; ret20: number; ret60: number; ret252: number;
}

/** Compute the full indicator snapshot. Safe on short series — everything
 *  degrades to NaN rather than throwing, and the signal engine drops NaN
 *  readings instead of voting on them. */
export function computeSnapshot(bars: readonly Bar[]): IndicatorSnapshot {
  const c = closes(bars);
  const h = highs(bars);
  const l = lows(bars);
  const price = last(c);
  const n = bars.length;

  const sma50Series = sma(c, 50);
  const sma200Series = sma(c, 200);
  const macdRes = macd(c);
  const rsi14Series = rsi(c, 14);
  const adxRes = adx(bars, 14);
  const stRes = superTrend(bars, 10, 3);
  const psarRes = parabolicSar(bars);
  const ichi = ichimoku(bars);
  const bbRes = bollinger(c, 20, 2);
  const atrSeries = atr(bars, 14);
  const obvSeries = obv(bars);
  const vwapRes = vwap(bars, 0);

  // Ichimoku positional bias.
  const cloudTop = last(ichi.cloudTop);
  const cloudBottom = last(ichi.cloudBottom);
  const ichimokuBias: 'above_cloud' | 'in_cloud' | 'below_cloud' =
    !Number.isFinite(cloudTop) || !Number.isFinite(cloudBottom)
      ? 'in_cloud'
      : price > cloudTop
        ? 'above_cloud'
        : price < cloudBottom
          ? 'below_cloud'
          : 'in_cloud';

  // 52-week window (or whatever history exists).
  const win = Math.min(n, 252);
  const recent = bars.slice(-win);
  const high52w = recent.length ? Math.max(...recent.map((b) => b.h)) : NaN;
  const low52w = recent.length ? Math.min(...recent.map((b) => b.l)) : NaN;
  const rangeSpan = high52w - low52w;

  const retOver = (k: number): number => {
    const base = at(c, k);
    return Number.isFinite(base) && base !== 0 ? (price / base - 1) * 100 : NaN;
  };

  const obvTail = obvSeries.filter(Number.isFinite).slice(-20);
  const obvSlope =
    obvTail.length >= 5
      ? (obvTail[obvTail.length - 1] - obvTail[0]) / (Math.abs(obvTail[0]) || 1)
      : 0;

  const lastBar = bars[n - 1] ?? { t: 0, o: 0, h: 0, l: 0, c: 0, v: 0 };
  const prevBar = bars[n - 2] ?? lastBar;

  return {
    bars,
    price,
    barCount: n,

    sma10: last(sma(c, 10)),
    sma20: last(sma(c, 20)),
    sma50: last(sma50Series),
    sma100: last(sma(c, 100)),
    sma200: last(sma200Series),
    ema9: last(ema(c, 9)),
    ema21: last(ema(c, 21)),
    ema50: last(ema(c, 50)),
    ema200: last(ema(c, 200)),
    hma21: last(hma(c, 21)),
    kama20: last(kama(c, 20)),
    sma20Series: sma(c, 20),
    sma50Series,
    sma200Series,
    ema9Series: ema(c, 9),
    ema21Series: ema(c, 21),
    goldenCross: crossedAbove(sma50Series, sma200Series),
    deathCross: crossedBelow(sma50Series, sma200Series),
    barsSince50_200: barsSinceCross(sma50Series, sma200Series),

    rsi14: last(rsi14Series),
    rsi2: last(rsi(c, 2)),
    rsi14Prev: at(rsi14Series, 1),
    rsi14Series,
    connorsRsi: last(connorsRsi(c)),
    macd: macdRes,
    macdCrossUp: crossedAbove(macdRes.macd, macdRes.signal),
    macdCrossDown: crossedBelow(macdRes.macd, macdRes.signal),
    stoch: stochastic(bars),
    stochRsi: stochRsi(c),
    cci20: last(cci(bars, 20)),
    williamsR14: last(williamsR(bars, 14)),
    roc10: last(roc(c, 10)),
    roc20: last(roc(c, 20)),
    mom10: last(momentum(c, 10)),
    trix: trix(c),
    kst: kst(c),
    uo: last(ultimateOscillator(bars)),
    ao: last(awesomeOscillator(bars)),
    ppo: ppo(c),
    cmo14: last(cmo(c, 14)),
    rvi: rvi(bars),
    fisher: last(fisherTransform(bars)),
    coppock: last(coppock(c)),
    efficiency20: last(efficiencyRatio(c, 20)),
    squeezeMom: last(squeezeMomentum(bars)),

    adx: adxRes,
    adx14: last(adxRes.adx),
    plusDi: last(adxRes.plusDi),
    minusDi: last(adxRes.minusDi),
    aroon: aroon(bars),
    aroonOsc: last(aroon(bars).oscillator),
    superTrend: stRes,
    stDirection: last(stRes.direction),
    stLevel: last(stRes.trend),
    psar: psarRes,
    psarDirection: last(psarRes.direction),
    psarLevel: last(psarRes.psar),
    ichimoku: ichi,
    ichimokuBias,
    vortex: vortex(bars),
    viPlus: last(vortex(bars).plusVi),
    viMinus: last(vortex(bars).minusVi),
    dpo20: last(dpo(c, 20)),
    regression: regressionChannel(c, Math.min(60, Math.max(20, n - 1))),
    mass: last(massIndex(bars)),
    alignment: trendAlignment(c),
    choppiness: last(choppinessIndex(bars, 14)),

    atr14: last(atrSeries),
    natr14: last(natr(bars, 14)),
    atrSeries,
    bb: bbRes,
    bbWidthPct: last(bbRes.width),
    bbPercentB: last(bbRes.percentB),
    kc: keltner(bars),
    dc: donchian(bars, 20),
    squeeze: squeeze(bars),
    hv20: last(historicalVol(c, 20)),
    hv60: last(historicalVol(c, 60)),
    parkinson20: last(parkinsonVol(bars, 20)),
    garmanKlass20: last(garmanKlassVol(bars, 20)),
    yangZhang20: yangZhangVol(bars, 20),
    volCone: volCone(c),
    ulcer14: last(ulcerIndex(c, 14)),
    adrPct: averageDailyRangePct(bars, 20),
    rangeUsed: rangeUsage(bars, 20),
    realisedVolAnnual: realisedVol(c.slice(-60)),
    hurst: hurstExponent(c.slice(-Math.min(n, 256))),

    obvSeries,
    obvSlope,
    adSeries: adLine(bars),
    cmf20: last(chaikinMoneyFlow(bars, 20)),
    chaikinOsc: last(chaikinOscillator(bars)),
    mfi14: last(mfi(bars, 14)),
    force13: last(forceIndex(bars, 13)),
    eom14: last(easeOfMovement(bars, 14)),
    vwapSession: vwapRes,
    vwapValue: last(vwapRes.vwap),
    vwapDistancePct: (() => {
      const v = last(vwapRes.vwap);
      return Number.isFinite(v) && v !== 0 ? ((price - v) / v) * 100 : NaN;
    })(),
    relVolume: relativeVolume(bars, 20),
    volTrend: volumeTrend(bars, 20),
    volConfirm: volumePriceConfirmation(bars, 20),
    profile: volumeProfile(bars.slice(-Math.min(n, 120))),
    klinger: klinger(bars),
    dollarVol: dollarVolume(bars, 20),

    structure: marketStructure(bars),
    levels: keyLevels(bars),
    pivotsClassic: pivots(prevBar, 'classic'),
    pivotsFib: pivots(prevBar, 'fibonacci'),
    pivotsCamarilla: pivots(prevBar, 'camarilla'),
    fib: fibRetracements(bars, 60),
    candles: candlePatterns(bars, 3),
    rsiDivergence: detectDivergence(bars, rsi14Series),
    macdDivergence: detectDivergence(bars, macdRes.histogram),
    gap: gapAnalysis(bars),
    streak: closeStreak(bars),

    pctFrom52wHigh: Number.isFinite(high52w) && high52w !== 0 ? ((price - high52w) / high52w) * 100 : NaN,
    pctFrom52wLow: Number.isFinite(low52w) && low52w !== 0 ? ((price - low52w) / low52w) * 100 : NaN,
    high52w,
    low52w,
    pricePercentile: rangeSpan > 0 ? (price - low52w) / rangeSpan : 0.5,
    ret1: retOver(1),
    ret5: retOver(5),
    ret20: retOver(20),
    ret60: retOver(60),
    ret252: retOver(252),
  };
}
