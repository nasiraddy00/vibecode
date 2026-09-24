/* ===========================================================================
   Synchronous data layer for the standalone browser build.

   The server build reaches market data through the async provider registry,
   which falls back to the simulator when no feed is reachable. In the browser
   there is no feed to reach at all, so this calls the simulator directly and
   skips the async plumbing entirely — every analytic below is the same code
   the server runs, only the bar source differs.

   Everything is memoised: the engine runs across ~100 instruments, and
   recomputing on every navigation would make the terminal feel broken.
   ========================================================================= */

import type { Bar, Provenance, AssetClass } from '../lib/types';
import {
  ALL_INSTRUMENTS, INDEXES, CRYPTO, COMMODITIES, FX, SECTOR_ETFS,
  BENCHMARK_ETFS, EQUITIES, BONDS, INTL_INDEXES, HOME_PANELS, resolveInstrument,
  type Instrument,
} from '../lib/market/universe';
import { simulateSeries, simulateQuote } from '../lib/providers/simulator';
import { computeSnapshot, type IndicatorSnapshot } from '../lib/indicators';
import { closes, last, sma } from '../lib/indicators/core';
import { generateSignal } from '../lib/signals';
import { writeAnalystNote } from '../lib/signals/analyst';
import { assessVix, stressGauge, type VixComplex, type StressGauge } from '../lib/vol';
import { mean } from '../lib/util/math';
import {
  assessFundamentals, analyseEarnings,
  type FundamentalAssessment, type EarningsAnalysis, type Fundamentals,
} from '../lib/fundamentals';
import {
  generateFundamentals, generateEarnings, generateOptionChain, generateIvHistory,
} from '../lib/fundamentals/generate';
import {
  analyseInsiders, analyseInstitutional, analyseSocial, analyseNews, analyseAnalysts,
  type InsiderAnalysis, type InstitutionalAnalysis, type SocialAnalysis,
  type NewsAnalysis, type AnalystConsensus,
} from '../lib/sentiment';
import {
  generateInsiders, generateInstitutional, generateSocial, generateNews, generateAnalysts,
} from '../lib/sentiment/generate';
import {
  ivStats, analyseSkew, analyseTermStructure, analysePositioning,
  type OptionChain, type IvStats, type SkewAnalysis, type TermStructure, type Positioning,
} from '../lib/options/chain';
import type { TickerRow, SectorRow, TradeIdea, Breadth, SessionPlaybook } from '../lib/market/cockpit';
import type { ScreenerRow } from '../lib/market/screener';

const barCache = new Map<string, Bar[]>();

export function getBarsSync(inst: Instrument, count = 750): Bar[] {
  const key = `${inst.symbol}:${count}`;
  const hit = barCache.get(key);
  if (hit) return hit;
  const bars = simulateSeries(inst, { bars: count, timeframe: '1d' }).bars;
  barCache.set(key, bars);
  return bars;
}

const SIM: Provenance = 'simulated';

/* ---------------------------------------------------------------------------
   COCKPIT
   ------------------------------------------------------------------------- */

function buildRow(inst: Instrument): TickerRow {
  const bars = getBarsSync(inst, 300);
  const quote = simulateQuote(inst, bars);
  const snap = computeSnapshot(bars);
  const c = closes(bars);
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
    provenance: SIM,
    source: 'simulator',
  };
}

const rowsFor = (symbols: readonly string[]): TickerRow[] =>
  symbols
    .map((s) => resolveInstrument(s))
    .filter((i): i is Instrument => Boolean(i))
    .map(buildRow);

function buildIdea(inst: Instrument): TradeIdea | null {
  const bars = getBarsSync(inst, 420);
  if (bars.length < 220) return null;

  const sig = generateSignal({
    symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
    bars, provenance: SIM, horizon: 'swing', equity: 10_000,
  });
  if (sig.plan.direction === 'flat') return null;

  const c = closes(bars);
  const prev = c[c.length - 2] ?? sig.price;

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
    provenance: SIM,
    dataQuality: sig.dataQuality,
  };
}

