/* ===========================================================================
   Analyst note generation.

   The dossier shows every analytic and lets the reader synthesise. This module
   does the synthesis and commits to a decision, the way an analyst writes a
   note: conclusion first, evidence second, the honest counter-case third, and
   an explicit level at which the thesis is wrong.

   Rules this generator follows, because they are what separate a research note
   from a horoscope:

   1. LEAD WITH THE DECISION. No throat-clearing, no "the market is complex".
   2. QUANTIFY. "ADX at 34" beats "the trend is strong".
   3. STATE THE COUNTER-CASE HONESTLY. A note that only argues one side is
      marketing. The bear case for a buy is the most useful paragraph in it.
   4. NAME THE INVALIDATION. A view you cannot be wrong about is not a view.
   5. NEVER EXCEED THE EVIDENCE. Low conviction produces a note that says so
      and recommends no position, rather than manufacturing confidence.
   ========================================================================= */

import type { SignalResult, Vote, VoteFamily } from '../types';
import type { IndicatorSnapshot } from '../indicators';
import type { FundamentalAssessment, EarningsAnalysis } from '../fundamentals';
import type {
  InsiderAnalysis, InstitutionalAnalysis, SocialAnalysis, NewsAnalysis,
} from '../sentiment';
import type { IvStats } from '../options/chain';
import type { VixComplex } from '../vol';

export interface NoteSection {
  heading: string;
  body: string;
}

export interface AnalystNote {
  /** The single decisive call. */
  action: 'BUY' | 'SELL' | 'NO TRADE';
  direction: 'LONG' | 'SHORT' | 'FLAT';
  /** How to express it in plain words, e.g. "long the shares". */
  expression: string;
  conviction: number;
  convictionWord: string;
  /** One sentence a portfolio manager could read and act on. */
  headline: string;

  /** Headings differ on a no-trade, where the columns are the two cases that
   *  cancelled rather than a case and its rebuttal. */
  supportingHeading: string;
  againstHeading: string;

  thesis: string;
  supporting: NoteSection[];
  against: NoteSection[];
  technical: string;
  fundamental: string | null;
  flow: string | null;
  volatility: string;
  invalidation: string;
  execution: string;
  bottomLine: string;
  /** Always present. Never suppressed. */
  disclosure: string;
}

export interface NoteInput {
  signal: SignalResult;
  snapshot: IndicatorSnapshot;
  name: string;
  assetClass: string;
  fundamentals?: FundamentalAssessment | null;
  earnings?: EarningsAnalysis | null;
  insider?: InsiderAnalysis | null;
  institutional?: InstitutionalAnalysis | null;
  social?: SocialAnalysis | null;
  news?: NewsAnalysis | null;
  iv?: IvStats | null;
  vix?: VixComplex | null;
  /** True when prices came from the simulator rather than a live feed. */
  simulated: boolean;
}

/* ---------------------------------------------------------------------------
   HELPERS
   ------------------------------------------------------------------------- */

const n2 = (x: number, dp = 2): string => (Number.isFinite(x) ? x.toFixed(dp) : '—');

const pct = (x: number, dp = 1): string =>
  Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(dp)}%` : '—';

/** Instrument names sometimes end in a period ("NVIDIA Corp."), which produces
 *  "NVIDIA Corp.." when a sentence ends on one. */
const cleanName = (n: string): string => n.replace(/\.+$/, '');

/** 1st, 2nd, 3rd, 4th — "82th percentile" reads as a typo, because it is. */
function ordinal(x: number): string {
  const i = Math.round(x);
  const mod100 = i % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${i}th`;
  switch (i % 10) {
    case 1: return `${i}st`;
    case 2: return `${i}nd`;
    case 3: return `${i}rd`;
    default: return `${i}th`;
  }
}

/** Regime as a noun phrase that reads inside a sentence. Lowercasing the
 *  regime description instead would mangle the acronyms inside it. */
const REGIME_PHRASE: Record<string, string> = {
  strong_uptrend: 'in a strong, well-organised uptrend',
  uptrend: 'in a genuine but unemphatic uptrend',
  choppy_bullish: 'choppy with a bullish lean',
  range: 'range-bound',
  choppy_bearish: 'choppy with a bearish lean',
  downtrend: 'in a genuine downtrend',
  strong_downtrend: 'in a decisive downtrend',
  high_vol_shock: 'in a volatility shock',
};

