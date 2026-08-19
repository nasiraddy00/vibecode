/* ===========================================================================
   Vote generation: every analytic reduced to a common opinion shape.

   A Vote carries a direction (-1..+1), a confidence (0..1), the horizon it
   speaks to, and a plain-English rationale. Reducing heterogeneous models to
   one shape is what lets the ensemble weigh an RSI reading against a
   Piotroski score against a gamma-exposure figure without special cases.

   Confidence is not the same as score. A vote can be strongly directional and
   barely trustworthy (an oscillator in a runaway trend), or weakly
   directional and highly trustworthy (a 200-day slope). Keeping the two
   separate is what stops the ensemble from being dominated by whichever
   indicator happens to be most extreme.
   ========================================================================= */

import type { Vote, Provenance, MarketRegime } from '../types';
import type { IndicatorSnapshot } from '../indicators';
import { clamp, scale, squash, mean } from '../util/math';
import { last, at } from '../indicators/core';

interface VoteContext {
  provenance: Provenance;
  regime?: MarketRegime;
}

const V = (
  id: string,
  label: string,
  family: Vote['family'],
  score: number,
  confidence: number,
  horizon: Vote['horizon'],
  rationale: string,
  reading: string,
  provenance: Provenance,
): Vote => ({
  id, label, family,
  score: clamp(score, -1, 1),
  confidence: clamp(confidence, 0, 1),
  horizon, rationale, reading, provenance,
});

const ok = (x: number): boolean => Number.isFinite(x);

/* ===========================================================================
   TREND
   ========================================================================= */

