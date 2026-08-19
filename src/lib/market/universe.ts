/* ===========================================================================
   Instrument universe.

   `anchor` is a REFERENCE LEVEL used to seed the deterministic simulator and
   to sanity-check live feeds — it is explicitly NOT a quote, and the UI never
   displays it as one. When a live provider is configured, real prices replace
   these entirely and the provenance badge flips from SIM to LIVE.
   ========================================================================= */

import type { AssetClass } from '../types';

export interface Instrument {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** Seed/reference level for the simulator. Not a quote. */
  anchor: number;
  /** Typical annualised volatility, used to calibrate the simulator. */
  typicalVol: number;
  /** Long-run annual drift used by the simulator. */
  drift: number;
  sector?: string;
  currency: string;
  /** Exchange or venue, for display. */
  venue: string;
  /** Trades around the clock (crypto, FX) vs session-bound. */
  continuous: boolean;
  /** Symbol used by the Yahoo-style providers. */
  yahooSymbol?: string;
  /** Symbol used by Binance. */
  binanceSymbol?: string;
  /** CoinGecko id. */
  coingeckoId?: string;
  description?: string;
}

const eq = (
  symbol: string, name: string, anchor: number, vol: number, drift: number,
  sector: string, description?: string,
): Instrument => ({
  symbol, name, assetClass: 'equity', anchor, typicalVol: vol, drift,
  sector, currency: 'USD', venue: 'NASDAQ/NYSE', continuous: false,
  yahooSymbol: symbol, description,
});

export const INDEXES: Instrument[] = [
  { symbol: 'SPX', name: 'S&P 500', assetClass: 'index', anchor: 5850, typicalVol: 0.16, drift: 0.08, currency: 'USD', venue: 'CBOE', continuous: false, yahooSymbol: '^GSPC', description: 'The broad US large-cap benchmark and the reference risk asset for global markets.' },
  { symbol: 'NDX', name: 'Nasdaq 100', assetClass: 'index', anchor: 20400, typicalVol: 0.21, drift: 0.11, currency: 'USD', venue: 'NASDAQ', continuous: false, yahooSymbol: '^NDX', description: 'Mega-cap technology concentration; the highest-beta major US index.' },
  { symbol: 'DJI', name: 'Dow Jones Industrial Average', assetClass: 'index', anchor: 43200, typicalVol: 0.14, drift: 0.07, currency: 'USD', venue: 'NYSE', continuous: false, yahooSymbol: '^DJI', description: 'Price-weighted blue-chip index; skews defensive and value.' },
  { symbol: 'RUT', name: 'Russell 2000', assetClass: 'index', anchor: 2280, typicalVol: 0.23, drift: 0.06, currency: 'USD', venue: 'NYSE', continuous: false, yahooSymbol: '^RUT', description: 'US small caps — the cleanest read on domestic economic risk appetite.' },
  { symbol: 'VIX', name: 'CBOE Volatility Index', assetClass: 'index', anchor: 15.8, typicalVol: 0.95, drift: 0, currency: 'USD', venue: 'CBOE', continuous: false, yahooSymbol: '^VIX', description: '30-day implied volatility on SPX. The market\'s own estimate of how wrong it might be.' },
  { symbol: 'VIX3M', name: 'CBOE 3-Month Volatility', assetClass: 'index', anchor: 18.2, typicalVol: 0.7, drift: 0, currency: 'USD', venue: 'CBOE', continuous: false, yahooSymbol: '^VIX3M' },
  { symbol: 'VIX9D', name: 'CBOE 9-Day Volatility', assetClass: 'index', anchor: 14.6, typicalVol: 1.1, drift: 0, currency: 'USD', venue: 'CBOE', continuous: false, yahooSymbol: '^VIX9D' },
  { symbol: 'VVIX', name: 'VIX of VIX', assetClass: 'index', anchor: 92, typicalVol: 0.6, drift: 0, currency: 'USD', venue: 'CBOE', continuous: false, yahooSymbol: '^VVIX' },
  { symbol: 'DXY', name: 'US Dollar Index', assetClass: 'fx', anchor: 104.2, typicalVol: 0.08, drift: 0, currency: 'USD', venue: 'ICE', continuous: true, yahooSymbol: 'DX-Y.NYB', description: 'Dollar strength versus a basket of majors; the master variable for commodities and EM.' },
  { symbol: 'TNX', name: 'US 10-Year Yield', assetClass: 'rate', anchor: 4.28, typicalVol: 0.25, drift: 0, currency: 'USD', venue: 'CBOT', continuous: false, yahooSymbol: '^TNX', description: 'The global discount rate. Equity multiples key off this more than off earnings.' },
  { symbol: 'FVX', name: 'US 5-Year Yield', assetClass: 'rate', anchor: 4.11, typicalVol: 0.26, drift: 0, currency: 'USD', venue: 'CBOT', continuous: false, yahooSymbol: '^FVX' },
  { symbol: 'IRX', name: 'US 13-Week Yield', assetClass: 'rate', anchor: 4.62, typicalVol: 0.12, drift: 0, currency: 'USD', venue: 'CBOT', continuous: false, yahooSymbol: '^IRX' },
];

