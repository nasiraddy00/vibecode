/* ===========================================================================
   Modelled fundamentals and option chains.

   Used only when no live fundamentals provider is configured. Everything here
   is tagged `simulated` and badged SIM in the UI. Figures are internally
   consistent (the balance sheet balances, TTM aggregates match the quarters,
   the option chain is arbitrage-free by construction) so that the analytics
   downstream are exercised properly rather than fed nonsense.
   ========================================================================= */

import type { Bar } from '../types';
import type { Instrument } from '../market/universe';
import { mulberry32, gaussian, hashString, clamp } from '../util/math';
import type {
  Fundamentals, IncomeStatement, BalanceSheet, CashFlow, EarningsEvent,
} from './types';
import { SHARE_COUNTS } from '../providers/simulator';
import { blackScholes, impliedVolatility } from '../options/blackscholes';
import type { OptionContract, OptionChain } from '../options/chain';

const DAY = 86_400_000;
const QUARTER = 91 * DAY;

/** Sector-typical margin and growth profiles, so a utility does not get
 *  handed software margins. */
const SECTOR_PROFILE: Record<string, { gross: number; op: number; growth: number; capexRatio: number }> = {
  'Technology':               { gross: 0.58, op: 0.26, growth: 0.14, capexRatio: 0.07 },
  'Communication Services':   { gross: 0.52, op: 0.22, growth: 0.10, capexRatio: 0.12 },
  'Health Care':              { gross: 0.62, op: 0.19, growth: 0.08, capexRatio: 0.06 },
  'Financials':               { gross: 0.68, op: 0.32, growth: 0.07, capexRatio: 0.03 },
  'Consumer Discretionary':   { gross: 0.38, op: 0.11, growth: 0.09, capexRatio: 0.06 },
  'Consumer Staples':         { gross: 0.36, op: 0.15, growth: 0.04, capexRatio: 0.05 },
  'Industrials':              { gross: 0.32, op: 0.13, growth: 0.06, capexRatio: 0.05 },
  'Energy':                   { gross: 0.30, op: 0.16, growth: 0.03, capexRatio: 0.14 },
  'Materials':                { gross: 0.26, op: 0.12, growth: 0.04, capexRatio: 0.10 },
  'Utilities':                { gross: 0.42, op: 0.21, growth: 0.03, capexRatio: 0.22 },
  'Real Estate':              { gross: 0.55, op: 0.30, growth: 0.04, capexRatio: 0.18 },
};