export function trendVotes(s: IndicatorSnapshot, ctx: VoteContext): Vote[] {
  const out: Vote[] = [];
  const p = ctx.provenance;
  const price = s.price;

  // --- moving-average stack --------------------------------------------
  if (ok(s.alignment.score)) {
    const aligned = s.alignment.detail.filter((d) => d.above).length;
    const total = s.alignment.detail.length;
    out.push(V(
      'ma_alignment', 'MA stack alignment', 'trend',
      s.alignment.score,
      total >= 4 ? 0.85 : 0.5,
      'swing',
      total === 0
        ? 'Not enough history to judge the moving-average stack.'
        : `Price is above ${aligned} of ${total} key moving averages and the stack is ${s.alignment.score > 0.2 ? 'rising' : s.alignment.score < -0.2 ? 'falling' : 'flat'}. Multi-timeframe agreement is the difference between a trend you can lean on and one you are fighting.`,
      `${aligned}/${total} above`,
      p,
    ));
  }

  // --- golden/death cross ------------------------------------------------
  if (ok(s.sma50) && ok(s.sma200)) {
    const spread = ((s.sma50 - s.sma200) / s.sma200) * 100;
    const fresh = s.barsSince50_200 >= 0 && s.barsSince50_200 < 20;
    out.push(V(
      'ma_cross_50_200', '50/200 cross', 'trend',
      clamp(spread / 8, -1, 1),
      fresh ? 0.7 : 0.5,
      'position',
      s.goldenCross
        ? 'A golden cross printed on this bar — the 50-day has crossed above the 200-day.'
        : s.deathCross
          ? 'A death cross printed on this bar — the 50-day has crossed below the 200-day.'
          : `The 50-day sits ${spread >= 0 ? 'above' : 'below'} the 200-day by ${Math.abs(spread).toFixed(1)}%${fresh ? `, crossed ${s.barsSince50_200} bars ago` : ''}. This is a slow regime marker, not an entry trigger.`,
      `${spread >= 0 ? '+' : ''}${spread.toFixed(1)}%`,
      p,
    ));
  }

  // --- ADX / DMI ---------------------------------------------------------
  if (ok(s.adx14) && ok(s.plusDi) && ok(s.minusDi)) {
    const diSpread = s.plusDi - s.minusDi;
    // ADX measures strength, not direction; DI gives the side. A high ADX
    // with a narrow DI spread means a strong move that is losing its side.
    const strengthGate = clamp((s.adx14 - 15) / 25, 0, 1);
    out.push(V(
      'adx_dmi', 'ADX / DMI', 'trend',
      squash(diSpread / 18) * strengthGate,
      s.adx14 > 25 ? 0.8 : s.adx14 > 20 ? 0.55 : 0.3,
      'swing',
      s.adx14 < 20
        ? `ADX at ${s.adx14.toFixed(1)} says there is no trend to follow — directional systems will chop here and mean-reversion has the edge.`
        : `ADX at ${s.adx14.toFixed(1)} confirms a ${s.adx14 > 40 ? 'very strong' : s.adx14 > 25 ? 'genuine' : 'developing'} trend, with +DI ${s.plusDi.toFixed(1)} against -DI ${s.minusDi.toFixed(1)}.`,
      `ADX ${s.adx14.toFixed(1)}`,
      p,
    ));
  }

  // --- SuperTrend --------------------------------------------------------
  if (ok(s.stDirection) && ok(s.stLevel)) {
    const distance = price !== 0 ? ((price - s.stLevel) / price) * 100 : 0;
    out.push(V(
      'supertrend', 'SuperTrend', 'trend',
      s.stDirection * clamp(0.4 + Math.abs(distance) / 12, 0.4, 1),
      0.7,
      'swing',
      `SuperTrend is ${s.stDirection > 0 ? 'long' : 'short'} with its trailing stop at ${s.stLevel.toFixed(2)}, ${Math.abs(distance).toFixed(1)}% ${distance > 0 ? 'below' : 'above'} spot. A close through that level flips the signal.`,
      s.stDirection > 0 ? 'LONG' : 'SHORT',
      p,
    ));
  }

  // --- Parabolic SAR -----------------------------------------------------
  if (ok(s.psarDirection)) {
    out.push(V(
      'psar', 'Parabolic SAR', 'trend',
      s.psarDirection * 0.55,
      0.45,
      'intraday',
      `SAR is positioned ${s.psarDirection > 0 ? 'beneath price (long)' : 'above price (short)'} at ${s.psarLevel.toFixed(2)}. SAR is a trailing stop first and a signal second — it whipsaws badly in ranges.`,
      s.psarDirection > 0 ? 'LONG' : 'SHORT',
      p,
    ));
  }

  // --- Ichimoku ----------------------------------------------------------
  {
    const tenkan = last(s.ichimoku.tenkan);
    const kijun = last(s.ichimoku.kijun);
    let score = 0;
    if (s.ichimokuBias === 'above_cloud') score += 0.55;
    else if (s.ichimokuBias === 'below_cloud') score -= 0.55;
    if (ok(tenkan) && ok(kijun)) score += tenkan > kijun ? 0.25 : -0.25;

    out.push(V(
      'ichimoku', 'Ichimoku cloud', 'trend',
      score,
      s.ichimokuBias === 'in_cloud' ? 0.3 : 0.65,
      'swing',
      s.ichimokuBias === 'above_cloud'
        ? 'Price is trading above the cloud, which now acts as support. The Ichimoku system treats this as an established bullish regime.'
        : s.ichimokuBias === 'below_cloud'
          ? 'Price is trading below the cloud, which now acts as resistance — an established bearish regime.'
          : 'Price is inside the cloud: the Ichimoku system explicitly says stand aside here, as the cloud provides no directional edge.',
      s.ichimokuBias.replace('_', ' '),
      p,
    ));
  }

  // --- Aroon -------------------------------------------------------------
  if (ok(s.aroonOsc)) {
    out.push(V(
      'aroon', 'Aroon oscillator', 'trend',
      s.aroonOsc / 100,
      Math.abs(s.aroonOsc) > 50 ? 0.55 : 0.35,
      'swing',
      `Aroon oscillator at ${s.aroonOsc.toFixed(0)} — ${Math.abs(s.aroonOsc) > 70 ? 'a decisive' : Math.abs(s.aroonOsc) > 30 ? 'a moderate' : 'no clear'} lean toward ${s.aroonOsc > 0 ? 'new highs' : 'new lows'} in the lookback. Aroon catches trend *starts* that ADX is structurally late to.`,
      s.aroonOsc.toFixed(0),
      p,
    ));
  }

  // --- Vortex ------------------------------------------------------------
  if (ok(s.viPlus) && ok(s.viMinus)) {
    const spread = s.viPlus - s.viMinus;
    out.push(V(
      'vortex', 'Vortex indicator', 'trend',
      squash(spread * 4),
      0.45,
      'swing',
      `VI+ ${s.viPlus.toFixed(3)} against VI- ${s.viMinus.toFixed(3)}. ${Math.abs(spread) > 0.12 ? 'A clear separation confirms directional pressure.' : 'The lines are converged, which typically precedes a directional resolution.'}`,
      `${spread >= 0 ? '+' : ''}${spread.toFixed(3)}`,
      p,
    ));
  }

  // --- regression channel ------------------------------------------------
  if (ok(s.regression.slopePctAnnual) && s.regression.r2 > 0) {
    // Slope gives direction; R² gives how much to trust the line.
    const slopeScore = squash(s.regression.slopePctAnnual / 60);
    out.push(V(
      'regression', 'Regression channel', 'trend',
      slopeScore * clamp(s.regression.r2 * 1.4, 0, 1),
      clamp(0.3 + s.regression.r2 * 0.55, 0.2, 0.85),
      'swing',
      `The 60-bar regression line is sloping ${s.regression.slopePctAnnual >= 0 ? 'up' : 'down'} at ${Math.abs(s.regression.slopePctAnnual).toFixed(0)}% annualised with R² of ${s.regression.r2.toFixed(2)}. ${s.regression.r2 > 0.7 ? 'That is a well-behaved channel worth trading against its rails.' : s.regression.r2 > 0.35 ? 'A moderate fit — the channel is indicative rather than precise.' : 'A poor fit: price is not respecting a linear channel here.'} Price sits at ${s.regression.position >= 0 ? '+' : ''}${s.regression.position.toFixed(2)} standard errors from the mean.`,
      `R² ${s.regression.r2.toFixed(2)}`,
      p,
    ));
  }

  return out;
}