export const CRYPTO: Instrument[] = [
  { symbol: 'BTC-USD', name: 'Bitcoin', assetClass: 'crypto', anchor: 97500, typicalVol: 0.52, drift: 0.35, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'BTC-USD', binanceSymbol: 'BTCUSDT', coingeckoId: 'bitcoin', description: 'The reserve asset of the crypto complex; increasingly traded as a macro liquidity proxy.' },
  { symbol: 'ETH-USD', name: 'Ethereum', assetClass: 'crypto', anchor: 3420, typicalVol: 0.63, drift: 0.30, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'ETH-USD', binanceSymbol: 'ETHUSDT', coingeckoId: 'ethereum', description: 'Smart-contract settlement layer; higher beta to crypto risk appetite than BTC.' },
  { symbol: 'SOL-USD', name: 'Solana', assetClass: 'crypto', anchor: 188, typicalVol: 0.88, drift: 0.35, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'SOL-USD', binanceSymbol: 'SOLUSDT', coingeckoId: 'solana' },
  { symbol: 'XRP-USD', name: 'XRP', assetClass: 'crypto', anchor: 2.14, typicalVol: 0.85, drift: 0.20, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'XRP-USD', binanceSymbol: 'XRPUSDT', coingeckoId: 'ripple' },
  { symbol: 'BNB-USD', name: 'BNB', assetClass: 'crypto', anchor: 645, typicalVol: 0.62, drift: 0.22, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'BNB-USD', binanceSymbol: 'BNBUSDT', coingeckoId: 'binancecoin' },
  { symbol: 'DOGE-USD', name: 'Dogecoin', assetClass: 'crypto', anchor: 0.328, typicalVol: 1.05, drift: 0.10, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'DOGE-USD', binanceSymbol: 'DOGEUSDT', coingeckoId: 'dogecoin' },
  { symbol: 'ADA-USD', name: 'Cardano', assetClass: 'crypto', anchor: 0.89, typicalVol: 0.88, drift: 0.12, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'ADA-USD', binanceSymbol: 'ADAUSDT', coingeckoId: 'cardano' },
  { symbol: 'AVAX-USD', name: 'Avalanche', assetClass: 'crypto', anchor: 36.4, typicalVol: 0.92, drift: 0.18, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'AVAX-USD', binanceSymbol: 'AVAXUSDT', coingeckoId: 'avalanche-2' },
  { symbol: 'LINK-USD', name: 'Chainlink', assetClass: 'crypto', anchor: 22.8, typicalVol: 0.86, drift: 0.20, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'LINK-USD', binanceSymbol: 'LINKUSDT', coingeckoId: 'chainlink' },
  { symbol: 'MATIC-USD', name: 'Polygon', assetClass: 'crypto', anchor: 0.52, typicalVol: 0.95, drift: 0.05, currency: 'USD', venue: 'Aggregate', continuous: true, yahooSymbol: 'MATIC-USD', binanceSymbol: 'MATICUSDT', coingeckoId: 'matic-network' },
];

