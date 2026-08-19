/* ===========================================================================
   Fundamental analysis: valuation, quality, health and earnings dynamics.

   Every score here is expressed on a common -1..+1 directional scale so the
   ensemble can weigh it against a technical reading without special-casing.
   ========================================================================= */

import type { Fundamentals, EarningsEvent, IncomeStatement, BalanceSheet, CashFlow } from './types';
import { clamp, scale, squash, mean } from '../util/math';

export * from './types';

/* ---------------------------------------------------------------------------
   VALUATION
   ------------------------------------------------------------------------- */

export interface ValuationMetrics {
  pe: number;
  forwardPe: number;
  peg: number;
  ps: number;
  pb: number;
  pfcf: number;
  evEbitda: number;
  evSales: number;
  fcfYield: number;
  earningsYield: number;
  /** Graham's intrinsic-value proxy: sqrt(22.5 * EPS * BVPS). */
  grahamNumber: number;
  grahamUpside: number;
  /** Simple two-stage DCF on FCF; conservative by design. */
  dcfValue: number;
  dcfUpside: number;
}

export function valuation(f: Fundamentals, price: number): ValuationMetrics {
  const shares = f.sharesOutstanding || 1;
  const bvps = f.balance[0] ? f.balance[0].equity / shares : NaN;
  const eps = f.ttm.eps;
  const revenuePerShare = f.ttm.revenue / shares;
  const fcfPerShare = f.ttm.freeCashFlow / shares;

  const pe = eps > 0 ? price / eps : NaN;
  const forwardPe = f.forward.epsNextYear > 0 ? price / f.forward.epsNextYear : NaN;
  const growth = f.forward.epsGrowth5y;
  const peg = Number.isFinite(pe) && growth > 0 ? pe / (growth * 100) : NaN;

  // Graham number is only meaningful for positive earnings and book value.
  const grahamNumber = eps > 0 && bvps > 0 ? Math.sqrt(22.5 * eps * bvps) : NaN;

  const dcfValue = twoStageDcf(f, shares);

  return {
    pe,
    forwardPe,
    peg,
    ps: revenuePerShare > 0 ? price / revenuePerShare : NaN,
    pb: bvps > 0 ? price / bvps : NaN,
    pfcf: fcfPerShare > 0 ? price / fcfPerShare : NaN,
    evEbitda: f.ttm.ebitda > 0 ? f.enterpriseValue / f.ttm.ebitda : NaN,
    evSales: f.ttm.revenue > 0 ? f.enterpriseValue / f.ttm.revenue : NaN,
    fcfYield: f.marketCap > 0 ? (f.ttm.freeCashFlow / f.marketCap) * 100 : NaN,
    earningsYield: eps > 0 && price > 0 ? (eps / price) * 100 : NaN,
    grahamNumber,
    grahamUpside: Number.isFinite(grahamNumber) && price > 0 ? ((grahamNumber - price) / price) * 100 : NaN,
    dcfValue,
    dcfUpside: Number.isFinite(dcfValue) && price > 0 ? ((dcfValue - price) / price) * 100 : NaN,
  };
}

/** Two-stage discounted cash flow. Stage one grows FCF at the estimated rate
 *  (capped at 25% — no company compounds faster than that for five years in a
 *  base case), stage two applies a terminal growth of 2.5%. Discount rate is
 *  built from a 4.5% risk-free plus a beta-scaled equity risk premium. */