/* ===========================================================================
   MOMENTUM
   ========================================================================= */

export function momentumVotes(s: IndicatorSnapshot, ctx: VoteContext): Vote[] {
  const out: Vote[] = [];
  const p = ctx.provenance;
  const trending = ok(s.adx14) && s.adx14 > 25;

  // --- RSI ---------------------------------------------------------------
  if (ok(s.rsi14)) {
    // The classic mistake is treating RSI 70 as "sell" in a trend. In a strong
    // uptrend RSI lives above 60 for weeks. So the interpretation flips with
    // the regime: in a trend, extremes confirm; in a range, they fade.
    const raw = (s.rsi14 - 50) / 50;
    const score = trending ? raw * 0.55 : -raw * 0.75;
    out.push(V(
      'rsi_14', 'RSI (14)', trending ? 'momentum' : 'meanreversion',
      score,
      s.rsi14 > 75 || s.rsi14 < 25 ? 0.7 : 0.5,
      'swing',
      trending
        ? `RSI at ${s.rsi14.toFixed(1)} in a trending tape (ADX ${s.adx14.toFixed(0)}). In a genuine trend an extreme RSI confirms strength rather than warning of reversal — the textbook 70/30 rule loses money here.`
        : `RSI at ${s.rsi14.toFixed(1)} in a non-trending tape. Without a trend to ride, ${s.rsi14 > 70 ? 'overbought' : s.rsi14 < 30 ? 'oversold' : 'mid-range'} readings mean-revert far more often than they extend.`,
      s.rsi14.toFixed(1),
      p,
    ));
  }

  // --- RSI(2), the short-horizon mean-reversion workhorse ----------------
  if (ok(s.rsi2) && ok(s.sma200) && s.price > s.sma200) {
    // Connors' rule: only take RSI(2) longs above the 200-day.
    out.push(V(
      'rsi_2', 'RSI (2) pullback', 'meanreversion',
      s.rsi2 < 10 ? 0.75 : s.rsi2 < 25 ? 0.4 : s.rsi2 > 90 ? -0.35 : 0,
      s.rsi2 < 10 || s.rsi2 > 90 ? 0.6 : 0.3,
      'intraday',
      `RSI(2) at ${s.rsi2.toFixed(1)} with price above the 200-day. Short-period RSI pullbacks inside an established uptrend are one of the few genuinely robust short-horizon edges — but only on the long side, and only above the 200-day.`,
      s.rsi2.toFixed(1),
      p,
    ));
  }

  // --- MACD --------------------------------------------------------------
  {
    const line = last(s.macd.macd);
    const sig = last(s.macd.signal);
    const hist = last(s.macd.histogram);
    const histPrev = at(s.macd.histogram, 1);
    if (ok(line) && ok(sig) && ok(hist)) {
      const expanding = ok(histPrev) && Math.abs(hist) > Math.abs(histPrev);
      const norm = s.price !== 0 ? (hist / s.price) * 100 : 0;
      out.push(V(
        'macd', 'MACD', 'momentum',
        squash(norm * 12) * (expanding ? 1 : 0.65),
        s.macdCrossUp || s.macdCrossDown ? 0.75 : 0.6,
        'swing',
        s.macdCrossUp
          ? 'MACD has just crossed above its signal line — a fresh momentum turn to the upside.'
          : s.macdCrossDown
            ? 'MACD has just crossed below its signal line — a fresh momentum turn to the downside.'
            : `MACD histogram is ${hist >= 0 ? 'positive' : 'negative'} and ${expanding ? 'expanding, so momentum is still building' : 'contracting, so the move is losing thrust even though the sign has not flipped'}.`,
        `${hist >= 0 ? '+' : ''}${hist.toFixed(3)}`,
        p,
      ));
    }
  }

  // --- Stochastic --------------------------------------------------------
  {
    const k = last(s.stoch.k);
    const d = last(s.stoch.d);
    if (ok(k) && ok(d)) {
      const raw = (k - 50) / 50;
      out.push(V(
        'stochastic', 'Stochastic', trending ? 'momentum' : 'meanreversion',
        (trending ? raw * 0.4 : -raw * 0.6) + (k > d ? 0.12 : -0.12),
        k > 80 || k < 20 ? 0.55 : 0.4,
        'intraday',
        `%K ${k.toFixed(1)} against %D ${d.toFixed(1)}. ${k > 80 ? 'In the overbought zone' : k < 20 ? 'In the oversold zone' : 'Mid-range'}, with %K ${k > d ? 'above' : 'below'} %D.`,
        `${k.toFixed(0)}/${d.toFixed(0)}`,
        p,
      ));
    }
  }

  // --- StochRSI ----------------------------------------------------------
  {
    const k = last(s.stochRsi.k);
    if (ok(k)) {
      out.push(V(
        'stoch_rsi', 'Stochastic RSI', 'meanreversion',
        k < 5 ? 0.6 : k > 95 ? -0.6 : -((k - 50) / 50) * 0.35,
        k < 10 || k > 90 ? 0.5 : 0.3,
        'intraday',
        `StochRSI at ${k.toFixed(1)}. This is the most sensitive oscillator in the stack — it pins at 0 and 100 constantly, so it is only informative at the true extremes.`,
        k.toFixed(0),
        p,
      ));
    }
  }

  // --- CCI ---------------------------------------------------------------
  if (ok(s.cci20)) {
    out.push(V(
      'cci', 'CCI (20)', trending ? 'momentum' : 'meanreversion',
      trending ? squash(s.cci20 / 180) * 0.6 : -squash(s.cci20 / 180) * 0.6,
      Math.abs(s.cci20) > 100 ? 0.5 : 0.35,
      'swing',
      `CCI at ${s.cci20.toFixed(0)}. Beyond ±100 the reading is outside its normal band — ${trending ? 'in a trend that signals continuation' : 'without a trend that signals exhaustion'}.`,
      s.cci20.toFixed(0),
      p,
    ));
  }

  // --- Williams %R -------------------------------------------------------
  if (ok(s.williamsR14)) {
    const norm = (s.williamsR14 + 50) / 50;
    out.push(V(
      'williams_r', 'Williams %R', 'meanreversion',
      -norm * 0.45,
      0.35,
      'intraday',
      `Williams %R at ${s.williamsR14.toFixed(1)} — price is sitting ${s.williamsR14 > -20 ? 'at the top of' : s.williamsR14 < -80 ? 'at the bottom of' : 'inside'} its 14-bar range.`,
      s.williamsR14.toFixed(0),
      p,
    ));
  }

  // --- rate of change ----------------------------------------------------
  if (ok(s.roc20)) {
    out.push(V(
      'roc', 'Rate of change (20)', 'momentum',
      squash(s.roc20 / 15),
      0.5,
      'swing',
      `Price is ${s.roc20 >= 0 ? 'up' : 'down'} ${Math.abs(s.roc20).toFixed(1)}% over 20 bars. Raw momentum is the single most robust cross-sectional anomaly in the equity literature, which is why it gets a vote of its own rather than only feeding composites.`,
      `${s.roc20 >= 0 ? '+' : ''}${s.roc20.toFixed(1)}%`,
      p,
    ));
  }

  // --- Ultimate oscillator -----------------------------------------------
  if (ok(s.uo)) {
    out.push(V(
      'ultimate_osc', 'Ultimate oscillator', 'momentum',
      (s.uo - 50) / 50 * 0.5,
      0.45,
      'swing',
      `Ultimate oscillator at ${s.uo.toFixed(1)}, blending 7/14/28-bar buying pressure. Its multi-period construction makes it far less prone to the false divergences that plague single-period oscillators.`,
      s.uo.toFixed(1),
      p,
    ));
  }

  // --- TRIX --------------------------------------------------------------
  {
    const t = last(s.trix.macd);
    const tSig = last(s.trix.signal);
    if (ok(t) && ok(tSig)) {
      out.push(V(
        'trix', 'TRIX', 'momentum',
        squash(t / 25) * 0.6 + (t > tSig ? 0.15 : -0.15),
        0.4,
        'swing',
        `TRIX at ${t.toFixed(1)}bp ${t > tSig ? 'above' : 'below'} its signal. Triple smoothing strips out the noise that makes raw ROC unreliable, at the cost of lag.`,
        t.toFixed(1),
        p,
      ));
    }
  }

  // --- Awesome oscillator ------------------------------------------------
  if (ok(s.ao)) {
    out.push(V(
      'awesome_osc', 'Awesome oscillator', 'momentum',
      squash(s.ao / (s.price * 0.02)) * 0.5,
      0.35,
      'swing',
      `AO at ${s.ao.toFixed(2)} — the 5/34 spread of median price is ${s.ao >= 0 ? 'positive' : 'negative'}, indicating ${s.ao >= 0 ? 'bullish' : 'bearish'} short-against-medium term pressure.`,
      s.ao.toFixed(2),
      p,
    ));
  }

  // --- momentum quality (efficiency ratio) --------------------------------
  if (ok(s.efficiency20)) {
    // Efficiency does not have a direction; it scales the reliability of the
    // directional votes. Emitted with score 0 and used as a weight modifier.
    out.push(V(
      'efficiency', 'Momentum efficiency', 'momentum',
      0,
      clamp(s.efficiency20, 0, 1),
      'swing',
      `Kaufman efficiency ratio at ${s.efficiency20.toFixed(2)}. ${s.efficiency20 > 0.5 ? 'Price is travelling in a straight line — trend signals are reliable here.' : s.efficiency20 > 0.25 ? 'A moderately noisy path; trend signals need confirmation.' : 'Price is churning: most of the movement is retraced, so directional signals degrade badly.'}`,
      s.efficiency20.toFixed(2),
      p,
    ));
  }

  return out;
}

