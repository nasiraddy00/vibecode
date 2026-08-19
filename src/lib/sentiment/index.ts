/* ===========================================================================
   Sentiment & flow analysis: insider, institutional, social, news, analysts.

   Each analyser accepts already-fetched records and returns a scored view.
   Fetching lives in the providers layer; scoring lives here, so both are
   independently testable and the modelled path exercises identical code.
   ========================================================================= */

import type { Provenance } from '../types';
import { clamp, squash, scale, mean, mulberry32, gaussian, hashString } from '../util/math';
import type {
  InsiderTransaction, InsiderAnalysis,
  InstitutionalHolder, InstitutionalAnalysis,
  SocialSignal, SocialAnalysis,
  NewsItem, NewsAnalysis,
  AnalystRating, AnalystConsensus,
} from './types';

export * from './types';

const DAY = 86_400_000;

/* ---------------------------------------------------------------------------
   INSIDER (SEC Form 4)
   ------------------------------------------------------------------------- */

/** Score insider activity.
 *
 *  The research consensus is asymmetric and this model reflects it: insider
 *  BUYING is informative (there is exactly one reason to buy your own stock
 *  with your own money), while insider SELLING is mostly noise — options
 *  vesting, diversification, tax, house purchases. So sales are heavily
 *  discounted, and only cluster selling by multiple officers carries weight.
 *
 *  Cluster buying — three or more distinct insiders purchasing inside a
 *  month — is the single strongest configuration in the literature. */
export function analyseInsiders(
  transactions: InsiderTransaction[],
  provenance: Provenance,
  source: string,
  now = Date.now(),
): InsiderAnalysis {
  const window90 = transactions.filter((t) => now - t.transactionDate <= 90 * DAY);
  const window30 = transactions.filter((t) => now - t.transactionDate <= 30 * DAY);

  // Only open-market purchases (P) and sales (S) are informative. Awards (A)
  // and option exercises (M) are compensation, not conviction.
  const buys = window90.filter((t) => t.transactionCode === 'P');
  const sells = window90.filter((t) => t.transactionCode === 'S');

  const buyValue = buys.reduce((a, t) => a + Math.abs(t.value), 0);
  const sellValue = sells.reduce((a, t) => a + Math.abs(t.value), 0);
  const netValue90d = buyValue - sellValue;

  const uniqueBuyers = new Set(buys.map((t) => t.insiderName)).size;
  const uniqueSellers = new Set(sells.map((t) => t.insiderName)).size;

  const buyers30 = new Set(window30.filter((t) => t.transactionCode === 'P').map((t) => t.insiderName));
  const sellers30 = new Set(window30.filter((t) => t.transactionCode === 'S').map((t) => t.insiderName));
  const clusterBuy = buyers30.size >= 3;
  const clusterSell = sellers30.size >= 4;

  const totalValue = buyValue + sellValue;
  const buyRatio = totalValue > 0 ? buyValue / totalValue : 0.5;

  let score = 0;
  if (totalValue > 0) {
    // Buying carries full weight; selling is damped to a third.
    const buySignal = squash(buyValue / 2_000_000, 1) * 0.85;
    const sellSignal = -squash(sellValue / 2_000_000, 1) * 0.28;
    score = buySignal + sellSignal;
  }
  if (clusterBuy) score += 0.35;
  if (clusterSell) score -= 0.15;

  // A CEO or CFO buying is worth more than a director buying.
  const seniorBuy = buys.some((t) => /chief|ceo|cfo|president/i.test(t.role));
  if (seniorBuy) score += 0.15;

  score = clamp(score, -1, 1);

  const confidence =
    provenance === 'simulated' ? 0.25
    : window90.length === 0 ? 0.15
    : clamp(0.4 + Math.min(0.45, window90.length * 0.05), 0, 0.9);

  const note = buildInsiderNote(uniqueBuyers, uniqueSellers, buyValue, sellValue, clusterBuy, window90.length);

  return {
    transactions: window90.sort((a, b) => b.transactionDate - a.transactionDate),
    netValue90d, buyCount: buys.length, sellCount: sells.length,
    uniqueBuyers, uniqueSellers, clusterBuy, clusterSell, buyRatio,
    score, confidence, note, provenance, source,
  };
}

