/* ===========================================================================
   Fundamental data model.
   ========================================================================= */

import type { Provenance } from '../types';

export interface IncomeStatement {
  fiscalPeriod: string;
  revenue: number;
  grossProfit: number;
  operatingIncome: number;
  netIncome: number;
  ebitda: number;
  eps: number;
  epsDiluted: number;
  interestExpense: number;
  taxExpense: number;
  sharesOutstanding: number;
}

export interface BalanceSheet {
  fiscalPeriod: string;
  totalAssets: number;
  currentAssets: number;
  cash: number;
  inventory: number;
  receivables: number;
  totalLiabilities: number;
  currentLiabilities: number;
  longTermDebt: number;
  totalDebt: number;
  equity: number;
  retainedEarnings: number;
  goodwill: number;
}

export interface CashFlow {
  fiscalPeriod: string;
  operatingCashFlow: number;
  capex: number;
  freeCashFlow: number;
  dividendsPaid: number;
  buybacks: number;
  shareIssuance: number;
}

export interface Fundamentals {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
  currency: string;
  marketCap: number;
  enterpriseValue: number;
  sharesOutstanding: number;
  floatShares: number;
  /** Short interest as a percentage of float. */
  shortPercentFloat: number;
  shortRatio: number;
  beta: number;
  dividendYield: number;
  payoutRatio: number;
  employees: number;

  income: IncomeStatement[];   // most recent first, quarterly
  balance: BalanceSheet[];
  cashflow: CashFlow[];

  /** Trailing-twelve-month aggregates. */
  ttm: {
    revenue: number;
    netIncome: number;
    eps: number;
    ebitda: number;
    freeCashFlow: number;
    operatingCashFlow: number;
  };

  /** Forward estimates, where available. */
  forward: {
    epsNextYear: number;
    revenueGrowthNextYear: number;
    epsGrowthNextYear: number;
    /** Long-term (5y) growth estimate. */
    epsGrowth5y: number;
  };

  provenance: Provenance;
  source: string;
  asOf: number;
}

export interface EarningsEvent {
  date: number;
  fiscalPeriod: string;
  epsEstimate: number;
  epsActual: number | null;
  revenueEstimate: number;
  revenueActual: number | null;
  /** Percentage surprise vs estimate. */
  surprisePct: number | null;
  /** Price reaction on the session after the report, in percent. */
  reactionPct: number | null;
  time: 'bmo' | 'amc' | 'unknown';
  confirmed: boolean;
}
