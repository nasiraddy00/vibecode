/* ===========================================================================
   Home-page market assembly.

   Builds the full opening-session picture in one server-side pass: quotes and
   sparklines across every asset class, the volatility complex, breadth, sector
   rotation, and a ranked set of trade candidates produced by running the full
   signal engine across the universe.
   ========================================================================= */

import type { Bar, Quote, AssetClass, Provenance } from '../types';
import type { SignalResult } from '../types';
import { getBars, getQuote, type BarsResult } from '../providers';
import {
  ALL_INSTRUMENTS, INDEXES, CRYPTO, COMMODITIES, FX, SECTOR_ETFS,
  BENCHMARK_ETFS, EQUITIES, HOME_PANELS, resolveInstrument, type Instrument,
} from './universe';
import { generateSignal } from '../signals';
import { assessVix, stressGauge, type VixComplex, type StressGauge } from '../vol';
import { computeSnapshot } from '../indicators';
import { closes, last, sma } from '../indicators/core';
import { mean, clamp } from '../util/math';

export interface TickerRow {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  change: number;
  changePct: number;
  high: number;
  low: number;
  volume: number;
  /** Trailing closes for the sparkline. */
  spark: number[];
  /** Distance from the 20-day mean, in ATRs — how stretched it is right now. */
  stretch: number;
  ret5: number;
  ret20: number;
  rsi: number;
  atrPct: number;
  provenance: Provenance;
  source: string;
}

export interface SectorRow {
  symbol: string;
  name: string;
  changePct: number;
  ret5: number;
  ret20: number;
  /** Performance relative to SPY over 20 sessions. */
  relative20: number;
  spark: number[];
  provenance: Provenance;
}

export interface TradeIdea {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  changePct: number;
  action: string;
  direction: 'long' | 'short' | 'flat';
  score: number;
  conviction: number;
  regime: string;
  regimeLabel: string;
  entry: number;
  stop: number;
  target: number;
  riskReward: number;
  instrument: string;
  optionNote?: string;
  /** The single most important reason, for the one-line summary. */
  headline: string;
  spark: number[];
  provenance: Provenance;
  dataQuality: number;
}

export interface Breadth {
  /** Share of the tracked equity universe above its 50-day MA. */
  above50: number;
  above200: number;
  advancers: number;
  decliners: number;
  unchanged: number;
  /** Advance/decline ratio. */
  adRatio: number;
  /** Net new highs minus new lows over 52 weeks. */
  netNewHighs: number;
  state: 'strong' | 'healthy' | 'neutral' | 'weak' | 'washed_out';
  note: string;
}

export interface SessionPlaybook {
  headline: string;
  bullets: { label: string; text: string; tone: 'long' | 'short' | 'neutral' | 'warn' }[];
}

export interface CockpitData {
  asOf: number;
  indexes: TickerRow[];
  crypto: TickerRow[];
  commodities: TickerRow[];
  fx: TickerRow[];
  rates: TickerRow[];
  sectors: SectorRow[];
  vix: VixComplex;
  stress: StressGauge;
  breadth: Breadth;
  ideas: {
    equities: TradeIdea[];
    crypto: TradeIdea[];
    indexes: TradeIdea[];
    commodities: TradeIdea[];
  };
  playbook: SessionPlaybook;
  mode: 'live' | 'mixed' | 'simulated';
  anySimulated: boolean;
}

/* ---------------------------------------------------------------------------
   ROW BUILDERS
   ------------------------------------------------------------------------- */

