/* ===========================================================================
   Instrument universe.

   Two tiers:

     1. The CURATED universe below — every instrument the terminal knows by
        name, with a reference level and volatility calibration so the
        simulator can stand in when a feed is down. These populate the home
        panels, the screener and the command bar.

     2. Anything else. `resolveDynamic` in ./resolve.ts will synthesise an
        Instrument for any ticker a vendor can find, so the search bar is not
        limited to this list.

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
  /** Symbol used by Nasdaq, where it differs (share classes, indexes). */
  nasdaqSymbol?: string;
  /** CoinGecko id. */
  coingeckoId?: string;
  description?: string;
  /** True when this instrument was synthesised by a vendor lookup rather
   *  than curated here. The UI labels these so a trader knows the
   *  calibration is inferred, not hand-set. */
  dynamic?: boolean;
  /** Fixed-income sub-type, for the bond panel's grouping. */
  bondKind?: 'treasury' | 'tips' | 'credit' | 'highyield' | 'muni' | 'aggregate'
    | 'international' | 'floating' | 'convertible' | 'mortgage' | 'preferred' | 'cash';
  /** Approximate effective duration in years, for fixed income. */
  duration?: number;
}

/* --- compact constructors ------------------------------------------------ */

const eq = (
  symbol: string, name: string, anchor: number, vol: number, drift: number,
  sector: string, description?: string,
): Instrument => ({
  symbol, name, assetClass: 'equity', anchor, typicalVol: vol, drift,
  sector, currency: 'USD', venue: 'NASDAQ/NYSE', continuous: false,
  yahooSymbol: symbol, description,
});

const etf = (
  symbol: string, name: string, anchor: number, vol: number, drift: number,
  sector?: string, description?: string,
): Instrument => ({
  symbol, name, assetClass: 'etf', anchor, typicalVol: vol, drift,
  sector, currency: 'USD', venue: 'NYSE ARCA', continuous: false,
  yahooSymbol: symbol, description,
});

const bond = (
  symbol: string, name: string, anchor: number, vol: number, drift: number,
  bondKind: NonNullable<Instrument['bondKind']>, duration: number, description?: string,
): Instrument => ({
  symbol, name, assetClass: 'bond', anchor, typicalVol: vol, drift,
  currency: 'USD', venue: 'NYSE ARCA', continuous: false,
  yahooSymbol: symbol, bondKind, duration, description,
});

const cx = (
  symbol: string, name: string, binance: string | undefined, gecko: string,
  anchor: number, vol: number, drift: number, description?: string,
): Instrument => ({
  symbol: `${symbol}-USD`, name, assetClass: 'crypto', anchor, typicalVol: vol, drift,
  currency: 'USD', venue: 'Aggregate', continuous: true,
  yahooSymbol: `${symbol}-USD`, binanceSymbol: binance, coingeckoId: gecko, description,
});

const fut = (
  symbol: string, name: string, anchor: number, vol: number, drift: number,
  venue: string, description?: string,
): Instrument => ({
  symbol, name, assetClass: 'commodity', anchor, typicalVol: vol, drift,
  currency: 'USD', venue, continuous: true, yahooSymbol: symbol, description,
});

const fxp = (
  symbol: string, name: string, anchor: number, vol: number,
  currency: string, description?: string,
): Instrument => ({
  symbol, name, assetClass: 'fx', anchor, typicalVol: vol, drift: 0,
  currency, venue: 'FX', continuous: true, yahooSymbol: symbol, description,
});

const idx = (
  symbol: string, name: string, yahooSymbol: string, anchor: number, vol: number,
  drift: number, venue: string, currency = 'USD', description?: string,
): Instrument => ({
  symbol, name, assetClass: 'index', anchor, typicalVol: vol, drift,
  currency, venue, continuous: false, yahooSymbol, description,
});

/* --- US indexes and volatility ------------------------------------------ */

export const INDEXES: Instrument[] = [
  idx('SPX', 'S&P 500', '^GSPC', 5850, 0.16, 0.08, 'CBOE', 'USD', 'The broad US large-cap benchmark and the reference risk asset for global markets.'),
  idx('NDX', 'Nasdaq 100', '^NDX', 20400, 0.21, 0.11, 'NASDAQ', 'USD', 'Mega-cap technology concentration; the highest-beta major US index.'),
  idx('DJI', 'Dow Jones Industrial Average', '^DJI', 43200, 0.14, 0.07, 'NYSE', 'USD', 'Price-weighted blue-chip index; skews defensive and value.'),
  idx('RUT', 'Russell 2000', '^RUT', 2280, 0.23, 0.06, 'NYSE', 'USD', 'US small caps — the cleanest read on domestic economic risk appetite.'),
  idx('NYA', 'NYSE Composite', '^NYA', 19500, 0.14, 0.06, 'NYSE'),
  idx('MID', 'S&P MidCap 400', '^MID', 3150, 0.19, 0.07, 'NYSE'),
  idx('VIX', 'CBOE Volatility Index', '^VIX', 15.8, 0.95, 0, 'CBOE', 'USD', '30-day implied volatility on SPX. The market\'s own estimate of how wrong it might be.'),
  idx('VIX3M', 'CBOE 3-Month Volatility', '^VIX3M', 18.2, 0.7, 0, 'CBOE'),
  idx('VIX9D', 'CBOE 9-Day Volatility', '^VIX9D', 14.6, 1.1, 0, 'CBOE'),
  idx('VVIX', 'VIX of VIX', '^VVIX', 92, 0.6, 0, 'CBOE'),
  idx('SKEW', 'CBOE SKEW Index', '^SKEW', 142, 0.25, 0, 'CBOE', 'USD', 'The price of tail protection — how much traders are paying for crash insurance.'),
  idx('OVX', 'CBOE Crude Oil Volatility', '^OVX', 34, 0.7, 0, 'CBOE'),
  idx('GVZ', 'CBOE Gold Volatility', '^GVZ', 16.5, 0.6, 0, 'CBOE'),
  { symbol: 'DXY', name: 'US Dollar Index', assetClass: 'fx', anchor: 104.2, typicalVol: 0.08, drift: 0, currency: 'USD', venue: 'ICE', continuous: true, yahooSymbol: 'DX-Y.NYB', description: 'Dollar strength versus a basket of majors; the master variable for commodities and EM.' },
];

/* --- international indexes ---------------------------------------------- */

export const INTL_INDEXES: Instrument[] = [
  idx('FTSE', 'FTSE 100', '^FTSE', 8250, 0.13, 0.05, 'LSE', 'GBP', 'UK large caps — heavily weighted to energy, miners and banks rather than the domestic economy.'),
  idx('DAX', 'DAX 40', '^GDAXI', 19200, 0.18, 0.07, 'XETRA', 'EUR', 'German industrial and export bellwether; high beta to global trade and China.'),
  idx('CAC', 'CAC 40', '^FCHI', 7450, 0.17, 0.06, 'Euronext', 'EUR'),
  idx('SX5E', 'EURO STOXX 50', '^STOXX50E', 4900, 0.17, 0.06, 'Eurex', 'EUR'),
  idx('N225', 'Nikkei 225', '^N225', 39000, 0.20, 0.08, 'TSE', 'JPY', 'Japanese large caps; moves inversely to the yen through the exporter weighting.'),
  idx('HSI', 'Hang Seng', '^HSI', 19800, 0.26, 0.03, 'HKEX', 'HKD', 'The offshore China proxy; dominated by policy headlines and property credit.'),
  idx('SSEC', 'Shanghai Composite', '000001.SS', 3300, 0.20, 0.03, 'SSE', 'CNY'),
  idx('SENSEX', 'BSE SENSEX', '^BSESN', 82000, 0.15, 0.11, 'BSE', 'INR', 'Indian large caps — the strongest structural growth story in the major EM indexes.'),
  idx('NIFTY', 'NIFTY 50', '^NSEI', 25000, 0.15, 0.11, 'NSE', 'INR'),
  idx('AXJO', 'S&P/ASX 200', '^AXJO', 8300, 0.14, 0.06, 'ASX', 'AUD'),
  idx('GSPTSE', 'S&P/TSX Composite', '^GSPTSE', 24500, 0.13, 0.06, 'TSX', 'CAD'),
  idx('BVSP', 'Bovespa', '^BVSP', 132000, 0.24, 0.05, 'B3', 'BRL'),
  idx('KS11', 'KOSPI', '^KS11', 2600, 0.19, 0.05, 'KRX', 'KRW'),
  idx('TWII', 'Taiwan Weighted', '^TWII', 23000, 0.20, 0.10, 'TWSE', 'TWD', 'The purest listed expression of global semiconductor demand.'),
  idx('MXX', 'IPC Mexico', '^MXX', 52000, 0.18, 0.05, 'BMV', 'MXN'),
  idx('STI', 'Straits Times', '^STI', 3700, 0.12, 0.05, 'SGX', 'SGD'),
];

