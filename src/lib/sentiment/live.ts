/* ===========================================================================
   Real reported facts, where a free feed carries them.

   The modelled generators in ./generate.ts exist so the terminal has
   something coherent to show when no feed is reachable. When one is, the
   real thing should win — and the difference has to stay visible, which is
   why everything here returns provenance 'live' and the modelled path keeps
   returning 'simulated'.

   The rule this module obeys: where the free tier does not carry something,
   return nothing. Never a plausible substitute wearing a live badge.
   ========================================================================= */

import type { Provenance } from '../types';
import type {
  InsiderTransaction, InsiderAnalysis, AnalystConsensus, NewsItem, NewsAnalysis,
} from './types';
import { analyseInsiders, analyseNews } from './index';
import {
  finnhubInsiders, finnhubRecommendations, finnhubNews,
  type FinnhubRecommendation, type FinnhubNewsRow,
} from '../providers/adapters';

const DAY = 86_400_000;

/* --- insider transactions (Form 4) --------------------------------------- */

/** Finnhub's transaction codes, as filed. P and S are the ones that carry
 *  information: an award or an option exercise is compensation, not a view. */
const MEANINGFUL_CODES = new Set(['P', 'S', 'A', 'M', 'F', 'G']);

export async function liveInsiders(symbol: string, now = Date.now()): Promise<InsiderAnalysis | null> {
  const rows = await finnhubInsiders(symbol);
  if (!rows.length) return null;

  const transactions: InsiderTransaction[] = [];
  for (const r of rows) {
    const transactionDate = Date.parse(`${r.transactionDate}T00:00:00Z`);
    const filingDate = Date.parse(`${r.filingDate}T00:00:00Z`);
    if (!Number.isFinite(transactionDate)) continue;

    const code = (r.transactionCode || '').toUpperCase().slice(0, 1);
    if (code && !MEANINGFUL_CODES.has(code)) continue;

    const shares = Math.abs(r.change ?? 0);
    const price = r.transactionPrice ?? 0;
    const sharesAfter = r.share ?? 0;
    const before = sharesAfter - (r.change ?? 0);

    transactions.push({
      insiderName: r.name || 'Undisclosed',
      // Finnhub's free tier does not carry the filer's officer/director
      // title. Inventing one would be inventing the very thing that makes
      // an insider trade worth reading, so it stays blank.
      role: '',
      transactionCode: code || 'P',
      shares,
      pricePerShare: price,
      value: shares * price,
      transactionDate,
      filingDate: Number.isFinite(filingDate) ? filingDate : transactionDate,
      sharesAfter,
      holdingChangePct: before > 0 ? ((r.change ?? 0) / before) * 100 : 0,
    });
  }

  if (!transactions.length) return null;
  return analyseInsiders(transactions, 'live', 'finnhub', now);
}

/* --- analyst consensus ---------------------------------------------------- */

/** Rating scale: 1 strong buy … 5 strong sell, matching the modelled path. */
const WEIGHTS: [keyof FinnhubRecommendation, number][] = [
  ['strongBuy', 1], ['buy', 2], ['hold', 3], ['sell', 4], ['strongSell', 5],
];

/**
 * Build consensus from Finnhub's aggregate counts.
 *
 * The free tier reports how many analysts sit at each rating, but not who
 * they are or where their price targets sit. So `ratings` stays empty and
 * every target field is NaN — the consumers already treat NaN as "no
 * coverage" and omit the figure rather than printing a zero, which is the
 * behaviour we want. What is real here is the distribution and, more
 * usefully, how it has moved.
 */
export function consensusFromCounts(
  periods: FinnhubRecommendation[],
  provenance: Provenance = 'live',
  source = 'finnhub',
): AnalystConsensus | null {
  if (!periods.length) return null;

  const latest = periods[0];
  const total = WEIGHTS.reduce((a, [k]) => a + (Number(latest[k]) || 0), 0);
  if (total === 0) return null;

  const consensusScore =
    WEIGHTS.reduce((a, [k, v]) => a + (Number(latest[k]) || 0) * v, 0) / total;

  // Revisions carry more information than levels. Comparing the newest
  // period against the one before it is the only revision signal the free
  // tier supports, and it is the one that matters.
  let revisionMomentum = 0;
  if (periods.length > 1) {
    const prev = periods[1];
    const prevTotal = WEIGHTS.reduce((a, [k]) => a + (Number(prev[k]) || 0), 0);
    if (prevTotal > 0) {
      const prevScore =
        WEIGHTS.reduce((a, [k, v]) => a + (Number(prev[k]) || 0) * v, 0) / prevTotal;
      // A falling score means the street moved toward buy.
      revisionMomentum = prevScore - consensusScore;
    }
  }

  const bullish = (Number(latest.strongBuy) || 0) + (Number(latest.buy) || 0);
  const bearish = (Number(latest.sell) || 0) + (Number(latest.strongSell) || 0);

  // Centre the 1..5 scale on 3 and scale to -1..+1, then let revisions tilt it.
  const level = (3 - consensusScore) / 2;
  const score = Math.max(-1, Math.min(1, level * 0.75 + revisionMomentum * 1.5));

  // Coverage breadth is the confidence: four analysts is an opinion, forty
  // is a consensus. Capped well below 1 because a consensus is a lagging,
  // widely-known input, not an edge.
  const confidence = Math.min(0.55, 0.15 + total / 90);

  const direction = revisionMomentum > 0.05 ? 'improving'
    : revisionMomentum < -0.05 ? 'deteriorating' : 'steady';

  return {
    ratings: [],
    strongBuy: Number(latest.strongBuy) || 0,
    buy: Number(latest.buy) || 0,
    hold: Number(latest.hold) || 0,
    sell: Number(latest.sell) || 0,
    strongSell: Number(latest.strongSell) || 0,
    consensusScore,
    meanTarget: NaN,
    highTarget: NaN,
    lowTarget: NaN,
    targetUpsidePct: NaN,
    revisionMomentum,
    score,
    confidence,
    note:
      `${total} analysts covering as of ${latest.period}: ${bullish} bullish, `
      + `${latest.hold} neutral, ${bearish} bearish (mean rating `
      + `${consensusScore.toFixed(2)} on a 1–5 scale, ${direction}). `
      + 'Price targets are not available on this data tier, so no upside is shown.',
    provenance,
    source,
  };
}

