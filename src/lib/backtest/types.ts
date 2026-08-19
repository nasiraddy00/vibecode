/* ===========================================================================
   Backtest data model.
   ========================================================================= */

import type { Bar, Direction, Horizon, MarketRegime } from '../types';

export interface BacktestConfig {
  symbol: string;
  /** Starting capital. */
  initialCapital: number;
  /** Commission per trade as a fraction of notional (0.001 = 10bp). */
  commission: number;
  /** Slippage as a fraction of price, applied against the trade on entry
   *  and exit. */
  slippage: number;
  /** Annualised funding/borrow cost charged on leveraged or short exposure. */
  fundingRate: number;
  /** Bars of history required before the first trade may be taken. */
  warmupBars: number;
  /** Maximum fraction of equity to risk per trade. */
  maxRiskFraction: number;
  /** Conviction below which no position is opened. */
  convictionThreshold: number;
  /** Whether short positions are permitted. */
  allowShorts: boolean;
  horizon: Horizon;
  /** Hard cap on bars held before a forced exit. */
  maxHoldBars: number;
  /** Move the stop to breakeven once this many R of profit is reached. */
  breakevenAtR: number;
  /** Trail the stop by this ATR multiple once in profit. 0 disables. */
  trailAtrMultiple: number;
  /** Exit on decay when conviction falls below threshold * this ratio. */
  decayExitRatio: number;
  /** Consecutive decayed evaluations required before a decay exit fires.
   *  1 reproduces the naive "exit on any weak reading" behaviour. */
  decayExitBars: number;
  /** Risk-free rate for Sharpe. */
  riskFreeRate: number;
  /** Bars per year, for annualisation. */
  periodsPerYear: number;
}

export const DEFAULT_CONFIG: BacktestConfig = {
  symbol: '',
  initialCapital: 10_000,
  commission: 0.001,
  slippage: 0.0005,
  fundingRate: 0.05,
  warmupBars: 250,
  maxRiskFraction: 0.02,
  convictionThreshold: 32,
  allowShorts: true,
  horizon: 'swing',
  maxHoldBars: 30,
  breakevenAtR: 1.0,
  trailAtrMultiple: 2.5,
  decayExitRatio: 0.6,
  decayExitBars: 3,
  riskFreeRate: 0.045,
  periodsPerYear: 252,
};

export type ExitReason =
  | 'stop'
  | 'target'
  | 'trailing_stop'
  | 'signal_flip'
  | 'signal_decay'
  | 'max_hold'
  | 'end_of_data';

export interface Trade {
  id: number;
  direction: Direction;
  entryBar: number;
  entryTime: number;
  entryPrice: number;
  /** Price actually paid after slippage. */
  entryFill: number;
  exitBar: number;
  exitTime: number;
  exitPrice: number;
  exitFill: number;
  size: number;
  notional: number;
  stop: number;
  target: number;
  exitReason: ExitReason;
  grossPnl: number;
  commissionPaid: number;
  fundingPaid: number;
  netPnl: number;
  pnlPct: number;
  /** Profit in units of initial risk. The only P&L unit that compares
   *  meaningfully across trades of different size. */
  rMultiple: number;
  barsHeld: number;
  /** Equity immediately after this trade closed. */
  equityAfter: number;
  convictionAtEntry: number;
  scoreAtEntry: number;
  regimeAtEntry: MarketRegime;
  /** Worst unrealised loss during the hold, in R. */
  maxAdverseR: number;
  /** Best unrealised gain during the hold, in R. */
  maxFavourableR: number;
}

export interface EquityPoint {
  bar: number;
  time: number;
  equity: number;
  /** Mark-to-market including any open position. */
  markToMarket: number;
  drawdown: number;
  drawdownPct: number;
  exposure: number;
  price: number;
}

export interface BacktestMetrics {
  // --- returns -----------------------------------------------------------
  initialCapital: number;
  finalEquity: number;
  totalReturn: number;
  totalReturnPct: number;
  cagr: number;
  /** Buy and hold over the same window, for comparison. */
  buyHoldReturnPct: number;
  alphaVsBuyHold: number;

  // --- risk --------------------------------------------------------------
  maxDrawdown: number;
  maxDrawdownPct: number;
  maxDrawdownDurationBars: number;
  volatility: number;
  downsideDeviation: number;
  ulcerIndex: number;
  var95: number;
  cvar95: number;

  // --- risk-adjusted ------------------------------------------------------
  sharpe: number;
  sortino: number;
  calmar: number;
  /** Return per unit of Ulcer index. */
  martin: number;

  // --- trade statistics ---------------------------------------------------
  totalTrades: number;
  winners: number;
  losers: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  avgWinR: number;
  avgLossR: number;
  profitFactor: number;
  expectancy: number;
  expectancyR: number;
  payoffRatio: number;
  largestWin: number;
  largestLoss: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgBarsHeld: number;
  /** Fraction of bars with a position open. */
  exposureTime: number;
  /** Total commission and slippage paid, as a share of initial capital. */
  totalCosts: number;
  costDragPct: number;

  // --- distribution --------------------------------------------------------
  bestTradeR: number;
  worstTradeR: number;
  /** Ratio of the 95th percentile gain to the 5th percentile loss. */
  tailRatio: number;
  /** Kelly-optimal fraction implied by the realised win rate and payoff. */
  impliedKelly: number;

  // --- statistical significance ---------------------------------------------
  /** t-statistic of mean R against zero. The question every backtest must
   *  answer and almost none do: is this expectancy distinguishable from luck? */
  tStat: number;
  /** Two-sided p-value for the above. */
  pValue: number;
  /** Standard error of the mean R multiple. */
  standardError: number;
  /** Plain-language verdict on statistical significance. */
  significance: string;

  // --- by regime / direction ------------------------------------------------
  longTrades: number;
  shortTrades: number;
  longWinRate: number;
  shortWinRate: number;
  byExitReason: Record<string, number>;
}

export interface BacktestResult {
  config: BacktestConfig;
  symbol: string;
  /** Where the price data came from — the single most important caveat. */
  dataProvenance: 'live' | 'cached' | 'simulated';
  dataSource: string;
  barsTested: number;
  startTime: number;
  endTime: number;
  trades: Trade[];
  equityCurve: EquityPoint[];
  metrics: BacktestMetrics;
  /** Honest assessment of what this run does and does not establish. */
  caveats: string[];
}