const rankIdeas = (insts: readonly Instrument[], topN: number): TradeIdea[] =>
  insts
    .map(buildIdea)
    .filter((i): i is TradeIdea => i !== null)
    .sort((a, b) => {
      const av = a.conviction + (Number.isFinite(a.riskReward) ? Math.min(a.riskReward, 4) * 3 : 0);
      const bv = b.conviction + (Number.isFinite(b.riskReward) ? Math.min(b.riskReward, 4) * 3 : 0);
      return bv - av;
    })
    .slice(0, topN);

function computeBreadth(): Breadth {
  const sample = EQUITIES.slice(0, 40);
  const rows = sample.map((inst) => {
    const bars = getBarsSync(inst, 300);
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
  });

  const above50 = (rows.filter((r) => r.above50).length / rows.length) * 100;
  const above200 = (rows.filter((r) => r.above200).length / rows.length) * 100;
  const advancers = rows.filter((r) => r.advancing && !r.unchanged).length;
  const unchanged = rows.filter((r) => r.unchanged).length;
  const decliners = rows.length - advancers - unchanged;
  const netNewHighs = rows.filter((r) => r.newHigh).length - rows.filter((r) => r.newLow).length;

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

function buildSectors(): SectorRow[] {
  const spy = resolveInstrument('SPY');
  const spyC = spy ? closes(getBarsSync(spy, 120)) : [];
  const spyRet20 = spyC.length > 21 ? (spyC[spyC.length - 1] / spyC[spyC.length - 21] - 1) * 100 : 0;

  return SECTOR_ETFS.map((inst) => {
    const c = closes(getBarsSync(inst, 120));
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
      provenance: SIM,
    };
  }).sort((a, b) => b.relative20 - a.relative20);
}

function buildVix(): VixComplex {
  const get = (sym: string, n: number): Bar[] => {
    const inst = resolveInstrument(sym);
    return inst ? getBarsSync(inst, n) : [];
  };
  const vixBars = get('VIX', 300);
  const lastC = (b: Bar[]): number => (b.length ? b[b.length - 1].c : NaN);
  const prevC = (b: Bar[]): number => (b.length > 1 ? b[b.length - 2].c : NaN);

  return assessVix({
    vix: lastC(vixBars),
    vixPrev: prevC(vixBars),
    vix3m: lastC(get('VIX3M', 60)),
    vix9d: lastC(get('VIX9D', 60)),
    vvix: lastC(get('VVIX', 60)),
    vixHistory: closes(vixBars),
    spxBars: get('SPX', 60),
    provenance: SIM,
  });
}