/* ===========================================================================
   VOLATILITY
   ========================================================================= */

export function volatilityVotes(s: IndicatorSnapshot, ctx: VoteContext): Vote[] {
  const out: Vote[] = [];
  const p = ctx.provenance;

  // --- Bollinger %B ------------------------------------------------------
  if (ok(s.bbPercentB)) {
    const trending = ok(s.adx14) && s.adx14 > 25;
    const centred = s.bbPercentB - 0.5;
    out.push(V(
      'bollinger_pctb', 'Bollinger %B', trending ? 'volatility' : 'meanreversion',
      trending ? centred * 1.0 : -centred * 1.3,
      s.bbPercentB > 1 || s.bbPercentB < 0 ? 0.6 : 0.4,
      'swing',
      s.bbPercentB > 1
        ? `Price has closed outside the upper Bollinger band (%B ${s.bbPercentB.toFixed(2)}). ${trending ? 'In a trend this is continuation, not exhaustion — bands ride.' : 'Without a trend behind it this is a stretched condition that usually reverts.'}`
        : s.bbPercentB < 0
          ? `Price has closed below the lower band (%B ${s.bbPercentB.toFixed(2)}). ${trending ? 'In a downtrend this rides rather than reverts.' : 'Absent a trend, this is a stretched condition that usually reverts.'}`
          : `%B at ${s.bbPercentB.toFixed(2)} — price is ${s.bbPercentB > 0.5 ? 'in the upper' : 'in the lower'} half of the band.`,
      s.bbPercentB.toFixed(2),
      p,
    ));
  }

  // --- squeeze -----------------------------------------------------------
  if (s.squeeze.barsInSqueeze > 0 || s.squeeze.fired) {
    // A squeeze has no direction of its own — it forecasts *expansion*. The
    // direction is inherited from whatever the trend votes say, so this is
    // emitted with a small score and a high confidence as a regime flag.
    out.push(V(
      'squeeze', 'Volatility squeeze', 'volatility',
      s.squeeze.fired ? (s.alignment.score > 0 ? 0.45 : -0.45) : 0,
      s.squeeze.fired ? 0.7 : 0.45,
      'swing',
      s.squeeze.fired
        ? `A volatility squeeze has just released after ${s.squeeze.barsInSqueeze} compressed bars. Squeezes forecast the size of the next move, not its direction — the direction is taken from the trend stack, which currently leans ${s.alignment.score > 0 ? 'long' : 'short'}.`
        : `Bollinger bands have been inside the Keltner channel for ${s.squeeze.barsInSqueeze} bars. Compressed volatility resolves into expansion; the longer the coil, the larger the release.`,
      s.squeeze.fired ? 'FIRED' : `${s.squeeze.barsInSqueeze} bars`,
      p,
    ));
  }

  // --- volatility cone ---------------------------------------------------
  if (ok(s.volCone.current)) {
    // High realised volatility is a risk signal, not a directional one, but
    // extreme volatility spikes are associated with capitulation lows.
    const pct = s.volCone.percentile;
    out.push(V(
      'vol_regime', 'Realised volatility regime', 'volatility',
      pct > 0.92 ? 0.25 : pct > 0.75 ? -0.2 : pct < 0.2 ? 0.1 : 0,
      0.5,
      'swing',
      `20-bar realised volatility is ${(s.volCone.current * 100).toFixed(0)}%, the ${(pct * 100).toFixed(0)}th percentile of its own year (${s.volCone.state}). ${pct > 0.9 ? 'Volatility this extreme usually accompanies capitulation rather than the start of a decline.' : pct < 0.2 ? 'Compressed volatility tends to precede expansion — position for a range break, and note that stops placed in quiet tape get run in the expansion.' : 'Volatility is unremarkable; size normally.'}`,
      `${(s.volCone.current * 100).toFixed(0)}% (p${(pct * 100).toFixed(0)})`,
      p,
    ));
  }

  // --- range usage -------------------------------------------------------
  if (ok(s.rangeUsed)) {
    out.push(V(
      'range_usage', 'Daily range used', 'volatility',
      0,
      clamp(1 - s.rangeUsed / 2, 0.1, 0.8),
      'intraday',
      `The instrument has travelled ${(s.rangeUsed * 100).toFixed(0)}% of its average daily range. ${s.rangeUsed > 1.3 ? 'It is already extended well past a normal day, so chasing here has poor risk/reward — the remaining move is small relative to the stop you need.' : s.rangeUsed < 0.5 ? 'Less than half the typical range is used, leaving room for the session to develop.' : 'Range usage is normal for this point in the session.'}`,
      `${(s.rangeUsed * 100).toFixed(0)}%`,
      p,
    ));
  }

  return out;
}

