/* ===========================================================================
   Per-instrument dossier: everything the ticker dashboard renders, assembled
   server-side in one pass.
   ========================================================================= */

import type { Bar, SignalResult, Provenance } from '../types';
import { resolveInstrument, type Instrument } from './universe';
import { resolveAny } from './resolve';
import { getBars, getQuote, type QuoteResult } from '../providers';
import { computeSnapshot, type IndicatorSnapshot } from '../indicators';
import { generateSignal } from '../signals';
import {
  assessFundamentals, analyseEarnings,
  type FundamentalAssessment, type EarningsAnalysis, type Fundamentals,
} from '../fundamentals';
import { generateFundamentals, generateEarnings, generateOptionChain, generateIvHistory } from '../fundamentals/generate';
import {
  analyseInsiders, analyseInstitutional, analyseSocial, analyseNews, analyseAnalysts,
  type InsiderAnalysis, type InstitutionalAnalysis, type SocialAnalysis,
  type NewsAnalysis, type AnalystConsensus,
} from '../sentiment';
import {
  generateInsiders, generateInstitutional, generateSocial, generateNews, generateAnalysts,
} from '../sentiment/generate';
import {
  ivStats, analyseSkew, analyseTermStructure, analysePositioning,
  type OptionChain, type IvStats, type SkewAnalysis, type TermStructure, type Positioning,
} from '../options/chain';
import { assessVix, type VixComplex } from '../vol';
import { closes } from '../indicators/core';
import { realisedVol } from '../util/math';

export interface Dossier {
  instrument: Instrument;
  quote: QuoteResult;
  bars: Bar[];
  barsProvenance: Provenance;
  barsSource: string;
  fallbackReason?: string;
  snapshot: IndicatorSnapshot;
  signal: SignalResult;

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

export async function buildDossier(
  symbolRaw: string,
  opts: { horizon?: 'intraday' | 'swing' | 'position'; equity?: number } = {},
): Promise<Dossier | null> {
  // Curated first; anything else goes to the vendor lookup, so the dossier
  // and the trade call are available for any listed security, not just the
  // names shipped in the universe.
  const inst = resolveInstrument(symbolRaw) ?? await resolveAny(symbolRaw);
  if (!inst) return null;

  const now = Date.now();
  const [barsResult, quote, vixBars, spxBars] = await Promise.all([
    getBars(inst, '1d', 750),
    getQuote(inst),
    getBars('VIX', '1d', 300).catch(() => null),
    getBars('SPX', '1d', 60).catch(() => null),
  ]);

  const bars = barsResult.bars;
  const snapshot = computeSnapshot(bars);
  const isSim = barsResult.provenance === 'simulated';
  const provenance: Provenance = isSim ? 'simulated' : 'live';

  const vix = assessVix({
    vix: vixBars?.bars.length ? vixBars.bars[vixBars.bars.length - 1].c : NaN,
    vixPrev: vixBars && vixBars.bars.length > 1 ? vixBars.bars[vixBars.bars.length - 2].c : NaN,
    vixHistory: vixBars ? closes(vixBars.bars) : [],
    spxBars: spxBars?.bars ?? [],
    provenance: vixBars?.provenance === 'simulated' ? 'simulated' : 'live',
  });

  // --- fundamentals & earnings (equities only) ---------------------------
  let fundamentals: FundamentalAssessment | null = null;
  let raw: Fundamentals | null = null;
  let earnings: EarningsAnalysis | null = null;
  let analysts: AnalystConsensus | null = null;

  if (inst.assetClass === 'equity' || inst.assetClass === 'etf') {
    raw = generateFundamentals(inst, bars, now);
    fundamentals = assessFundamentals(raw, snapshot.price);
    const ev = generateEarnings(inst, raw, bars, now);
    earnings = analyseEarnings(ev.history, ev.next, now, 10);
    analysts = analyseAnalysts(generateAnalysts(inst, bars, now), snapshot.price, 'simulated', 'simulator', now);
  }

  // --- flow & sentiment ---------------------------------------------------
  const insider = inst.assetClass === 'equity'
    ? analyseInsiders(generateInsiders(inst, bars, now), 'simulated', 'simulator', now)
    : null;

  const institutional = raw
    ? analyseInstitutional(
        generateInstitutional(inst, bars, raw.floatShares, now),
        raw.floatShares, 'simulated', 'simulator', now,
      )
    : null;

  const social = analyseSocial(generateSocial(inst, bars), 'simulated', 'simulator');
  const news = analyseNews(generateNews(inst, bars, now), 'simulated', 'simulator', now);

  // --- options ------------------------------------------------------------
  const optionsAvailable =
    inst.assetClass === 'equity' || inst.assetClass === 'etf' ||
    inst.assetClass === 'index' || inst.assetClass === 'crypto';

  let chain: OptionChain | null = null;
  let iv: IvStats | null = null;
  let skew: SkewAnalysis | null = null;
  let term: TermStructure | null = null;
  let positioning: Positioning | null = null;

  if (optionsAvailable && snapshot.price > 0) {
    // Anchor implied volatility to the instrument's own realised volatility
    // plus a variance risk premium — implied trades above realised the large
    // majority of the time, and pinning it to the calibration constant would
    // make every IV rank identical.
    const rv = Number.isFinite(snapshot.realisedVolAnnual) && snapshot.realisedVolAnnual > 0
      ? snapshot.realisedVolAnnual
      : inst.typicalVol;
    const baseIv = Math.max(0.05, rv * 1.12 + 0.015);

    chain = generateOptionChain(inst, snapshot.price, baseIv, now);
    const ivHistory = generateIvHistory(inst, baseIv);
    iv = ivStats(baseIv, ivHistory, rv);

    const front = Math.min(...chain.expiries);
    skew = analyseSkew(chain.contracts.filter((c) => c.expiry === front), snapshot.price);
    term = analyseTermStructure(chain);
    positioning = analysePositioning(chain, true);
  }

  // --- signal --------------------------------------------------------------
  const signal = generateSignal({
    symbol: inst.symbol,
    name: inst.name,
    assetClass: inst.assetClass,
    bars,
    provenance,
    horizon: opts.horizon ?? 'swing',
    equity: opts.equity ?? 10_000,
    now: new Date(now),
    fundamentals: fundamentals ?? undefined,
    earnings: earnings ?? undefined,
    insider: insider ?? undefined,
    institutional: institutional ?? undefined,
    social,
    news,
    analysts: analysts ?? undefined,
    iv: iv ?? undefined,
    vix,
    optionsPositioningScore: positioning?.score,
    optionsPositioningNote: positioning?.note,
    optionsAvailable,
  });

  return {
    instrument: inst,
    quote,
    bars,
    barsProvenance: barsResult.provenance,
    barsSource: barsResult.source,
    fallbackReason: barsResult.fallbackReason,
    snapshot,
    signal,
    fundamentals,
    raw,
    earnings,
    insider,
    institutional,
    social,
    news,
    analysts,
    chain,
    iv,
    skew,
    term,
    positioning,
    vix,
    asOf: now,
  };
}