export async function liveAnalysts(symbol: string): Promise<AnalystConsensus | null> {
  const periods = await finnhubRecommendations(symbol);
  return consensusFromCounts(periods);
}

/* --- news ----------------------------------------------------------------- */

export async function liveNews(symbol: string, now = Date.now()): Promise<NewsAnalysis | null> {
  const rows = await finnhubNews(symbol, now - 14 * DAY, now);
  if (!rows.length) return null;

  const items: NewsItem[] = rows
    .filter((r: FinnhubNewsRow) => r.headline && r.datetime)
    .slice(0, 40)
    .map((r: FinnhubNewsRow) => ({
      headline: r.headline as string,
      summary: r.summary ?? '',
      source: r.source || 'unknown',
      url: r.url ?? '',
      publishedAt: (r.datetime as number) * 1000,
      // Finnhub does not score sentiment on the free tier, so the score is
      // read from the headline text rather than accepting a number we do
      // not have.
      sentiment: headlineSentiment(`${r.headline} ${r.summary ?? ''}`),
      relevance: 1,
      category: categorise(`${r.headline} ${r.summary ?? ''}`),
    }));

  if (!items.length) return null;

  return analyseNews(items, 'live', 'finnhub', now);
}

/* --- headline reading -----------------------------------------------------
   A deliberately plain lexical score. It is not a language model and does
   not pretend to be one: it catches the vocabulary that moves equities and
   returns 0 when it recognises nothing, so an unscored headline contributes
   nothing rather than a guess.
   ------------------------------------------------------------------------- */

const POSITIVE = /\b(beat|beats|surge|surges|soar|soars|jump|jumps|rally|rallies|record|upgrade|upgraded|outperform|raises?|raised|strong|growth|profit|wins?|approval|approved|breakthrough|expands?|partnership|buyback|dividend increase)\b/gi;
const NEGATIVE = /\b(miss|misses|missed|plunge|plunges|slump|slumps|tumble|tumbles|fall|falls|downgrade|downgraded|underperform|cuts?|cut|weak|loss|losses|lawsuit|sued|investigation|probe|recall|delay|delayed|bankrupt|layoffs?|warns?|warning|halt|halted|fraud)\b/gi;

export function headlineSentiment(text: string): number {
  if (!text) return 0;
  const pos = (text.match(POSITIVE) ?? []).length;
  const neg = (text.match(NEGATIVE) ?? []).length;
  if (pos === 0 && neg === 0) return 0;
  return Math.max(-1, Math.min(1, (pos - neg) / Math.max(2, pos + neg)));
}

const CATEGORY_PATTERNS: [NewsItem['category'], RegExp][] = [
  ['earnings', /\b(earnings|eps|quarter(ly)?|revenue|results|beat|miss)\b/i],
  ['guidance', /\b(guidance|outlook|forecast|raises? (its )?(view|target)|cuts? (its )?(view|target))\b/i],
  ['analyst', /\b(upgrade|downgrade|price target|initiat(es|ed) coverage|rating)\b/i],
  ['mna', /\b(acquisition|acquires?|merger|takeover|buyout|stake|divest)\b/i],
  ['legal', /\b(lawsuit|sued|settlement|investigation|probe|antitrust|sec |fine)\b/i],
  ['product', /\b(launch|unveil|releases?|product|approval|fda|patent)\b/i],
  ['macro', /\b(fed|inflation|tariff|rates?|economy|gdp|jobs report)\b/i],
];

export function categorise(text: string): NewsItem['category'] {
  for (const [cat, re] of CATEGORY_PATTERNS) if (re.test(text)) return cat;
  return 'general';
}