/* --- the treasury curve (yields, not prices) ----------------------------- */

export const RATES: Instrument[] = [
  { symbol: 'IRX', name: 'US 13-Week Yield', assetClass: 'rate', anchor: 4.62, typicalVol: 0.12, drift: 0, currency: 'USD', venue: 'CBOT', continuous: false, yahooSymbol: '^IRX', description: 'The front end — effectively the policy rate, and the discount rate for everything else.' },
  { symbol: 'FVX', name: 'US 5-Year Yield', assetClass: 'rate', anchor: 4.11, typicalVol: 0.26, drift: 0, currency: 'USD', venue: 'CBOT', continuous: false, yahooSymbol: '^FVX', description: 'The belly of the curve; the cleanest read on the expected path of policy.' },
  { symbol: 'TNX', name: 'US 10-Year Yield', assetClass: 'rate', anchor: 4.28, typicalVol: 0.25, drift: 0, currency: 'USD', venue: 'CBOT', continuous: false, yahooSymbol: '^TNX', description: 'The global discount rate. Equity multiples key off this more than off earnings.' },
  { symbol: 'TYX', name: 'US 30-Year Yield', assetClass: 'rate', anchor: 4.48, typicalVol: 0.22, drift: 0, currency: 'USD', venue: 'CBOT', continuous: false, yahooSymbol: '^TYX', description: 'The long bond — term premium, fiscal credibility and inflation expectations in one number.' },
];

/* --- fixed income --------------------------------------------------------
   Bonds trade as funds here rather than as individual CUSIPs: retail feeds
   do not carry single-bond quotes, and the ETF is what an individual can
   actually trade. Duration is the number that matters — it is the
   sensitivity to the rates above, and it is what the signal engine keys on.
   ------------------------------------------------------------------------- */

export const BONDS: Instrument[] = [
  // Treasury ladder, short to long.
  bond('SGOV', 'iShares 0-3 Month Treasury', 100.4, 0.004, 0.048, 'cash', 0.1, 'Effectively cash. The risk-free leg against which every other trade is measured.'),
  bond('BIL', 'SPDR 1-3 Month T-Bill', 91.6, 0.004, 0.048, 'cash', 0.1),
  bond('SHV', 'iShares Short Treasury', 110.3, 0.006, 0.047, 'cash', 0.4),
  bond('SHY', 'iShares 1-3 Year Treasury', 82.9, 0.017, 0.042, 'treasury', 1.8),
  bond('VGSH', 'Vanguard Short-Term Treasury', 58.4, 0.017, 0.042, 'treasury', 1.9),
  bond('IEI', 'iShares 3-7 Year Treasury', 118.2, 0.042, 0.039, 'treasury', 4.4),
  bond('IEF', 'iShares 7-10 Year Treasury', 94.8, 0.068, 0.035, 'treasury', 7.4, 'The belly benchmark — the cleanest duration expression without long-bond convexity.'),
  bond('VGIT', 'Vanguard Intermediate Treasury', 58.9, 0.055, 0.037, 'treasury', 5.3),
  bond('TLH', 'iShares 10-20 Year Treasury', 103.5, 0.105, 0.031, 'treasury', 11.5),
  bond('TLT', 'iShares 20+ Year Treasury', 90.4, 0.160, 0.028, 'treasury', 16.8, 'The long-duration trade. Moves like an equity index and is the market\'s preferred recession hedge.'),
  bond('VGLT', 'Vanguard Long-Term Treasury', 57.2, 0.158, 0.028, 'treasury', 15.9),
  bond('EDV', 'Vanguard Extended Duration', 71.8, 0.215, 0.026, 'treasury', 24.2, 'Zero-coupon STRIPS — the most rate-sensitive listed instrument in US fixed income.'),
  bond('ZROZ', 'PIMCO 25+ Year Zero Coupon', 78.4, 0.220, 0.026, 'treasury', 25.8),
  bond('GOVT', 'iShares US Treasury Bond', 22.6, 0.055, 0.037, 'treasury', 5.9),

  // Inflation-linked.
  bond('TIP', 'iShares TIPS Bond', 108.7, 0.052, 0.036, 'tips', 6.8, 'Real yields rather than nominal — the direct read on the market\'s inflation compensation.'),
  bond('SCHP', 'Schwab US TIPS', 53.9, 0.053, 0.036, 'tips', 6.9),
  bond('VTIP', 'Vanguard Short-Term TIPS', 48.9, 0.020, 0.041, 'tips', 2.5),
  bond('STIP', 'iShares 0-5 Year TIPS', 100.2, 0.021, 0.041, 'tips', 2.4),

  // Investment-grade credit.
  bond('LQD', 'iShares iBoxx IG Corporate', 108.4, 0.078, 0.042, 'credit', 8.3, 'Investment-grade spread risk layered on top of duration; widens fast when growth scares hit.'),
  bond('VCIT', 'Vanguard Intermediate Corporate', 80.6, 0.058, 0.043, 'credit', 6.2),
  bond('VCSH', 'Vanguard Short-Term Corporate', 78.4, 0.022, 0.045, 'credit', 2.7),
  bond('VCLT', 'Vanguard Long-Term Corporate', 76.9, 0.135, 0.040, 'credit', 13.1),
  bond('IGSB', 'iShares 1-5 Year IG Corporate', 51.9, 0.023, 0.045, 'credit', 2.6),
  bond('SPSB', 'SPDR Short Term Corporate', 30.2, 0.021, 0.045, 'credit', 1.9),

  // High yield and bank loans — the credit risk appetite gauges.
  bond('HYG', 'iShares High Yield Corporate', 79.8, 0.070, 0.062, 'highyield', 3.2, 'The single best listed proxy for credit risk appetite. Leads equities at turning points.'),
  bond('JNK', 'SPDR Bloomberg High Yield', 96.4, 0.072, 0.063, 'highyield', 3.1),
  bond('USHY', 'iShares Broad USD High Yield', 37.6, 0.071, 0.064, 'highyield', 3.4),
  bond('SHYG', 'iShares 0-5 Year High Yield', 42.8, 0.048, 0.066, 'highyield', 2.1),
  bond('ANGL', 'VanEck Fallen Angel High Yield', 29.4, 0.082, 0.061, 'highyield', 4.6),
  bond('BKLN', 'Invesco Senior Loan', 21.2, 0.035, 0.070, 'floating', 0.2, 'Floating-rate bank loans — credit risk without duration risk.'),
  bond('SRLN', 'SPDR Blackstone Senior Loan', 41.8, 0.036, 0.071, 'floating', 0.2),
  bond('FLOT', 'iShares Floating Rate Note', 50.8, 0.008, 0.049, 'floating', 0.1),
  bond('TFLO', 'iShares Treasury Floating Rate', 50.5, 0.005, 0.047, 'floating', 0.0),

  // Municipals.
  bond('MUB', 'iShares National Muni Bond', 107.2, 0.045, 0.033, 'muni', 6.2, 'Tax-exempt income; the after-tax yield is what makes this competitive with treasuries.'),
  bond('VTEB', 'Vanguard Tax-Exempt Bond', 50.4, 0.046, 0.033, 'muni', 6.4),
  bond('SUB', 'iShares Short-Term Muni', 105.8, 0.014, 0.030, 'muni', 1.9),
  bond('HYD', 'VanEck High Yield Muni', 53.6, 0.068, 0.046, 'muni', 7.8),

  // Broad aggregate.
  bond('AGG', 'iShares Core US Aggregate', 98.6, 0.055, 0.039, 'aggregate', 6.1, 'The default US bond benchmark — treasuries, agencies, mortgages and IG credit in one.'),
  bond('BND', 'Vanguard Total Bond Market', 73.8, 0.055, 0.039, 'aggregate', 6.2),
  bond('BNDX', 'Vanguard Total International Bond', 49.4, 0.042, 0.031, 'international', 7.1),
  bond('SCHZ', 'Schwab US Aggregate Bond', 23.4, 0.054, 0.039, 'aggregate', 6.1),

  // International and emerging-market debt.
  bond('EMB', 'iShares JPM USD EM Bond', 90.2, 0.088, 0.055, 'international', 6.8, 'Dollar-denominated EM sovereign risk; keyed to the dollar and global risk appetite.'),
  bond('VWOB', 'Vanguard EM Government Bond', 64.8, 0.085, 0.056, 'international', 6.5),
  bond('PCY', 'Invesco EM Sovereign Debt', 20.6, 0.095, 0.057, 'international', 8.4),
  bond('IGOV', 'iShares Intl Treasury Bond', 41.2, 0.070, 0.022, 'international', 8.1),
  bond('BWX', 'SPDR Intl Treasury Bond', 22.8, 0.072, 0.022, 'international', 8.0),

  // Mortgages, preferreds, convertibles.
  bond('MBB', 'iShares MBS', 93.4, 0.058, 0.040, 'mortgage', 5.9, 'Agency mortgages — negative convexity means they underperform when rates move sharply either way.'),
  bond('VMBS', 'Vanguard Mortgage-Backed', 46.2, 0.057, 0.040, 'mortgage', 5.8),
  bond('PFF', 'iShares Preferred & Income', 32.4, 0.085, 0.062, 'preferred', 6.2),
  bond('PGX', 'Invesco Preferred', 11.8, 0.086, 0.061, 'preferred', 6.4),
  bond('CWB', 'SPDR Convertible Securities', 78.6, 0.170, 0.072, 'convertible', 2.8, 'Equity optionality in a bond wrapper; behaves like a call on the issuer.'),
  bond('ICVT', 'iShares Convertible Bond', 92.4, 0.185, 0.078, 'convertible', 2.4),

  // Ultra-short / cash management.
  bond('JPST', 'JPMorgan Ultra-Short Income', 50.6, 0.007, 0.049, 'cash', 0.4),
  bond('MINT', 'PIMCO Enhanced Short Maturity', 100.8, 0.008, 0.049, 'cash', 0.4),
  bond('ICSH', 'iShares Ultra Short-Term Bond', 50.7, 0.007, 0.049, 'cash', 0.4),
  bond('NEAR', 'iShares Short Maturity Bond', 50.4, 0.010, 0.048, 'cash', 0.7),
];