/** Weight of a vote inside the note: how loudly it argues. */
const weightOf = (v: Vote): number => Math.abs(v.score) * v.confidence;

/** The strongest votes on one side, excluding context-only zero scores. */
function topVotes(votes: Vote[], sign: 1 | -1, limit: number): Vote[] {
  return votes
    .filter((v) => Math.sign(v.score) === sign && v.score !== 0)
    .sort((a, b) => weightOf(b) - weightOf(a))
    .slice(0, limit);
}

const FAMILY_PROSE: Record<VoteFamily, string> = {
  trend: 'trend', momentum: 'momentum', meanreversion: 'mean reversion',
  volatility: 'volatility', volume: 'volume', structure: 'price structure',
  pattern: 'chart pattern', fundamental: 'fundamentals', valuation: 'valuation',
  quality: 'business quality', earnings: 'earnings', insider: 'insider activity',
  institutional: 'institutional flow', social: 'retail sentiment', news: 'news flow',
  macro: 'macro', options: 'options positioning', seasonality: 'seasonality',
  intermarket: 'intermarket',
};

function convictionWord(c: number): string {
  if (c >= 80) return 'high';
  if (c >= 65) return 'solid';
  if (c >= 50) return 'moderate';
  if (c >= 32) return 'marginal';
  return 'insufficient';
}