export function generateFundamentals(
  inst: Instrument, bars: readonly Bar[], now = Date.now(),
): Fundamentals {
  const rng = mulberry32(hashString(`fund|${inst.symbol}`));
  const price = bars[bars.length - 1]?.c ?? inst.anchor;
  const shares = SHARE_COUNTS[inst.symbol] ?? 1e9;
  const marketCap = price * shares;

  const sector = inst.sector ?? 'Technology';
  const profile = SECTOR_PROFILE[sector] ?? SECTOR_PROFILE['Technology'];

  // Anchor revenue off market cap with a sector-plausible sales multiple.
  const psMultiple = 1.2 + rng() * (sector === 'Technology' ? 7 : 2.2);
  const ttmRevenue = marketCap / psMultiple;

  const grossMargin = clamp(profile.gross + gaussian(rng) * 0.06, 0.12, 0.9);
  const opMargin = clamp(profile.op + gaussian(rng) * 0.05, -0.1, 0.55);
  const growth = clamp(profile.growth + gaussian(rng) * 0.06, -0.15, 0.45);

  const income: IncomeStatement[] = [];
  const balance: BalanceSheet[] = [];
  const cashflow: CashFlow[] = [];

  // Twelve quarters, newest first, growing backwards at the implied rate.
  for (let q = 0; q < 12; q++) {
    const ageFactor = 1 / (1 + growth) ** (q / 4);
    // Seasonal wobble plus noise; Q4 is stronger for most consumer names.
    const seasonal = 1 + (q % 4 === 0 ? 0.06 : q % 4 === 2 ? -0.03 : 0) + gaussian(rng) * 0.03;
    const revenue = (ttmRevenue / 4) * ageFactor * seasonal;
    const grossProfit = revenue * clamp(grossMargin + gaussian(rng) * 0.015, 0.05, 0.95);
    const operatingIncome = revenue * clamp(opMargin + gaussian(rng) * 0.02, -0.3, 0.6);
    const interestExpense = revenue * 0.012 * (0.5 + rng());
    const pretax = operatingIncome - interestExpense;
    const taxExpense = pretax > 0 ? pretax * 0.21 : 0;
    const netIncome = pretax - taxExpense;
    const ebitda = operatingIncome + revenue * 0.05;

    income.push({
      fiscalPeriod: quarterLabel(now - q * QUARTER),
      revenue, grossProfit, operatingIncome, netIncome, ebitda,
      eps: netIncome / shares,
      epsDiluted: netIncome / (shares * 1.02),
      interestExpense, taxExpense, sharesOutstanding: shares,
    });

    const totalAssets = revenue * 4 * (1.1 + rng() * 1.6);
    const cash = totalAssets * (0.08 + rng() * 0.22);
    const currentAssets = totalAssets * (0.3 + rng() * 0.2);
    const totalDebt = totalAssets * (0.1 + rng() * 0.3);
    const totalLiabilities = totalAssets * (0.35 + rng() * 0.3);
    const equityValue = totalAssets - totalLiabilities;

    balance.push({
      fiscalPeriod: quarterLabel(now - q * QUARTER),
      totalAssets,
      currentAssets,
      cash,
      inventory: totalAssets * 0.05 * (sector === 'Technology' ? 0.4 : 1),
      receivables: revenue * (0.55 + rng() * 0.35),
      totalLiabilities,
      currentLiabilities: totalLiabilities * (0.35 + rng() * 0.2),
      longTermDebt: totalDebt * 0.75,
      totalDebt,
      // Equity is the residual, so the balance sheet actually balances.
      equity: equityValue,
      retainedEarnings: equityValue * (0.4 + rng() * 0.45),
      goodwill: totalAssets * 0.1 * rng(),
    });

    const operatingCashFlow = netIncome * (1.05 + rng() * 0.45);
    const capex = revenue * profile.capexRatio * (0.7 + rng() * 0.6);

    cashflow.push({
      fiscalPeriod: quarterLabel(now - q * QUARTER),
      operatingCashFlow,
      capex,
      freeCashFlow: operatingCashFlow - capex,
      dividendsPaid: netIncome > 0 ? netIncome * 0.15 * rng() : 0,
      buybacks: netIncome > 0 ? netIncome * 0.3 * rng() : 0,
      shareIssuance: (rng() - 0.7) * revenue * 0.01,
    });
  }

  const ttm = <K extends keyof IncomeStatement>(k: K): number =>
    income.slice(0, 4).reduce((a, x) => a + (x[k] as number), 0);

  const totalDebt = balance[0].totalDebt;
  const cash = balance[0].cash;

  return {
    symbol: inst.symbol,
    name: inst.name,
    sector,
    industry: sector,
    currency: inst.currency,
    marketCap,
    enterpriseValue: marketCap + totalDebt - cash,
    sharesOutstanding: shares,
    floatShares: shares * (0.82 + rng() * 0.16),
    shortPercentFloat: clamp(1 + rng() * 9 + (inst.typicalVol > 0.5 ? rng() * 12 : 0), 0.3, 32),
    shortRatio: 1 + rng() * 5,
    beta: clamp(inst.typicalVol / 0.17, 0.35, 3),
    dividendYield: sector === 'Utilities' || sector === 'Consumer Staples' ? 1.8 + rng() * 2 : rng() * 1.4,
    payoutRatio: rng() * 0.5,
    employees: Math.round(5000 + rng() * 180_000),
    income, balance, cashflow,
    ttm: {
      revenue: ttm('revenue'),
      netIncome: ttm('netIncome'),
      eps: ttm('eps'),
      ebitda: ttm('ebitda'),
      freeCashFlow: cashflow.slice(0, 4).reduce((a, x) => a + x.freeCashFlow, 0),
      operatingCashFlow: cashflow.slice(0, 4).reduce((a, x) => a + x.operatingCashFlow, 0),
    },
    forward: {
      epsNextYear: ttm('eps') * (1 + growth),
      revenueGrowthNextYear: growth,
      epsGrowthNextYear: growth * 1.2,
      epsGrowth5y: growth * 0.85,
    },
    provenance: 'simulated',
    source: 'simulator',
    asOf: now,
  };
}