/* --- crypto --------------------------------------------------------------
   Binance pair where one exists (it is the deepest book and the only free
   real-time websocket); CoinGecko id always, as the keyless fallback.
   ------------------------------------------------------------------------- */

export const CRYPTO: Instrument[] = [
  cx('BTC', 'Bitcoin', 'BTCUSDT', 'bitcoin', 97500, 0.52, 0.35, 'The reserve asset of the crypto complex; increasingly traded as a macro liquidity proxy.'),
  cx('ETH', 'Ethereum', 'ETHUSDT', 'ethereum', 3420, 0.63, 0.30, 'Smart-contract settlement layer; higher beta to crypto risk appetite than BTC.'),
  cx('SOL', 'Solana', 'SOLUSDT', 'solana', 188, 0.88, 0.35, 'The highest-throughput major chain; the preferred venue for retail speculation.'),
  cx('XRP', 'XRP', 'XRPUSDT', 'ripple', 2.14, 0.85, 0.20),
  cx('BNB', 'BNB', 'BNBUSDT', 'binancecoin', 645, 0.62, 0.22),
  cx('DOGE', 'Dogecoin', 'DOGEUSDT', 'dogecoin', 0.328, 1.05, 0.10, 'The purest listed measure of retail speculative appetite in crypto.'),
  cx('ADA', 'Cardano', 'ADAUSDT', 'cardano', 0.89, 0.88, 0.12),
  cx('AVAX', 'Avalanche', 'AVAXUSDT', 'avalanche-2', 36.4, 0.92, 0.18),
  cx('LINK', 'Chainlink', 'LINKUSDT', 'chainlink', 22.8, 0.86, 0.20),
  cx('TRX', 'TRON', 'TRXUSDT', 'tron', 0.245, 0.72, 0.15),
  cx('TON', 'Toncoin', 'TONUSDT', 'the-open-network', 5.42, 0.90, 0.15),
  cx('DOT', 'Polkadot', 'DOTUSDT', 'polkadot', 7.15, 0.88, 0.05),
  cx('MATIC', 'Polygon', 'MATICUSDT', 'matic-network', 0.52, 0.95, 0.05),
  cx('SHIB', 'Shiba Inu', 'SHIBUSDT', 'shiba-inu', 0.0000225, 1.15, 0.05),
  cx('LTC', 'Litecoin', 'LTCUSDT', 'litecoin', 104, 0.72, 0.08),
  cx('BCH', 'Bitcoin Cash', 'BCHUSDT', 'bitcoin-cash', 452, 0.78, 0.08),
  cx('UNI', 'Uniswap', 'UNIUSDT', 'uniswap', 13.4, 0.92, 0.12),
  cx('NEAR', 'NEAR Protocol', 'NEARUSDT', 'near', 5.28, 0.95, 0.15),
  cx('APT', 'Aptos', 'APTUSDT', 'aptos', 9.64, 0.98, 0.12),
  cx('ICP', 'Internet Computer', 'ICPUSDT', 'internet-computer', 10.8, 1.00, 0.05),
  cx('ETC', 'Ethereum Classic', 'ETCUSDT', 'ethereum-classic', 26.4, 0.85, 0.05),
  cx('XLM', 'Stellar', 'XLMUSDT', 'stellar', 0.362, 0.92, 0.08),
  cx('FIL', 'Filecoin', 'FILUSDT', 'filecoin', 5.18, 0.98, 0.05),
  cx('ARB', 'Arbitrum', 'ARBUSDT', 'arbitrum', 0.782, 1.02, 0.10),
  cx('OP', 'Optimism', 'OPUSDT', 'optimism', 1.72, 1.05, 0.10),
  cx('INJ', 'Injective', 'INJUSDT', 'injective-protocol', 22.6, 1.08, 0.15),
  cx('SUI', 'Sui', 'SUIUSDT', 'sui', 3.42, 1.10, 0.20),
  cx('SEI', 'Sei', 'SEIUSDT', 'sei-network', 0.445, 1.12, 0.12),
  cx('TIA', 'Celestia', 'TIAUSDT', 'celestia', 5.24, 1.15, 0.10),
  cx('RUNE', 'THORChain', 'RUNEUSDT', 'thorchain', 4.38, 1.10, 0.08),
  cx('AAVE', 'Aave', 'AAVEUSDT', 'aave', 312, 0.92, 0.18),
  cx('MKR', 'Maker', 'MKRUSDT', 'maker', 1640, 0.88, 0.10),
  cx('ATOM', 'Cosmos', 'ATOMUSDT', 'cosmos', 6.42, 0.90, 0.02),
  cx('ALGO', 'Algorand', 'ALGOUSDT', 'algorand', 0.342, 0.98, 0.05),
  cx('VET', 'VeChain', 'VETUSDT', 'vechain', 0.0392, 0.98, 0.05),
  cx('HBAR', 'Hedera', 'HBARUSDT', 'hedera-hashgraph', 0.268, 1.00, 0.10),
  cx('IMX', 'Immutable', 'IMXUSDT', 'immutable-x', 1.28, 1.05, 0.08),
  cx('STX', 'Stacks', 'STXUSDT', 'blockstack', 1.86, 1.08, 0.12),
  cx('GRT', 'The Graph', 'GRTUSDT', 'the-graph', 0.192, 1.02, 0.05),
  cx('SAND', 'The Sandbox', 'SANDUSDT', 'the-sandbox', 0.385, 1.08, 0.00),
  cx('PEPE', 'Pepe', 'PEPEUSDT', 'pepe', 0.0000182, 1.25, 0.05, 'A pure sentiment instrument — no cash flows, no protocol, only flow.'),
  cx('WIF', 'dogwifhat', 'WIFUSDT', 'dogwifcoin', 2.34, 1.30, 0.05),
  cx('BONK', 'Bonk', 'BONKUSDT', 'bonk', 0.0000315, 1.32, 0.05),
];

/* --- commodities (front-month futures) ----------------------------------- */

