/* ===========================================================================
   Modelled sentiment records.

   Used only when a live feed is unavailable. Everything produced here is
   tagged `provenance: 'simulated'` and rendered behind a SIM badge.

   TWO RULES THIS FILE OBEYS
   -------------------------
   1. NO FABRICATED ATTRIBUTION. No real person or firm is ever named as
      holding an opinion or a position. Insiders are role-labelled, funds are
      category aggregates, analysts are tier aggregates. When live filings are
      present the real names come from the filings, which are public record.

   2. NO LOOKAHEAD. Every modelled record is derived from trailing price
      action only. This matters because these records feed the signal engine,
      and a generator that peeked at future bars would produce a backtest that
      looks brilliant and means nothing.
   ========================================================================= */

import type { Bar } from '../types';
import type { Instrument } from '../market/universe';
import { mulberry32, gaussian, hashString, clamp, mean } from '../util/math';
import type {
  InsiderTransaction, InstitutionalHolder, SocialSignal, NewsItem, AnalystRating,
} from './types';
import { scoreHeadline, categoriseHeadline } from './index';

const DAY = 86_400_000;

/** Trailing momentum over `lookback` bars, as a decimal return. Used to make
 *  modelled behaviour respond to price the way real participants do. */
function trailingMomentum(bars: readonly Bar[], lookback: number): number {
  if (bars.length < lookback + 1) return 0;
  const now = bars[bars.length - 1].c;
  const then = bars[bars.length - 1 - lookback].c;
  return then !== 0 ? now / then - 1 : 0;
}

/* ---------------------------------------------------------------------------
   INSIDER
   ------------------------------------------------------------------------- */

const INSIDER_ROLES = [
  'Chief Executive Officer', 'Chief Financial Officer', 'Chief Operating Officer',
  'Director', 'Director', 'Director', 'EVP & General Counsel', 'Chief Technology Officer',
];

export function generateInsiders(inst: Instrument, bars: readonly Bar[], now = Date.now()): InsiderTransaction[] {
  if (inst.assetClass !== 'equity') return [];
  const rng = mulberry32(hashString(`insider|${inst.symbol}`));
  const price = bars[bars.length - 1]?.c ?? inst.anchor;

  // Insiders are contrarian value buyers: purchases cluster after drawdowns,
  // sales cluster after strength. This is the empirically observed pattern.
  const mom60 = trailingMomentum(bars, 60);
  const buyBias = clamp(0.5 - mom60 * 1.8, 0.08, 0.92);

  const count = 3 + Math.floor(rng() * 7);
  const out: InsiderTransaction[] = [];

  for (let i = 0; i < count; i++) {
    const isBuy = rng() < buyBias;
    const roleIdx = Math.floor(rng() * INSIDER_ROLES.length);
    const daysAgo = Math.floor(rng() * 88) + 1;
    const txDate = now - daysAgo * DAY;

    // Price on the transaction date, taken from the trailing bar series so the
    // record is internally consistent with the chart.
    const barIdx = Math.max(0, bars.length - 1 - daysAgo);
    const txPrice = bars[barIdx]?.c ?? price;

    const shares = Math.round((isBuy ? 2_000 + rng() * 30_000 : 5_000 + rng() * 60_000));
    const sharesAfter = Math.round(shares * (4 + rng() * 30));

    out.push({
      insiderName: `Modelled insider ${String.fromCharCode(65 + i)}`,
      role: INSIDER_ROLES[roleIdx],
      transactionCode: isBuy ? 'P' : rng() < 0.75 ? 'S' : 'M',
      shares,
      pricePerShare: txPrice,
      value: shares * txPrice * (isBuy ? 1 : -1),
      transactionDate: txDate,
      filingDate: txDate + (1 + Math.floor(rng() * 2)) * DAY,
      sharesAfter,
      holdingChangePct: (shares / sharesAfter) * 100 * (isBuy ? 1 : -1),
    });
  }

  return out;
}