function twoStageDcf(f: Fundamentals, shares: number): number {
  const fcf0 = f.ttm.freeCashFlow;
  if (!(fcf0 > 0) || shares <= 0) return NaN;

  const g1 = clamp(f.forward.epsGrowth5y, -0.1, 0.25);
  const gTerm = 0.025;
  const riskFree = 0.045;
  const erp = 0.05;
  const beta = clamp(f.beta || 1, 0.5, 2.5);
  const wacc = clamp(riskFree + beta * erp, 0.07, 0.16);
  if (wacc <= gTerm) return NaN;

  let pv = 0;
  let fcf = fcf0;
  for (let year = 1; year <= 5; year++) {
    fcf *= 1 + g1;
    pv += fcf / (1 + wacc) ** year;
  }
  const terminal = (fcf * (1 + gTerm)) / (wacc - gTerm);
  pv += terminal / (1 + wacc) ** 5;

  // Net out debt, add back cash, to move from enterprise to equity value.
  const b = f.balance[0];
  const netDebt = b ? b.totalDebt - b.cash : 0;
  return (pv - netDebt) / shares;
}

/** Composite valuation score. Negative = expensive, positive = cheap.
 *  Deliberately sector-agnostic thresholds are avoided in favour of ratio
 *  bands wide enough to be meaningful across most of the market. */
export function valuationScore(v: ValuationMetrics): { score: number; notes: string[] } {
  const parts: { w: number; s: number }[] = [];
  const notes: string[] = [];

  if (Number.isFinite(v.pe) && v.pe > 0) {
    const s = scale(v.pe, 45, 8);       // 45x -> -1 (expensive), 8x -> +1
    parts.push({ w: 0.2, s });
    notes.push(`P/E ${v.pe.toFixed(1)}x`);
  }
  if (Number.isFinite(v.forwardPe) && v.forwardPe > 0) {
    parts.push({ w: 0.15, s: scale(v.forwardPe, 40, 7) });
    notes.push(`Fwd P/E ${v.forwardPe.toFixed(1)}x`);
  }
  if (Number.isFinite(v.peg) && v.peg > 0) {
    // PEG 1.0 is the classic fair-value line.
    parts.push({ w: 0.15, s: scale(v.peg, 3, 0.6) });
    notes.push(`PEG ${v.peg.toFixed(2)}`);
  }
  if (Number.isFinite(v.evEbitda) && v.evEbitda > 0) {
    parts.push({ w: 0.15, s: scale(v.evEbitda, 25, 5) });
    notes.push(`EV/EBITDA ${v.evEbitda.toFixed(1)}x`);
  }
  if (Number.isFinite(v.fcfYield)) {
    parts.push({ w: 0.2, s: scale(v.fcfYield, -2, 10) });
    notes.push(`FCF yield ${v.fcfYield.toFixed(1)}%`);
  }
  if (Number.isFinite(v.ps) && v.ps > 0) {
    parts.push({ w: 0.15, s: scale(v.ps, 15, 1) });
    notes.push(`P/S ${v.ps.toFixed(1)}x`);
  }

  if (!parts.length) return { score: 0, notes: ['Insufficient valuation data'] };
  const wsum = parts.reduce((a, p) => a + p.w, 0);
  const score = parts.reduce((a, p) => a + p.w * p.s, 0) / wsum;
  return { score: clamp(score, -1, 1), notes };
}

/* ---------------------------------------------------------------------------
   QUALITY & PROFITABILITY
   ------------------------------------------------------------------------- */

export interface QualityMetrics {
  grossMargin: number;
  operatingMargin: number;
  netMargin: number;
  roe: number;
  roa: number;
  roic: number;
  /** FCF as a percentage of revenue. */
  fcfMargin: number;
  /** Net income converted to cash — >1 is healthy, <0.8 is a red flag. */
  cashConversion: number;
  assetTurnover: number;
  /** Revenue CAGR over the available quarterly history, annualised. */
  revenueGrowthYoY: number;
  epsGrowthYoY: number;
  /** Standard deviation of quarterly revenue growth — earnings stability. */
  revenueVolatility: number;
}