export const COMMODITIES: Instrument[] = [
  fut('GC=F', 'Gold', 2648, 0.15, 0.06, 'COMEX', 'The real-rate and debasement hedge; inversely keyed to real yields and the dollar.'),
  fut('SI=F', 'Silver', 30.6, 0.28, 0.05, 'COMEX', 'Half precious metal, half industrial input — the higher-beta gold trade.'),
  fut('PL=F', 'Platinum', 968, 0.24, 0.02, 'NYMEX'),
  fut('PA=F', 'Palladium', 1024, 0.36, 0.00, 'NYMEX'),
  fut('HG=F', 'Copper', 4.18, 0.24, 0.04, 'COMEX', 'Dr. Copper — the classic real-economy demand signal, dominated by Chinese construction.'),
  fut('ALI=F', 'Aluminium', 2580, 0.22, 0.02, 'COMEX'),
  fut('CL=F', 'WTI Crude Oil', 70.4, 0.35, 0.02, 'NYMEX', 'The growth-and-geopolitics barometer; feeds directly into headline inflation.'),
  fut('BZ=F', 'Brent Crude', 74.1, 0.33, 0.02, 'ICE'),
  fut('NG=F', 'Natural Gas', 3.42, 0.72, 0.00, 'NYMEX', 'The most volatile major commodity — weather-driven and structurally mean-reverting.'),
  fut('RB=F', 'RBOB Gasoline', 2.02, 0.38, 0.00, 'NYMEX'),
  fut('HO=F', 'Heating Oil', 2.24, 0.34, 0.00, 'NYMEX'),
  fut('ZC=F', 'Corn', 4.42, 0.26, 0.00, 'CBOT'),
  fut('ZW=F', 'Wheat', 5.48, 0.31, 0.00, 'CBOT', 'The most geopolitically sensitive agricultural contract.'),
  fut('ZS=F', 'Soybeans', 10.1, 0.22, 0.00, 'CBOT'),
  fut('ZM=F', 'Soybean Meal', 302, 0.26, 0.00, 'CBOT'),
  fut('ZL=F', 'Soybean Oil', 42.4, 0.28, 0.00, 'CBOT'),
  fut('ZO=F', 'Oats', 3.62, 0.34, 0.00, 'CBOT'),
  fut('ZR=F', 'Rough Rice', 15.2, 0.24, 0.00, 'CBOT'),
  fut('KC=F', 'Coffee', 3.18, 0.42, 0.00, 'ICE', 'Weather-driven soft with the fattest tails in the agricultural complex.'),
  fut('SB=F', 'Sugar', 0.215, 0.32, 0.00, 'ICE'),
  fut('CC=F', 'Cocoa', 8420, 0.52, 0.00, 'ICE'),
  fut('CT=F', 'Cotton', 0.685, 0.26, 0.00, 'ICE'),
  fut('OJ=F', 'Orange Juice', 4.62, 0.48, 0.00, 'ICE'),
  fut('LE=F', 'Live Cattle', 1.88, 0.16, 0.00, 'CME'),
  fut('GF=F', 'Feeder Cattle', 2.52, 0.18, 0.00, 'CME'),
  fut('HE=F', 'Lean Hogs', 0.845, 0.28, 0.00, 'CME'),
  fut('LBS=F', 'Lumber', 562, 0.44, 0.00, 'CME'),
];

/* --- foreign exchange ---------------------------------------------------- */

export const FX: Instrument[] = [
  fxp('EURUSD=X', 'EUR/USD', 1.048, 0.075, 'USD', 'The deepest currency pair on earth; effectively the inverse of the dollar index.'),
  fxp('USDJPY=X', 'USD/JPY', 154.2, 0.100, 'JPY', 'The global carry barometer; moves with US-Japan rate differentials.'),
  fxp('GBPUSD=X', 'GBP/USD', 1.262, 0.085, 'USD'),
  fxp('USDCHF=X', 'USD/CHF', 0.895, 0.072, 'CHF', 'The franc is the reflexive haven — it rallies when Europe is frightened.'),
  fxp('USDCAD=X', 'USD/CAD', 1.438, 0.062, 'CAD'),
  fxp('AUDUSD=X', 'AUD/USD', 0.628, 0.095, 'USD', 'The commodity-and-China proxy in G10 currency form.'),
  fxp('NZDUSD=X', 'NZD/USD', 0.568, 0.098, 'USD'),
  fxp('EURGBP=X', 'EUR/GBP', 0.831, 0.055, 'GBP'),
  fxp('EURJPY=X', 'EUR/JPY', 161.6, 0.098, 'JPY'),
  fxp('GBPJPY=X', 'GBP/JPY', 194.5, 0.112, 'JPY', 'The classic volatility pair — thin liquidity and a large daily range.'),
  fxp('AUDJPY=X', 'AUD/JPY', 96.8, 0.120, 'JPY', 'The purest listed risk-on/risk-off signal in FX.'),
  fxp('EURCHF=X', 'EUR/CHF', 0.938, 0.045, 'CHF'),
  fxp('USDCNY=X', 'USD/CNY', 7.29, 0.040, 'CNY', 'A managed rate — the level the PBoC tolerates is itself the policy signal.'),
  fxp('USDMXN=X', 'USD/MXN', 20.4, 0.135, 'MXN'),
  fxp('USDBRL=X', 'USD/BRL', 6.12, 0.155, 'BRL'),
  fxp('USDINR=X', 'USD/INR', 84.8, 0.045, 'INR'),
  fxp('USDKRW=X', 'USD/KRW', 1438, 0.085, 'KRW'),
  fxp('USDTRY=X', 'USD/TRY', 34.8, 0.185, 'TRY'),
  fxp('USDZAR=X', 'USD/ZAR', 18.2, 0.155, 'ZAR'),
  fxp('USDSEK=X', 'USD/SEK', 11.0, 0.105, 'SEK'),
  fxp('USDNOK=X', 'USD/NOK', 11.3, 0.110, 'NOK'),
  fxp('USDSGD=X', 'USD/SGD', 1.352, 0.042, 'SGD'),
  fxp('USDHKD=X', 'USD/HKD', 7.78, 0.008, 'HKD'),
];

/* --- sector ETFs ---------------------------------------------------------- */

export const SECTOR_ETFS: Instrument[] = [
  etf('XLK', 'Technology', 231, 0.22, 0.12, 'Technology'),
  etf('XLF', 'Financials', 49.2, 0.19, 0.08, 'Financials'),
  etf('XLE', 'Energy', 88.4, 0.27, 0.05, 'Energy'),
  etf('XLV', 'Health Care', 141, 0.16, 0.07, 'Health Care'),
  etf('XLY', 'Consumer Discretionary', 208, 0.21, 0.09, 'Consumer Discretionary'),
  etf('XLP', 'Consumer Staples', 79.6, 0.13, 0.05, 'Consumer Staples'),
  etf('XLI', 'Industrials', 137, 0.18, 0.08, 'Industrials'),
  etf('XLU', 'Utilities', 77.8, 0.16, 0.05, 'Utilities'),
  etf('XLB', 'Materials', 88.1, 0.19, 0.06, 'Materials'),
  etf('XLRE', 'Real Estate', 41.3, 0.19, 0.04, 'Real Estate'),
  etf('XLC', 'Communication Services', 98.2, 0.21, 0.10, 'Communication Services'),
];

/* --- industry and thematic ETFs ------------------------------------------ */

export const INDUSTRY_ETFS: Instrument[] = [
  etf('SMH', 'VanEck Semiconductor', 252, 0.33, 0.16, 'Technology', 'The AI capex cycle in a single ticker; the highest-beta major industry fund.'),
  etf('SOXX', 'iShares Semiconductor', 228, 0.33, 0.15, 'Technology'),
  etf('IBB', 'iShares Biotechnology', 138, 0.24, 0.05, 'Health Care'),
  etf('XBI', 'SPDR Biotech', 92.4, 0.32, 0.04, 'Health Care', 'Equal-weighted small-cap biotech — a levered bet on rate cuts and risk appetite.'),
  etf('KRE', 'SPDR Regional Banking', 62.8, 0.32, 0.05, 'Financials', 'Where funding stress shows up first when the curve inverts.'),
  etf('KBE', 'SPDR Bank', 56.4, 0.30, 0.05, 'Financials'),
  etf('ITB', 'iShares US Home Construction', 108, 0.29, 0.09, 'Consumer Discretionary'),
  etf('XHB', 'SPDR Homebuilders', 112, 0.27, 0.09, 'Consumer Discretionary'),
  etf('XME', 'SPDR Metals & Mining', 62.4, 0.31, 0.05, 'Materials'),
  etf('XOP', 'SPDR Oil & Gas E&P', 134, 0.36, 0.04, 'Energy'),
  etf('OIH', 'VanEck Oil Services', 288, 0.40, 0.02, 'Energy'),
  etf('JETS', 'US Global Jets', 24.6, 0.34, 0.04, 'Industrials'),
  etf('GDX', 'VanEck Gold Miners', 38.2, 0.34, 0.07, 'Materials', 'Operationally levered to the gold price — roughly 2x the metal\'s move.'),
  etf('GDXJ', 'VanEck Junior Gold Miners', 46.8, 0.40, 0.07, 'Materials'),
  etf('TAN', 'Invesco Solar', 32.4, 0.46, -0.05, 'Energy'),
  etf('ICLN', 'iShares Clean Energy', 12.4, 0.36, -0.04, 'Energy'),
  etf('LIT', 'Global X Lithium', 38.6, 0.38, -0.02, 'Materials'),
  etf('URA', 'Global X Uranium', 31.2, 0.42, 0.10, 'Energy'),
  etf('ARKK', 'ARK Innovation', 58.4, 0.48, 0.06, 'Technology', 'Long-duration growth concentrated and unhedged; the cleanest proxy for speculative appetite.'),
  etf('VNQ', 'Vanguard Real Estate', 92.6, 0.19, 0.04, 'Real Estate'),
  etf('IYR', 'iShares US Real Estate', 98.2, 0.19, 0.04, 'Real Estate'),
  etf('IGV', 'iShares Expanded Tech-Software', 98.6, 0.28, 0.12, 'Technology'),
  etf('HACK', 'Amplify Cybersecurity', 78.4, 0.26, 0.11, 'Technology'),
  etf('BOTZ', 'Global X Robotics & AI', 31.8, 0.30, 0.08, 'Technology'),
  etf('MOO', 'VanEck Agribusiness', 76.4, 0.20, 0.05, 'Materials'),
];

