/* ===========================================================================
   Sentiment & flow data model.

   A NOTE ON ATTRIBUTION
   ---------------------
   When live filings are available, named entities come from the filings
   themselves — those are public record. When they are not available, this
   module NEVER invents a named person or firm and attributes an opinion to
   them. Modelled output is aggregated into category labels ("Large-cap growth
   funds", "Retail options flow") and badged SIM. Putting a fabricated "BUY"
   in a real fund manager's mouth is not a UX shortcut, it is a fabrication
   about a real person.
   ========================================================================= */

import type { Provenance } from '../types';

export interface InsiderTransaction {
  /** Reporting person as named in the filing. */
  insiderName: string;
  role: string;
  /** P = open-market purchase, S = sale, A = award/grant, M = option exercise. */
  transactionCode: string;
  shares: number;
  pricePerShare: number;
  value: number;
  transactionDate: number;
  filingDate: number;
  /** Shares held after the transaction. */
  sharesAfter: number;
  /** Change in the insider's holding, as a percentage. */
  holdingChangePct: number;
}

export interface InsiderAnalysis {
  transactions: InsiderTransaction[];
  /** Net dollar value of open-market buys minus sells, last 90 days. */
  netValue90d: number;
  buyCount: number;
  sellCount: number;
  /** Distinct insiders buying — clusters matter far more than single trades. */
  uniqueBuyers: number;
  uniqueSellers: number;
  /** True when 3+ distinct insiders bought within 30 days. */
  clusterBuy: boolean;
  clusterSell: boolean;
  /** Buy value as a share of total insider transaction value. */
  buyRatio: number;
  score: number;
  confidence: number;
  note: string;
  provenance: Provenance;
  source: string;
}

export interface InstitutionalHolder {
  /** Filer name from the 13F, or a category label in modelled mode. */
  name: string;
  type: 'hedge_fund' | 'pension' | 'mutual_fund' | 'sovereign' | 'insurance' | 'aggregate';
  shares: number;
  value: number;
  /** Change in share count versus the prior filing. */
  changeShares: number;
  changePct: number;
  /** Share of the filer's disclosed portfolio. */
  portfolioWeight: number;
  action: 'new' | 'added' | 'held' | 'trimmed' | 'exited';
  filingDate: number;
  quarter: string;
}

export interface InstitutionalAnalysis {
  holders: InstitutionalHolder[];
  totalInstitutionalShares: number;
  /** Percentage of float held by institutions. */
  institutionalOwnership: number;
  netFlowShares: number;
  buyerCount: number;
  sellerCount: number;
  newPositions: number;
  exitedPositions: number;
  /** Hedge funds and pensions read differently: pensions are slow and
   *  valuation-driven, hedge funds are fast and momentum-driven. */
  hedgeFundNet: number;
  pensionNet: number;
  score: number;
  confidence: number;
  note: string;
  /** 13F data is 45 days stale by law. Surfaced explicitly, never hidden. */
  reportingLagDays: number;
  provenance: Provenance;
  source: string;
}

export interface SocialSignal {
  /** Platform or cohort label. */
  channel: string;
  /** Directional lean in [-1, 1]. */
  sentiment: number;
  /** Volume of mentions in the window. */
  mentions: number;
  /** Change in mention volume versus the trailing average. */
  mentionChangePct: number;
  /** How many of the tracked accounts are net bullish. */
  bullishShare: number;
  followers?: number;
  note: string;
}

export interface SocialAnalysis {
  signals: SocialSignal[];
  aggregateSentiment: number;
  totalMentions: number;
  mentionSpike: boolean;
  /** Retail crowding is contrarian at extremes. */
  crowding: 'extreme_bullish' | 'bullish' | 'neutral' | 'bearish' | 'extreme_bearish';
  score: number;
  confidence: number;
  note: string;
  provenance: Provenance;
  source: string;
}

export interface NewsItem {
  headline: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: number;
  /** Directional score in [-1, 1]. */
  sentiment: number;
  /** How material the item is, 0-1. */
  relevance: number;
  category: 'earnings' | 'guidance' | 'macro' | 'product' | 'legal' | 'analyst' | 'mna' | 'general';
}

export interface NewsAnalysis {
  items: NewsItem[];
  /** Time-decayed weighted sentiment. */
  aggregateSentiment: number;
  volume24h: number;
  /** Unusual news volume often precedes or accompanies repricing. */
  volumeSpike: boolean;
  dominantCategory: string;
  score: number;
  confidence: number;
  note: string;
  provenance: Provenance;
  source: string;
}

export interface AnalystRating {
  firm: string;
  rating: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  priceTarget: number;
  date: number;
  previousRating?: string;
}

export interface AnalystConsensus {
  ratings: AnalystRating[];
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
  /** 1 (strong buy) to 5 (strong sell). */
  consensusScore: number;
  meanTarget: number;
  highTarget: number;
  lowTarget: number;
  targetUpsidePct: number;
  /** Net upgrades minus downgrades in the last 90 days. */
  revisionMomentum: number;
  score: number;
  confidence: number;
  note: string;
  provenance: Provenance;
  source: string;
}