function buildPlaybook(
  indexes: TickerRow[], vix: VixComplex, breadth: Breadth,
  sectors: SectorRow[], stress: StressGauge, crypto: TickerRow[],
): SessionPlaybook {
  const bullets: SessionPlaybook['bullets'] = [];
  const spx = indexes.find((i) => i.symbol === 'SPX');
  const ndx = indexes.find((i) => i.symbol === 'NDX');
  const rut = indexes.find((i) => i.symbol === 'RUT');

  if (spx) {
    bullets.push({
      label: 'INDEX TONE',
      tone: spx.changePct > 0.4 ? 'long' : spx.changePct < -0.4 ? 'short' : 'neutral',
      text:
        `S&P ${spx.changePct >= 0 ? '+' : ''}${spx.changePct.toFixed(2)}%` +
        (ndx ? `, Nasdaq ${ndx.changePct >= 0 ? '+' : ''}${ndx.changePct.toFixed(2)}%` : '') +
        (rut ? `, Russell ${rut.changePct >= 0 ? '+' : ''}${rut.changePct.toFixed(2)}%` : '') + '. ' +
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

  bullets.push({
    label: 'VOLATILITY',
    tone: vix.score > 0.15 ? 'long' : vix.score < -0.15 ? 'short' : 'neutral',
    text: vix.tradingImplication,
  });
  bullets.push({
    label: 'BREADTH',
    tone: breadth.state === 'strong' || breadth.state === 'healthy' ? 'long'
      : breadth.state === 'weak' ? 'short'
      : breadth.state === 'washed_out' ? 'warn' : 'neutral',
    text: breadth.note,
  });

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

  bullets.push({
    label: 'CROSS-ASSET',
    tone: stress.state === 'risk_on' ? 'long' : stress.state === 'crisis' ? 'warn'
      : stress.state === 'risk_off' ? 'short' : 'neutral',
    text: `Stress gauge at ${stress.level.toFixed(0)}/100. ${stress.note}`,
  });

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

  const dir = !spx ? 'mixed' : spx.changePct > 0.35 ? 'bid' : spx.changePct < -0.35 ? 'offered' : 'two-way';
  const headline =
    stress.state === 'crisis'
      ? 'Cross-asset stress is firing on multiple channels. Capital preservation dominates: cut gross exposure, widen stops, and expect correlations to converge toward one.'
      : vix.regime === 'panic' || vix.regime === 'stressed'
        ? `Equities ${dir} into a ${vix.regime} volatility regime. Position sizing matters more than signal selection today — the distribution of outcomes is far wider than the edge.`
        : breadth.state === 'weak' && dir === 'bid'
          ? 'Indexes are bid on narrowing breadth. Follow the leadership, but treat index-level strength as less durable than it looks — this is a narrow tape.'
          : breadth.state === 'strong' && dir === 'bid'
            ? 'Broad participation behind a bid tape. Trend-following and pullback entries both work in this configuration; fade signals are the ones to distrust.'
            : dir === 'offered' && breadth.state === 'washed_out'
              ? 'Offered tape with washed-out breadth. Downside continuation is possible but this is where mean-reversion has its best odds — demand better prices before shorting.'
              : `Equities ${dir} with volatility in the ${vix.regime} band and breadth ${breadth.state.replace('_', ' ')}. No dominant macro theme — trade the instrument, not the index.`;

  return { headline, bullets };
}

export interface CockpitData {
  asOf: number;
  indexes: TickerRow[];
  crypto: TickerRow[];
  commodities: TickerRow[];
  fx: TickerRow[];
  rates: TickerRow[];
  bonds: TickerRow[];
  world: TickerRow[];
  sectors: SectorRow[];
  vix: VixComplex;
  stress: StressGauge;
  breadth: Breadth;
  ideas: {
    equities: TradeIdea[]; crypto: TradeIdea[]; indexes: TradeIdea[];
    commodities: TradeIdea[]; bonds: TradeIdea[];
  };
  playbook: SessionPlaybook;
}

let cockpitCache: CockpitData | null = null;

export function buildCockpit(): CockpitData {
  if (cockpitCache) return cockpitCache;

  const indexes = rowsFor(HOME_PANELS.indexes);
  const crypto = rowsFor(HOME_PANELS.crypto);
  const commodities = rowsFor(HOME_PANELS.commodities);
  const fx = rowsFor(HOME_PANELS.fx);
  const rates = rowsFor(HOME_PANELS.rates);
  const bonds = rowsFor(HOME_PANELS.bonds);
  const world = rowsFor(HOME_PANELS.world);
  const sectors = buildSectors();
  const vix = buildVix();
  const breadth = computeBreadth();

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

  cockpitCache = {
    asOf: Date.now(),
    indexes, crypto, commodities, fx, rates, bonds, world, sectors, vix, stress, breadth,
    ideas: {
      equities: rankIdeas([...EQUITIES, ...BENCHMARK_ETFS], 10),
      crypto: rankIdeas(CRYPTO, 10),
      indexes: rankIdeas(
        [
          ...INDEXES.filter((i) => i.assetClass === 'index'
            && !['VIX', 'VIX3M', 'VIX9D', 'VVIX', 'SKEW', 'OVX', 'GVZ'].includes(i.symbol)),
          ...INTL_INDEXES,
          ...SECTOR_ETFS,
        ],
        10,
      ),
      commodities: rankIdeas(COMMODITIES, 10),
      bonds: rankIdeas(BONDS, 10),
    },
    playbook: buildPlaybook(indexes, vix, breadth, sectors, stress, crypto),
  };
  return cockpitCache;
}

/* ---------------------------------------------------------------------------
   DOSSIER
   ------------------------------------------------------------------------- */

export interface Dossier {
  instrument: Instrument;
  quote: ReturnType<typeof simulateQuote>;
  bars: Bar[];
  snapshot: IndicatorSnapshot;
  signal: ReturnType<typeof generateSignal>;
  fundamentals: FundamentalAssessment | null;
  raw: Fundamentals | null;
  earnings: EarningsAnalysis | null;
  insider: InsiderAnalysis | null;
  institutional: InstitutionalAnalysis | null;
  social: SocialAnalysis;
  news: NewsAnalysis;
  analysts: AnalystConsensus | null;
  chain: OptionChain | null;
  iv: IvStats | null;
  skew: SkewAnalysis | null;
  term: TermStructure | null;
  positioning: Positioning | null;
  vix: VixComplex;
  asOf: number;
}

const dossierCache = new Map<string, Dossier>();

export function buildDossier(symbolRaw: string): Dossier | null {
  const inst = resolveInstrument(symbolRaw);
  if (!inst) return null;

  const hit = dossierCache.get(inst.symbol);
  if (hit) return hit;

  const now = Date.now();
  const bars = getBarsSync(inst, 750);
  const snapshot = computeSnapshot(bars);
  const quote = simulateQuote(inst, bars);
  const vix = buildVix();

  let fundamentals: FundamentalAssessment | null = null;
  let raw: Fundamentals | null = null;
  let earnings: EarningsAnalysis | null = null;
  let analysts: AnalystConsensus | null = null;

  if (inst.assetClass === 'equity' || inst.assetClass === 'etf') {
    raw = generateFundamentals(inst, bars, now);
    fundamentals = assessFundamentals(raw, snapshot.price);
    const ev = generateEarnings(inst, raw, bars, now);
    earnings = analyseEarnings(ev.history, ev.next, now, 10);
    analysts = analyseAnalysts(generateAnalysts(inst, bars, now), snapshot.price, SIM, 'simulator', now);
  }

  const insider = inst.assetClass === 'equity'
    ? analyseInsiders(generateInsiders(inst, bars, now), SIM, 'simulator', now)
    : null;
  const institutional = raw
    ? analyseInstitutional(generateInstitutional(inst, bars, raw.floatShares, now), raw.floatShares, SIM, 'simulator', now)
    : null;
  const social = analyseSocial(generateSocial(inst, bars), SIM, 'simulator');
  const news = analyseNews(generateNews(inst, bars, now), SIM, 'simulator', now);

  const optionsAvailable =
    inst.assetClass === 'equity' || inst.assetClass === 'etf' ||
    inst.assetClass === 'index' || inst.assetClass === 'crypto';

  let chain: OptionChain | null = null;
  let iv: IvStats | null = null;
  let skew: SkewAnalysis | null = null;
  let term: TermStructure | null = null;
  let positioning: Positioning | null = null;

  if (optionsAvailable && snapshot.price > 0) {
    const rv = Number.isFinite(snapshot.realisedVolAnnual) && snapshot.realisedVolAnnual > 0
      ? snapshot.realisedVolAnnual
      : inst.typicalVol;
    const baseIv = Math.max(0.05, rv * 1.12 + 0.015);
    chain = generateOptionChain(inst, snapshot.price, baseIv, now);
    iv = ivStats(baseIv, generateIvHistory(inst, baseIv), rv);
    const front = Math.min(...chain.expiries);
    skew = analyseSkew(chain.contracts.filter((c) => c.expiry === front), snapshot.price);
    term = analyseTermStructure(chain);
    positioning = analysePositioning(chain, true);
  }

  const signal = generateSignal({
    symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
    bars, provenance: SIM, horizon: 'swing', equity: 10_000, now: new Date(now),
    fundamentals: fundamentals ?? undefined,
    earnings: earnings ?? undefined,
    insider: insider ?? undefined,
    institutional: institutional ?? undefined,
    social, news,
    analysts: analysts ?? undefined,
    iv: iv ?? undefined,
    vix,
    optionsPositioningScore: positioning?.score,
    optionsPositioningNote: positioning?.note,
    optionsAvailable,
  });

  const d: Dossier = {
    instrument: inst, quote, bars, snapshot, signal,
    fundamentals, raw, earnings, insider, institutional, social, news, analysts,
    chain, iv, skew, term, positioning, vix, asOf: now,
  };
  dossierCache.set(inst.symbol, d);
  return d;
}

/* ---------------------------------------------------------------------------
   SCREENER
   ------------------------------------------------------------------------- */

let screenerCache: ScreenerRow[] | null = null;

export function runScreener(): ScreenerRow[] {
  if (screenerCache) return screenerCache;

  screenerCache = ALL_INSTRUMENTS
    .filter((i) => i.assetClass !== 'rate')
    .map((inst): ScreenerRow | null => {
      const bars = getBarsSync(inst, 420);
      if (bars.length < 220) return null;
      const s = computeSnapshot(bars);
      const sig = generateSignal({
        symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
        bars, provenance: SIM, horizon: 'swing', equity: 10_000,
      });
      const c = closes(bars);
      const prev = c[c.length - 2] ?? s.price;
      return {
        symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass, sector: inst.sector,
        price: s.price,
        changePct: prev !== 0 ? ((s.price - prev) / prev) * 100 : 0,
        ret5: s.ret5, ret20: s.ret20, ret60: s.ret60,
        rsi: s.rsi14, adx: s.adx14, atrPct: s.natr14, relVolume: s.relVolume,
        pctFrom52wHigh: s.pctFrom52wHigh, pricePercentile: s.pricePercentile,
        action: sig.action, direction: sig.plan.direction, score: sig.score,
        conviction: sig.conviction, regime: sig.regime.label, riskReward: sig.plan.riskReward,
        aboveSma50: s.price > s.sma50, aboveSma200: s.price > s.sma200,
        squeeze: s.squeeze.barsInSqueeze > 0 || s.squeeze.fired,
        spark: c.slice(-50),
        provenance: 'simulated',
      };
    })
    .filter((r): r is ScreenerRow => r !== null)
    .sort((a, b) => b.conviction - a.conviction);

  return screenerCache;
}

/* ---------------------------------------------------------------------------
   TRADE CALL
   ------------------------------------------------------------------------- */

import type { TradeView } from '../components/TradeVerdict';

const tradeCache = new Map<string, TradeView>();

export function buildTradeCall(symbolRaw: string): TradeView | null {
  const d = buildDossier(symbolRaw);
  if (!d) return null;

  const hit = tradeCache.get(d.instrument.symbol);
  if (hit) return hit;

  const note = writeAnalystNote({
    signal: d.signal,
    snapshot: d.snapshot,
    name: d.instrument.name,
    assetClass: d.instrument.assetClass,
    fundamentals: d.fundamentals,
    earnings: d.earnings,
    insider: d.insider,
    institutional: d.institutional,
    social: d.social,
    news: d.news,
    iv: d.iv,
    vix: d.vix,
    simulated: true,
  });

  const v: TradeView = {
    instrument: d.instrument,
    note,
    signal: d.signal,
    snapshot: d.snapshot,
    bars: d.bars,
    simulated: true,
    source: 'simulator',
  };
  tradeCache.set(d.instrument.symbol, v);
  return v;
}