export function quality(f: Fundamentals): QualityMetrics {
  const i0 = f.income[0];
  const b0 = f.balance[0];
  const rev = f.ttm.revenue;

  const grossMargin = i0 && rev > 0 ? (sumTtm(f.income, 'grossProfit') / rev) * 100 : NaN;
  const operatingMargin = rev > 0 ? (sumTtm(f.income, 'operatingIncome') / rev) * 100 : NaN;
  const netMargin = rev > 0 ? (f.ttm.netIncome / rev) * 100 : NaN;

  const roe = b0 && b0.equity > 0 ? (f.ttm.netIncome / b0.equity) * 100 : NaN;
  const roa = b0 && b0.totalAssets > 0 ? (f.ttm.netIncome / b0.totalAssets) * 100 : NaN;

  // ROIC = NOPAT / invested capital, invested capital = debt + equity - cash.
  const taxRate = 0.21;
  const nopat = sumTtm(f.income, 'operatingIncome') * (1 - taxRate);
  const investedCapital = b0 ? b0.totalDebt + b0.equity - b0.cash : NaN;
  const roic = investedCapital > 0 ? (nopat / investedCapital) * 100 : NaN;

  // Year-over-year growth from the same quarter a year prior (index 4).
  const yoy = (arr: IncomeStatement[], key: 'revenue' | 'eps'): number => {
    if (arr.length < 5) return NaN;
    const now = arr[0][key];
    const then = arr[4][key];
    return then !== 0 ? ((now - then) / Math.abs(then)) * 100 : NaN;
  };

  const qGrowth: number[] = [];
  for (let k = 0; k + 4 < f.income.length; k++) {
    const a = f.income[k].revenue;
    const b = f.income[k + 4].revenue;
    if (b !== 0) qGrowth.push(((a - b) / Math.abs(b)) * 100);
  }

  return {
    grossMargin,
    operatingMargin,
    netMargin,
    roe,
    roa,
    roic,
    fcfMargin: rev > 0 ? (f.ttm.freeCashFlow / rev) * 100 : NaN,
    cashConversion: f.ttm.netIncome !== 0 ? f.ttm.operatingCashFlow / f.ttm.netIncome : NaN,
    assetTurnover: b0 && b0.totalAssets > 0 ? rev / b0.totalAssets : NaN,
    revenueGrowthYoY: yoy(f.income, 'revenue'),
    epsGrowthYoY: yoy(f.income, 'eps'),
    revenueVolatility: qGrowth.length >= 3 ? Math.sqrt(mean(qGrowth.map((g) => (g - mean(qGrowth)) ** 2))) : NaN,
  };
}

function sumTtm(arr: IncomeStatement[], key: keyof IncomeStatement): number {
  const slice = arr.slice(0, 4);
  return slice.reduce((a, x) => a + (typeof x[key] === 'number' ? (x[key] as number) : 0), 0);
}

export function qualityScore(q: QualityMetrics): { score: number; notes: string[] } {
  const parts: { w: number; s: number }[] = [];
  const notes: string[] = [];

  if (Number.isFinite(q.roic)) {
    // A durable business out-earns its cost of capital; ~10% is the hurdle.
    parts.push({ w: 0.25, s: scale(q.roic, -5, 30) });
    notes.push(`ROIC ${q.roic.toFixed(1)}%`);
  }
  if (Number.isFinite(q.roe)) {
    parts.push({ w: 0.15, s: scale(q.roe, -10, 35) });
    notes.push(`ROE ${q.roe.toFixed(1)}%`);
  }
  if (Number.isFinite(q.operatingMargin)) {
    parts.push({ w: 0.2, s: scale(q.operatingMargin, -10, 30) });
    notes.push(`Op margin ${q.operatingMargin.toFixed(1)}%`);
  }
  if (Number.isFinite(q.fcfMargin)) {
    parts.push({ w: 0.2, s: scale(q.fcfMargin, -10, 25) });
    notes.push(`FCF margin ${q.fcfMargin.toFixed(1)}%`);
  }
  if (Number.isFinite(q.cashConversion)) {
    parts.push({ w: 0.2, s: scale(q.cashConversion, 0.3, 1.4) });
    notes.push(`Cash conversion ${q.cashConversion.toFixed(2)}x`);
  }

  if (!parts.length) return { score: 0, notes: ['Insufficient quality data'] };
  const wsum = parts.reduce((a, p) => a + p.w, 0);
  return { score: clamp(parts.reduce((a, p) => a + p.w * p.s, 0) / wsum, -1, 1), notes };
}