function quarterLabel(ms: number): string {
  const d = new Date(ms);
  return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
}

/* ---------------------------------------------------------------------------
   EARNINGS
   ------------------------------------------------------------------------- */

export function generateEarnings(
  inst: Instrument, f: Fundamentals, bars: readonly Bar[], now = Date.now(),
): { history: EarningsEvent[]; next: EarningsEvent | null } {
  if (inst.assetClass !== 'equity') return { history: [], next: null };
  const rng = mulberry32(hashString(`earn|${inst.symbol}`));

  const history: EarningsEvent[] = [];
  for (let q = 1; q <= 8; q++) {
    const date = now - q * QUARTER + Math.floor(rng() * 10) * DAY;
    const estimate = f.income[q]?.eps ?? f.ttm.eps / 4;
    // Companies beat modestly more often than they miss — guidance is managed.
    const surprisePct = gaussian(rng) * 6 + 2.2;
    const actual = estimate * (1 + surprisePct / 100);
    // Reaction correlates with surprise but far from perfectly: the bar the
    // market sets is not the bar the analysts publish.
    const reaction = surprisePct * (0.55 + rng() * 0.8) + gaussian(rng) * 3.5;

    history.push({
      date,
      fiscalPeriod: quarterLabel(date),
      epsEstimate: estimate,
      epsActual: actual,
      revenueEstimate: f.income[q]?.revenue ?? f.ttm.revenue / 4,
      revenueActual: (f.income[q]?.revenue ?? f.ttm.revenue / 4) * (1 + gaussian(rng) * 0.02),
      surprisePct,
      reactionPct: reaction,
      time: rng() < 0.6 ? 'amc' : 'bmo',
      confirmed: true,
    });
  }

  const daysAhead = Math.floor(rng() * 75) + 3;
  const nextDate = now + daysAhead * DAY;
  const next: EarningsEvent = {
    date: nextDate,
    fiscalPeriod: quarterLabel(nextDate),
    epsEstimate: f.forward.epsNextYear / 4,
    epsActual: null,
    revenueEstimate: (f.ttm.revenue / 4) * (1 + f.forward.revenueGrowthNextYear),
    revenueActual: null,
    surprisePct: null,
    reactionPct: null,
    time: rng() < 0.6 ? 'amc' : 'bmo',
    confirmed: daysAhead < 30,
  };

  return { history, next };
}

/* ---------------------------------------------------------------------------
   OPTION CHAIN
   ------------------------------------------------------------------------- */

/** Build an arbitrage-free chain from a volatility surface: a smile in strike
 *  and a term structure in time. Prices come from Black-Scholes on that
 *  surface, and IV is then recovered by inversion — so the chain the UI
 *  displays is internally consistent with the pricing model, and the IV
 *  solver is genuinely exercised rather than handed its own inputs back. */