export const COMMODITIES: Instrument[] = [
  { symbol: 'GC=F', name: 'Gold', assetClass: 'commodity', anchor: 2648, typicalVol: 0.15, drift: 0.06, currency: 'USD', venue: 'COMEX', continuous: true, yahooSymbol: 'GC=F', description: 'The real-rate and debasement hedge; inversely keyed to real yields and the dollar.' },
  { symbol: 'SI=F', name: 'Silver', assetClass: 'commodity', anchor: 30.6, typicalVol: 0.28, drift: 0.05, currency: 'USD', venue: 'COMEX', continuous: true, yahooSymbol: 'SI=F', description: 'Half precious metal, half industrial input — the higher-beta gold trade.' },
  { symbol: 'CL=F', name: 'WTI Crude Oil', assetClass: 'commodity', anchor: 70.4, typicalVol: 0.35, drift: 0.02, currency: 'USD', venue: 'NYMEX', continuous: true, yahooSymbol: 'CL=F', description: 'The growth-and-geopolitics barometer; feeds directly into headline inflation.' },
  { symbol: 'BZ=F', name: 'Brent Crude', assetClass: 'commodity', anchor: 74.1, typicalVol: 0.33, drift: 0.02, currency: 'USD', venue: 'ICE', continuous: true, yahooSymbol: 'BZ=F' },
  { symbol: 'NG=F', name: 'Natural Gas', assetClass: 'commodity', anchor: 3.42, typicalVol: 0.72, drift: 0, currency: 'USD', venue: 'NYMEX', continuous: true, yahooSymbol: 'NG=F', description: 'The most volatile major commodity — weather-driven and structurally mean-reverting.' },
  { symbol: 'HG=F', name: 'Copper', assetClass: 'commodity', anchor: 4.18, typicalVol: 0.24, drift: 0.04, currency: 'USD', venue: 'COMEX', continuous: true, yahooSymbol: 'HG=F', description: 'Dr. Copper — the classic real-economy demand signal, dominated by Chinese construction.' },
  { symbol: 'ZC=F', name: 'Corn', assetClass: 'commodity', anchor: 4.42, typicalVol: 0.26, drift: 0, currency: 'USD', venue: 'CBOT', continuous: true, yahooSymbol: 'ZC=F' },
  { symbol: 'ZW=F', name: 'Wheat', assetClass: 'commodity', anchor: 5.48, typicalVol: 0.31, drift: 0, currency: 'USD', venue: 'CBOT', continuous: true, yahooSymbol: 'ZW=F' },
];

export const FX: Instrument[] = [
  { symbol: 'EURUSD=X', name: 'EUR/USD', assetClass: 'fx', anchor: 1.048, typicalVol: 0.075, drift: 0, currency: 'USD', venue: 'FX', continuous: true, yahooSymbol: 'EURUSD=X' },
  { symbol: 'USDJPY=X', name: 'USD/JPY', assetClass: 'fx', anchor: 154.2, typicalVol: 0.10, drift: 0, currency: 'JPY', venue: 'FX', continuous: true, yahooSymbol: 'USDJPY=X', description: 'The global carry barometer; moves with US-Japan rate differentials.' },
  { symbol: 'GBPUSD=X', name: 'GBP/USD', assetClass: 'fx', anchor: 1.262, typicalVol: 0.085, drift: 0, currency: 'USD', venue: 'FX', continuous: true, yahooSymbol: 'GBPUSD=X' },
  { symbol: 'USDCNY=X', name: 'USD/CNY', assetClass: 'fx', anchor: 7.29, typicalVol: 0.04, drift: 0, currency: 'CNY', venue: 'FX', continuous: true, yahooSymbol: 'USDCNY=X' },
];