/* --- broad market, factor and international ETFs -------------------------- */

export const BENCHMARK_ETFS: Instrument[] = [
  etf('SPY', 'SPDR S&P 500 ETF', 583, 0.16, 0.08, undefined, 'The most liquid security in the world and the reference hedge for US equity risk.'),
  etf('VOO', 'Vanguard S&P 500 ETF', 536, 0.16, 0.08),
  etf('IVV', 'iShares Core S&P 500', 586, 0.16, 0.08),
  etf('VTI', 'Vanguard Total Stock Market', 291, 0.16, 0.08),
  etf('QQQ', 'Invesco QQQ Trust', 497, 0.21, 0.11),
  etf('QQQM', 'Invesco NASDAQ 100 ETF', 205, 0.21, 0.11),
  etf('IWM', 'iShares Russell 2000 ETF', 226, 0.23, 0.06),
  etf('DIA', 'SPDR Dow Jones ETF', 432, 0.14, 0.07),
  etf('RSP', 'Invesco S&P 500 Equal Weight', 173, 0.17, 0.07, undefined, 'Equal weight strips out mega-cap concentration — the spread against SPY is the breadth trade.'),
  etf('MDY', 'SPDR S&P MidCap 400', 578, 0.19, 0.07),
  etf('IJH', 'iShares Core S&P Mid-Cap', 63.4, 0.19, 0.07),
  etf('IJR', 'iShares Core S&P Small-Cap', 118, 0.22, 0.06),
  // Factor and style.
  etf('VTV', 'Vanguard Value', 172, 0.14, 0.07, undefined, 'Large-cap value; the long leg of the classic value-versus-growth spread.'),
  etf('VUG', 'Vanguard Growth', 412, 0.21, 0.11),
  etf('MTUM', 'iShares MSCI USA Momentum', 218, 0.19, 0.10),
  etf('QUAL', 'iShares MSCI USA Quality', 178, 0.16, 0.09),
  etf('USMV', 'iShares MSCI USA Min Vol', 89.4, 0.12, 0.06),
  etf('SPLV', 'Invesco S&P 500 Low Volatility', 71.2, 0.12, 0.06),
  etf('SCHD', 'Schwab US Dividend Equity', 28.4, 0.14, 0.07),
  etf('VIG', 'Vanguard Dividend Appreciation', 198, 0.14, 0.08),
  etf('DVY', 'iShares Select Dividend', 138, 0.14, 0.06),
  // International.
  etf('EFA', 'iShares MSCI EAFE', 79.8, 0.15, 0.05),
  etf('VEA', 'Vanguard Developed Markets', 51.2, 0.15, 0.05),
  etf('EEM', 'iShares MSCI Emerging Markets', 43.6, 0.19, 0.04),
  etf('VWO', 'Vanguard Emerging Markets', 44.2, 0.18, 0.04),
  etf('VGK', 'Vanguard European', 65.8, 0.17, 0.05),
  etf('VPL', 'Vanguard Pacific', 76.4, 0.16, 0.05),
  etf('FXI', 'iShares China Large-Cap', 29.4, 0.30, 0.02, undefined, 'The offshore China trade — dominated by policy announcements rather than fundamentals.'),
  etf('ASHR', 'Xtrackers CSI 300 China A', 27.8, 0.26, 0.02),
  etf('EWJ', 'iShares MSCI Japan', 70.2, 0.16, 0.07),
  etf('EWZ', 'iShares MSCI Brazil', 26.4, 0.30, 0.03),
  etf('EWG', 'iShares MSCI Germany', 31.8, 0.20, 0.06),
  etf('EWU', 'iShares MSCI United Kingdom', 36.2, 0.16, 0.05),
  etf('INDA', 'iShares MSCI India', 54.6, 0.16, 0.10),
  etf('EWY', 'iShares MSCI South Korea', 56.8, 0.24, 0.04),
  etf('EWT', 'iShares MSCI Taiwan', 54.2, 0.24, 0.10),
  etf('EWC', 'iShares MSCI Canada', 42.6, 0.15, 0.06),
  etf('EWA', 'iShares MSCI Australia', 24.8, 0.16, 0.05),
  // Commodity and crypto wrappers.
  etf('GLD', 'SPDR Gold Shares', 243, 0.15, 0.06),
  etf('IAU', 'iShares Gold Trust', 49.6, 0.15, 0.06),
  etf('SLV', 'iShares Silver Trust', 28.2, 0.28, 0.05),
  etf('USO', 'United States Oil Fund', 72.4, 0.34, 0.00, undefined, 'Holds front-month futures, so contango bleeds it over time. Not a spot proxy.'),
  etf('UNG', 'United States Natural Gas', 14.2, 0.70, -0.15, undefined, 'The most severe roll decay of any listed commodity fund.'),
  etf('DBC', 'Invesco DB Commodity Index', 22.4, 0.17, 0.02),
  etf('DBA', 'Invesco DB Agriculture', 25.6, 0.14, 0.02),
  etf('PDBC', 'Invesco Optimum Yield Commodity', 13.8, 0.16, 0.02),
  etf('IBIT', 'iShares Bitcoin Trust', 55.4, 0.52, 0.35, undefined, 'Spot bitcoin in a brokerage wrapper; the main institutional access route.'),
  etf('FBTC', 'Fidelity Wise Origin Bitcoin', 85.2, 0.52, 0.35),
  etf('GBTC', 'Grayscale Bitcoin Trust', 82.6, 0.52, 0.33),
  etf('ETHE', 'Grayscale Ethereum Trust', 26.4, 0.63, 0.28),
  etf('BITO', 'ProShares Bitcoin Strategy', 22.8, 0.54, 0.28),
  // Volatility and leveraged — the tactical toolkit.
  etf('VXX', 'iPath Series B VIX Short-Term', 48.2, 0.75, -0.55, undefined, 'Structural decay from rolling up a contango curve. A hedge, never an investment.'),
  etf('UVXY', 'ProShares Ultra VIX Short-Term', 22.4, 1.40, -0.80, undefined, '1.5x levered VIX futures. Decays toward zero by construction.'),
  etf('SVXY', 'ProShares Short VIX Short-Term', 48.6, 0.60, 0.15),
  etf('TQQQ', 'ProShares UltraPro QQQ', 78.4, 0.63, 0.20, undefined, '3x daily Nasdaq. Path-dependent — volatility drag makes it a poor long-term hold.'),
  etf('SQQQ', 'ProShares UltraPro Short QQQ', 8.42, 0.63, -0.45),
  etf('SPXL', 'Direxion Daily S&P 500 Bull 3X', 158, 0.48, 0.16),
  etf('SPXS', 'Direxion Daily S&P 500 Bear 3X', 6.82, 0.48, -0.38),
  etf('SOXL', 'Direxion Daily Semiconductor Bull 3X', 32.6, 0.99, 0.22),
  etf('SOXS', 'Direxion Daily Semiconductor Bear 3X', 9.24, 0.99, -0.55),
  etf('TNA', 'Direxion Daily Small Cap Bull 3X', 42.8, 0.69, 0.10),
  etf('TZA', 'Direxion Daily Small Cap Bear 3X', 12.4, 0.69, -0.42),
  etf('UPRO', 'ProShares UltraPro S&P 500', 92.6, 0.48, 0.16),
  etf('LABU', 'Direxion Daily Biotech Bull 3X', 78.4, 0.96, -0.05),
];