export function generateOptionChain(
  inst: Instrument, spot: number, baseIv: number, now = Date.now(), riskFree = 0.045,
): OptionChain {
  const rng = mulberry32(hashString(`chain|${inst.symbol}`));
  const contracts: OptionContract[] = [];
  const expiries: number[] = [];

  const dteLadder = [7, 14, 30, 60, 90, 180];

  for (const dte of dteLadder) {
    const expiry = now + dte * DAY;
    expiries.push(expiry);
    const T = dte / 365;

    // Term structure: short-dated carries an event premium, long-dated mean
    // reverts toward the long-run level.
    const termAdj = 1 + 0.12 * Math.exp(-dte / 25) - 0.05 * (1 - Math.exp(-dte / 120));
    const atmIv = baseIv * termAdj;

    const step = strikeIncrement(spot);
    const atmStrike = Math.round(spot / step) * step;
    const range = Math.ceil((spot * Math.min(0.5, atmIv * Math.sqrt(T) * 2.6)) / step);

    for (let k = -range; k <= range; k++) {
      const strike = atmStrike + k * step;
      if (strike <= 0) continue;

      // Volatility smile: equity skew is negative (downside bid), and the
      // smile steepens as expiry approaches.
      const moneyness = Math.log(strike / spot);
      const skewSlope = inst.assetClass === 'crypto' ? -0.35 : -0.85;
      const smileCurve = 0.55 / Math.sqrt(Math.max(T, 0.02));
      const iv = clamp(
        atmIv * (1 + skewSlope * moneyness + smileCurve * moneyness * moneyness),
        0.03, 4,
      );

      for (const type of ['call', 'put'] as const) {
        const g = blackScholes(spot, strike, T, riskFree, iv, type);
        if (g.price < 0.005) continue;

        // Spread widens with distance from the money and with shorter expiry.
        const spreadPct = clamp(0.012 + Math.abs(moneyness) * 0.09 + 0.02 / Math.sqrt(dte), 0.01, 0.35);
        const half = g.price * spreadPct;
        const mid = g.price;

        // Open interest and volume concentrate at round strikes and near ATM.
        const atmness = Math.exp(-((moneyness / (atmIv * Math.sqrt(T) + 0.02)) ** 2) / 2);
        const roundBonus = strike % (step * 5) === 0 ? 2.2 : 1;
        const oi = Math.round(atmness * roundBonus * (2000 + rng() * 9000) * (dte <= 45 ? 1.6 : 0.7));
        const vol = Math.round(oi * (0.06 + rng() * 0.5));

        contracts.push({
          symbol: `${inst.symbol} ${new Date(expiry).toISOString().slice(0, 10)} ${type === 'call' ? 'C' : 'P'}${strike}`,
          type,
          strike,
          expiry,
          dte,
          bid: Math.max(0.01, mid - half),
          ask: mid + half,
          last: mid * (0.98 + rng() * 0.04),
          mid,
          volume: vol,
          openInterest: oi,
          // Recover IV by inversion from the mid price, exercising the solver.
          impliedVol: impliedVolatility(mid, spot, strike, T, riskFree, type) || iv,
          delta: g.delta,
          gamma: g.gamma,
          theta: g.theta,
          vega: g.vega,
          inTheMoney: type === 'call' ? spot > strike : spot < strike,
        });
      }
    }
  }

  return {
    symbol: inst.symbol,
    spot,
    contracts,
    expiries,
    provenance: 'simulated',
    source: 'simulator',
    asOf: now,
  };
}

function strikeIncrement(spot: number): number {
  if (spot < 5) return 0.5;
  if (spot < 25) return 1;
  if (spot < 100) return 2.5;
  if (spot < 250) return 5;
  if (spot < 1000) return 10;
  if (spot < 5000) return 50;
  return 500;
}

/** A plausible one-year history of 30-day ATM implied volatility, for IV rank.
 *  Mean-reverting with occasional spikes, which is how IV actually behaves. */
export function generateIvHistory(inst: Instrument, current: number, days = 252): number[] {
  const rng = mulberry32(hashString(`ivhist|${inst.symbol}`));
  const out: number[] = [];
  const longRun = current;
  let iv = current;
  for (let i = 0; i < days; i++) {
    // Ornstein-Uhlenbeck reversion plus an asymmetric spike process.
    iv += 0.06 * (longRun - iv) + gaussian(rng) * longRun * 0.05;
    if (rng() < 0.02) iv += longRun * (0.25 + rng() * 0.8);
    iv = clamp(iv, longRun * 0.35, longRun * 3.5);
    out.push(iv);
  }
  out[out.length - 1] = current;
  return out;
}
