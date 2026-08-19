/* ===========================================================================
   The signal ensemble.

   Aggregation is weighted by three independent factors:
     family weight   — how much this KIND of analytic matters in this regime
     horizon weight  — how much it matters for the holding period requested
     vote confidence — how much THIS reading can be trusted right now

   Conviction is then built from three things that are genuinely different:
     magnitude  — how strong the net signal is
     agreement  — how much the votes actually concur (a strong signal from
                  violently disagreeing inputs is not a confident signal)
     breadth    — how many independent analytics support it

   Data quality is deliberately NOT folded into conviction. They answer
   different questions: conviction is "how strongly does the ensemble believe
   this", data quality is "how real is the input it believed it about".
   Multiplying them together produces a single number that means neither, and
   silently hides a simulated feed behind a merely-mediocre score. They are
   reported side by side instead, and the UI badges simulated data explicitly.
   ========================================================================= */

import type {
  Vote, VoteFamily, SignalResult, FamilyAttribution, Action, Direction,
  Horizon, AssetClass, Bar, Provenance,
} from '../types';
import type { IndicatorSnapshot } from '../indicators';
import { computeSnapshot } from '../indicators';
import { clamp, scale, mean, stdev } from '../util/math';
import { classifyRegime, familyWeight, HORIZON_WEIGHTS } from './regime';
import {
  trendVotes, momentumVotes, volatilityVotes, volumeVotes,
  structureVotes, seasonalityVotes,
} from './votes';
import { buildTradePlan, type PlanInput } from './plan';
import type { IvStats } from '../options/chain';
import type { VixComplex } from '../vol';
import type { FundamentalAssessment, EarningsAnalysis } from '../fundamentals';
import { earningsScore } from '../fundamentals';
import type {
  InsiderAnalysis, InstitutionalAnalysis, SocialAnalysis,
  NewsAnalysis, AnalystConsensus,
} from '../sentiment';

export * from './regime';
export * from './votes';
export * from './plan';

export interface SignalInput {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  bars: readonly Bar[];
  provenance: Provenance;
  horizon?: Horizon;
  equity?: number;
  maxRiskFraction?: number;
  now?: Date;

  /** Optional enrichment. Anything omitted simply contributes no votes. */
  fundamentals?: FundamentalAssessment;
  earnings?: EarningsAnalysis;
  insider?: InsiderAnalysis;
  institutional?: InstitutionalAnalysis;
  social?: SocialAnalysis;
  news?: NewsAnalysis;
  analysts?: AnalystConsensus;
  iv?: IvStats;
  vix?: VixComplex;
  optionsPositioningScore?: number;
  optionsPositioningNote?: string;
  optionsAvailable?: boolean;
  /** Estimated win rate for Kelly sizing, from the backtester. */
  estimatedWinRate?: number;
}

/** Produce the complete signal for one instrument. */
export function generateSignal(input: SignalInput): SignalResult {
  const {
    symbol, name, assetClass, bars, provenance,
    horizon = 'swing', equity = 10_000, maxRiskFraction = 0.02,
    now = new Date(),
  } = input;

  const snapshot = computeSnapshot(bars);
  const regime = classifyRegime(snapshot);
  const ctx = { provenance, regime: regime.regime };

  // --- collect votes -------------------------------------------------------
  const votes: Vote[] = [
    ...trendVotes(snapshot, ctx),
    ...momentumVotes(snapshot, ctx),
    ...volatilityVotes(snapshot, ctx),
    ...volumeVotes(snapshot, ctx),
    ...structureVotes(snapshot, ctx),
    ...seasonalityVotes(now, ctx),
    ...enrichmentVotes(input),
  ].filter((v) => Number.isFinite(v.score) && Number.isFinite(v.confidence));

  // --- aggregate -----------------------------------------------------------
  const { score, attribution, agreement, effectiveWeightSum } =
    aggregate(votes, regime.regime, horizon);

  const dataQuality = computeDataQuality(votes, provenance);
  const conviction = computeConviction(score, agreement, votes, effectiveWeightSum);

  const direction: Direction = conviction < 32 ? 'flat' : score > 0 ? 'long' : 'short';
  const action = toAction(score, conviction);

  // --- trade plan -----------------------------------------------------------
  const planInput: PlanInput = {
    snapshot,
    score,
    conviction,
    regime: regime.regime,
    horizon,
    equity,
    maxRiskFraction,
    estimatedWinRate: input.estimatedWinRate,
    iv: input.iv,
    optionsAvailable: input.optionsAvailable ?? (assetClass === 'equity' || assetClass === 'etf' || assetClass === 'index'),
  };
  const plan = buildTradePlan(planInput);

  // --- warnings -------------------------------------------------------------
  const warnings = buildWarnings(input, snapshot, regime.regime, dataQuality, agreement, votes);

  return {
    symbol, name, assetClass,
    asOf: Date.now(),
    price: snapshot.price,
    score, conviction, action, direction,
    regime, votes, attribution, plan, agreement, dataQuality, warnings,
  };
}