/* ---------------------------------------------------------------------------
   FINANCIAL HEALTH SCORES
   ------------------------------------------------------------------------- */

export interface PiotroskiResult {
  score: number;          // 0-9
  signals: { name: string; pass: boolean; detail: string }[];
  interpretation: string;
}

/** Piotroski F-Score: nine binary tests of profitability, leverage and
 *  operating efficiency. 8-9 is strong, 0-2 is distressed. */
export function piotroskiFScore(f: Fundamentals): PiotroskiResult {
  const signals: { name: string; pass: boolean; detail: string }[] = [];
  const i = f.income;
  const b = f.balance;
  const cf = f.cashflow;

  const push = (name: string, pass: boolean, detail: string): void => {
    signals.push({ name, pass, detail });
  };

  // --- profitability (4 tests) ------------------------------------------
  const roaNow = b[0] && b[0].totalAssets > 0 ? f.ttm.netIncome / b[0].totalAssets : NaN;
  push('Positive ROA', roaNow > 0, `ROA ${(roaNow * 100).toFixed(1)}%`);

  const ocf = f.ttm.operatingCashFlow;
  push('Positive operating cash flow', ocf > 0, `OCF ${(ocf / 1e6).toFixed(0)}M`);

  const roaPrior =
    b[4] && b[4].totalAssets > 0 && i.length >= 8
      ? i.slice(4, 8).reduce((a, x) => a + x.netIncome, 0) / b[4].totalAssets
      : NaN;
  push('ROA improving', Number.isFinite(roaPrior) && roaNow > roaPrior, 'vs prior year');

  push('Cash flow exceeds earnings', ocf > f.ttm.netIncome, 'accruals quality');

  // --- leverage & liquidity (3 tests) ------------------------------------
  const ltdNow = b[0] ? b[0].longTermDebt / Math.max(1, b[0].totalAssets) : NaN;
  const ltdPrior = b[4] ? b[4].longTermDebt / Math.max(1, b[4].totalAssets) : NaN;
  push('Leverage not rising', Number.isFinite(ltdPrior) && ltdNow <= ltdPrior, 'LTD/assets');

  const crNow = b[0] && b[0].currentLiabilities > 0 ? b[0].currentAssets / b[0].currentLiabilities : NaN;
  const crPrior = b[4] && b[4].currentLiabilities > 0 ? b[4].currentAssets / b[4].currentLiabilities : NaN;
  push('Current ratio improving', Number.isFinite(crPrior) && crNow > crPrior, `CR ${crNow?.toFixed(2)}`);

  const issuance = cf.slice(0, 4).reduce((a, x) => a + x.shareIssuance, 0);
  push('No share dilution', issuance <= 0, 'net issuance');

  // --- operating efficiency (2 tests) ------------------------------------
  const gmNow = f.ttm.revenue > 0 ? sumTtm(i, 'grossProfit') / f.ttm.revenue : NaN;
  const revPrior = i.slice(4, 8).reduce((a, x) => a + x.revenue, 0);
  const gmPrior = revPrior > 0 ? i.slice(4, 8).reduce((a, x) => a + x.grossProfit, 0) / revPrior : NaN;
  push('Gross margin improving', Number.isFinite(gmPrior) && gmNow > gmPrior, `GM ${(gmNow * 100).toFixed(1)}%`);

  const atNow = b[0] && b[0].totalAssets > 0 ? f.ttm.revenue / b[0].totalAssets : NaN;
  const atPrior = b[4] && b[4].totalAssets > 0 ? revPrior / b[4].totalAssets : NaN;
  push('Asset turnover improving', Number.isFinite(atPrior) && atNow > atPrior, 'efficiency');

  const score = signals.filter((s) => s.pass).length;
  const interpretation =
    score >= 8 ? 'Very strong financial position'
    : score >= 6 ? 'Healthy fundamentals'
    : score >= 4 ? 'Mixed financial signals'
    : score >= 2 ? 'Weak fundamentals'
    : 'Financially distressed';

  return { score, signals, interpretation };
}