/* --- equities ------------------------------------------------------------
   The curated list is the S&P 100 plus the names that actually carry retail
   and day-trading volume. Anything outside it still resolves through the
   dynamic vendor lookup in ./resolve.ts.
   ------------------------------------------------------------------------- */

export const EQUITIES: Instrument[] = [
  // Mega-cap technology and communication.
  eq('AAPL', 'Apple Inc.', 234, 0.24, 0.12, 'Technology', 'The largest consumer hardware franchise, increasingly a services annuity.'),
  eq('MSFT', 'Microsoft Corp.', 428, 0.22, 0.13, 'Technology', 'Enterprise software and the leading commercial AI distribution channel.'),
  eq('NVDA', 'NVIDIA Corp.', 138, 0.48, 0.25, 'Technology', 'The accelerated-computing monopoly; the single highest-beta expression of the AI capex cycle.'),
  eq('GOOGL', 'Alphabet Inc.', 176, 0.27, 0.11, 'Communication Services', 'Search advertising cash machine with an unpriced cloud and AI optionality.'),
  eq('AMZN', 'Amazon.com Inc.', 224, 0.29, 0.13, 'Consumer Discretionary', 'Retail logistics at scale funding the highest-margin cloud business in the market.'),
  eq('META', 'Meta Platforms Inc.', 592, 0.34, 0.14, 'Communication Services', 'Attention monetisation at 3bn users, with a large discretionary capex overhang.'),
  eq('TSLA', 'Tesla Inc.', 352, 0.58, 0.15, 'Consumer Discretionary', 'Auto manufacturer valued on autonomy and energy optionality; the retail sentiment bellwether.'),
  eq('AVGO', 'Broadcom Inc.', 168, 0.35, 0.16, 'Technology', 'Custom silicon and infrastructure software; the second-order AI beneficiary.'),
  eq('NFLX', 'Netflix Inc.', 892, 0.32, 0.15, 'Communication Services'),
  eq('DIS', 'Walt Disney Co.', 112, 0.27, 0.05, 'Communication Services'),
  eq('CMCSA', 'Comcast Corp.', 38.4, 0.22, 0.02, 'Communication Services'),
  eq('T', 'AT&T Inc.', 22.8, 0.20, 0.04, 'Communication Services'),
  eq('VZ', 'Verizon Communications', 40.2, 0.18, 0.03, 'Communication Services'),
  eq('TMUS', 'T-Mobile US Inc.', 228, 0.20, 0.10, 'Communication Services'),
  // Semiconductors and hardware.
  eq('AMD', 'Advanced Micro Devices', 128, 0.48, 0.14, 'Technology', 'The credible second source in accelerated compute; high beta to AI sentiment.'),
  eq('INTC', 'Intel Corp.', 20.4, 0.45, -0.05, 'Technology', 'A turnaround story with foundry execution risk and negative free cash flow.'),
  eq('MU', 'Micron Technology', 102, 0.45, 0.10, 'Technology', 'The memory cycle — the most violently cyclical large-cap in semiconductors.'),
  eq('QCOM', 'Qualcomm Inc.', 158, 0.32, 0.09, 'Technology'),
  eq('TXN', 'Texas Instruments', 192, 0.26, 0.07, 'Technology'),
  eq('AMAT', 'Applied Materials', 168, 0.38, 0.11, 'Technology'),
  eq('LRCX', 'Lam Research Corp.', 74.2, 0.40, 0.11, 'Technology'),
  eq('KLAC', 'KLA Corp.', 636, 0.36, 0.13, 'Technology'),
  eq('ADI', 'Analog Devices', 212, 0.28, 0.08, 'Technology'),
  eq('NXPI', 'NXP Semiconductors', 212, 0.33, 0.07, 'Technology'),
  eq('MRVL', 'Marvell Technology', 112, 0.48, 0.13, 'Technology'),
  eq('ARM', 'Arm Holdings plc', 132, 0.55, 0.14, 'Technology'),
  eq('TSM', 'Taiwan Semiconductor ADR', 196, 0.34, 0.16, 'Technology', 'The sole credible manufacturer of leading-edge logic; carries irreducible geopolitical risk.'),
  eq('ASML', 'ASML Holding ADR', 688, 0.36, 0.12, 'Technology', 'EUV lithography monopoly — a genuine single point of failure for the entire industry.'),
  eq('SMCI', 'Super Micro Computer', 34.2, 0.88, 0.10, 'Technology'),
  eq('DELL', 'Dell Technologies', 118, 0.40, 0.10, 'Technology'),
  eq('HPQ', 'HP Inc.', 34.6, 0.26, 0.03, 'Technology'),
  eq('WDC', 'Western Digital Corp.', 62.4, 0.46, 0.06, 'Technology'),
  eq('STX', 'Seagate Technology', 98.4, 0.42, 0.07, 'Technology'),
  // Software and internet.
  eq('CRM', 'Salesforce Inc.', 336, 0.30, 0.10, 'Technology'),
  eq('ORCL', 'Oracle Corp.', 178, 0.29, 0.12, 'Technology'),
  eq('ADBE', 'Adobe Inc.', 468, 0.30, 0.08, 'Technology'),
  eq('NOW', 'ServiceNow Inc.', 1024, 0.30, 0.14, 'Technology'),
  eq('INTU', 'Intuit Inc.', 636, 0.28, 0.11, 'Technology'),
  eq('IBM', 'International Business Machines', 224, 0.22, 0.06, 'Technology'),
  eq('ACN', 'Accenture plc', 358, 0.22, 0.08, 'Technology'),
  eq('CSCO', 'Cisco Systems', 58.6, 0.20, 0.05, 'Technology'),
  eq('PANW', 'Palo Alto Networks', 188, 0.36, 0.13, 'Technology'),
  eq('CRWD', 'CrowdStrike Holdings', 348, 0.44, 0.15, 'Technology'),
  eq('SNOW', 'Snowflake Inc.', 168, 0.50, 0.06, 'Technology'),
  eq('DDOG', 'Datadog Inc.', 144, 0.46, 0.11, 'Technology'),
  eq('MDB', 'MongoDB Inc.', 268, 0.52, 0.06, 'Technology'),
  eq('NET', 'Cloudflare Inc.', 108, 0.52, 0.10, 'Technology'),
  eq('SHOP', 'Shopify Inc.', 108, 0.48, 0.12, 'Technology'),
  eq('SQ', 'Block Inc.', 88.4, 0.52, 0.08, 'Technology'),
  eq('PYPL', 'PayPal Holdings', 86.2, 0.36, 0.05, 'Technology'),
  eq('UBER', 'Uber Technologies', 68.4, 0.35, 0.12, 'Industrials'),
  eq('ABNB', 'Airbnb Inc.', 134, 0.36, 0.08, 'Consumer Discretionary'),
  eq('PLTR', 'Palantir Technologies', 74.2, 0.62, 0.20, 'Technology', 'Government and commercial AI deployment; valuation carries extreme growth expectations.'),
  eq('SPOT', 'Spotify Technology', 468, 0.40, 0.12, 'Communication Services'),
  eq('RBLX', 'Roblox Corp.', 58.4, 0.52, 0.06, 'Communication Services'),
  eq('COIN', 'Coinbase Global', 296, 0.72, 0.15, 'Financials', 'The listed proxy for crypto trading volumes; beta to BTC well above 1.'),
  eq('MSTR', 'MicroStrategy Inc.', 382, 1.05, 0.20, 'Technology', 'A leveraged bitcoin holding vehicle wrapped in a software company.'),
  eq('HOOD', 'Robinhood Markets', 38.6, 0.62, 0.12, 'Financials'),
  // Financials.
  eq('JPM', 'JPMorgan Chase & Co.', 242, 0.21, 0.09, 'Financials', 'The fortress balance sheet; a direct read on US credit and capital markets activity.'),
  eq('BAC', 'Bank of America Corp.', 46.2, 0.25, 0.08, 'Financials'),
  eq('WFC', 'Wells Fargo & Co.', 74.8, 0.26, 0.08, 'Financials'),
  eq('C', 'Citigroup Inc.', 71.4, 0.27, 0.07, 'Financials'),
  eq('GS', 'Goldman Sachs Group', 578, 0.25, 0.10, 'Financials'),
  eq('MS', 'Morgan Stanley', 128, 0.25, 0.09, 'Financials'),
  eq('SCHW', 'Charles Schwab Corp.', 74.2, 0.28, 0.07, 'Financials'),
  eq('BLK', 'BlackRock Inc.', 1024, 0.22, 0.09, 'Financials'),
  eq('BX', 'Blackstone Inc.', 178, 0.32, 0.10, 'Financials'),
  eq('KKR', 'KKR & Co. Inc.', 148, 0.34, 0.11, 'Financials'),
  eq('BRK-B', 'Berkshire Hathaway Inc.', 456, 0.15, 0.09, 'Financials'),
  eq('V', 'Visa Inc.', 312, 0.18, 0.11, 'Financials', 'A toll booth on global consumption with structurally high incremental margins.'),
  eq('MA', 'Mastercard Inc.', 522, 0.19, 0.11, 'Financials'),
  eq('AXP', 'American Express Co.', 298, 0.24, 0.10, 'Financials'),
  eq('COF', 'Capital One Financial', 178, 0.30, 0.07, 'Financials'),
  eq('SPGI', 'S&P Global Inc.', 512, 0.20, 0.10, 'Financials'),
  eq('CME', 'CME Group Inc.', 232, 0.16, 0.07, 'Financials'),
  eq('ICE', 'Intercontinental Exchange', 152, 0.18, 0.08, 'Financials'),
  eq('PGR', 'Progressive Corp.', 242, 0.22, 0.12, 'Financials'),
  eq('CB', 'Chubb Ltd.', 282, 0.17, 0.08, 'Financials'),
  eq('AIG', 'American International Group', 74.6, 0.22, 0.06, 'Financials'),
  eq('MET', 'MetLife Inc.', 82.4, 0.23, 0.06, 'Financials'),
  // Health care.
  eq('LLY', 'Eli Lilly and Co.', 782, 0.30, 0.16, 'Health Care', 'GLP-1 franchise driving the largest earnings revision cycle in large-cap pharma.'),
  eq('UNH', 'UnitedHealth Group Inc.', 512, 0.22, 0.09, 'Health Care'),
  eq('JNJ', 'Johnson & Johnson', 146, 0.15, 0.05, 'Health Care'),
  eq('ABBV', 'AbbVie Inc.', 176, 0.20, 0.08, 'Health Care'),
  eq('MRK', 'Merck & Co. Inc.', 99, 0.20, 0.06, 'Health Care'),
  eq('PFE', 'Pfizer Inc.', 26.2, 0.24, -0.02, 'Health Care'),
  eq('TMO', 'Thermo Fisher Scientific', 528, 0.22, 0.07, 'Health Care'),
  eq('ABT', 'Abbott Laboratories', 114, 0.18, 0.07, 'Health Care'),
  eq('DHR', 'Danaher Corp.', 232, 0.24, 0.06, 'Health Care'),
  eq('AMGN', 'Amgen Inc.', 282, 0.21, 0.06, 'Health Care'),
  eq('GILD', 'Gilead Sciences', 92.4, 0.22, 0.05, 'Health Care'),
  eq('BMY', 'Bristol-Myers Squibb', 56.8, 0.23, 0.02, 'Health Care'),
  eq('VRTX', 'Vertex Pharmaceuticals', 452, 0.26, 0.10, 'Health Care'),
  eq('REGN', 'Regeneron Pharmaceuticals', 728, 0.28, 0.07, 'Health Care'),
  eq('ISRG', 'Intuitive Surgical Inc.', 528, 0.26, 0.13, 'Health Care'),
  eq('MDT', 'Medtronic plc', 86.2, 0.19, 0.04, 'Health Care'),
  eq('CVS', 'CVS Health Corp.', 56.4, 0.28, 0.00, 'Health Care'),
  eq('CI', 'Cigna Group', 288, 0.24, 0.06, 'Health Care'),
  eq('ELV', 'Elevance Health Inc.', 392, 0.24, 0.07, 'Health Care'),
  eq('MRNA', 'Moderna Inc.', 42.6, 0.62, -0.15, 'Health Care'),
  // Consumer.
  eq('WMT', 'Walmart Inc.', 92, 0.18, 0.10, 'Consumer Staples'),
  eq('COST', 'Costco Wholesale Corp.', 936, 0.20, 0.12, 'Consumer Staples'),
  eq('TGT', 'Target Corp.', 132, 0.28, 0.03, 'Consumer Staples'),
  eq('PG', 'Procter & Gamble Co.', 168, 0.14, 0.06, 'Consumer Staples'),
  eq('KO', 'Coca-Cola Co.', 62, 0.14, 0.05, 'Consumer Staples'),
  eq('PEP', 'PepsiCo Inc.', 156, 0.15, 0.05, 'Consumer Staples'),
  eq('PM', 'Philip Morris International', 128, 0.18, 0.08, 'Consumer Staples'),
  eq('MO', 'Altria Group Inc.', 52.4, 0.17, 0.05, 'Consumer Staples'),
  eq('MDLZ', 'Mondelez International', 61.2, 0.16, 0.04, 'Consumer Staples'),
  eq('CL', 'Colgate-Palmolive Co.', 91.4, 0.15, 0.05, 'Consumer Staples'),
  eq('KMB', 'Kimberly-Clark Corp.', 132, 0.15, 0.04, 'Consumer Staples'),
  eq('GIS', 'General Mills Inc.', 64.2, 0.16, 0.03, 'Consumer Staples'),
  eq('HD', 'Home Depot Inc.', 412, 0.21, 0.08, 'Consumer Discretionary'),
  eq('LOW', 'Lowe\'s Companies Inc.', 262, 0.22, 0.08, 'Consumer Discretionary'),
  eq('MCD', 'McDonald\'s Corp.', 292, 0.15, 0.08, 'Consumer Discretionary'),
  eq('SBUX', 'Starbucks Corp.', 98.4, 0.24, 0.05, 'Consumer Discretionary'),
  eq('NKE', 'NIKE Inc.', 76.8, 0.26, 0.02, 'Consumer Discretionary'),
  eq('LULU', 'Lululemon Athletica', 338, 0.38, 0.06, 'Consumer Discretionary'),
  eq('TJX', 'TJX Companies Inc.', 122, 0.19, 0.10, 'Consumer Discretionary'),
  eq('BKNG', 'Booking Holdings Inc.', 4980, 0.26, 0.12, 'Consumer Discretionary'),
  eq('MAR', 'Marriott International', 282, 0.25, 0.09, 'Consumer Discretionary'),
  eq('GM', 'General Motors Co.', 53.2, 0.30, 0.04, 'Consumer Discretionary'),
  eq('F', 'Ford Motor Co.', 10.4, 0.32, 0.00, 'Consumer Discretionary'),
  eq('RIVN', 'Rivian Automotive', 12.8, 0.72, -0.10, 'Consumer Discretionary'),
  eq('CMG', 'Chipotle Mexican Grill', 58.4, 0.28, 0.10, 'Consumer Discretionary'),
  eq('DASH', 'DoorDash Inc.', 168, 0.42, 0.10, 'Consumer Discretionary'),
  // Industrials, energy, materials, utilities, real estate.
  eq('CAT', 'Caterpillar Inc.', 392, 0.24, 0.09, 'Industrials'),
  eq('DE', 'Deere & Co.', 428, 0.24, 0.08, 'Industrials'),
  eq('BA', 'Boeing Co.', 178, 0.38, 0.02, 'Industrials', 'Duopoly asset with severe execution and balance-sheet impairment.'),
  eq('GE', 'GE Aerospace', 178, 0.26, 0.12, 'Industrials'),
  eq('HON', 'Honeywell International', 228, 0.19, 0.06, 'Industrials'),
  eq('RTX', 'RTX Corp.', 118, 0.20, 0.07, 'Industrials'),
  eq('LMT', 'Lockheed Martin Corp.', 528, 0.18, 0.06, 'Industrials'),
  eq('NOC', 'Northrop Grumman Corp.', 486, 0.19, 0.06, 'Industrials'),
  eq('UNP', 'Union Pacific Corp.', 238, 0.19, 0.07, 'Industrials'),
  eq('UPS', 'United Parcel Service', 132, 0.23, 0.02, 'Industrials'),
  eq('FDX', 'FedEx Corp.', 282, 0.26, 0.05, 'Industrials'),
  eq('MMM', '3M Co.', 128, 0.24, 0.03, 'Industrials'),
  eq('ETN', 'Eaton Corp. plc', 332, 0.26, 0.13, 'Industrials', 'Electrical infrastructure — the unglamorous, physical side of the data-centre build-out.'),
  eq('XOM', 'Exxon Mobil Corp.', 108, 0.25, 0.06, 'Energy', 'Integrated major; the cleanest large-cap hedge against an energy supply shock.'),
  eq('CVX', 'Chevron Corp.', 158, 0.24, 0.05, 'Energy'),
  eq('COP', 'ConocoPhillips', 102, 0.28, 0.05, 'Energy'),
  eq('SLB', 'Schlumberger N.V.', 38.6, 0.32, 0.03, 'Energy'),
  eq('EOG', 'EOG Resources Inc.', 124, 0.29, 0.05, 'Energy'),
  eq('OXY', 'Occidental Petroleum', 48.2, 0.33, 0.03, 'Energy'),
  eq('MPC', 'Marathon Petroleum Corp.', 152, 0.31, 0.07, 'Energy'),
  eq('PSX', 'Phillips 66', 118, 0.29, 0.05, 'Energy'),
  eq('LIN', 'Linde plc', 428, 0.18, 0.09, 'Materials'),
  eq('FCX', 'Freeport-McMoRan Inc.', 41.2, 0.34, 0.05, 'Materials'),
  eq('NEM', 'Newmont Corp.', 42.8, 0.34, 0.05, 'Materials'),
  eq('NUE', 'Nucor Corp.', 122, 0.30, 0.06, 'Materials'),
  eq('SHW', 'Sherwin-Williams Co.', 348, 0.22, 0.08, 'Materials'),
  eq('APD', 'Air Products & Chemicals', 312, 0.22, 0.05, 'Materials'),
  eq('NEE', 'NextEra Energy Inc.', 72.4, 0.22, 0.06, 'Utilities'),
  eq('DUK', 'Duke Energy Corp.', 112, 0.16, 0.04, 'Utilities'),
  eq('SO', 'Southern Co.', 86.4, 0.16, 0.05, 'Utilities'),
  eq('VST', 'Vistra Corp.', 138, 0.46, 0.18, 'Utilities', 'Independent power with data-centre demand optionality; the highest-beta utility in the index.'),
  eq('CEG', 'Constellation Energy Corp.', 232, 0.44, 0.17, 'Utilities'),
  eq('AMT', 'American Tower Corp.', 192, 0.21, 0.03, 'Real Estate'),
  eq('PLD', 'Prologis Inc.', 108, 0.23, 0.04, 'Real Estate'),
  eq('EQIX', 'Equinix Inc.', 928, 0.22, 0.07, 'Real Estate'),
  eq('SPG', 'Simon Property Group', 178, 0.25, 0.06, 'Real Estate'),
  eq('O', 'Realty Income Corp.', 56.4, 0.19, 0.03, 'Real Estate'),
];