/* ===========================================================================
   VOLUME
   ========================================================================= */

export function volumeVotes(s: IndicatorSnapshot, ctx: VoteContext): Vote[] {
  const out: Vote[] = [];
  const p = ctx.provenance;

  if (ok(s.obvSlope)) {
    out.push(V(
      'obv', 'On-balance volume', 'volume',
      squash(s.obvSlope * 2.2),
      0.5,
      'swing',
      `OBV is ${s.obvSlope >= 0 ? 'rising' : 'falling'} over the last 20 bars. When OBV diverges from price it means the move is happening on thinning participation, which is how distribution and accumulation show up before price confirms.`,
      `${s.obvSlope >= 0 ? '+' : ''}${(s.obvSlope * 100).toFixed(1)}%`,
      p,
    ));
  }

  if (ok(s.cmf20)) {
    out.push(V(
      'cmf', 'Chaikin money flow', 'volume',
      squash(s.cmf20 * 5),
      0.5,
      'swing',
      `CMF at ${s.cmf20.toFixed(3)} — ${s.cmf20 > 0.05 ? 'closes are clustering near session highs on volume, which is accumulation' : s.cmf20 < -0.05 ? 'closes are clustering near session lows on volume, which is distribution' : 'no clear accumulation or distribution'}.`,
      s.cmf20.toFixed(3),
      p,
    ));
  }

  if (ok(s.mfi14)) {
    out.push(V(
      'mfi', 'Money flow index', 'volume',
      -((s.mfi14 - 50) / 50) * 0.5,
      s.mfi14 > 80 || s.mfi14 < 20 ? 0.55 : 0.35,
      'swing',
      `MFI at ${s.mfi14.toFixed(1)}. Being volume-weighted, MFI extremes carry more information than RSI extremes: ${s.mfi14 > 80 ? 'this much buying pressure is hard to sustain' : s.mfi14 < 20 ? 'selling pressure this extreme tends to exhaust' : 'the reading is mid-range'}.`,
      s.mfi14.toFixed(1),
      p,
    ));
  }

  if (ok(s.relVolume)) {
    // Relative volume has no direction; it validates or invalidates the move.
    out.push(V(
      'rel_volume', 'Relative volume', 'volume',
      0,
      clamp(s.relVolume / 2.2, 0.15, 0.95),
      'intraday',
      `Volume is running at ${s.relVolume.toFixed(2)}x its 20-bar average. ${s.relVolume > 1.8 ? 'Heavy participation validates the move — this is real flow, not drift.' : s.relVolume < 0.6 ? 'Thin participation. Moves on light volume are unreliable and reverse easily; treat every signal here with reduced size.' : 'Participation is normal.'}`,
      `${s.relVolume.toFixed(2)}x`,
      p,
    ));
  }

  if (ok(s.volConfirm)) {
    out.push(V(
      'vol_confirm', 'Volume/price confirmation', 'volume',
      s.volConfirm * 0.6,
      0.45,
      'swing',
      `Volume is expanding on ${s.volConfirm > 0 ? 'up' : 'down'} bars relative to the opposite direction. Healthy trends carry volume with them; when volume expands against the trend, the trend is being sold into.`,
      s.volConfirm.toFixed(2),
      p,
    ));
  }

  // --- volume profile position -------------------------------------------
  if (ok(s.profile.poc)) {
    const pos = s.profile.position;
    out.push(V(
      'volume_profile', 'Volume profile', 'structure',
      pos === 'above_value' ? 0.35 : pos === 'below_value' ? -0.35 : 0,
      0.5,
      'swing',
      pos === 'above_value'
        ? `Price is trading above the value area (VAH ${s.profile.vah.toFixed(2)}), with the point of control at ${s.profile.poc.toFixed(2)}. Acceptance above value is bullish; rejection back inside it is the failure signal to watch.`
        : pos === 'below_value'
          ? `Price is below the value area (VAL ${s.profile.val.toFixed(2)}), point of control at ${s.profile.poc.toFixed(2)}. Acceptance below value is bearish until price reclaims the area.`
          : `Price is inside the value area (${s.profile.val.toFixed(2)}-${s.profile.vah.toFixed(2)}), where most volume has traded. This is balance — expect rotation rather than trend until one edge breaks.`,
      pos.replace('_', ' '),
      p,
    ));
  }

  return out;
}