async function buildRow(inst: Instrument): Promise<TickerRow | null> {
  try {
    const [barsResult, quote] = await Promise.all([
      getBars(inst, '1d', 300),
      getQuote(inst),
    ]);
    const bars = barsResult.bars;
    if (bars.length < 25) return null;

    const c = closes(bars);
    const snap = computeSnapshot(bars);
    const atr = Number.isFinite(snap.atr14) ? snap.atr14 : quote.price * 0.02;
    const sma20 = Number.isFinite(snap.sma20) ? snap.sma20 : quote.price;

    return {
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      price: quote.price,
      change: quote.change,
      changePct: quote.changePct,
      high: quote.high,
      low: quote.low,
      volume: quote.volume,
      spark: c.slice(-60),
      stretch: atr > 0 ? (quote.price - sma20) / atr : 0,
      ret5: snap.ret5,
      ret20: snap.ret20,
      rsi: snap.rsi14,
      atrPct: snap.natr14,
      provenance: quote.provenance,
      source: quote.source,
    };
  } catch {
    return null;
  }
}

async function buildRows(symbols: readonly string[]): Promise<TickerRow[]> {
  const insts = symbols.map((s) => resolveInstrument(s)).filter((i): i is Instrument => Boolean(i));
  const rows = await mapLimit(insts, 6, buildRow);
  return rows.filter((r): r is TickerRow => r !== null);
}

/** Bounded-concurrency map. Firing 50 provider calls at once trips every
 *  rate limiter there is; serialising them takes far too long. */