/* --- aggregation and lookup ---------------------------------------------- */

export const ALL_INSTRUMENTS: Instrument[] = [
  ...INDEXES, ...INTL_INDEXES, ...RATES, ...BONDS, ...CRYPTO, ...COMMODITIES,
  ...FX, ...SECTOR_ETFS, ...INDUSTRY_ETFS, ...BENCHMARK_ETFS, ...EQUITIES,
];

/** Curated instruments only. `ALL_INSTRUMENTS` grows as dynamic lookups
 *  register, so anything that means "the list we shipped" reads this. */
export const CURATED_COUNT = ALL_INSTRUMENTS.length;

const BY_SYMBOL = new Map(ALL_INSTRUMENTS.map((i) => [i.symbol.toUpperCase(), i]));

/** Add an instrument discovered by a vendor lookup so subsequent resolutions
 *  are synchronous. Curated entries always win — a vendor payload never
 *  overwrites a hand-calibrated instrument. */
export function registerInstrument(inst: Instrument): Instrument {
  const key = inst.symbol.toUpperCase();
  const existing = BY_SYMBOL.get(key);
  if (existing) return existing;
  BY_SYMBOL.set(key, inst);
  ALL_INSTRUMENTS.push(inst);
  return inst;
}

/** True when the symbol is one we shipped calibration for. */
export const isCurated = (symbol: string): boolean => {
  const i = BY_SYMBOL.get(symbol.trim().toUpperCase());
  return Boolean(i && !i.dynamic);
};