/* ===========================================================================
   STRUCTURE & PATTERNS
   ========================================================================= */

export function structureVotes(s: IndicatorSnapshot, ctx: VoteContext): Vote[] {
  const out: Vote[] = [];
  const p = ctx.provenance;

  // --- market structure --------------------------------------------------
  {
    const st = s.structure.state;
    const score =
      st === 'uptrend_hh_hl' ? 0.65
      : st === 'breakout_up' ? 0.7
      : st === 'downtrend_lh_ll' ? -0.65
      : st === 'breakout_down' ? -0.7
      : 0;
    out.push(V(
      'market_structure', 'Market structure', 'structure',
      score,
      st === 'transition' ? 0.25 : 0.7,
      'swing',
      s.structure.description,
      st.replace(/_/g, ' '),
      p,
    ));
  }

  // --- position in the 52-week range -------------------------------------
  if (ok(s.pricePercentile)) {
    // Proximity to 52-week highs is a momentum positive, not a valuation
    // negative — the 52-week-high effect is well documented.
    out.push(V(
      'range_position', '52-week range position', 'structure',
      scale(s.pricePercentile, 0.15, 0.9) * 0.5,
      0.55,
      'position',
      `Price sits at the ${(s.pricePercentile * 100).toFixed(0)}th percentile of its 52-week range, ${Math.abs(s.pctFrom52wHigh).toFixed(1)}% below the high and ${Math.abs(s.pctFrom52wLow).toFixed(1)}% above the low. Stocks near 52-week highs outperform on average — the instinct to avoid them as "extended" is one of the more expensive retail biases.`,
      `p${(s.pricePercentile * 100).toFixed(0)}`,
      p,
    ));
  }

  // --- key levels --------------------------------------------------------
  if (s.levels.length) {
    const support = s.levels.filter((l) => l.type === 'support').sort((a, b) => b.price - a.price)[0];
    const resistance = s.levels.filter((l) => l.type === 'resistance').sort((a, b) => a.price - b.price)[0];
    const distSup = support ? Math.abs(support.distancePct) : Infinity;
    const distRes = resistance ? Math.abs(resistance.distancePct) : Infinity;

    // Being close to support is bullish (defined risk); close to resistance
    // is a headwind. Distance matters more than existence.
    let score = 0;
    if (distSup < 2 && distSup < distRes) score = 0.4;
    else if (distRes < 2 && distRes < distSup) score = -0.4;
    else if (Number.isFinite(distSup) && Number.isFinite(distRes)) {
      score = ((distRes - distSup) / (distRes + distSup)) * 0.3;
    }

    out.push(V(
      'key_levels', 'Support / resistance', 'structure',
      score,
      0.6,
      'swing',
      [
        support ? `Nearest support ${support.price.toFixed(2)} (${support.distancePct.toFixed(1)}%, ${support.touches} touches)` : 'No clear support identified',
        resistance ? `nearest resistance ${resistance.price.toFixed(2)} (+${resistance.distancePct.toFixed(1)}%, ${resistance.touches} touches)` : 'no clear resistance identified',
      ].join('; ') + '. Levels with more touches and more recent tests hold more often, and they define where a stop belongs.',
      support && resistance ? `${support.price.toFixed(2)} / ${resistance.price.toFixed(2)}` : '—',
      p,
    ));
  }

  // --- candlestick patterns -----------------------------------------------
  if (s.candles.length) {
    const scored = s.candles.filter((c) => c.bias !== 'neutral');
    if (scored.length) {
      const netScore = mean(
        scored.map((c) => (c.bias === 'bullish' ? 1 : -1) * c.quality),
      );
      const best = scored.reduce((a, b) => (b.quality > a.quality ? b : a));
      out.push(V(
        'candlestick', 'Candlestick pattern', 'pattern',
        netScore * 0.6,
        clamp(best.quality * 0.7, 0.2, 0.65),
        'intraday',
        `${best.name} detected${best.index < s.barCount - 1 ? ` ${s.barCount - 1 - best.index} bars ago` : ' on the current bar'}. ${best.note} Candlestick patterns are weak in isolation — they earn their place only when they confirm what the trend and level structure already say.`,
        best.name,
        p,
      ));
    }
  }

  // --- divergence ---------------------------------------------------------
  const divergences = [...s.rsiDivergence, ...s.macdDivergence];
  if (divergences.length) {
    const strongest = divergences.reduce((a, b) => (b.strength > a.strength ? b : a));
    const bullish = strongest.type.startsWith('bullish');
    out.push(V(
      'divergence', 'Momentum divergence', 'pattern',
      (bullish ? 1 : -1) * strongest.strength * 0.7,
      clamp(0.35 + strongest.strength * 0.35, 0.2, 0.7),
      'swing',
      `${strongest.description} Detected ${strongest.barsAgo} bars ago. ${strongest.type.includes('hidden') ? 'Hidden divergence confirms the prevailing trend rather than warning against it.' : 'Regular divergence warns of exhaustion, but it can persist for a long time — it is a reason to tighten risk, not to reverse position.'}`,
      strongest.type.replace(/_/g, ' '),
      p,
    ));
  }

  // --- gap ----------------------------------------------------------------
  if (s.gap.hasGap) {
    // Unfilled gaps in the direction of the trend tend to continue; filled
    // gaps are exhaustion.
    const score = s.gap.filled
      ? (s.gap.type === 'up' ? -0.3 : 0.3)
      : (s.gap.type === 'up' ? 0.4 : -0.4);
    out.push(V(
      'gap', 'Overnight gap', 'pattern',
      score,
      0.5,
      'intraday',
      s.gap.filled
        ? `The ${Math.abs(s.gap.gapPct).toFixed(1)}% gap ${s.gap.type} has already been filled. A filled gap on the session it opened is a failed move and frequently reverses through the other side.`
        : `A ${Math.abs(s.gap.gapPct).toFixed(1)}% gap ${s.gap.type} is holding with ${(s.gap.fillFraction * 100).toFixed(0)}% retraced. Gaps that hold their first hour tend to run — this is the "gap and go" configuration.`,
      `${s.gap.gapPct >= 0 ? '+' : ''}${s.gap.gapPct.toFixed(1)}%`,
      p,
    ));
  }

  // --- streak -------------------------------------------------------------
  if (s.streak.length >= 4) {
    out.push(V(
      'streak', 'Consecutive closes', 'meanreversion',
      -s.streak.direction * clamp((s.streak.length - 3) / 6, 0, 0.6),
      clamp(0.25 + s.streak.length * 0.04, 0.2, 0.55),
      'intraday',
      `${s.streak.length} consecutive ${s.streak.direction > 0 ? 'up' : 'down'} closes. Streaks of five or more mean-revert more often than they extend, particularly in index and large-cap names.`,
      `${s.streak.length} ${s.streak.direction > 0 ? 'up' : 'down'}`,
      p,
    ));
  }

  // --- VWAP ---------------------------------------------------------------
  if (ok(s.vwapDistancePct)) {
    out.push(V(
      'vwap', 'VWAP position', 'structure',
      clamp(s.vwapDistancePct / 3, -0.5, 0.5),
      0.5,
      'intraday',
      `Price is ${Math.abs(s.vwapDistancePct).toFixed(2)}% ${s.vwapDistancePct >= 0 ? 'above' : 'below'} VWAP. VWAP is the institutional benchmark: desks working large orders are judged against it, so it acts as a genuine magnet and a line in the sand for intraday bias.`,
      `${s.vwapDistancePct >= 0 ? '+' : ''}${s.vwapDistancePct.toFixed(2)}%`,
      p,
    ));
  }

  return out;
}

