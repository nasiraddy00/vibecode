/* ===========================================================================
   Core domain types for Meridian Terminal.
   ========================================================================= */

/** A single OHLCV bar. `t` is a UTC epoch in milliseconds. */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type AssetClass =
  | 'equity' | 'etf' | 'index' | 'crypto' | 'commodity' | 'fx' | 'rate' | 'bond';

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

/** Where a number came from. Displayed on every figure in the UI: a trader
 *  must never be unable to tell a measurement from an estimate. */
export type Provenance =
  | 'live'      // fetched from an upstream provider this request
  | 'cached'    // fetched recently, served from cache
  | 'derived'   // computed from live/cached inputs
  | 'simulated' // produced by the deterministic simulator: NOT market truth
  | 'stale'     // upstream failed; last good value, age flagged
  | 'missing';  // no data, no estimate

export interface Sourced<T> {
  value: T;
  provenance: Provenance;
  /** Human-readable provider id, e.g. "binance", "sec-edgar", "simulator". */
  source: string;
  /** Epoch ms the underlying data was produced. */
  asOf: number;
}

export interface Quote {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  /** Average daily volume, 20d. */
  avgVolume?: number;
  marketCap?: number;
  /** Pre/post-market price when the session is closed. */
  extendedPrice?: number;
  extendedChangePct?: number;
  currency: string;
  provenance: Provenance;
  source: string;
  asOf: number;
}

/* ---------------------------------------------------------------------------
   SIGNALS
   ------------------------------------------------------------------------- */

export type Direction = 'long' | 'short' | 'flat';

export type Action =
  | 'STRONG BUY'
  | 'BUY'
  | 'ACCUMULATE'
  | 'HOLD'
  | 'REDUCE'
  | 'SELL'
  | 'STRONG SELL';

/** One analytic's opinion. Every model in the terminal — technical,
 *  fundamental, flow, sentiment, volatility — reduces to this shape so the
 *  ensemble can weigh them on a common scale. */
export interface Vote {
  /** Stable identifier, e.g. "rsi_14", "piotroski", "insider_cluster". */
  id: string;
  /** Display label. */
  label: string;
  /** Which family this belongs to; drives grouping and regime weighting. */
  family: VoteFamily;
  /** Directional score in [-1, +1]. Negative = bearish, positive = bullish. */
  score: number;
  /** How much to trust this reading right now, [0, 1]. Low when the input is
   *  simulated, stale, thin, or the indicator is outside its useful regime. */
  confidence: number;
  /** Intended holding horizon this vote speaks to. */
  horizon: Horizon;
  /** One-line plain-English justification shown in the UI. */
  rationale: string;
  /** The raw reading, for display next to the verdict. */
  reading?: string;
  provenance: Provenance;
}

export type VoteFamily =
  | 'trend'
  | 'momentum'
  | 'meanreversion'
  | 'volatility'
  | 'volume'
  | 'structure'
  | 'pattern'
  | 'fundamental'
  | 'valuation'
  | 'quality'
  | 'earnings'
  | 'insider'
  | 'institutional'
  | 'social'
  | 'news'
  | 'macro'
  | 'options'
  | 'seasonality'
  | 'intermarket';

export type Horizon = 'intraday' | 'swing' | 'position';

export type MarketRegime =
  | 'strong_uptrend'
  | 'uptrend'
  | 'choppy_bullish'
  | 'range'
  | 'choppy_bearish'
  | 'downtrend'
  | 'strong_downtrend'
  | 'high_vol_shock';

export interface RegimeAssessment {
  regime: MarketRegime;
  /** ADX-style trend strength [0,100]. */
  trendStrength: number;
  /** Choppiness index [0,100]; high = mean-reverting, low = trending. */
  choppiness: number;
  /** Realised annualised volatility, as a decimal (0.42 = 42%). */
  realisedVol: number;
  /** Percentile of current vol vs its own 1y history, [0,1]. */
  volPercentile: number;
  /** Hurst exponent; >0.5 trending, <0.5 mean-reverting. */
  hurst: number;
  label: string;
  description: string;
}

/** The tradeable instruction the terminal produces. */
export interface TradePlan {
  direction: Direction;
  /** Cash-equity/spot instruction. */
  instrument: 'spot' | 'call' | 'put' | 'call_spread' | 'put_spread' | 'none';
  entry: number;
  stop: number;
  targets: number[];
  /** Reward-to-risk on the first target. */
  riskReward: number;
  /** Fraction of account equity to risk on this trade, e.g. 0.0075 = 0.75%. */
  riskFraction: number;
  /** Position size in units/shares/contracts, given the account equity. */
  size: number;
  /** Notional value of the position. */
  notional: number;
  horizon: Horizon;
  /** Expected holding period in bars. */
  expectedBars: number;
  optionLeg?: OptionLegSuggestion;
  notes: string[];
}

export interface OptionLegSuggestion {
  type: 'call' | 'put';
  strike: number;
  /** Days to expiry. */
  dte: number;
  expiry: string;
  targetDelta: number;
  estimatedIV: number;
  estimatedPremium: number;
  breakeven: number;
  /** Why this structure over spot. */
  reason: string;
}

export interface SignalResult {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  asOf: number;
  price: number;
  /** Net directional score in [-1, +1] after weighting. */
  score: number;
  /** 0-100 conviction: magnitude x agreement x data quality. */
  conviction: number;
  action: Action;
  direction: Direction;
  regime: RegimeAssessment;
  votes: Vote[];
  /** Score contribution per family, for the attribution chart. */
  attribution: FamilyAttribution[];
  plan: TradePlan;
  /** Fraction of votes agreeing with the net direction, [0,1]. */
  agreement: number;
  /** Share of inputs that are real market data rather than simulated. */
  dataQuality: number;
  warnings: string[];
}

export interface FamilyAttribution {
  family: VoteFamily;
  score: number;
  weight: number;
  contribution: number;
  voteCount: number;
}