const ALIASES: Record<string, string> = {
  SP500: 'SPX', 'S&P': 'SPX', SPX500: 'SPX', ES: 'SPX', GSPC: 'SPX',
  NASDAQ: 'NDX', NQ: 'NDX', DOW: 'DJI', YM: 'DJI',
  RUSSELL: 'RUT', RTY: 'RUT',
  BITCOIN: 'BTC-USD', ETHEREUM: 'ETH-USD', XBT: 'BTC-USD',
  GOLD: 'GC=F', XAUUSD: 'GC=F', XAU: 'GC=F', SILVER: 'SI=F', XAGUSD: 'SI=F', XAG: 'SI=F',
  OIL: 'CL=F', WTI: 'CL=F', CRUDE: 'CL=F', BRENT: 'BZ=F',
  GAS: 'NG=F', NATGAS: 'NG=F', COPPER: 'HG=F', PLATINUM: 'PL=F', PALLADIUM: 'PA=F',
  WHEAT: 'ZW=F', CORN: 'ZC=F', SOYBEANS: 'ZS=F', COFFEE: 'KC=F', SUGAR: 'SB=F', COCOA: 'CC=F',
  DOLLAR: 'DXY', USD: 'DXY', DXY: 'DXY',
  EUR: 'EURUSD=X', JPY: 'USDJPY=X', GBP: 'GBPUSD=X', CHF: 'USDCHF=X',
  CAD: 'USDCAD=X', AUD: 'AUDUSD=X', NZD: 'NZDUSD=X',
  US10Y: 'TNX', '10Y': 'TNX', US30Y: 'TYX', '30Y': 'TYX', US5Y: 'FVX', '5Y': 'FVX',
  '3M': 'IRX', TBILL: 'IRX',
  BONDS: 'AGG', TREASURIES: 'GOVT', TREASURY: 'GOVT', JUNK: 'HYG', HIGHYIELD: 'HYG',
  MUNIS: 'MUB', TIPS: 'TIP', CREDIT: 'LQD',
  GOOG: 'GOOGL', BRK: 'BRK-B', BRKB: 'BRK-B', 'BRK.B': 'BRK-B', FB: 'META',
  NIKKEI: 'N225', FOOTSIE: 'FTSE', HANGSENG: 'HSI',
};

/** Resolve a user-typed ticker against the curated universe. Handles crypto
 *  shorthand ("BTC" -> "BTC-USD") and the common aliases, and is
 *  case-insensitive. Returns undefined for anything not curated — callers
 *  that want open-ended lookup use `resolveAny` from ./resolve.ts. */
export function resolveInstrument(raw: string): Instrument | undefined {
  if (!raw) return undefined;
  const s = raw.trim().toUpperCase();

  const direct = BY_SYMBOL.get(s);
  if (direct) return direct;

  const asCrypto = BY_SYMBOL.get(`${s}-USD`);
  if (asCrypto) return asCrypto;

  // "BTCUSD" / "BTCUSDT" written without the separator.
  const stripped = s.replace(/USDT?$/, '');
  if (stripped !== s) {
    const viaPair = BY_SYMBOL.get(`${stripped}-USD`);
    if (viaPair) return viaPair;
  }

  // "EURUSD" typed without Yahoo's =X suffix.
  if (/^[A-Z]{6}$/.test(s)) {
    const viaFx = BY_SYMBOL.get(`${s}=X`);
    if (viaFx) return viaFx;
  }

  const alias = ALIASES[s];
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
    // A dynamic entry is still a real instrument, but a curated one carries
    // a description and hand-set calibration, so it sorts first on a tie.
    if (score > 0 && inst.dynamic) score -= 25;
    return { inst, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((s) => s.inst);
}

/** Instruments grouped by asset class, for the screener's class filter. */
export const ASSET_CLASS_LABELS: Record<string, string> = {
  equity: 'Equities', etf: 'ETFs', bond: 'Bonds', index: 'Indexes',
  crypto: 'Crypto', commodity: 'Commodities', fx: 'FX', rate: 'Rates',
};

/** The default watch sets each home-page panel renders. */
export const HOME_PANELS = {
  indexes: ['SPX', 'NDX', 'DJI', 'RUT', 'VIX'],
  world: ['FTSE', 'DAX', 'N225', 'HSI', 'SENSEX'],
  crypto: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD'],
  commodities: ['GC=F', 'SI=F', 'CL=F', 'NG=F', 'HG=F'],
  fx: ['DXY', 'EURUSD=X', 'USDJPY=X', 'GBPUSD=X'],
  rates: ['IRX', 'FVX', 'TNX', 'TYX'],
  bonds: ['SHY', 'IEF', 'TLT', 'LQD', 'HYG'],
  sectors: SECTOR_ETFS.map((s) => s.symbol),
} as const;