/* ===========================================================================
   SEASONALITY
   ========================================================================= */

/** Calendar effects. Individually small and heavily data-mined, so they carry
 *  low weight — but they are real, persistent, and free to compute. */
export function seasonalityVotes(date: Date, ctx: VoteContext): Vote[] {
  const out: Vote[] = [];
  const p = ctx.provenance;
  const month = date.getUTCMonth();     // 0 = January
  const dow = date.getUTCDay();         // 0 = Sunday
  const dom = date.getUTCDate();

  // "Sell in May" — the Nov-Apr half-year has historically carried almost all
  // of the equity risk premium.
  const favourableHalf = month >= 9 || month <= 3;
  out.push(V(
    'seasonal_half', 'Six-month seasonality', 'seasonality',
    favourableHalf ? 0.2 : -0.12,
    0.3,
    'position',
    favourableHalf
      ? 'The November-April half-year has historically delivered the large majority of equity returns. The effect is real and persistent across decades and markets, though far too weak to trade on its own.'
      : 'The May-October half-year has historically been the weaker seasonal window. A mild headwind, not a reason to be short.',
    favourableHalf ? 'Favourable' : 'Weak',
    p,
  ));

  // Turn of the month: the last day plus the first three tend to be strong.
  const turnOfMonth = dom >= 28 || dom <= 3;
  if (turnOfMonth) {
    out.push(V(
      'seasonal_tom', 'Turn of month', 'seasonality',
      0.25,
      0.3,
      'intraday',
      'Turn-of-month window. Systematic inflows from payroll contributions and index rebalancing cluster here, and the effect shows up consistently in the data.',
      'Active',
      p,
    ));
  }

  // Monday weakness / Friday strength is the classic day-of-week pattern; it
  // has weakened materially since it was documented, hence the tiny weight.
  if (dow === 1 || dow === 5) {
    out.push(V(
      'seasonal_dow', 'Day of week', 'seasonality',
      dow === 5 ? 0.1 : -0.1,
      0.15,
      'intraday',
      `${dow === 5 ? 'Friday' : 'Monday'} effect. Historically ${dow === 5 ? 'the strongest' : 'the weakest'} weekday for equities, though the edge has largely been arbitraged away since publication.`,
      dow === 5 ? 'Friday' : 'Monday',
      p,
    ));
  }

  return out;
}