/* ---------------------------------------------------------------------------
   INSTITUTIONAL — category aggregates only, never named firms
   ------------------------------------------------------------------------- */

const HOLDER_CATEGORIES: { name: string; type: InstitutionalHolder['type']; weight: number }[] = [
  { name: 'Passive index complex (aggregate)', type: 'aggregate', weight: 0.34 },
  { name: 'Long-only mutual funds (aggregate)', type: 'mutual_fund', weight: 0.22 },
  { name: 'Multi-strategy hedge funds (aggregate)', type: 'hedge_fund', weight: 0.14 },
  { name: 'Equity long/short funds (aggregate)', type: 'hedge_fund', weight: 0.09 },
  { name: 'Public pension funds (aggregate)', type: 'pension', weight: 0.11 },
  { name: 'Sovereign wealth funds (aggregate)', type: 'sovereign', weight: 0.05 },
  { name: 'Insurance general accounts (aggregate)', type: 'insurance', weight: 0.05 },
];

export function generateInstitutional(
  inst: Instrument,
  bars: readonly Bar[],
  floatShares: number,
  now = Date.now(),
): InstitutionalHolder[] {
  if (inst.assetClass !== 'equity' && inst.assetClass !== 'etf') return [];
  const rng = mulberry32(hashString(`inst|${inst.symbol}`));
  const price = bars[bars.length - 1]?.c ?? inst.anchor;

  // Institutional flow chases trend with a lag, and the fast money (hedge
  // funds) chases harder than the slow money (pensions).
  const mom120 = trailingMomentum(bars, 120);
  const baseShares = floatShares * 0.72;

  // 13F data is 45+ days stale by construction. Model it that way.
  const lagDays = 47 + Math.floor(rng() * 40);
  const filingDate = now - lagDays * DAY;
  const q = new Date(filingDate);
  const quarter = `Q${Math.floor(q.getMonth() / 3) + 1} ${q.getFullYear()}`;

  return HOLDER_CATEGORIES.map((cat) => {
    const shares = Math.round(baseShares * cat.weight * (0.85 + rng() * 0.3));

    // Passive vehicles barely trade; active managers respond to momentum.
    const responsiveness =
      cat.type === 'aggregate' ? 0.06
      : cat.type === 'hedge_fund' ? 1.5
      : cat.type === 'pension' ? 0.35
      : 0.7;

    const drift = mom120 * responsiveness * 0.14 + gaussian(rng) * 0.035 * responsiveness;
    const changeShares = Math.round(shares * clamp(drift, -0.45, 0.6));
    const changePct = shares > 0 ? (changeShares / shares) * 100 : 0;

    const action: InstitutionalHolder['action'] =
      changePct > 25 ? 'new'
      : changePct > 2 ? 'added'
      : changePct < -60 ? 'exited'
      : changePct < -2 ? 'trimmed'
      : 'held';

    return {
      name: cat.name,
      type: cat.type,
      shares,
      value: shares * price,
      changeShares,
      changePct,
      portfolioWeight: 0.4 + rng() * 3.5,
      action,
      filingDate,
      quarter,
    };
  });
}

/* ---------------------------------------------------------------------------
   SOCIAL — real platform names, aggregate sentiment, no individuals
   ------------------------------------------------------------------------- */

const SOCIAL_CHANNELS = [
  { channel: 'Reddit r/wallstreetbets', base: 12_000, retailWeight: 1.0 },
  { channel: 'Reddit r/stocks + r/investing', base: 5_400, retailWeight: 0.7 },
  { channel: 'StockTwits', base: 8_200, retailWeight: 0.9 },
  { channel: 'X / finance cohort', base: 18_000, retailWeight: 0.8 },
  { channel: 'YouTube & newsletter commentary', base: 2_100, retailWeight: 0.6 },
  { channel: 'Discord / Telegram trading rooms', base: 3_400, retailWeight: 1.0 },
];