async function mapLimit<T, R>(
  items: readonly T[], limit: number, fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ---------------------------------------------------------------------------
   TRADE IDEAS
   ------------------------------------------------------------------------- */

async function buildIdea(inst: Instrument): Promise<TradeIdea | null> {
  try {
    const barsResult = await getBars(inst, '1d', 420);
    if (barsResult.bars.length < 220) return null;

    const sig = generateSignal({
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      bars: barsResult.bars,
      provenance: barsResult.provenance === 'simulated' ? 'simulated' : 'live',
      horizon: 'swing',
      equity: 10_000,
    });

    const c = closes(barsResult.bars);
    const prev = c[c.length - 2] ?? sig.price;

    // The headline is the reason a trader would actually give if asked "why
    // this one?". Broad context votes (MA stack, range position) are present on
    // every instrument and would otherwise win every headline, saying nothing
    // that distinguishes this idea from the next — so they are demoted and only
    // surface when nothing more specific supports the call.
    const GENERIC = new Set(['ma_alignment', 'range_position', 'seasonal_half', 'seasonal_dow']);
    const topVote = [...sig.votes]
      .filter((v) => v.score !== 0 && Math.sign(v.score) === Math.sign(sig.score))
      .sort((a, b) => {
        const wa = Math.abs(a.score * a.confidence) * (GENERIC.has(a.id) ? 0.35 : 1);
        const wb = Math.abs(b.score * b.confidence) * (GENERIC.has(b.id) ? 0.35 : 1);
        return wb - wa;
      })[0];

    return {
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      price: sig.price,
      changePct: prev !== 0 ? ((sig.price - prev) / prev) * 100 : 0,
      action: sig.action,
      direction: sig.plan.direction,
      score: sig.score,
      conviction: sig.conviction,
      regime: sig.regime.regime,
      regimeLabel: sig.regime.label,
      entry: sig.plan.entry,
      stop: sig.plan.stop,
      target: sig.plan.targets[0] ?? NaN,
      riskReward: sig.plan.riskReward,
      instrument: sig.plan.instrument,
      optionNote: sig.plan.optionLeg
        ? `${sig.plan.optionLeg.type.toUpperCase()} ${sig.plan.optionLeg.strike} ${sig.plan.optionLeg.dte}DTE`
        : undefined,
      headline: topVote
        ? `${topVote.label}${topVote.reading ? ` ${topVote.reading}` : ''} · ${sig.regime.label.toLowerCase()}`
        : sig.regime.label,
      spark: c.slice(-60),
      provenance: barsResult.provenance === 'simulated' ? 'simulated' : 'live',
      dataQuality: sig.dataQuality,
    };
  } catch {
    return null;
  }
}

async function rankIdeas(insts: readonly Instrument[], topN: number): Promise<TradeIdea[]> {
  const ideas = await mapLimit(insts, 5, buildIdea);
  return ideas
    .filter((i): i is TradeIdea => i !== null && i.direction !== 'flat')
    // Rank by conviction, with a light tilt toward better reward-to-risk.
    .sort((a, b) => {
      const aScore = a.conviction + (Number.isFinite(a.riskReward) ? Math.min(a.riskReward, 4) * 3 : 0);
      const bScore = b.conviction + (Number.isFinite(b.riskReward) ? Math.min(b.riskReward, 4) * 3 : 0);
      return bScore - aScore;
    })
    .slice(0, topN);
}

/* ---------------------------------------------------------------------------
   BREADTH
   ------------------------------------------------------------------------- */

async function computeBreadth(): Promise<Breadth> {
  const sample = EQUITIES.slice(0, 40);
  const results = await mapLimit(sample, 6, async (inst) => {
    try {
      const { bars } = await getBars(inst, '1d', 300);
      if (bars.length < 210) return null;
      const c = closes(bars);
      const price = c[c.length - 1];
      const prev = c[c.length - 2];
      const ma50 = last(sma(c, 50));
      const ma200 = last(sma(c, 200));
      const win = bars.slice(-252);
      const high52 = Math.max(...win.map((b) => b.h));
      const low52 = Math.min(...win.map((b) => b.l));
      return {
        above50: price > ma50,
        above200: price > ma200,
        advancing: price > prev,
        unchanged: price === prev,
        newHigh: price >= high52 * 0.995,
        newLow: price <= low52 * 1.005,
      };
    } catch {
      return null;
    }
  });

  const valid = results.filter((r): r is NonNullable<typeof r> => r !== null);
  if (!valid.length) {
    return {
      above50: NaN, above200: NaN, advancers: 0, decliners: 0, unchanged: 0,
      adRatio: NaN, netNewHighs: 0, state: 'neutral',
      note: 'Breadth unavailable — no constituent data could be loaded.',
    };
  }

  const above50 = (valid.filter((r) => r.above50).length / valid.length) * 100;
  const above200 = (valid.filter((r) => r.above200).length / valid.length) * 100;
  const advancers = valid.filter((r) => r.advancing && !r.unchanged).length;
  const unchanged = valid.filter((r) => r.unchanged).length;
  const decliners = valid.length - advancers - unchanged;
  const netNewHighs = valid.filter((r) => r.newHigh).length - valid.filter((r) => r.newLow).length;

  const state: Breadth['state'] =
    above50 > 70 && above200 > 65 ? 'strong'
    : above50 > 55 ? 'healthy'
    : above50 > 40 ? 'neutral'
    : above50 > 20 ? 'weak'
    : 'washed_out';

  const note =
    state === 'strong'
      ? `${above50.toFixed(0)}% of the tracked universe is above its 50-day. Broad participation confirms the index move rather than masking a narrow one.`
      : state === 'washed_out'
        ? `Only ${above50.toFixed(0)}% are above their 50-day. Breadth this washed out is a capitulation reading — historically closer to a bottom than a top, though it can persist.`
        : state === 'weak'
          ? `${above50.toFixed(0)}% above the 50-day. Narrow participation: the index is being carried by a handful of names, which is how tops are built.`
          : `${above50.toFixed(0)}% above the 50-day and ${above200.toFixed(0)}% above the 200-day. Participation is unremarkable.`;

  return {
    above50, above200, advancers, decliners, unchanged,
    adRatio: decliners > 0 ? advancers / decliners : advancers,
    netNewHighs, state, note,
  };
}

/* ---------------------------------------------------------------------------
   SECTORS
   ------------------------------------------------------------------------- */

async function buildSectors(): Promise<SectorRow[]> {
  const spyBars = await getBars('SPY', '1d', 120).catch(() => null);
  const spyRet20 = spyBars && spyBars.bars.length > 21
    ? (() => {
        const c = closes(spyBars.bars);
        const base = c[c.length - 21];
        return base ? (c[c.length - 1] / base - 1) * 100 : 0;
      })()
    : 0;

  const rows = await mapLimit(SECTOR_ETFS, 6, async (inst) => {
    try {
      const { bars, provenance } = await getBars(inst, '1d', 120);
      if (bars.length < 25) return null;
      const c = closes(bars);
      const price = c[c.length - 1];
      const prev = c[c.length - 2];
      const r5 = c.length > 6 ? (price / c[c.length - 6] - 1) * 100 : 0;
      const r20 = c.length > 21 ? (price / c[c.length - 21] - 1) * 100 : 0;
      return {
        symbol: inst.symbol,
        name: inst.name,
        changePct: prev ? ((price - prev) / prev) * 100 : 0,
        ret5: r5,
        ret20: r20,
        relative20: r20 - spyRet20,
        spark: c.slice(-40),
        provenance: provenance === 'simulated' ? ('simulated' as Provenance) : ('live' as Provenance),
      };
    } catch {
      return null;
    }
  });

  return rows
    .filter((r): r is SectorRow => r !== null)
    .sort((a, b) => b.relative20 - a.relative20);
}

/* ---------------------------------------------------------------------------
   VOLATILITY COMPLEX
   ------------------------------------------------------------------------- */

async function buildVix(): Promise<VixComplex> {
  const [vixBars, vix3mBars, vix9dBars, vvixBars, spxBars] = await Promise.all([
    getBars('VIX', '1d', 300).catch(() => null),
    getBars('VIX3M', '1d', 60).catch(() => null),
    getBars('VIX9D', '1d', 60).catch(() => null),
    getBars('VVIX', '1d', 60).catch(() => null),
    getBars('SPX', '1d', 60).catch(() => null),
  ]);

  const lastClose = (b: BarsResult | null): number =>
    b && b.bars.length ? b.bars[b.bars.length - 1].c : NaN;
  const prevClose = (b: BarsResult | null): number =>
    b && b.bars.length > 1 ? b.bars[b.bars.length - 2].c : NaN;

  return assessVix({
    vix: lastClose(vixBars),
    vixPrev: prevClose(vixBars),
    vix3m: lastClose(vix3mBars),
    vix9d: lastClose(vix9dBars),
    vvix: lastClose(vvixBars),
    vixHistory: vixBars ? closes(vixBars.bars) : [],
    spxBars: spxBars?.bars ?? [],
    provenance: vixBars?.provenance === 'simulated' ? 'simulated' : 'live',
  });
}

/* ---------------------------------------------------------------------------
   SESSION PLAYBOOK
   ------------------------------------------------------------------------- */

function buildPlaybook(
  indexes: TickerRow[], vix: VixComplex, breadth: Breadth,
  sectors: SectorRow[], stress: StressGauge, crypto: TickerRow[],
): SessionPlaybook {
  const bullets: SessionPlaybook['bullets'] = [];

  const spx = indexes.find((i) => i.symbol === 'SPX');
  const ndx = indexes.find((i) => i.symbol === 'NDX');
  const rut = indexes.find((i) => i.symbol === 'RUT');

  // --- index tone ---------------------------------------------------------
  if (spx) {
    const tone = spx.changePct > 0.4 ? 'long' : spx.changePct < -0.4 ? 'short' : 'neutral';
    bullets.push({
      label: 'INDEX TONE',
      tone,
      text:
        `S&P ${spx.changePct >= 0 ? '+' : ''}${spx.changePct.toFixed(2)}%` +
        (ndx ? `, Nasdaq ${ndx.changePct >= 0 ? '+' : ''}${ndx.changePct.toFixed(2)}%` : '') +
        (rut ? `, Russell ${rut.changePct >= 0 ? '+' : ''}${rut.changePct.toFixed(2)}%` : '') +
        '. ' +
        (ndx && rut && ndx.changePct > rut.changePct + 0.5
          ? 'Large-cap tech is leading small caps, which is a defensive-growth rotation rather than a broad risk-on move.'
          : rut && ndx && rut.changePct > ndx.changePct + 0.5
            ? 'Small caps are leading — a genuine risk-appetite signal, since they carry the most domestic economic sensitivity.'
            : 'Leadership is evenly distributed across the cap spectrum.'),
    });

    if (Number.isFinite(spx.stretch)) {
      bullets.push({
        label: 'POSITIONING',
        tone: Math.abs(spx.stretch) > 2 ? 'warn' : 'neutral',
        text:
          `The index sits ${Math.abs(spx.stretch).toFixed(1)} ATRs ${spx.stretch >= 0 ? 'above' : 'below'} its 20-day mean` +
          (Math.abs(spx.stretch) > 2
            ? '. That is a stretched condition — chasing here means paying for the move that has already happened.'
            : '. Not stretched; entries do not require a pullback.'),
      });
    }
  }

  // --- volatility ---------------------------------------------------------
  bullets.push({
    label: 'VOLATILITY',
    tone: vix.score > 0.15 ? 'long' : vix.score < -0.15 ? 'short' : 'neutral',
    text: vix.tradingImplication,
  });

  // --- breadth -------------------------------------------------------------
  bullets.push({
    label: 'BREADTH',
    tone: breadth.state === 'strong' || breadth.state === 'healthy' ? 'long'
      : breadth.state === 'weak' ? 'short'
      : breadth.state === 'washed_out' ? 'warn' : 'neutral',
    text: breadth.note,
  });

  // --- rotation -------------------------------------------------------------
  if (sectors.length >= 3) {
    const leaders = sectors.slice(0, 2).map((s) => s.name).join(' and ');
    const laggards = sectors.slice(-2).map((s) => s.name).join(' and ');
    const defensiveLeading = sectors.slice(0, 3).some((s) =>
      ['Utilities', 'Consumer Staples', 'Health Care'].includes(s.name));
    bullets.push({
      label: 'ROTATION',
      tone: defensiveLeading ? 'warn' : 'neutral',
      text:
        `${leaders} lead on a 20-day relative basis; ${laggards} lag. ` +
        (defensiveLeading
          ? 'Defensives leading while the index holds up is a classic late-cycle tell — money is de-risking without leaving.'
          : 'Cyclical leadership is consistent with continued risk appetite.'),
    });
  }

  // --- cross-asset stress ----------------------------------------------------
  bullets.push({
    label: 'CROSS-ASSET',
    tone: stress.state === 'risk_on' ? 'long' : stress.state === 'crisis' ? 'warn' : stress.state === 'risk_off' ? 'short' : 'neutral',
    text: `Stress gauge at ${stress.level.toFixed(0)}/100. ${stress.note}`,
  });

  // --- crypto ---------------------------------------------------------------
  const btc = crypto.find((c) => c.symbol === 'BTC-USD');
  if (btc) {
    bullets.push({
      label: 'CRYPTO',
      tone: btc.changePct > 1 ? 'long' : btc.changePct < -1 ? 'short' : 'neutral',
      text:
        `Bitcoin ${btc.changePct >= 0 ? '+' : ''}${btc.changePct.toFixed(2)}% with RSI at ${Number.isFinite(btc.rsi) ? btc.rsi.toFixed(0) : '—'} and ATR running ${Number.isFinite(btc.atrPct) ? btc.atrPct.toFixed(1) : '—'}% of price. ` +
        'Crypto trades continuously, so it prices weekend and overnight risk that equities gap to on Monday — it is the best available read on risk appetite while the US market is shut.',
    });
  }

  const headline = buildHeadline(spx, vix, breadth, stress);
  return { headline, bullets };
}

function buildHeadline(
  spx: TickerRow | undefined, vix: VixComplex, breadth: Breadth, stress: StressGauge,
): string {
  const dir = !spx ? 'mixed' : spx.changePct > 0.35 ? 'bid' : spx.changePct < -0.35 ? 'offered' : 'two-way';

  if (stress.state === 'crisis') {
    return 'Cross-asset stress is firing on multiple channels. Capital preservation dominates: cut gross exposure, widen stops, and expect correlations to converge toward one.';
  }
  if (vix.regime === 'panic' || vix.regime === 'stressed') {
    return `Equities ${dir} into a ${vix.regime} volatility regime. Position sizing matters more than signal selection today — the distribution of outcomes is far wider than the edge.`;
  }
  if (breadth.state === 'weak' && dir === 'bid') {
    return 'Indexes are bid on narrowing breadth. Follow the leadership, but treat index-level strength as less durable than it looks — this is a narrow tape.';
  }
  if (breadth.state === 'strong' && dir === 'bid') {
    return 'Broad participation behind a bid tape. Trend-following and pullback entries both work in this configuration; fade signals are the ones to distrust.';
  }
  if (dir === 'offered' && breadth.state === 'washed_out') {
    return 'Offered tape with washed-out breadth. Downside continuation is possible but this is where mean-reversion has its best odds — demand better prices before shorting.';
  }
  return `Equities ${dir} with volatility in the ${vix.regime} band and breadth ${breadth.state.replace('_', ' ')}. No dominant macro theme — trade the instrument, not the index.`;
}

/* ---------------------------------------------------------------------------
   MAIN ASSEMBLY
   ------------------------------------------------------------------------- */

export async function buildCockpit(): Promise<CockpitData> {
  const [
    indexes, crypto, commodities, fx, rates, sectors, vix, breadth,
  ] = await Promise.all([
    buildRows(HOME_PANELS.indexes),
    buildRows(HOME_PANELS.crypto),
    buildRows(HOME_PANELS.commodities),
    buildRows(HOME_PANELS.fx),
    buildRows(HOME_PANELS.rates),
    buildSectors(),
    buildVix(),
    computeBreadth(),
  ]);

  const dxy = fx.find((f) => f.symbol === 'DXY');
  const gold = commodities.find((c) => c.symbol === 'GC=F');
  const tnx = rates.find((r) => r.symbol === 'TNX');
  const fvx = rates.find((r) => r.symbol === 'FVX');
  const spxRow = indexes.find((i) => i.symbol === 'SPX');

  const stress = stressGauge({
    vix: vix.vix,
    vixTermRatio: vix.ratio30d3m,
    yieldCurve: tnx && fvx ? tnx.price - fvx.price : undefined,
    dollarMomentum: dxy?.ret20,
    goldRelative: gold && spxRow ? gold.ret20 - spxRow.ret20 : undefined,
    breadth: breadth.above50,
  });

  const [equityIdeas, cryptoIdeas, indexIdeas, commodityIdeas] = await Promise.all([
    rankIdeas([...EQUITIES, ...BENCHMARK_ETFS], 10),
    rankIdeas(CRYPTO, 10),
    rankIdeas([...INDEXES.filter((i) => i.assetClass === 'index' && i.symbol !== 'VIX3M' && i.symbol !== 'VIX9D' && i.symbol !== 'VVIX'), ...SECTOR_ETFS], 10),
    rankIdeas(COMMODITIES, 10),
  ]);

  const allRows = [...indexes, ...crypto, ...commodities, ...fx, ...rates];
  const anySimulated = allRows.some((r) => r.provenance === 'simulated');
  const allSimulated = allRows.length > 0 && allRows.every((r) => r.provenance === 'simulated');

  return {
    asOf: Date.now(),
    indexes, crypto, commodities, fx, rates, sectors,
    vix, stress, breadth,
    ideas: {
      equities: equityIdeas,
      crypto: cryptoIdeas,
      indexes: indexIdeas,
      commodities: commodityIdeas,
    },
    playbook: buildPlaybook(indexes, vix, breadth, sectors, stress, crypto),
    mode: allSimulated ? 'simulated' : anySimulated ? 'mixed' : 'live',
    anySimulated,
  };
}