export interface AltmanResult {
  z: number;
  zone: 'safe' | 'grey' | 'distress';
  components: { name: string; value: number; weight: number }[];
  interpretation: string;
}

/** Altman Z-Score (original public-manufacturer coefficients).
 *  >2.99 safe, 1.81-2.99 grey, <1.81 distress. */
export function altmanZScore(f: Fundamentals): AltmanResult {
  const b = f.balance[0];
  if (!b || b.totalAssets <= 0) {
    return { z: NaN, zone: 'grey', components: [], interpretation: 'Insufficient balance-sheet data' };
  }

  const ta = b.totalAssets;
  const workingCapital = b.currentAssets - b.currentLiabilities;
  const ebit = sumTtm(f.income, 'operatingIncome');

  const x1 = workingCapital / ta;
  const x2 = b.retainedEarnings / ta;
  const x3 = ebit / ta;
  const x4 = b.totalLiabilities > 0 ? f.marketCap / b.totalLiabilities : 0;
  const x5 = f.ttm.revenue / ta;

  const z = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;
  const zone = z > 2.99 ? 'safe' : z >= 1.81 ? 'grey' : 'distress';

  return {
    z,
    zone,
    components: [
      { name: 'Working capital / assets', value: x1, weight: 1.2 },
      { name: 'Retained earnings / assets', value: x2, weight: 1.4 },
      { name: 'EBIT / assets', value: x3, weight: 3.3 },
      { name: 'Market cap / liabilities', value: x4, weight: 0.6 },
      { name: 'Revenue / assets', value: x5, weight: 1.0 },
    ],
    interpretation:
      zone === 'safe' ? 'Low bankruptcy risk'
      : zone === 'grey' ? 'Grey zone — monitor leverage'
      : 'Elevated financial distress risk',
  };
}

export interface BeneishResult {
  m: number;
  flag: boolean;
  interpretation: string;
}

/** Beneish M-Score — detects earnings-manipulation likelihood. Above -1.78
 *  is the conventional flag. Requires year-ago comparatives; returns NaN if
 *  the history is too short rather than guessing. */
export function beneishMScore(f: Fundamentals): BeneishResult {
  const i = f.income;
  const b = f.balance;
  const cf = f.cashflow;
  if (i.length < 8 || b.length < 5 || cf.length < 8) {
    return { m: NaN, flag: false, interpretation: 'Insufficient history for M-Score' };
  }

  const revNow = i.slice(0, 4).reduce((a, x) => a + x.revenue, 0);
  const revPrior = i.slice(4, 8).reduce((a, x) => a + x.revenue, 0);
  const b0 = b[0];
  const b1 = b[4];
  if (revPrior <= 0 || b1.totalAssets <= 0) {
    return { m: NaN, flag: false, interpretation: 'Insufficient history for M-Score' };
  }

  const dsri = (b0.receivables / revNow) / (b1.receivables / revPrior);
  const gmNow = i.slice(0, 4).reduce((a, x) => a + x.grossProfit, 0) / revNow;
  const gmPrior = i.slice(4, 8).reduce((a, x) => a + x.grossProfit, 0) / revPrior;
  const gmi = gmPrior / (gmNow || 1e-9);
  const aqiNow = 1 - (b0.currentAssets + 0) / b0.totalAssets;
  const aqiPrior = 1 - (b1.currentAssets + 0) / b1.totalAssets;
  const aqi = aqiPrior !== 0 ? aqiNow / aqiPrior : 1;
  const sgi = revNow / revPrior;
  const depi = 1;  // depreciation detail not modelled; neutral contribution
  const sgai = 1;
  const lvgi =
    b1.totalLiabilities / b1.totalAssets !== 0
      ? (b0.totalLiabilities / b0.totalAssets) / (b1.totalLiabilities / b1.totalAssets)
      : 1;
  const tata =
    b0.totalAssets > 0
      ? (i.slice(0, 4).reduce((a, x) => a + x.netIncome, 0) -
         cf.slice(0, 4).reduce((a, x) => a + x.operatingCashFlow, 0)) / b0.totalAssets
      : 0;

  const m =
    -4.84 + 0.92 * dsri + 0.528 * gmi + 0.404 * aqi + 0.892 * sgi +
    0.115 * depi - 0.172 * sgai + 4.679 * tata - 0.327 * lvgi;

  const flag = m > -1.78;
  return {
    m,
    flag,
    interpretation: flag
      ? 'Accounting quality warrants scrutiny — accruals or receivables growing faster than sales'
      : 'No accounting-manipulation flag',
  };
}