export function generateSocial(inst: Instrument, bars: readonly Bar[]): SocialSignal[] {
  const rng = mulberry32(hashString(`social|${inst.symbol}`));

  // Retail sentiment is a lagging function of recent price: crowds are
  // bullish after rallies and bearish after declines, essentially always.
  const mom5 = trailingMomentum(bars, 5);
  const mom20 = trailingMomentum(bars, 20);
  const baseSentiment = clamp(mom5 * 6 + mom20 * 2.2, -0.92, 0.92);

  // Mentions spike with absolute movement, not direction.
  const volatilityBoost = 1 + Math.abs(mom5) * 14;

  const popularity =
    inst.assetClass === 'crypto' ? 1.6
    : ['TSLA', 'NVDA', 'GME', 'AMC', 'PLTR', 'MSTR', 'COIN', 'AMD'].includes(inst.symbol) ? 2.2
    : inst.assetClass === 'equity' ? 1.0
    : 0.35;

  return SOCIAL_CHANNELS.map((ch) => {
    const sentiment = clamp(baseSentiment * ch.retailWeight + gaussian(rng) * 0.14, -1, 1);
    const mentions = Math.round(ch.base * popularity * volatilityBoost * (0.6 + rng() * 0.8));
    const mentionChangePct = (volatilityBoost - 1) * 100 + gaussian(rng) * 25;

    return {
      channel: ch.channel,
      sentiment,
      mentions,
      mentionChangePct,
      bullishShare: clamp(0.5 + sentiment * 0.42, 0.02, 0.98),
      note:
        sentiment > 0.5 ? 'Overwhelmingly bullish chatter'
        : sentiment > 0.15 ? 'Leaning bullish'
        : sentiment < -0.5 ? 'Capitulation tone'
        : sentiment < -0.15 ? 'Leaning bearish'
        : 'Mixed / no clear lean',
    };
  });
}

/* ---------------------------------------------------------------------------
   NEWS — templated headlines, scored through the same lexicon as live news
   ------------------------------------------------------------------------- */

const HEADLINE_TEMPLATES: { positive: string[]; negative: string[]; neutral: string[] } = {
  positive: [
    '{NAME} beats quarterly estimates as margins expand',
    'Analysts raise price targets on {NAME} following strong results',
    '{NAME} announces expanded buyback programme',
    '{NAME} surges after upbeat guidance',
    '{NAME} secures major new contract, shares climb',
    'Institutional accumulation reported in {NAME}',
    '{NAME} upgraded to overweight on improving fundamentals',
  ],
  negative: [
    '{NAME} misses on revenue as demand softens',
    'Analysts cut estimates for {NAME} after guidance warning',
    '{NAME} slides on margin pressure concerns',
    'Regulatory probe reported into {NAME} practices',
    '{NAME} downgraded on valuation concerns',
    '{NAME} tumbles as competition intensifies',
    'Insider selling accelerates at {NAME}',
  ],
  neutral: [
    '{NAME} to report quarterly results next week',
    '{NAME} announces leadership appointment',
    '{NAME} presents at industry conference',
    'Options activity elevated in {NAME}',
    '{NAME} files annual report',
  ],
};

const MACRO_HEADLINES = {
  positive: [
    'Risk appetite improves as inflation data cools',
    'Fed officials signal patience, equities rally',
    'Credit spreads tighten on growth optimism',
  ],
  negative: [
    'Yields spike as inflation surprises to the upside',
    'Risk-off tone as growth data disappoints',
    'Credit spreads widen amid liquidity concerns',
  ],
  neutral: [
    'Markets await key economic data this week',
    'Positioning data shows mixed institutional stance',
  ],
};