function buildInsiderNote(
  buyers: number, sellers: number, buyValue: number, sellValue: number,
  cluster: boolean, total: number,
): string {
  if (total === 0) return 'No reportable insider transactions in the last 90 days.';
  const fmt = (v: number): string =>
    v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`;

  if (cluster) {
    return `Cluster buy: ${buyers} distinct insiders purchased ${fmt(buyValue)} of open-market stock within 30 days. Multiple officers committing personal capital simultaneously is the strongest configuration in the insider literature.`;
  }
  if (buyers > 0 && sellers === 0) {
    return `${buyers} insider${buyers > 1 ? 's' : ''} bought ${fmt(buyValue)} with no offsetting sales.`;
  }
  if (sellers > 0 && buyers === 0) {
    return `${sellers} insider${sellers > 1 ? 's' : ''} sold ${fmt(sellValue)}. Sales are weak evidence in isolation — vesting and diversification explain most of them.`;
  }
  return `Mixed: ${buyers} buying (${fmt(buyValue)}) against ${sellers} selling (${fmt(sellValue)}).`;
}

/* ---------------------------------------------------------------------------
   INSTITUTIONAL (13F)
   ------------------------------------------------------------------------- */

/** Score institutional positioning.
 *
 *  13F filings are due 45 days after quarter end, so the data is between 45
 *  and 135 days stale. That is a genuine and severe limitation for a
 *  day-trading tool, so this analyser reports the lag explicitly and caps its
 *  own confidence accordingly — it should inform conviction, never trigger an
 *  intraday entry on its own. */
export function analyseInstitutional(
  holders: InstitutionalHolder[],
  floatShares: number,
  provenance: Provenance,
  source: string,
  now = Date.now(),
): InstitutionalAnalysis {
  const totalInstitutionalShares = holders.reduce((a, h) => a + h.shares, 0);
  const netFlowShares = holders.reduce((a, h) => a + h.changeShares, 0);

  const buyers = holders.filter((h) => h.changeShares > 0);
  const sellers = holders.filter((h) => h.changeShares < 0);
  const newPositions = holders.filter((h) => h.action === 'new').length;
  const exitedPositions = holders.filter((h) => h.action === 'exited').length;

  const hedgeFundNet = holders
    .filter((h) => h.type === 'hedge_fund')
    .reduce((a, h) => a + h.changeShares, 0);
  const pensionNet = holders
    .filter((h) => h.type === 'pension')
    .reduce((a, h) => a + h.changeShares, 0);

  const institutionalOwnership =
    floatShares > 0 ? clamp((totalInstitutionalShares / floatShares) * 100, 0, 100) : NaN;

  // Normalise net flow against the position base so a large fund adding to a
  // small name outweighs a small fund adding to a mega-cap.
  const flowRatio = totalInstitutionalShares > 0 ? netFlowShares / totalInstitutionalShares : 0;

  let score = squash(flowRatio * 8, 1) * 0.6;
  if (newPositions > exitedPositions * 1.5 && newPositions >= 2) score += 0.2;
  if (exitedPositions > newPositions * 1.5 && exitedPositions >= 2) score -= 0.2;
  // Hedge funds are the faster money; weight their direction a little more.
  if (totalInstitutionalShares > 0) {
    score += squash((hedgeFundNet / totalInstitutionalShares) * 10, 1) * 0.2;
  }
  score = clamp(score, -1, 1);

  const latestFiling = holders.length ? Math.max(...holders.map((h) => h.filingDate)) : now;
  const reportingLagDays = Math.max(0, Math.round((now - latestFiling) / DAY));

  // Stale data must not masquerade as a live signal.
  const stalenessPenalty = clamp(1 - reportingLagDays / 180, 0.15, 1);
  const confidence =
    provenance === 'simulated' ? 0.2 : clamp(0.5 * stalenessPenalty, 0.1, 0.5);

  const note = holders.length === 0
    ? 'No institutional filings available.'
    : `${buyers.length} filers added and ${sellers.length} reduced; ${newPositions} new positions against ${exitedPositions} exits. ` +
      `Data is ${reportingLagDays} days old — 13F reporting runs 45 days behind quarter end, so treat this as a slow-moving conviction input, not a trade trigger.`;

  return {
    holders: holders.sort((a, b) => Math.abs(b.changeShares) - Math.abs(a.changeShares)),
    totalInstitutionalShares, institutionalOwnership, netFlowShares,
    buyerCount: buyers.length, sellerCount: sellers.length,
    newPositions, exitedPositions, hedgeFundNet, pensionNet,
    score, confidence, note, reportingLagDays, provenance, source,
  };
}

/* ---------------------------------------------------------------------------
   SOCIAL
   ------------------------------------------------------------------------- */

/** Score social sentiment.
 *
 *  Retail social sentiment is a *contrarian* indicator at extremes and a
 *  weak momentum indicator in the middle of its range. A mention spike with
 *  euphoric sentiment is the classic distribution signature; capitulation
 *  chatter at the lows is the mirror image. */
export function analyseSocial(
  signals: SocialSignal[],
  provenance: Provenance,
  source: string,
): SocialAnalysis {
  if (!signals.length) {
    return {
      signals: [], aggregateSentiment: 0, totalMentions: 0, mentionSpike: false,
      crowding: 'neutral', score: 0, confidence: 0.1,
      note: 'No social data available.', provenance, source,
    };
  }

  const totalMentions = signals.reduce((a, s) => a + s.mentions, 0);
  // Weight channels by mention share so a dead channel cannot swing the read.
  const aggregateSentiment = totalMentions > 0
    ? signals.reduce((a, s) => a + s.sentiment * s.mentions, 0) / totalMentions
    : mean(signals.map((s) => s.sentiment));

  const avgChange = mean(signals.map((s) => s.mentionChangePct));
  const mentionSpike = avgChange > 120;

  const crowding: SocialAnalysis['crowding'] =
    aggregateSentiment > 0.6 ? 'extreme_bullish'
    : aggregateSentiment > 0.25 ? 'bullish'
    : aggregateSentiment < -0.6 ? 'extreme_bearish'
    : aggregateSentiment < -0.25 ? 'bearish'
    : 'neutral';

  // Mild agreement follows the crowd; extreme agreement fades it.
  let score: number;
  if (crowding === 'extreme_bullish') score = mentionSpike ? -0.45 : -0.2;
  else if (crowding === 'extreme_bearish') score = mentionSpike ? 0.4 : 0.2;
  else score = aggregateSentiment * 0.4;

  const confidence = provenance === 'simulated' ? 0.15 : clamp(0.2 + Math.min(0.3, totalMentions / 20000), 0, 0.5);

  const note =
    crowding === 'extreme_bullish'
      ? `Retail sentiment is euphoric${mentionSpike ? ' with a mention spike' : ''} — historically a distribution signature rather than a continuation one.`
      : crowding === 'extreme_bearish'
        ? `Retail sentiment is capitulatory${mentionSpike ? ' on a volume spike' : ''} — washed-out positioning tends to precede relief rallies.`
        : `Social chatter is ${crowding.replace('_', ' ')} across ${signals.length} channels (${totalMentions.toLocaleString()} mentions).`;

  return {
    signals, aggregateSentiment, totalMentions, mentionSpike, crowding,
    score: clamp(score, -1, 1), confidence, note, provenance, source,
  };
}

/* ---------------------------------------------------------------------------
   NEWS
   ------------------------------------------------------------------------- */

/** Lexicon-based headline scoring. Deliberately simple and auditable: every
 *  term and weight is visible, so a wrong reading can be traced to a word
 *  rather than disappearing into a model. */
const BULLISH_TERMS: [RegExp, number][] = [
  [/\b(beat|beats|topped|exceeded|surpass\w*)\b/i, 0.6],
  [/\b(raise[ds]?|hike[ds]?|upgrade[ds]?|boost\w*)\b/i, 0.55],
  [/\b(record|all-time high|blowout|surge[ds]?|soar\w*|rally\w*|jump\w*)\b/i, 0.5],
  [/\b(approval|approved|breakthrough|wins?|awarded|secured)\b/i, 0.45],
  [/\b(buyback|repurchase|dividend increase|special dividend)\b/i, 0.4],
  [/\b(acquisition|acquires?|merger|takeover bid|stake)\b/i, 0.35],
  [/\b(outperform|overweight|strong buy|initiat\w+ .{0,12}buy)\b/i, 0.5],
  [/\b(expansion|partnership|contract win|new order)\b/i, 0.3],
];

const BEARISH_TERMS: [RegExp, number][] = [
  [/\b(miss(?:ed|es)?|shortfall|disappoint\w*|below expectations)\b/i, -0.6],
  [/\b(cut|cuts|slash\w*|lower(?:ed|s)?|downgrade[ds]?|reduce[ds]?)\b/i, -0.55],
  [/\b(plunge[ds]?|tumble[ds]?|crash\w*|slump\w*|sink\w*|collapse[ds]?)\b/i, -0.6],
  [/\b(lawsuit|investigation|probe|subpoena|fraud|SEC charges?)\b/i, -0.65],
  [/\b(recall|halt\w*|suspension|ban(?:ned)?|delist\w*)\b/i, -0.6],
  [/\b(layoffs?|restructur\w*|bankrupt\w*|default\w*|going concern)\b/i, -0.7],
  [/\b(underperform|underweight|strong sell|sell rating)\b/i, -0.5],
  [/\b(warning|warns?|guidance cut|profit warning)\b/i, -0.6],
  [/\b(resign\w*|steps? down|departure|ouster)\b/i, -0.35],
];

/** Score a headline. Returns [-1, 1]. */
export function scoreHeadline(text: string): number {
  let score = 0;
  let hits = 0;
  for (const [re, w] of BULLISH_TERMS) if (re.test(text)) { score += w; hits++; }
  for (const [re, w] of BEARISH_TERMS) if (re.test(text)) { score += w; hits++; }
  // Negation flips a single-signal headline ("fails to beat").
  if (hits === 1 && /\b(not|fails? to|unable to|no longer|denies)\b/i.test(text)) score *= -0.6;
  return clamp(hits > 0 ? score / Math.sqrt(hits) : 0, -1, 1);
}

export function categoriseHeadline(text: string): NewsItem['category'] {
  if (/\b(earnings|quarter|q[1-4]|eps|revenue|results)\b/i.test(text)) return 'earnings';
  if (/\b(guidance|outlook|forecast|expects?)\b/i.test(text)) return 'guidance';
  if (/\b(fed|inflation|cpi|rates?|gdp|jobs|payroll|tariff)\b/i.test(text)) return 'macro';
  if (/\b(lawsuit|court|investigation|probe|settlement|regulat\w*)\b/i.test(text)) return 'legal';
  if (/\b(upgrade|downgrade|price target|analyst|initiat\w+ coverage)\b/i.test(text)) return 'analyst';
  if (/\b(acquisition|merger|acquires?|buyout|takeover|stake)\b/i.test(text)) return 'mna';
  if (/\b(launch\w*|unveil\w*|product|release[ds]?|version)\b/i.test(text)) return 'product';
  return 'general';
}

/** Aggregate news with exponential time decay — a 6-hour-old headline is
 *  worth far more than a 5-day-old one for a day trader. */
export function analyseNews(
  items: NewsItem[],
  provenance: Provenance,
  source: string,
  now = Date.now(),
  halfLifeHours = 18,
): NewsAnalysis {
  if (!items.length) {
    return {
      items: [], aggregateSentiment: 0, volume24h: 0, volumeSpike: false,
      dominantCategory: 'general', score: 0, confidence: 0.1,
      note: 'No news in the coverage window.', provenance, source,
    };
  }

  const sorted = [...items].sort((a, b) => b.publishedAt - a.publishedAt);
  const lambda = Math.log(2) / (halfLifeHours * 3_600_000);

  let weighted = 0;
  let weightSum = 0;
  for (const it of sorted) {
    const age = Math.max(0, now - it.publishedAt);
    const decay = Math.exp(-lambda * age);
    const w = decay * (0.3 + it.relevance * 0.7);
    weighted += it.sentiment * w;
    weightSum += w;
  }
  const aggregateSentiment = weightSum > 0 ? weighted / weightSum : 0;

  const volume24h = sorted.filter((i) => now - i.publishedAt <= DAY).length;
  const volumePrior = sorted.filter(
    (i) => now - i.publishedAt > DAY && now - i.publishedAt <= 7 * DAY,
  ).length / 6;
  const volumeSpike = volumePrior > 0 ? volume24h > volumePrior * 2.5 : volume24h >= 6;

  const catCounts = new Map<string, number>();
  for (const i of sorted.slice(0, 20)) {
    catCounts.set(i.category, (catCounts.get(i.category) ?? 0) + 1);
  }
  const dominantCategory =
    [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'general';

  // A news spike amplifies whatever direction the coverage carries.
  const score = clamp(aggregateSentiment * (volumeSpike ? 1.25 : 1), -1, 1);
  const confidence =
    provenance === 'simulated' ? 0.2 : clamp(0.25 + Math.min(0.35, sorted.length * 0.02), 0, 0.6);

  const note = volumeSpike
    ? `News volume is running ${volumePrior > 0 ? `${(volume24h / volumePrior).toFixed(1)}x` : 'well above'} its weekly pace, dominated by ${dominantCategory} coverage with a ${aggregateSentiment >= 0 ? 'positive' : 'negative'} tone.`
    : `${volume24h} items in 24h, mostly ${dominantCategory}; tone is ${Math.abs(aggregateSentiment) < 0.15 ? 'neutral' : aggregateSentiment > 0 ? 'positive' : 'negative'}.`;

  return {
    items: sorted.slice(0, 30), aggregateSentiment, volume24h, volumeSpike,
    dominantCategory, score, confidence, note, provenance, source,
  };
}

/* ---------------------------------------------------------------------------
   ANALYSTS
   ------------------------------------------------------------------------- */

const RATING_VALUE: Record<AnalystRating['rating'], number> = {
  strong_buy: 1, buy: 2, hold: 3, sell: 4, strong_sell: 5,
};

export function analyseAnalysts(
  ratings: AnalystRating[],
  price: number,
  provenance: Provenance,
  source: string,
  now = Date.now(),
): AnalystConsensus {
  if (!ratings.length) {
    return {
      ratings: [], strongBuy: 0, buy: 0, hold: 0, sell: 0, strongSell: 0,
      consensusScore: 3, meanTarget: NaN, highTarget: NaN, lowTarget: NaN,
      targetUpsidePct: NaN, revisionMomentum: 0, score: 0, confidence: 0.1,
      note: 'No analyst coverage available.', provenance, source,
    };
  }

  const count = (r: AnalystRating['rating']): number => ratings.filter((x) => x.rating === r).length;
  const consensusScore = mean(ratings.map((r) => RATING_VALUE[r.rating]));

  const targets = ratings.map((r) => r.priceTarget).filter((t) => t > 0);
  const meanTarget = targets.length ? mean(targets) : NaN;
  const targetUpsidePct = Number.isFinite(meanTarget) && price > 0
    ? ((meanTarget - price) / price) * 100
    : NaN;

  // Revisions carry more information than levels: the direction of change
  // predicts returns far better than the absolute rating does.
  const recent = ratings.filter((r) => now - r.date <= 90 * DAY && r.previousRating);
  let revisionMomentum = 0;
  for (const r of recent) {
    const prev = RATING_VALUE[r.previousRating as AnalystRating['rating']] ?? 3;
    const cur = RATING_VALUE[r.rating];
    revisionMomentum += prev - cur;  // positive = upgrade
  }

  const levelScore = scale(consensusScore, 4.2, 1.6);
  const upsideScore = Number.isFinite(targetUpsidePct) ? squash(targetUpsidePct / 25) : 0;
  const revisionScore = squash(revisionMomentum / 3);

  // Sell-side levels are structurally biased bullish, so they get the least
  // weight; revisions and the target gap carry the signal.
  const score = clamp(0.2 * levelScore + 0.35 * upsideScore + 0.45 * revisionScore, -1, 1);
  const confidence = provenance === 'simulated' ? 0.2 : clamp(0.2 + ratings.length * 0.02, 0, 0.55);

  const note =
    `${ratings.length} analysts, consensus ${consensusScore.toFixed(2)} (1 = strong buy). ` +
    (Number.isFinite(targetUpsidePct)
      ? `Mean target implies ${targetUpsidePct >= 0 ? '+' : ''}${targetUpsidePct.toFixed(1)}%. `
      : '') +
    (revisionMomentum !== 0
      ? `Net ${revisionMomentum > 0 ? 'upgrades' : 'downgrades'} over 90 days — revision direction is the part worth trading.`
      : 'No net revisions in 90 days.');

  return {
    ratings: ratings.sort((a, b) => b.date - a.date),
    strongBuy: count('strong_buy'), buy: count('buy'), hold: count('hold'),
    sell: count('sell'), strongSell: count('strong_sell'),
    consensusScore, meanTarget,
    highTarget: targets.length ? Math.max(...targets) : NaN,
    lowTarget: targets.length ? Math.min(...targets) : NaN,
    targetUpsidePct, revisionMomentum, score, confidence, note, provenance, source,
  };
}