export const SECTOR_ETFS: Instrument[] = [
  { symbol: 'XLK', name: 'Technology', assetClass: 'etf', anchor: 231, typicalVol: 0.22, drift: 0.12, sector: 'Technology', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLK' },
  { symbol: 'XLF', name: 'Financials', assetClass: 'etf', anchor: 49.2, typicalVol: 0.19, drift: 0.08, sector: 'Financials', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLF' },
  { symbol: 'XLE', name: 'Energy', assetClass: 'etf', anchor: 88.4, typicalVol: 0.27, drift: 0.05, sector: 'Energy', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLE' },
  { symbol: 'XLV', name: 'Health Care', assetClass: 'etf', anchor: 141, typicalVol: 0.16, drift: 0.07, sector: 'Health Care', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLV' },
  { symbol: 'XLY', name: 'Consumer Discretionary', assetClass: 'etf', anchor: 208, typicalVol: 0.21, drift: 0.09, sector: 'Consumer Discretionary', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLY' },
  { symbol: 'XLP', name: 'Consumer Staples', assetClass: 'etf', anchor: 79.6, typicalVol: 0.13, drift: 0.05, sector: 'Consumer Staples', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLP' },
  { symbol: 'XLI', name: 'Industrials', assetClass: 'etf', anchor: 137, typicalVol: 0.18, drift: 0.08, sector: 'Industrials', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLI' },
  { symbol: 'XLU', name: 'Utilities', assetClass: 'etf', anchor: 77.8, typicalVol: 0.16, drift: 0.05, sector: 'Utilities', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLU' },
  { symbol: 'XLB', name: 'Materials', assetClass: 'etf', anchor: 88.1, typicalVol: 0.19, drift: 0.06, sector: 'Materials', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLB' },
  { symbol: 'XLRE', name: 'Real Estate', assetClass: 'etf', anchor: 41.3, typicalVol: 0.19, drift: 0.04, sector: 'Real Estate', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLRE' },
  { symbol: 'XLC', name: 'Communication Services', assetClass: 'etf', anchor: 98.2, typicalVol: 0.21, drift: 0.10, sector: 'Communication Services', currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'XLC' },
];

export const BENCHMARK_ETFS: Instrument[] = [
  { symbol: 'SPY', name: 'SPDR S&P 500 ETF', assetClass: 'etf', anchor: 583, typicalVol: 0.16, drift: 0.08, currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'SPY' },
  { symbol: 'QQQ', name: 'Invesco QQQ Trust', assetClass: 'etf', anchor: 497, typicalVol: 0.21, drift: 0.11, currency: 'USD', venue: 'NASDAQ', continuous: false, yahooSymbol: 'QQQ' },
  { symbol: 'IWM', name: 'iShares Russell 2000 ETF', assetClass: 'etf', anchor: 226, typicalVol: 0.23, drift: 0.06, currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'IWM' },
  { symbol: 'DIA', name: 'SPDR Dow Jones ETF', assetClass: 'etf', anchor: 432, typicalVol: 0.14, drift: 0.07, currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'DIA' },
  { symbol: 'GLD', name: 'SPDR Gold Shares', assetClass: 'etf', anchor: 243, typicalVol: 0.15, drift: 0.06, currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'GLD' },
  { symbol: 'TLT', name: 'iShares 20+ Year Treasury', assetClass: 'etf', anchor: 90.4, typicalVol: 0.16, drift: 0.02, currency: 'USD', venue: 'NASDAQ', continuous: false, yahooSymbol: 'TLT' },
  { symbol: 'HYG', name: 'iShares High Yield Corporate', assetClass: 'etf', anchor: 79.8, typicalVol: 0.07, drift: 0.04, currency: 'USD', venue: 'NYSE ARCA', continuous: false, yahooSymbol: 'HYG' },
];

export const EQUITIES: Instrument[] = [
  eq('AAPL', 'Apple Inc.', 234, 0.24, 0.12, 'Technology', 'The largest consumer hardware franchise, increasingly a services annuity.'),
  eq('MSFT', 'Microsoft Corp.', 428, 0.22, 0.13, 'Technology', 'Enterprise software and the leading commercial AI distribution channel.'),
  eq('NVDA', 'NVIDIA Corp.', 138, 0.48, 0.25, 'Technology', 'The accelerated-computing monopoly; the single highest-beta expression of the AI capex cycle.'),
  eq('GOOGL', 'Alphabet Inc.', 176, 0.27, 0.11, 'Communication Services', 'Search advertising cash machine with an unpriced cloud and AI optionality.'),
  eq('AMZN', 'Amazon.com Inc.', 224, 0.29, 0.13, 'Consumer Discretionary', 'Retail logistics at scale funding the highest-margin cloud business in the market.'),
  eq('META', 'Meta Platforms Inc.', 592, 0.34, 0.14, 'Communication Services', 'Attention monetisation at 3bn users, with a large discretionary capex overhang.'),
  eq('TSLA', 'Tesla Inc.', 352, 0.58, 0.15, 'Consumer Discretionary', 'Auto manufacturer valued on autonomy and energy optionality; the retail sentiment bellwether.'),
  eq('AVGO', 'Broadcom Inc.', 168, 0.35, 0.16, 'Technology', 'Custom silicon and infrastructure software; the second-order AI beneficiary.'),
  eq('JPM', 'JPMorgan Chase & Co.', 242, 0.21, 0.09, 'Financials', 'The fortress balance sheet; a direct read on US credit and capital markets activity.'),
  eq('BRK-B', 'Berkshire Hathaway', 456, 0.15, 0.09, 'Financials'),
  eq('LLY', 'Eli Lilly and Co.', 782, 0.30, 0.16, 'Health Care', 'GLP-1 franchise driving the largest earnings revision cycle in large-cap pharma.'),
  eq('UNH', 'UnitedHealth Group', 512, 0.22, 0.09, 'Health Care'),
  eq('V', 'Visa Inc.', 312, 0.18, 0.11, 'Financials', 'A toll booth on global consumption with structurally high incremental margins.'),
  eq('MA', 'Mastercard Inc.', 522, 0.19, 0.11, 'Financials'),
  eq('XOM', 'Exxon Mobil Corp.', 108, 0.25, 0.06, 'Energy', 'Integrated major; the cleanest large-cap hedge against an energy supply shock.'),
  eq('CVX', 'Chevron Corp.', 158, 0.24, 0.05, 'Energy'),
  eq('WMT', 'Walmart Inc.', 92, 0.18, 0.10, 'Consumer Staples'),
  eq('COST', 'Costco Wholesale', 936, 0.20, 0.12, 'Consumer Staples'),
  eq('HD', 'Home Depot Inc.', 412, 0.21, 0.08, 'Consumer Discretionary'),
  eq('PG', 'Procter & Gamble', 168, 0.14, 0.06, 'Consumer Staples'),
  eq('JNJ', 'Johnson & Johnson', 146, 0.15, 0.05, 'Health Care'),
  eq('ABBV', 'AbbVie Inc.', 176, 0.20, 0.08, 'Health Care'),
  eq('MRK', 'Merck & Co.', 99, 0.20, 0.06, 'Health Care'),
  eq('PEP', 'PepsiCo Inc.', 156, 0.15, 0.05, 'Consumer Staples'),
  eq('KO', 'Coca-Cola Co.', 62, 0.14, 0.05, 'Consumer Staples'),
  eq('AMD', 'Advanced Micro Devices', 128, 0.48, 0.14, 'Technology', 'The credible second source in accelerated compute; high beta to AI sentiment.'),
  eq('INTC', 'Intel Corp.', 20.4, 0.45, -0.05, 'Technology', 'A turnaround story with foundry execution risk and negative free cash flow.'),
  eq('CRM', 'Salesforce Inc.', 336, 0.30, 0.10, 'Technology'),
  eq('ORCL', 'Oracle Corp.', 178, 0.29, 0.12, 'Technology'),
  eq('ADBE', 'Adobe Inc.', 468, 0.30, 0.08, 'Technology'),
  eq('NFLX', 'Netflix Inc.', 892, 0.32, 0.15, 'Communication Services'),
  eq('DIS', 'Walt Disney Co.', 112, 0.27, 0.05, 'Communication Services'),
  eq('BA', 'Boeing Co.', 178, 0.38, 0.02, 'Industrials', 'Duopoly asset with severe execution and balance-sheet impairment.'),
  eq('CAT', 'Caterpillar Inc.', 392, 0.24, 0.09, 'Industrials'),
  eq('GE', 'GE Aerospace', 178, 0.26, 0.12, 'Industrials'),
  eq('GS', 'Goldman Sachs Group', 578, 0.25, 0.10, 'Financials'),
  eq('MS', 'Morgan Stanley', 128, 0.25, 0.09, 'Financials'),
  eq('BAC', 'Bank of America', 46.2, 0.25, 0.08, 'Financials'),
  eq('WFC', 'Wells Fargo & Co.', 74.8, 0.26, 0.08, 'Financials'),
  eq('PLTR', 'Palantir Technologies', 74.2, 0.62, 0.20, 'Technology', 'Government and commercial AI deployment; valuation carries extreme growth expectations.'),
  eq('COIN', 'Coinbase Global', 296, 0.72, 0.15, 'Financials', 'The listed proxy for crypto trading volumes; beta to BTC well above 1.'),
  eq('MSTR', 'MicroStrategy Inc.', 382, 1.05, 0.20, 'Technology', 'A leveraged bitcoin holding vehicle wrapped in a software company.'),
  eq('SMCI', 'Super Micro Computer', 34.2, 0.88, 0.10, 'Technology'),
  eq('MU', 'Micron Technology', 102, 0.45, 0.10, 'Technology'),
  eq('QCOM', 'Qualcomm Inc.', 158, 0.32, 0.09, 'Technology'),
  eq('TXN', 'Texas Instruments', 192, 0.26, 0.07, 'Technology'),
  eq('AMAT', 'Applied Materials', 168, 0.38, 0.11, 'Technology'),
  eq('ARM', 'Arm Holdings', 132, 0.55, 0.14, 'Technology'),
  eq('UBER', 'Uber Technologies', 68.4, 0.35, 0.12, 'Industrials'),
  eq('ABNB', 'Airbnb Inc.', 134, 0.36, 0.08, 'Consumer Discretionary'),
];

export const ALL_INSTRUMENTS: Instrument[] = [
  ...INDEXES, ...CRYPTO, ...COMMODITIES, ...FX,
  ...SECTOR_ETFS, ...BENCHMARK_ETFS, ...EQUITIES,
];

const BY_SYMBOL = new Map(ALL_INSTRUMENTS.map((i) => [i.symbol.toUpperCase(), i]));

/** Resolve a user-typed ticker to an instrument. Handles the common crypto
 *  shorthands ("BTC" -> "BTC-USD") and is case-insensitive. */
export function resolveInstrument(raw: string): Instrument | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toUpperCase();
  const direct = BY_SYMBOL.get(s);
  if (direct) return direct;

  // Crypto shorthand.
  const asCrypto = BY_SYMBOL.get(`${s}-USD`);
  if (asCrypto) return asCrypto;

  // Common aliases.
  const aliases: Record<string, string> = {
    'SP500': 'SPX', 'S&P': 'SPX', 'SPX500': 'SPX', 'ES': 'SPX',
    'NASDAQ': 'NDX', 'NQ': 'NDX', 'DOW': 'DJI', 'YM': 'DJI',
    'RUSSELL': 'RUT', 'RTY': 'RUT',
    'BITCOIN': 'BTC-USD', 'ETHEREUM': 'ETH-USD',
    'GOLD': 'GC=F', 'XAUUSD': 'GC=F', 'SILVER': 'SI=F', 'XAGUSD': 'SI=F',
    'OIL': 'CL=F', 'WTI': 'CL=F', 'CRUDE': 'CL=F', 'BRENT': 'BZ=F',
    'GAS': 'NG=F', 'NATGAS': 'NG=F', 'COPPER': 'HG=F',
    'DOLLAR': 'DXY', 'USD': 'DXY',
    'EUR': 'EURUSD=X', 'JPY': 'USDJPY=X', 'GBP': 'GBPUSD=X',
    'US10Y': 'TNX', '10Y': 'TNX', 'GOOG': 'GOOGL', 'BRK': 'BRK-B',
    'FB': 'META', 'BRKB': 'BRK-B',
  };
  const alias = aliases[s];
  return alias ? BY_SYMBOL.get(alias) : undefined;
}

/** Fuzzy search across symbol and name, for the command bar. */
export function searchInstruments(query: string, limit = 12): Instrument[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];

  const scored = ALL_INSTRUMENTS.map((inst) => {
    const sym = inst.symbol.toUpperCase();
    const name = inst.name.toUpperCase();
    let score = 0;
    if (sym === q) score = 1000;
    else if (sym.startsWith(q)) score = 500 - sym.length;
    else if (name.startsWith(q)) score = 300 - name.length;
    else if (sym.includes(q)) score = 150;
    else if (name.includes(q)) score = 100;
    return { inst, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.inst);
}

/** The default watch sets each home-page panel renders. */
export const HOME_PANELS = {
  indexes: ['SPX', 'NDX', 'DJI', 'RUT', 'VIX'],
  crypto: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD'],
  commodities: ['GC=F', 'SI=F', 'CL=F', 'NG=F', 'HG=F'],
  fx: ['DXY', 'EURUSD=X', 'USDJPY=X', 'GBPUSD=X'],
  rates: ['TNX', 'FVX', 'IRX'],
  sectors: SECTOR_ETFS.map((s) => s.symbol),
} as const;