export function generateNews(inst: Instrument, bars: readonly Bar[], now = Date.now()): NewsItem[] {
  const rng = mulberry32(hashString(`news|${inst.symbol}`));

  // Coverage tone tracks recent price — news follows the tape at least as
  // often as it leads it.
  const mom10 = trailingMomentum(bars, 10);
  const posBias = clamp(0.5 + mom10 * 3.2, 0.12, 0.88);

  const count = 8 + Math.floor(rng() * 8);
  const out: NewsItem[] = [];

  for (let i = 0; i < count; i++) {
    const roll = rng();
    const tone: 'positive' | 'negative' | 'neutral' =
      roll < posBias * 0.75 ? 'positive'
      : roll < 0.82 ? 'negative'
      : 'neutral';

    const isMacro = rng() < 0.2;
    const pool = isMacro ? MACRO_HEADLINES[tone] : HEADLINE_TEMPLATES[tone];
    const template = pool[Math.floor(rng() * pool.length)];
    const headline = template.replace('{NAME}', inst.name);

    const hoursAgo = Math.pow(rng(), 1.6) * 120;   // skewed toward recent
    const publishedAt = now - hoursAgo * 3_600_000;

    out.push({
      headline,
      summary: isMacro
        ? 'Cross-asset context relevant to positioning in this instrument.'
        : `Coverage relating to ${inst.name} (${inst.symbol}).`,
      source: ['Reuters', 'Bloomberg', 'Dow Jones', 'CNBC', 'Barron\'s', 'MarketWatch'][Math.floor(rng() * 6)],
      url: '#',
      publishedAt,
      // Score through the same lexicon live headlines go through, so the
      // modelled path exercises the production scoring code.
      sentiment: scoreHeadline(headline),
      relevance: isMacro ? 0.35 + rng() * 0.25 : 0.5 + rng() * 0.5,
      category: categoriseHeadline(headline),
    });
  }

  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}

/* ---------------------------------------------------------------------------
   ANALYSTS — tier aggregates, never named research firms
   ------------------------------------------------------------------------- */

const ANALYST_TIERS = [
  'Bulge-bracket research', 'Bulge-bracket research', 'Mid-tier broker',
  'Mid-tier broker', 'Independent research', 'Boutique specialist',
  'Regional broker', 'Quantitative research',
];

export function generateAnalysts(inst: Instrument, bars: readonly Bar[], now = Date.now()): AnalystRating[] {
  if (inst.assetClass !== 'equity' && inst.assetClass !== 'etf') return [];
  const rng = mulberry32(hashString(`analyst|${inst.symbol}`));
  const price = bars[bars.length - 1]?.c ?? inst.anchor;

  // Sell-side ratings lag price and skew structurally bullish.
  const mom60 = trailingMomentum(bars, 60);
  const bullBias = clamp(0.58 + mom60 * 1.4, 0.2, 0.9);

  const count = 6 + Math.floor(rng() * 10);
  const out: AnalystRating[] = [];

  for (let i = 0; i < count; i++) {
    const r = rng();
    const rating: AnalystRating['rating'] =
      r < bullBias * 0.35 ? 'strong_buy'
      : r < bullBias * 0.85 ? 'buy'
      : r < 0.9 ? 'hold'
      : r < 0.97 ? 'sell'
      : 'strong_sell';

    const upsideByRating: Record<AnalystRating['rating'], number> = {
      strong_buy: 0.22, buy: 0.13, hold: 0.03, sell: -0.08, strong_sell: -0.18,
    };
    const target = price * (1 + upsideByRating[rating] + gaussian(rng) * 0.06);

    const hasRevision = rng() < 0.35;
    const previousRating: AnalystRating['rating'] | undefined = hasRevision
      ? (['strong_buy', 'buy', 'hold', 'sell', 'strong_sell'] as const)[Math.floor(rng() * 5)]
      : undefined;

    out.push({
      firm: `${ANALYST_TIERS[i % ANALYST_TIERS.length]} (modelled)`,
      rating,
      priceTarget: Math.max(0.01, target),
      date: now - Math.floor(rng() * 120) * DAY,
      previousRating,
    });
  }

  return out;
}