/* ---------------------------------------------------------------------------
   EARNINGS DYNAMICS
   ------------------------------------------------------------------------- */

export interface EarningsAnalysis {
  next: EarningsEvent | null;
  daysToNext: number | null;
  history: EarningsEvent[];
  /** Average surprise over the last four reports, in percent. */
  avgSurprise: number;
  /** How many of the last four beat. */
  beatCount: number;
  /** Average absolute price move on the day after the report. */
  avgReaction: number;
  /** Standard deviation of reactions — the implied event risk. */
  reactionVol: number;
  /** Post-earnings announcement drift: sign persistence after surprises. */
  driftScore: number;
  /** True when a report lands inside the intended holding window. */
  eventRisk: boolean;
  note: string;
}

export function analyseEarnings(
  history: EarningsEvent[],
  next: EarningsEvent | null,
  now = Date.now(),
  horizonDays = 10,
): EarningsAnalysis {
  const reported = history.filter((e) => e.epsActual != null && e.surprisePct != null);
  const recent = reported.slice(0, 4);

  const surprises = recent.map((e) => e.surprisePct as number);
  const reactions = reported
    .filter((e) => e.reactionPct != null)
    .slice(0, 8)
    .map((e) => e.reactionPct as number);

  const avgSurprise = surprises.length ? mean(surprises) : NaN;
  const beatCount = surprises.filter((s) => s > 0).length;
  const avgReaction = reactions.length ? mean(reactions.map(Math.abs)) : NaN;
  const reactionVol =
    reactions.length >= 3
      ? Math.sqrt(mean(reactions.map((r) => (r - mean(reactions)) ** 2)))
      : NaN;

  // PEAD: do positive surprises tend to be followed by positive reactions?
  let driftScore = 0;
  const paired = reported.filter((e) => e.reactionPct != null && e.surprisePct != null).slice(0, 8);
  if (paired.length >= 3) {
    let agree = 0;
    for (const e of paired) {
      if (Math.sign(e.surprisePct as number) === Math.sign(e.reactionPct as number)) agree++;
    }
    driftScore = (agree / paired.length) * 2 - 1;
  }

  const daysToNext = next ? Math.ceil((next.date - now) / 86400000) : null;
  const eventRisk = daysToNext != null && daysToNext >= 0 && daysToNext <= horizonDays;

  const note = !next
    ? 'No scheduled report in the data window.'
    : eventRisk
      ? `Earnings in ${daysToNext}d — inside the intended holding window. Size down or trade the event deliberately.`
      : `Next report in ${daysToNext}d — outside the holding window.`;

  return {
    next,
    daysToNext,
    history: reported.slice(0, 8),
    avgSurprise,
    beatCount,
    avgReaction,
    reactionVol,
    driftScore,
    eventRisk,
    note,
  };
}

/** Directional score from earnings dynamics. Beat streaks with positive drift
 *  are bullish; an imminent report cuts confidence regardless of direction. */