/** Join clauses into a readable list. */
function listify(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/* ---------------------------------------------------------------------------
   MAIN
   ------------------------------------------------------------------------- */

export function writeAnalystNote(input: NoteInput): AnalystNote {
  const { signal: sig } = input;
  const plan = sig.plan;
  const isLong = plan.direction === 'long';
  const isFlat = plan.direction === 'flat';

  const action: AnalystNote['action'] = isFlat ? 'NO TRADE' : isLong ? 'BUY' : 'SELL';
  const direction: AnalystNote['direction'] = isFlat ? 'FLAT' : isLong ? 'LONG' : 'SHORT';
  const cWord = convictionWord(sig.conviction);
  const expression = expressionOf(plan, isLong);

  const bulls = topVotes(sig.votes, 1, 6);
  const bears = topVotes(sig.votes, -1, 6);
  const forVotes = isLong ? bulls : bears;
  const againstVotes = isLong ? bears : bulls;

  return {
    action,
    direction,
    expression,
    conviction: sig.conviction,
    convictionWord: cWord,
    headline: writeHeadline(input, action, expression, cWord),
    supportingHeading: isFlat ? 'The bull case' : 'What supports this',
    againstHeading: isFlat ? 'The bear case' : 'What argues against it',
    thesis: writeThesis(input, isLong, isFlat, forVotes),
    supporting: writeEvidence(isFlat ? bulls : forVotes),
    against: writeEvidence(isFlat ? bears : againstVotes),
    technical: writeTechnical(input),
    fundamental: writeFundamental(input),
    flow: writeFlow(input),
    volatility: writeVolatility(input),
    invalidation: writeInvalidation(input, isLong, isFlat),
    execution: writeExecution(input, isFlat, expression),
    bottomLine: writeBottomLine(input, action, direction, cWord, isFlat),
    disclosure: writeDisclosure(input.simulated, sig),
  };
}

/* ---------------------------------------------------------------------------
   SECTIONS
   ------------------------------------------------------------------------- */

function expressionOf(plan: SignalResult['plan'], isLong: boolean): string {
  switch (plan.instrument) {
    case 'call': return `long ${plan.optionLeg?.dte ?? 30}-day calls`;
    case 'put': return `long ${plan.optionLeg?.dte ?? 30}-day puts`;
    case 'call_spread': return 'a bull call spread';
    case 'put_spread': return 'a bear put spread';
    case 'spot': return isLong ? 'long the shares' : 'short the shares';
    default: return 'no position';
  }
}

function writeHeadline(i: NoteInput, action: string, expression: string, cWord: string): string {
  const { signal: sig, name } = i;
  if (action === 'NO TRADE') {
    return (
      `No position in ${cleanName(name)}. The evidence is genuinely split — ${(sig.agreement * 100).toFixed(0)}% agreement across ` +
      `${sig.votes.length} analytics — and conviction of ${sig.conviction.toFixed(0)} sits below the threshold at which capital should be committed.`
    );
  }
  const rr = Number.isFinite(sig.plan.riskReward) ? `${n2(sig.plan.riskReward)}:1` : 'undefined';
  return (
    `${action} ${cleanName(name)} — ${expression}, ${cWord} conviction at ${sig.conviction.toFixed(0)}/100, ` +
    `risking to ${n2(sig.plan.stop)} for a first target of ${n2(sig.plan.targets[0] ?? NaN)} (${rr} reward to risk).`
  );
}

function writeThesis(i: NoteInput, isLong: boolean, isFlat: boolean, forVotes: Vote[]): string {
  const { signal: sig, snapshot: s, name } = i;
  const regime = sig.regime;
  const phrase = REGIME_PHRASE[regime.regime] ?? regime.label.toLowerCase();

  if (isFlat) {
    return (
      `${cleanName(name)} does not currently present a trade. The ensemble's net score of ${n2(sig.score, 3)} is close enough to zero that the direction is arbitrary, ` +
      `and only ${(sig.agreement * 100).toFixed(0)}% of the weighted evidence agrees with whichever way it happens to lean. ` +
      `The tape is ${phrase}, with ADX at ${n2(regime.trendStrength, 0)} and choppiness at ${n2(regime.choppiness, 0)}. ` +
      `The bull and bear cases below are both real; they simply cancel. Waiting costs nothing — the setup either resolves into something readable or it does not, ` +
      `and there is no edge in guessing which.`
    );
  }

  const families = [...new Set(forVotes.map((v) => FAMILY_PROSE[v.family]))].slice(0, 3);
  const side = isLong ? 'higher' : 'lower';

  return (
    `The weight of evidence in ${cleanName(name)} points ${side}. ` +
    `Across ${sig.votes.length} independent analytics the ensemble scores ${n2(sig.score, 3)} with ${(sig.agreement * 100).toFixed(0)}% of weighted votes on the same side, ` +
    `and the strongest support comes from ${listify(families)}. ` +
    `That matters more than usual because the market is ${phrase} — ${regimeImplication(regime.regime, isLong)} ` +
    `Price is ${n2(s.price)} against a ${n2(s.sma50)} 50-day and a ${n2(s.sma200)} 200-day, ` +
    `${pct(s.pctFrom52wHigh)} from the 52-week high and ${pct(s.pctFrom52wLow)} off the low.`
  );
}

function regimeImplication(regime: string, isLong: boolean): string {
  if (regime === 'strong_uptrend') {
    return isLong
      ? 'a well-organised advance rewards following strength rather than waiting for a pullback that may not come.'
      : 'shorting into a strong, organised uptrend is the lowest-probability trade in the book, and this signal should be sized accordingly.';
  }
  if (regime === 'strong_downtrend') {
    return isLong
      ? 'buying into a decisive downtrend is where the phrase "catching a falling knife" comes from, so this needs a tight invalidation.'
      : 'a decisive decline tends to persist longer than oversold readings suggest, and rallies are for selling.';
  }
  if (regime === 'range') {
    return 'in a range, breakout entries bleed and the higher-expectancy approach is fading the edges — which is what this signal is doing.';
  }
  if (regime === 'high_vol_shock') {
    return 'in a volatility shock, correlations converge and position size matters more than signal quality.';
  }
  if (regime.includes('choppy')) {
    return 'a choppy tape produces false breakouts, so entries need better levels and smaller size than the score alone implies.';
  }
  return 'the trend is genuine but not emphatic, so entry level matters more than it would in a runaway move.';
}

/** On a directional call these are the case for and the case against. On a
 *  no-trade they are the two cases that cancelled each other out — which is the
 *  most useful thing a no-trade note can show, so they are never empty. */
function writeEvidence(votes: Vote[]): NoteSection[] {
  return votes.slice(0, 5).map((v) => ({
    heading: `${v.label}${v.reading ? ` — ${v.reading}` : ''}`,
    body: v.rationale,
  }));
}

function writeTechnical(i: NoteInput): string {
  const { snapshot: s } = i;

  // Sort the readings by what they actually argue rather than listing them in
  // a flat sequence joined by "and". A paragraph that strings "+DI below -DI"
  // together with "trading above the cloud" reads as though they agree, when
  // in fact they are the two sides of the disagreement the reader most needs
  // to see.
  const bullish: string[] = [];
  const bearish: string[] = [];
  const neutral: string[] = [];

  if (Number.isFinite(s.adx14)) {
    if (s.adx14 > 25) {
      const diBull = s.plusDi > s.minusDi;
      (diBull ? bullish : bearish).push(
        `ADX at ${n2(s.adx14, 0)} confirms a real trend and the DI pair points ${diBull ? 'up' : 'down'} (+DI ${n2(s.plusDi, 1)} against -DI ${n2(s.minusDi, 1)})`,
      );
    } else {
      neutral.push(
        `ADX at ${n2(s.adx14, 0)} says there is no trend to follow, which is where directional systems chop and mean reversion has the edge`,
      );
    }
  }

  if (Number.isFinite(s.rsi14)) {
    const trending = s.adx14 > 25;
    if (s.rsi14 > 60) {
      (trending ? bullish : bearish).push(
        `RSI at ${n2(s.rsi14, 0)}${trending ? ', which in a trending tape reads as strength rather than exhaustion' : ', stretched with no trend behind it to justify the extension'}`,
      );
    } else if (s.rsi14 < 40) {
      (trending ? bearish : bullish).push(
        `RSI at ${n2(s.rsi14, 0)}${trending ? ', confirming downside pressure rather than marking a bottom' : ', washed out enough to expect a bounce absent a trend'}`,
      );
    } else {
      neutral.push(`RSI is mid-range at ${n2(s.rsi14, 0)}`);
    }
  }

  if (Number.isFinite(s.stDirection)) {
    (s.stDirection > 0 ? bullish : bearish).push(
      `SuperTrend is ${s.stDirection > 0 ? 'long' : 'short'} with its trailing stop at ${n2(s.stLevel)}`,
    );
  }

  if (s.ichimokuBias === 'above_cloud') bullish.push('price is holding above the Ichimoku cloud');
  else if (s.ichimokuBias === 'below_cloud') bearish.push('price is trapped below the Ichimoku cloud');
  else neutral.push('price is inside the Ichimoku cloud, where the system explicitly says stand aside');

  if (Number.isFinite(s.vwapDistancePct)) {
    (s.vwapDistancePct >= 0 ? bullish : bearish).push(
      `it trades ${n2(Math.abs(s.vwapDistancePct))}% ${s.vwapDistancePct >= 0 ? 'above' : 'below'} its rolling VWAP`,
    );
  }

  if (Number.isFinite(s.relVolume)) {
    neutral.push(
      s.relVolume > 1.5
        ? `volume at ${n2(s.relVolume)}x its 20-day average validates the move as real flow rather than drift`
        : s.relVolume < 0.7
          ? `volume at only ${n2(s.relVolume)}x average is thin, and moves on thin participation reverse easily`
          : `participation is ordinary at ${n2(s.relVolume)}x average volume`,
    );
  }

  const chunks: string[] = [];
  if (bullish.length) chunks.push(`Arguing higher: ${listify(bullish)}.`);
  if (bearish.length) chunks.push(`Arguing lower: ${listify(bearish)}.`);

  // The conflict sentence is the point of this whole function.
  if (bullish.length && bearish.length) {
    const lead =
      bullish.length === bearish.length ? 'The technical picture is genuinely split'
      : bullish.length > bearish.length ? 'The technical picture leans higher but is not clean'
      : 'The technical picture leans lower but is not clean';
    chunks.unshift(`${lead} — the indicators below contradict each other, and that disagreement is itself the finding.`);
  } else if (bullish.length || bearish.length) {
    chunks.unshift('The technical indicators are unusually consistent with each other here.');
  }

  if (neutral.length) chunks.push(`Context: ${listify(neutral)}.`);
  chunks.push(s.structure.description);

  if (s.levels.length) {
    chunks.push(
      `The levels that matter are ${listify(
        s.levels.slice(0, 3).map((l) => `${l.type} at ${n2(l.price)} (${l.touches} touches, ${pct(l.distancePct)} away)`),
      )}.`,
    );
  }

  return chunks.join(' ');
}

function writeFundamental(i: NoteInput): string | null {
  const f = i.fundamentals;
  if (!f) return null;

  const v = f.valuation;
  const q = f.quality;
  const multiples: string[] = [];

  if (Number.isFinite(v.pe) && v.pe > 0) multiples.push(`${n2(v.pe, 1)}x trailing earnings`);
  if (Number.isFinite(v.forwardPe) && v.forwardPe > 0) multiples.push(`${n2(v.forwardPe, 1)}x forward`);
  if (Number.isFinite(v.evEbitda) && v.evEbitda > 0) multiples.push(`${n2(v.evEbitda, 1)}x EV/EBITDA`);
  if (Number.isFinite(v.fcfYield)) multiples.push(`a ${n2(v.fcfYield, 1)}% free cash flow yield`);

  const valuationLine = multiples.length ? `The business trades at ${listify(multiples)}. ` : '';

  const growthLine = Number.isFinite(q.revenueGrowthYoY)
    ? `Revenue is ${q.revenueGrowthYoY >= 0 ? 'growing' : 'contracting'} ${n2(Math.abs(q.revenueGrowthYoY), 1)}% year over year. `
    : '';

  const qualityLine = Number.isFinite(q.roic)
    ? `Returns on invested capital of ${n2(q.roic, 1)}% ${
        q.roic > 12 ? 'clear the cost of capital comfortably, which is what makes a compounding story credible'
        : q.roic > 7 ? 'roughly cover the cost of capital — adequate, not exceptional'
        : 'fall short of the cost of capital, meaning growth destroys value rather than creating it'
      }. `
    : '';

  const cashLine = Number.isFinite(q.cashConversion)
    ? `Earnings convert to cash at ${n2(q.cashConversion)}x${
        q.cashConversion < 0.8
          ? ', which is a quality flag worth watching — reported profit that does not become cash usually reverts'
          : ', which is healthy'
      }. `
    : '';

  const healthLine =
    `Piotroski scores ${f.piotroski.score}/9 (${f.piotroski.interpretation.toLowerCase()}) and the Altman Z-Score of ${n2(f.altman.z)} places it in the ${f.altman.zone} zone. `;

  const verdict =
    f.composite > 0.25 ? 'On fundamentals alone this is a name worth owning through noise. '
    : f.composite < -0.25 ? 'Fundamentally this is not a franchise to hold through a drawdown — it is a trade, not an investment. '
    : 'Fundamentals are unremarkable in both directions: they neither support nor prevent the trade. ';

  const flags = f.redFlags.length
    ? `Flags worth pricing: ${f.redFlags.join('; ')}.`
    : 'No accounting or solvency flags.';

  return `${valuationLine}${growthLine}${qualityLine}${cashLine}${healthLine}${verdict}${flags}`;
}

function writeFlow(i: NoteInput): string | null {
  const parts: string[] = [];
  if (i.insider && i.insider.transactions.length) parts.push(i.insider.note);
  if (i.institutional && i.institutional.holders.length) parts.push(i.institutional.note);
  if (i.social) parts.push(i.social.note);
  if (i.news) parts.push(i.news.note);
  return parts.length ? parts.join(' ') : null;
}

function writeVolatility(i: NoteInput): string {
  const { snapshot: s, iv, vix } = i;
  const parts: string[] = [];

  if (Number.isFinite(s.realisedVolAnnual)) {
    parts.push(
      `Realised volatility is running ${n2(s.realisedVolAnnual * 100, 0)}% annualised, the ${ordinal(s.volCone.percentile * 100)} percentile of its own year`,
    );
  }
  if (Number.isFinite(s.natr14)) {
    parts.push(`with an average true range of ${n2(s.natr14)}% of price`);
  }

  const squeezeLine = s.squeeze.fired
    ? ` A volatility squeeze has just released after ${s.squeeze.barsInSqueeze} compressed bars, which forecasts the size of the coming move but not its direction.`
    : s.squeeze.barsInSqueeze > 0
      ? ` Bollinger bands have sat inside the Keltner channel for ${s.squeeze.barsInSqueeze} bars — compressed volatility that resolves into expansion.`
      : '';

  const ivLine = iv
    ? ` Options are pricing ${n2(iv.iv30 * 100, 0)}% implied against that, an IV rank of ${(iv.ivRank * 100).toFixed(0)} and a ${iv.vrp >= 0 ? 'positive' : 'negative'} volatility risk premium of ${n2(Math.abs(iv.vrp) * 100, 1)} points. ${iv.note}`
    : '';

  const vixLine = vix
    ? ` Index volatility sits at ${n2(vix.vix)} in the ${vix.regime} band. ${vix.tradingImplication}`
    : '';

  return `${listify(parts)}.${squeezeLine}${ivLine}${vixLine}`;
}

function writeInvalidation(i: NoteInput, isLong: boolean, isFlat: boolean): string {
  const { signal: sig, snapshot: s } = i;
  const plan = sig.plan;

  if (isFlat) {
    const res = s.levels.find((l) => l.type === 'resistance')?.price ?? s.high52w;
    const sup = s.levels.find((l) => l.type === 'support')?.price ?? s.low52w;
    return (
      `There is no position to invalidate. What would change the picture: ADX pushing decisively through 25 to establish a trend (currently ${n2(s.adx14, 0)}), ` +
      `a close outside ${n2(res)} or ${n2(sup)}, or vote agreement rising above 65% from its current ${(sig.agreement * 100).toFixed(0)}%.`
    );
  }

  const stopPct = Math.abs((plan.entry - plan.stop) / plan.entry) * 100;
  const structural = plan.notes.find((nn) => nn.includes('structure'));

  return (
    `This view is wrong ${isLong ? 'below' : 'above'} ${n2(plan.stop)}, which is ${n2(stopPct)}% from here. ` +
    (structural
      ? `That level is not an arbitrary percentage — it sits just ${isLong ? 'under' : 'over'} the structure the thesis depends on, so a close through it means the premise itself has failed, not that the position got unlucky. `
      : `That is a volatility-scaled distance, wide enough to survive ordinary noise. `) +
    `A close beyond it should be taken as the thesis being disproved, not as a reason to widen the stop. ` +
    (Number.isFinite(s.atr14) && s.atr14 > 0
      ? `For scale, one average true range is ${n2(s.atr14)} — roughly ${n2((s.atr14 / plan.entry) * 100)}% — so the stop sits about ${n2(Math.abs(plan.entry - plan.stop) / s.atr14, 1)} normal daily moves away.`
      : '')
  );
}

function writeExecution(i: NoteInput, isFlat: boolean, expression: string): string {
  const plan = i.signal.plan;

  if (isFlat) {
    return 'No position. Re-run this when the tape resolves — the engine will produce a directional call the moment the evidence stops contradicting itself.';
  }

  const targets = plan.targets.slice(0, 3).map((t) => n2(t)).join(', then ');
  const optionLine = plan.optionLeg
    ? ` The options route is the ${n2(plan.optionLeg.strike)} ${plan.optionLeg.type} at ${plan.optionLeg.dte} days, roughly ${(plan.optionLeg.targetDelta * 100).toFixed(0)} delta, breaking even at ${n2(plan.optionLeg.breakeven)}. ${plan.optionLeg.reason}`
    : '';

  return (
    `Express this as ${expression}. Entry around ${n2(plan.entry)}, stop at ${n2(plan.stop)}, targets at ${targets}. ` +
    `Risk ${n2(plan.riskFraction * 100)}% of equity on the idea, which is ${n2(plan.size, plan.size < 1 ? 6 : 2)} units and $${n2(plan.notional)} of notional on a $10,000 account. ` +
    `Expected holding period is around ${plan.expectedBars} bars.${optionLine}`
  );
}

function writeBottomLine(
  i: NoteInput, action: string, direction: string, cWord: string, isFlat: boolean,
): string {
  const { signal: sig, name } = i;

  if (isFlat) {
    return `${cleanName(name)}: no trade. Conviction of ${sig.conviction.toFixed(0)} is below the floor, and the honest answer to "what do I do here" is nothing.`;
  }

  const caveats: string[] = [];
  if (sig.agreement < 0.65) caveats.push(`only ${(sig.agreement * 100).toFixed(0)}% of the evidence agrees`);
  if (sig.regime.regime === 'range') caveats.push('the tape is range-bound, which punishes breakout entries');
  if (sig.regime.regime === 'high_vol_shock') caveats.push('volatility is in shock territory, so size down');
  if (i.earnings?.eventRisk) {
    caveats.push(`earnings land in ${i.earnings.daysToNext} days, which is a binary this analysis cannot forecast`);
  }

  const caveatLine = caveats.length ? ` Take it with the caveat that ${listify(caveats)}.` : '';
  return `${cleanName(name)}: ${action}, ${direction.toLowerCase()}, ${cWord} conviction at ${sig.conviction.toFixed(0)}/100.${caveatLine}`;
}

function writeDisclosure(simulated: boolean, sig: SignalResult): string {
  const base =
    `This note is generated by a rules-based ensemble, not by a person. It is research software output, not investment advice, and no part of it has been validated against live trading. ` +
    `Data quality on this run scores ${(sig.dataQuality * 100).toFixed(0)}%.`;

  if (simulated) {
    return (
      `PRICES ARE SIMULATED. No live market feed was reachable, so every figure above is computed on a synthetic series produced by the deterministic simulator. ` +
      `The analytics are real and the reasoning is genuine; the market they describe is not. Do not trade on this. ${base}`
    );
  }
  return base;
}