/* ---------------------------------------------------------------------------
   AGGREGATION
   ------------------------------------------------------------------------- */

interface AggregateResult {
  score: number;
  attribution: FamilyAttribution[];
  agreement: number;
  effectiveWeightSum: number;
}

function aggregate(votes: Vote[], regime: string, horizon: Horizon): AggregateResult {
  const byFamily = new Map<VoteFamily, { weighted: number; weight: number; count: number; scores: number[] }>();

  let totalWeighted = 0;
  let totalWeight = 0;
  const directionalScores: number[] = [];
  const directionalWeights: number[] = [];

  for (const v of votes) {
    const fw = familyWeight(v.family, regime as never);
    const hw = HORIZON_WEIGHTS[horizon][v.horizon];
    const w = fw * hw * v.confidence;

    // Votes with a zero score are context (efficiency, relative volume): they
    // legitimately carry weight in the denominator via confidence, but must
    // not be treated as neutral opinions that dilute a real signal. They are
    // excluded from the numerator and from the agreement calculation.
    if (v.score !== 0) {
      totalWeighted += v.score * w;
      totalWeight += w;
      directionalScores.push(v.score);
      directionalWeights.push(w);
    }

    const entry = byFamily.get(v.family) ?? { weighted: 0, weight: 0, count: 0, scores: [] };
    entry.weighted += v.score * w;
    entry.weight += w;
    entry.count++;
    entry.scores.push(v.score);
    byFamily.set(v.family, entry);
  }

  const score = totalWeight > 0 ? clamp(totalWeighted / totalWeight, -1, 1) : 0;

  const attribution: FamilyAttribution[] = [...byFamily.entries()]
    .map(([family, e]) => ({
      family,
      score: e.weight > 0 ? e.weighted / e.weight : 0,
      weight: e.weight,
      contribution: totalWeight > 0 ? e.weighted / totalWeight : 0,
      voteCount: e.count,
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  // Agreement: the weighted share of directional votes on the winning side.
  let agreeWeight = 0;
  let totalDirWeight = 0;
  const netSign = Math.sign(score) || 1;
  for (let i = 0; i < directionalScores.length; i++) {
    totalDirWeight += directionalWeights[i];
    if (Math.sign(directionalScores[i]) === netSign) agreeWeight += directionalWeights[i];
  }
  const agreement = totalDirWeight > 0 ? agreeWeight / totalDirWeight : 0;

  return { score, attribution, agreement, effectiveWeightSum: totalWeight };
}

/* ---------------------------------------------------------------------------
   CONVICTION
   ------------------------------------------------------------------------- */

function computeConviction(
  score: number,
  agreement: number,
  votes: Vote[],
  weightSum: number,
): number {
  // Magnitude: |score| of 0.55 is treated as a full-strength ensemble reading,
  // because votes partially cancel by construction — a net 0.55 across ~35
  // analytics is a genuinely lopsided book. The 0.8 exponent stops the middle
  // of the range from collapsing toward zero.
  const magnitude = clamp(Math.abs(score) / 0.55, 0, 1) ** 0.8;

  // Agreement below ~42% means the ensemble is split; that should crush
  // conviction rather than merely reduce it.
  const agreementFactor = clamp(scale(agreement, 0.42, 0.88, 0, 1), 0, 1);

  // Breadth: a signal supported by 30 analytics is more robust than one
  // supported by 4, independent of how strong either is. Bounded well above
  // zero because breadth modulates confidence, it does not create it.
  const breadth = clamp(scale(weightSum, 2, 14, 0.55, 1), 0.5, 1);

  // Dispersion penalty: wildly scattered votes indicate an unstable read.
  const directional = votes.filter((v) => v.score !== 0).map((v) => v.score);
  const dispersion = directional.length >= 4 ? stdev(directional) : 0.5;
  const dispersionFactor = clamp(scale(dispersion, 0.85, 0.35, 0.75, 1), 0.7, 1);

  return clamp(magnitude * agreementFactor * breadth * dispersionFactor * 100, 0, 100);
}

/** Share of the signal's inputs that rest on real market data, reported
 *  alongside conviction rather than multiplied into it. A simulated feed is
 *  capped at 0.55 so it can never read as trustworthy, and the UI renders this
 *  as its own gauge next to the verdict. */
function computeDataQuality(votes: Vote[], provenance: Provenance): number {
  if (!votes.length) return 0;
  const realCount = votes.filter(
    (v) => v.provenance === 'live' || v.provenance === 'cached' || v.provenance === 'derived',
  ).length;
  const share = realCount / votes.length;

  // A simulated series still runs real analytics — the engine genuinely
  // computes, it just has nothing true to compute on. The 0.55 ceiling makes
  // that distinction visible without pretending the output is worthless.
  if (provenance === 'simulated') return clamp(0.35 + share * 0.2, 0.3, 0.55);
  return clamp(0.6 + share * 0.4, 0.5, 1);
}

/* ---------------------------------------------------------------------------
   ACTION MAPPING
   ------------------------------------------------------------------------- */

function toAction(score: number, conviction: number): Action {
  if (conviction < 32) return 'HOLD';
  const s = score;
  if (conviction >= 68) {
    if (s > 0.3) return 'STRONG BUY';
    if (s < -0.3) return 'STRONG SELL';
  }
  if (s > 0.22) return 'BUY';
  if (s > 0.08) return 'ACCUMULATE';
  if (s < -0.22) return 'SELL';
  if (s < -0.08) return 'REDUCE';
  return 'HOLD';
}

/* ---------------------------------------------------------------------------
   ENRICHMENT VOTES — fundamentals, flow, sentiment, volatility, options
   ------------------------------------------------------------------------- */

function enrichmentVotes(input: SignalInput): Vote[] {
  const out: Vote[] = [];
  const push = (
    id: string, label: string, family: VoteFamily, score: number, confidence: number,
    horizon: Horizon, rationale: string, reading: string, provenance: Provenance,
  ): void => {
    if (!Number.isFinite(score)) return;
    out.push({
      id, label, family,
      score: clamp(score, -1, 1),
      confidence: clamp(confidence, 0, 1),
      horizon, rationale, reading, provenance,
    });
  };

  // --- fundamentals -------------------------------------------------------
  if (input.fundamentals) {
    const f = input.fundamentals;
    push('valuation', 'Valuation composite', 'valuation', f.valuationScore, 0.6, 'position',
      `Valuation grade ${f.letterGrade} (${f.grade}/100). ${f.valuationNotes.join(', ')}. Valuation is close to useless for timing and close to decisive over a holding period measured in quarters — it is weighted accordingly.`,
      f.letterGrade, f.valuation.pe > 0 ? 'derived' : 'missing');

    push('quality', 'Business quality', 'quality', f.qualityScore, 0.6, 'position',
      `${f.qualityNotes.join(', ')}. Quality does not tell you when to buy, but it tells you what survives a drawdown long enough for the thesis to work.`,
      f.qualityNotes[0] ?? '—', 'derived');

    push('piotroski', 'Piotroski F-Score', 'fundamental', scale(f.piotroski.score, 1, 8), 0.55, 'position',
      `F-Score ${f.piotroski.score}/9 — ${f.piotroski.interpretation}. Nine binary tests of profitability, leverage and efficiency; scores of 8+ have historically outperformed scores of 0-2 by a wide margin.`,
      `${f.piotroski.score}/9`, 'derived');

    if (Number.isFinite(f.altman.z)) {
      push('altman', 'Altman Z-Score', 'fundamental', scale(f.altman.z, 1.0, 4.0), 0.5, 'position',
        `Z-Score ${f.altman.z.toFixed(2)} — ${f.altman.interpretation}. This is a bankruptcy-risk gauge; it matters most precisely when you are tempted by a cheap price.`,
        f.altman.z.toFixed(2), 'derived');
    }

    if (f.beneish.flag) {
      push('beneish', 'Accounting quality', 'quality', -0.5, 0.45, 'position',
        `Beneish M-Score of ${f.beneish.m.toFixed(2)} exceeds the -1.78 threshold. ${f.beneish.interpretation}`,
        f.beneish.m.toFixed(2), 'derived');
    }
  }

  // --- earnings -----------------------------------------------------------
  if (input.earnings) {
    const es = earningsScore(input.earnings);
    push('earnings', 'Earnings dynamics', 'earnings', es.score, es.confidence, 'swing',
      `${es.note}. ${input.earnings.note}`,
      `${input.earnings.beatCount}/4 beats`, 'derived');
  }

  // --- insider ------------------------------------------------------------
  if (input.insider) {
    push('insider', 'Insider activity', 'insider', input.insider.score, input.insider.confidence,
      'position', input.insider.note,
      input.insider.clusterBuy ? 'CLUSTER BUY' : `${input.insider.buyCount}B / ${input.insider.sellCount}S`,
      input.insider.provenance);
  }

  // --- institutional ------------------------------------------------------
  if (input.institutional) {
    push('institutional', 'Institutional flow', 'institutional',
      input.institutional.score, input.institutional.confidence, 'position',
      input.institutional.note,
      `${input.institutional.buyerCount}B / ${input.institutional.sellerCount}S`,
      input.institutional.provenance);
  }

  // --- social -------------------------------------------------------------
  if (input.social) {
    push('social', 'Social sentiment', 'social',
      input.social.score, input.social.confidence, 'intraday',
      input.social.note, input.social.crowding.replace('_', ' '), input.social.provenance);
  }

  // --- news ---------------------------------------------------------------
  if (input.news) {
    push('news', 'News flow', 'news',
      input.news.score, input.news.confidence, 'intraday',
      input.news.note, `${input.news.volume24h} items/24h`, input.news.provenance);
  }

  // --- analysts -----------------------------------------------------------
  if (input.analysts) {
    push('analysts', 'Analyst consensus', 'fundamental',
      input.analysts.score, input.analysts.confidence, 'swing',
      input.analysts.note,
      Number.isFinite(input.analysts.consensusScore) ? input.analysts.consensusScore.toFixed(2) : '—',
      input.analysts.provenance);
  }

  // --- implied volatility --------------------------------------------------
  if (input.iv) {
    // IV itself is not directional, but the premium bias changes how a
    // directional view should be expressed, and extreme IV rank has a mild
    // contrarian directional tilt.
    const ivScore =
      input.iv.ivRank > 0.9 ? 0.2 : input.iv.ivRank < 0.1 ? -0.05 : 0;
    push('iv_regime', 'Implied volatility', 'options', ivScore, 0.5, 'swing',
      input.iv.note, `IVR ${(input.iv.ivRank * 100).toFixed(0)}`, 'derived');
  }

  // --- options positioning -------------------------------------------------
  if (input.optionsPositioningScore != null) {
    push('options_positioning', 'Options positioning', 'options',
      input.optionsPositioningScore, 0.5, 'intraday',
      input.optionsPositioningNote ?? 'Options positioning read from open interest and volume.',
      '—', 'derived');
  }

  // --- VIX / macro ----------------------------------------------------------
  if (input.vix) {
    // The VIX read applies to risk assets. It is inverted for instruments
    // that are structurally defensive.
    push('vix', 'Volatility complex', 'macro',
      input.vix.score, input.vix.confidence, 'swing',
      `${input.vix.interpretation} ${input.vix.tradingImplication}`,
      `VIX ${input.vix.vix.toFixed(1)}`, input.vix.provenance);
  }

  return out;
}

/* ---------------------------------------------------------------------------
   WARNINGS
   ------------------------------------------------------------------------- */

function buildWarnings(
  input: SignalInput,
  s: IndicatorSnapshot,
  regime: string,
  dataQuality: number,
  agreement: number,
  votes: Vote[],
): string[] {
  const w: string[] = [];

  if (input.provenance === 'simulated') {
    w.push(
      'PRICE DATA IS SIMULATED. No live feed was reachable, so this signal is computed on a synthetic series. ' +
      'The analytics are real; the prices are not. Do not trade this.',
    );
  }

  if (s.barCount < 200) {
    w.push(
      `Only ${s.barCount} bars of history are available. Long-horizon indicators (200-day MA, 52-week range, volatility percentiles) are unreliable or unavailable below 250 bars.`,
    );
  }

  if (agreement < 0.55 && agreement > 0) {
    w.push(
      `Only ${(agreement * 100).toFixed(0)}% of weighted votes agree with the net direction. The inputs are genuinely conflicted — this is a low-quality setup regardless of which way the net score points.`,
    );
  }

  if (regime === 'range') {
    w.push('Range regime: breakout and trend-following entries have negative expectancy here until the range resolves.');
  }

  if (regime === 'high_vol_shock') {
    w.push('Volatility shock regime: correlations converge, stops get run on noise, and position sizing matters more than signal quality.');
  }

  if (Number.isFinite(s.relVolume) && s.relVolume < 0.55) {
    w.push(`Volume is running at ${s.relVolume.toFixed(2)}x average. Signals generated on thin participation reverse far more often than they follow through.`);
  }

  if (input.earnings?.eventRisk) {
    w.push(
      `Earnings in ${input.earnings.daysToNext} days. An earnings report is a binary event that technical analysis cannot forecast; either size for a gap or stand aside.`,
    );
  }

  if (Number.isFinite(s.natr14) && s.natr14 > 8) {
    w.push(`Average true range is ${s.natr14.toFixed(1)}% of price. A stop wide enough to survive normal movement here will be expensive.`);
  }

  if (input.fundamentals?.redFlags.length) {
    for (const flag of input.fundamentals.redFlags) w.push(flag);
  }

  if (Number.isFinite(s.dollarVol) && s.dollarVol < 5_000_000 && input.assetClass === 'equity') {
    w.push(
      `Average daily turnover is only $${(s.dollarVol / 1e6).toFixed(1)}M. Liquidity this thin means slippage and gap risk that most backtests do not capture.`,
    );
  }

  return w;
}