export function earningsScore(a: EarningsAnalysis): { score: number; confidence: number; note: string } {
  if (!a.history.length) {
    return { score: 0, confidence: 0.1, note: 'No earnings history available' };
  }

  const surpriseComponent = Number.isFinite(a.avgSurprise) ? squash(a.avgSurprise / 12) : 0;
  const beatComponent = (a.beatCount / 4) * 2 - 1;
  const driftComponent = a.driftScore;

  const score = clamp(0.4 * surpriseComponent + 0.3 * beatComponent + 0.3 * driftComponent, -1, 1);

  // An imminent report is a coin flip in the short run: keep the direction but
  // halve the confidence so the ensemble does not size into a binary event.
  const confidence = a.eventRisk ? 0.35 : 0.7;

  const note = a.eventRisk
    ? `${a.beatCount}/4 beats, avg surprise ${a.avgSurprise?.toFixed(1)}% — but a report lands in ${a.daysToNext}d`
    : `${a.beatCount}/4 beats, avg surprise ${a.avgSurprise?.toFixed(1)}%, drift ${a.driftScore > 0 ? 'confirms' : 'fades'}`;

  return { score, confidence, note };
}

/* ---------------------------------------------------------------------------
   COMPOSITE
   ------------------------------------------------------------------------- */

export interface FundamentalAssessment {
  valuation: ValuationMetrics;
  valuationScore: number;
  valuationNotes: string[];
  quality: QualityMetrics;
  qualityScore: number;
  qualityNotes: string[];
  piotroski: PiotroskiResult;
  altman: AltmanResult;
  beneish: BeneishResult;
  /** Net fundamental score in [-1, 1]. */
  composite: number;
  /** 0-100 grade for display. */
  grade: number;
  letterGrade: string;
  redFlags: string[];
}

export function assessFundamentals(f: Fundamentals, price: number): FundamentalAssessment {
  const v = valuation(f, price);
  const vs = valuationScore(v);
  const q = quality(f);
  const qs = qualityScore(q);
  const pio = piotroskiFScore(f);
  const alt = altmanZScore(f);
  const ben = beneishMScore(f);

  // Piotroski and Altman map onto the same -1..1 axis.
  const pioScore = scale(pio.score, 1, 8);
  const altScore = Number.isFinite(alt.z) ? scale(alt.z, 1.0, 4.0) : 0;

  const composite = clamp(
    0.3 * vs.score + 0.3 * qs.score + 0.25 * pioScore + 0.15 * altScore,
    -1, 1,
  );

  const redFlags: string[] = [];
  if (ben.flag) redFlags.push(ben.interpretation);
  if (alt.zone === 'distress') redFlags.push('Altman Z-Score in the distress zone');
  if (pio.score <= 2) redFlags.push('Piotroski F-Score of 2 or below');
  if (Number.isFinite(q.cashConversion) && q.cashConversion < 0.6) {
    redFlags.push('Earnings not converting to cash (conversion below 0.6x)');
  }
  if (Number.isFinite(q.revenueGrowthYoY) && q.revenueGrowthYoY < -15) {
    redFlags.push(`Revenue contracting ${q.revenueGrowthYoY.toFixed(0)}% year over year`);
  }
  if (f.shortPercentFloat > 20) {
    redFlags.push(`Short interest ${f.shortPercentFloat.toFixed(0)}% of float — crowded short, squeeze risk both ways`);
  }

  const grade = Math.round((composite + 1) * 50);
  const letterGrade =
    grade >= 85 ? 'A' : grade >= 75 ? 'B+' : grade >= 65 ? 'B' :
    grade >= 55 ? 'C+' : grade >= 45 ? 'C' : grade >= 35 ? 'D' : 'F';

  return {
    valuation: v,
    valuationScore: vs.score,
    valuationNotes: vs.notes,
    quality: q,
    qualityScore: qs.score,
    qualityNotes: qs.notes,
    piotroski: pio,
    altman: alt,
    beneish: ben,
    composite,
    grade,
    letterGrade,
    redFlags,
  };
}
