/* ===========================================================================
   Live upstream adapters.

   Each adapter is a thin, well-behaved client for one venue. They are written
   to run correctly wherever the network permits them; in a restricted
   environment they fail fast and the registry falls through to the simulator
   with the provenance flag flipped. No adapter ever invents a number.
   ========================================================================= */

import type { Bar, Quote, Timeframe, AssetClass } from '../types';
import type { Instrument } from '../market/universe';
import { fetchJson, ProviderError } from './http';
import { recordSuccess, recordFailure } from './health';

/* ---------------------------------------------------------------------------
   YAHOO FINANCE — broad coverage, no key. Best single source for equities,
   indexes, commodities, FX and rates.
   ------------------------------------------------------------------------- */

const YAHOO_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '1h', '1d': '1d', '1w': '1wk',
};

const YAHOO_RANGE: Record<Timeframe, string> = {
  '1m': '5d', '5m': '1mo', '15m': '1mo', '1h': '3mo', '4h': '1y', '1d': '5y', '1w': '10y',
};

interface YahooChartResponse {
  chart: {
    result?: {
      meta: {
        regularMarketPrice: number;
        chartPreviousClose: number;
        previousClose?: number;
        currency: string;
        symbol: string;
        longName?: string;
        shortName?: string;
        regularMarketVolume?: number;
      };
      timestamp?: number[];
      indicators: {
        quote: {
          open: (number | null)[];
          high: (number | null)[];
          low: (number | null)[];
          close: (number | null)[];
          volume: (number | null)[];
        }[];
      };
    }[];
    error?: { code: string; description: string } | null;
  };
}

export async function yahooBars(inst: Instrument, tf: Timeframe, limit: number): Promise<Bar[]> {
  const symbol = inst.yahooSymbol ?? inst.symbol;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=${YAHOO_INTERVAL[tf]}&range=${YAHOO_RANGE[tf]}&includePrePost=false`;

  const t0 = Date.now();
  try {
    const json = await fetchJson<YahooChartResponse>(url, { provider: 'yahoo', timeoutMs: 9000 });
    if (json.chart.error) {
      throw new ProviderError(json.chart.error.description, 'yahoo');
    }
    const result = json.chart.result?.[0];
    if (!result?.timestamp?.length) throw new ProviderError('empty chart payload', 'yahoo');

    const q = result.indicators.quote[0];
    const bars: Bar[] = [];
    for (let i = 0; i < result.timestamp.length; i++) {
      const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
      // Yahoo emits nulls for halted/illiquid intervals; drop rather than
      // interpolate — a fabricated bar corrupts every indicator downstream.
      if (o == null || h == null || l == null || c == null) continue;
      bars.push({ t: result.timestamp[i] * 1000, o, h, l, c, v: q.volume[i] ?? 0 });
    }

    recordSuccess('yahoo', Date.now() - t0);

    // 4h is not a native Yahoo interval; fold 1h bars into it.
    if (tf === '4h') return foldBars(bars, 4).slice(-limit);
    return bars.slice(-limit);
  } catch (err) {
    recordFailure('yahoo', (err as Error).message);
    throw err;
  }
}

export async function yahooQuote(inst: Instrument): Promise<Quote> {
  const symbol = inst.yahooSymbol ?? inst.symbol;
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&range=5d`;

  const t0 = Date.now();
  try {
    const json = await fetchJson<YahooChartResponse>(url, { provider: 'yahoo', timeoutMs: 8000 });
    const result = json.chart.result?.[0];
    if (!result) throw new ProviderError('empty quote payload', 'yahoo');

    const m = result.meta;
    const q = result.indicators.quote[0];
    const lastIdx = (result.timestamp?.length ?? 1) - 1;
    const prevClose = m.previousClose ?? m.chartPreviousClose;
    const price = m.regularMarketPrice;
    const change = price - prevClose;

    recordSuccess('yahoo', Date.now() - t0);
    return {
      symbol: inst.symbol,
      name: m.longName ?? m.shortName ?? inst.name,
      assetClass: inst.assetClass,
      price,
      change,
      changePct: prevClose !== 0 ? (change / prevClose) * 100 : 0,
      open: q.open[lastIdx] ?? price,
      high: q.high[lastIdx] ?? price,
      low: q.low[lastIdx] ?? price,
      prevClose,
      volume: m.regularMarketVolume ?? q.volume[lastIdx] ?? 0,
      currency: m.currency ?? inst.currency,
      provenance: 'live',
      source: 'yahoo',
      asOf: Date.now(),
    };
  } catch (err) {
    recordFailure('yahoo', (err as Error).message);
    throw err;
  }
}

/* ---------------------------------------------------------------------------
   BINANCE — the deepest free crypto OHLCV source, no key required.
   ------------------------------------------------------------------------- */

const BINANCE_INTERVAL: Record<Timeframe, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d', '1w': '1w',
};

type BinanceKline = [number, string, string, string, string, string, number, ...unknown[]];

export async function binanceBars(inst: Instrument, tf: Timeframe, limit: number): Promise<Bar[]> {
  if (!inst.binanceSymbol) throw new ProviderError(`${inst.symbol} has no Binance mapping`, 'binance');
  const url =
    `https://data-api.binance.vision/api/v3/klines?symbol=${inst.binanceSymbol}` +
    `&interval=${BINANCE_INTERVAL[tf]}&limit=${Math.min(1000, limit)}`;

  const t0 = Date.now();
  try {
    const rows = await fetchJson<BinanceKline[]>(url, { provider: 'binance', timeoutMs: 8000 });
    recordSuccess('binance', Date.now() - t0);
    return rows.map((k) => ({
      t: k[0],
      o: parseFloat(k[1]),
      h: parseFloat(k[2]),
      l: parseFloat(k[3]),
      c: parseFloat(k[4]),
      v: parseFloat(k[5]),
    }));
  } catch (err) {
    recordFailure('binance', (err as Error).message);
    throw err;
  }
}

interface Binance24h {
  lastPrice: string; priceChange: string; priceChangePercent: string;
  openPrice: string; highPrice: string; lowPrice: string;
  prevClosePrice: string; volume: string; quoteVolume: string;
}

export async function binanceQuote(inst: Instrument): Promise<Quote> {
  if (!inst.binanceSymbol) throw new ProviderError(`${inst.symbol} has no Binance mapping`, 'binance');
  const url = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${inst.binanceSymbol}`;
  const t0 = Date.now();
  try {
    const d = await fetchJson<Binance24h>(url, { provider: 'binance', timeoutMs: 6000 });
    recordSuccess('binance', Date.now() - t0);
    const price = parseFloat(d.lastPrice);
    return {
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      price,
      change: parseFloat(d.priceChange),
      changePct: parseFloat(d.priceChangePercent),
      open: parseFloat(d.openPrice),
      high: parseFloat(d.highPrice),
      low: parseFloat(d.lowPrice),
      prevClose: parseFloat(d.prevClosePrice) || price - parseFloat(d.priceChange),
      volume: parseFloat(d.volume),
      currency: 'USD',
      provenance: 'live',
      source: 'binance',
      asOf: Date.now(),
    };
  } catch (err) {
    recordFailure('binance', (err as Error).message);
    throw err;
  }
}

/* ---------------------------------------------------------------------------
   COINGECKO — breadth of crypto coverage and market-cap data.
   ------------------------------------------------------------------------- */

interface GeckoMarketChart { prices: [number, number][]; total_volumes: [number, number][]; }

export async function coingeckoBars(inst: Instrument, days: number): Promise<Bar[]> {
  if (!inst.coingeckoId) throw new ProviderError(`${inst.symbol} has no CoinGecko id`, 'coingecko');
  const key = process.env.COINGECKO_API_KEY;
  const url =
    `https://api.coingecko.com/api/v3/coins/${inst.coingeckoId}/market_chart` +
    `?vs_currency=usd&days=${days}&interval=daily${key ? `&x_cg_demo_api_key=${key}` : ''}`;

  const t0 = Date.now();
  try {
    const d = await fetchJson<GeckoMarketChart>(url, { provider: 'coingecko', timeoutMs: 9000 });
    recordSuccess('coingecko', Date.now() - t0);
    // CoinGecko's free tier returns closes only. Synthesising a full OHLC from
    // a close-only series would fabricate highs and lows, so the range is set
    // to the close and consumers see honest (if uninformative) bars.
    return d.prices.map(([t, p], i) => ({
      t, o: p, h: p, l: p, c: p, v: d.total_volumes[i]?.[1] ?? 0,
    }));
  } catch (err) {
    recordFailure('coingecko', (err as Error).message);
    throw err;
  }
}

/* ---------------------------------------------------------------------------
   FINNHUB — quotes, fundamentals, earnings, insider transactions.
   ------------------------------------------------------------------------- */

export const finnhubConfigured = (): boolean => Boolean(process.env.FINNHUB_API_KEY);

interface FinnhubQuote { c: number; d: number; dp: number; h: number; l: number; o: number; pc: number; t: number; }

export async function finnhubQuote(inst: Instrument): Promise<Quote> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');
  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(inst.symbol)}&token=${key}`;
  const t0 = Date.now();
  try {
    const d = await fetchJson<FinnhubQuote>(url, { provider: 'finnhub', timeoutMs: 7000 });
    if (!d.c) throw new ProviderError('no price in payload', 'finnhub');
    recordSuccess('finnhub', Date.now() - t0);
    return {
      symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
      price: d.c, change: d.d, changePct: d.dp,
      open: d.o, high: d.h, low: d.l, prevClose: d.pc,
      volume: 0, currency: inst.currency,
      provenance: 'live', source: 'finnhub', asOf: (d.t || Date.now() / 1000) * 1000,
    };
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}

export interface FinnhubInsiderRow {
  name: string; share: number; change: number; filingDate: string;
  transactionDate: string; transactionCode: string; transactionPrice: number;
}

export async function finnhubInsiders(symbol: string): Promise<FinnhubInsiderRow[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');
  const from = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/stock/insider-transactions?symbol=${symbol}&from=${from}&token=${key}`;
  const t0 = Date.now();
  try {
    const d = await fetchJson<{ data: FinnhubInsiderRow[] }>(url, { provider: 'finnhub', timeoutMs: 9000 });
    recordSuccess('finnhub', Date.now() - t0);
    return d.data ?? [];
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}

/* ---------------------------------------------------------------------------
   SEC EDGAR — the authoritative source for insider (Form 4) and
   institutional (13F) filings. No key, but the SEC requires a descriptive
   User-Agent with contact details; requests without one are blocked.
   ------------------------------------------------------------------------- */

export const secConfigured = (): boolean =>
  Boolean(process.env.SEC_USER_AGENT && process.env.SEC_USER_AGENT.includes('@'));

interface SecSubmissions {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
    };
  };
}

/** Recent filings of a given form type for a CIK. Returns the raw index; the
 *  sentiment layer parses the specific documents it needs. */
export async function secRecentFilings(cik: string, forms: string[], limit = 40): Promise<
  { form: string; filingDate: string; accession: string; document: string }[]
> {
  if (!secConfigured()) {
    throw new ProviderError(
      'SEC_USER_AGENT must be set to a contact address — the SEC blocks anonymous automated requests',
      'sec-edgar',
    );
  }
  const padded = cik.replace(/\D/g, '').padStart(10, '0');
  const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
  const t0 = Date.now();
  try {
    const d = await fetchJson<SecSubmissions>(url, {
      provider: 'sec-edgar',
      timeoutMs: 12000,
      headers: { 'User-Agent': process.env.SEC_USER_AGENT as string },
    });
    recordSuccess('sec-edgar', Date.now() - t0);
    const r = d.filings.recent;
    const out: { form: string; filingDate: string; accession: string; document: string }[] = [];
    for (let i = 0; i < r.form.length && out.length < limit; i++) {
      if (forms.includes(r.form[i])) {
        out.push({
          form: r.form[i],
          filingDate: r.filingDate[i],
          accession: r.accessionNumber[i],
          document: r.primaryDocument[i],
        });
      }
    }
    return out;
  } catch (err) {
    recordFailure('sec-edgar', (err as Error).message);
    throw err;
  }
}

/* ---------------------------------------------------------------------------
   HELPERS
   ------------------------------------------------------------------------- */

/** Fold N consecutive bars into one — used to build intervals a venue does
 *  not serve natively (e.g. 4h from 1h). */
export function foldBars(bars: readonly Bar[], factor: number): Bar[] {
  if (factor <= 1) return [...bars];
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i += factor) {
    const chunk = bars.slice(i, i + factor);
    if (!chunk.length) break;
    out.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map((b) => b.h)),
      l: Math.min(...chunk.map((b) => b.l)),
      c: chunk[chunk.length - 1].c,
      v: chunk.reduce((s, b) => s + b.v, 0),
    });
  }
  return out;
}

/* ---------------------------------------------------------------------------
   SYMBOL SEARCH — the open-ended lookup that lets the terminal address any
   listed security rather than only the curated universe.

   Two vendors, deliberately: Finnhub covers US equities and ETFs with clean
   type labels, Yahoo covers everything else (indexes, futures, FX, bonds,
   crypto, and every non-US listing). Results are normalised into one shape.
   ------------------------------------------------------------------------- */

export interface SymbolHit {
  /** The symbol as the price providers expect it. */
  symbol: string;
  name: string;
  /** Vendor's own type string, kept verbatim for inference and display. */
  type: string;
  exchange?: string;
  currency?: string;
  source: 'finnhub' | 'yahoo';
}

interface FinnhubSearchResponse {
  count: number;
  result: { description: string; displaySymbol: string; symbol: string; type: string }[];
}

export async function finnhubSearch(query: string): Promise<SymbolHit[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');
  const url = `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&exchange=US&token=${key}`;
  const t0 = Date.now();
  try {
    const d = await fetchJson<FinnhubSearchResponse>(url, { provider: 'finnhub', timeoutMs: 8000 });
    recordSuccess('finnhub', Date.now() - t0);
    return (d.result ?? [])
      // Finnhub returns option and warrant lines for common tickers; those
      // are not tradable instruments in this terminal's sense.
      .filter((r) => r.symbol && !r.symbol.includes('.') && !/WARRANT|RIGHT/i.test(r.type))
      .map((r) => ({
        symbol: r.displaySymbol || r.symbol,
        name: r.description,
        type: r.type || 'Common Stock',
        source: 'finnhub' as const,
      }));
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}

interface YahooSearchResponse {
  quotes?: {
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    typeDisp?: string;
    exchDisp?: string;
    exchange?: string;
  }[];
}

export async function yahooSearch(query: string): Promise<SymbolHit[]> {
  const url =
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}` +
    `&quotesCount=20&newsCount=0&listsCount=0`;
  const t0 = Date.now();
  try {
    const d = await fetchJson<YahooSearchResponse>(url, { provider: 'yahoo', timeoutMs: 8000 });
    recordSuccess('yahoo', Date.now() - t0);
    return (d.quotes ?? [])
      .filter((q) => q.symbol)
      .map((q) => ({
        symbol: q.symbol as string,
        name: q.longname || q.shortname || (q.symbol as string),
        type: q.quoteType || q.typeDisp || 'EQUITY',
        exchange: q.exchDisp || q.exchange,
        source: 'yahoo' as const,
      }));
  } catch (err) {
    recordFailure('yahoo', (err as Error).message);
    throw err;
  }
}

/** Confirm a symbol exists and recover its display metadata, for the case
 *  where the user types a ticker directly rather than picking a search hit. */
export async function yahooLookup(symbol: string): Promise<SymbolHit | undefined> {
  const hits = await yahooSearch(symbol);
  const want = symbol.trim().toUpperCase();
  return hits.find((h) => h.symbol.toUpperCase() === want) ?? hits[0];
}


/* ---------------------------------------------------------------------------
   NASDAQ — daily OHLCV for US equities, ETFs and indexes, no key.

   This is the bar source. Finnhub's free tier does not serve candles, and
   Yahoo rate-limits datacentre IPs hard enough to be unusable, so Nasdaq's
   own public endpoint carries the history that every indicator depends on.
   It wants a browser User-Agent and returns newest-first rows with prices
   formatted for display ("$341.075", "31,658,820"), so both need undoing.
   ------------------------------------------------------------------------- */

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** Nasdaq segments its history endpoint by asset class and rejects a wrong
 *  one, so the mapping has to be exact. Bond funds are ETFs to an exchange. */
function nasdaqAssetClass(inst: Instrument): string | undefined {
  switch (inst.assetClass) {
    case 'equity': return 'stocks';
    case 'etf': case 'bond': return 'etf';
    case 'index': return 'index';
    default: return undefined;
  }
}

/** "$1,234.56" -> 1234.56; "--" and "N/A" -> NaN. */
export function parseMoney(raw: string | undefined): number {
  if (!raw) return NaN;
  const cleaned = raw.replace(/[$,%\s]/g, '').replace(/,/g, '');
  if (!cleaned || cleaned === '--' || cleaned === 'N/A') return NaN;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Nasdaq prints MM/DD/YYYY. Parsed as UTC noon so a timezone shift cannot
 *  move a bar onto the previous calendar day. */
export function parseNasdaqDate(raw: string): number {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  if (!m) return NaN;
  return Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 12);
}

interface NasdaqHistoryResponse {
  data?: {
    tradesTable?: {
      rows?: { date: string; close: string; volume: string; open: string; high: string; low: string }[];
    };
  };
  status?: { rCode?: number; bCodeMessage?: { errorMessage?: string }[] | null };
}

/** Nasdaq's symbol spelling differs from Yahoo's for share classes. */
function nasdaqSymbol(inst: Instrument): string {
  return (inst.nasdaqSymbol ?? inst.symbol).replace(/-/g, '/');
}

export async function nasdaqBars(inst: Instrument, tf: Timeframe, limit: number): Promise<Bar[]> {
  const assetclass = nasdaqAssetClass(inst);
  if (!assetclass) throw new ProviderError(`nasdaq does not carry ${inst.assetClass}`, 'nasdaq');
  if (tf !== '1d' && tf !== '1w') {
    throw new ProviderError('nasdaq serves daily history only', 'nasdaq');
  }

  // Ask for calendar days generously: ~252 trading days a year.
  const days = Math.ceil((limit + 20) * (365 / 252));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const iso = (d: Date): string => d.toISOString().slice(0, 10);

  const url =
    `https://api.nasdaq.com/api/quote/${encodeURIComponent(nasdaqSymbol(inst))}/historical`
    + `?assetclass=${assetclass}&fromdate=${iso(from)}&todate=${iso(to)}&limit=9999`;

  const t0 = Date.now();
  try {
    const json = await fetchJson<NasdaqHistoryResponse>(url, {
      provider: 'nasdaq', timeoutMs: 15000, headers: { 'User-Agent': BROWSER_UA },
    });

    const rows = json.data?.tradesTable?.rows;
    if (!rows?.length) {
      const msg = json.status?.bCodeMessage?.[0]?.errorMessage ?? 'no rows returned';
      throw new ProviderError(msg, 'nasdaq');
    }

    const bars: Bar[] = [];
    // Rows arrive newest-first; the engine wants oldest-first.
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i];
      const t = parseNasdaqDate(r.date);
      const o = parseMoney(r.open), h = parseMoney(r.high);
      const l = parseMoney(r.low), c = parseMoney(r.close);
      // Drop rather than interpolate: a fabricated bar corrupts every
      // indicator downstream, and Nasdaq blanks halted sessions.
      if (!Number.isFinite(t) || !Number.isFinite(o) || !Number.isFinite(h)
        || !Number.isFinite(l) || !Number.isFinite(c)) continue;
      const v = parseMoney(r.volume);
      bars.push({ t, o, h, l, c, v: Number.isFinite(v) ? v : 0 });
    }

    if (!bars.length) throw new ProviderError('every row failed to parse', 'nasdaq');

    recordSuccess('nasdaq', Date.now() - t0);
    if (tf === '1w') return foldWeekly(bars).slice(-limit);
    return bars.slice(-limit);
  } catch (err) {
    recordFailure('nasdaq', (err as Error).message);
    throw err;
  }
}

/** Derive a quote from the daily history, for classes with no quote feed
 *  (indexes) or when the quote vendor is down. */
export async function nasdaqQuote(inst: Instrument): Promise<Quote> {
  const bars = await nasdaqBars(inst, '1d', 5);
  if (bars.length < 2) throw new ProviderError('not enough history for a quote', 'nasdaq');
  const lastBar = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const change = lastBar.c - prev.c;
  return {
    symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
    price: lastBar.c, change, changePct: prev.c !== 0 ? (change / prev.c) * 100 : 0,
    open: lastBar.o, high: lastBar.h, low: lastBar.l, prevClose: prev.c,
    volume: lastBar.v, currency: inst.currency,
    // The last daily bar is a real close, but it is a close, not a tick.
    provenance: 'live', source: 'nasdaq', asOf: lastBar.t,
  };
}

export function foldWeekly(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curWeek = -1;
  for (const b of bars) {
    const d = new Date(b.t);
    // ISO-ish week key: year * 53 + week number is enough to detect a change.
    const week = Math.floor(b.t / (7 * 86400000));
    if (!cur || week !== curWeek) {
      if (cur) out.push(cur);
      cur = { ...b };
      curWeek = week;
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
    void d;
  }
  if (cur) out.push(cur);
  return out;
}

/* ---------------------------------------------------------------------------
   FRANKFURTER — ECB daily reference rates for FX. No key, no limit.

   These are official daily fixings, which means a close and nothing else:
   no open, high or low, because the ECB does not publish one. Rather than
   invent a range, the bars carry o=h=l=c. Range-based analytics (ATR, true
   range, stop placement) will correctly read zero range and the engine's own
   guards will decline to size a trade off them. That is the honest outcome:
   we have the level, we do not have the session.
   ------------------------------------------------------------------------- */

interface FrankfurterSeries {
  base: string;
  rates: Record<string, Record<string, number>>;
}

/** "EURUSD=X" -> { base: 'EUR', quote: 'USD' } */
export function parseFxPair(symbol: string): { base: string; quote: string } | undefined {
  const m = /^([A-Z]{3})([A-Z]{3})=X$/.exec(symbol.trim().toUpperCase());
  return m ? { base: m[1], quote: m[2] } : undefined;
}

export async function frankfurterBars(inst: Instrument, _tf: Timeframe, limit: number): Promise<Bar[]> {
  const pair = parseFxPair(inst.symbol);
  if (!pair) throw new ProviderError(`${inst.symbol} is not a recognised FX pair`, 'frankfurter');

  const days = Math.ceil((limit + 20) * (365 / 252));
  const to = new Date();
  const from = new Date(to.getTime() - days * 86400000);
  const iso = (d: Date): string => d.toISOString().slice(0, 10);

  const url = `https://api.frankfurter.app/${iso(from)}..${iso(to)}`
    + `?base=${pair.base}&symbols=${pair.quote}`;

  const t0 = Date.now();
  try {
    const json = await fetchJson<FrankfurterSeries>(url, { provider: 'frankfurter', timeoutMs: 12000 });
    const dates = Object.keys(json.rates ?? {}).sort();
    if (!dates.length) throw new ProviderError('empty rate series', 'frankfurter');

    const bars: Bar[] = [];
    for (const d of dates) {
      const rate = json.rates[d]?.[pair.quote];
      if (!Number.isFinite(rate)) continue;
      const t = Date.parse(`${d}T12:00:00Z`);
      bars.push({ t, o: rate, h: rate, l: rate, c: rate, v: 0 });
    }

    if (!bars.length) throw new ProviderError('no usable rates', 'frankfurter');
    recordSuccess('frankfurter', Date.now() - t0);
    return bars.slice(-limit);
  } catch (err) {
    recordFailure('frankfurter', (err as Error).message);
    throw err;
  }
}

export async function frankfurterQuote(inst: Instrument): Promise<Quote> {
  const bars = await frankfurterBars(inst, '1d', 5);
  if (bars.length < 2) throw new ProviderError('not enough history for a quote', 'frankfurter');
  const lastBar = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const change = lastBar.c - prev.c;
  return {
    symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
    price: lastBar.c, change, changePct: prev.c !== 0 ? (change / prev.c) * 100 : 0,
    open: lastBar.c, high: lastBar.c, low: lastBar.c, prevClose: prev.c,
    volume: 0, currency: inst.currency,
    provenance: 'live', source: 'frankfurter', asOf: lastBar.t,
  };
}

/* ---------------------------------------------------------------------------
   FINNHUB, continued — the parts of the free tier that carry real reported
   facts rather than prices: analyst recommendations, earnings history and
   the forward calendar.

   These replace modelled stand-ins for US equities. Where the free tier does
   not carry something (per-firm price targets, full financial statements),
   these adapters return nothing rather than something plausible.
   ------------------------------------------------------------------------- */

export interface FinnhubRecommendation {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

/** Aggregate analyst recommendation counts, newest period first. Finnhub's
 *  free tier gives the distribution but not the individual firms or their
 *  price targets, so callers get counts and nothing invented around them. */
export async function finnhubRecommendations(symbol: string): Promise<FinnhubRecommendation[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');
  const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${encodeURIComponent(symbol)}&token=${key}`;
  const t0 = Date.now();
  try {
    const rows = await fetchJson<FinnhubRecommendation[]>(url, { provider: 'finnhub', timeoutMs: 9000 });
    recordSuccess('finnhub', Date.now() - t0);
    if (!Array.isArray(rows)) return [];
    return [...rows].sort((a, b) => (a.period < b.period ? 1 : -1));
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}

export interface FinnhubEarningsRow {
  period: string;
  actual: number | null;
  estimate: number | null;
  surprise: number | null;
  surprisePercent: number | null;
  quarter?: number;
  year?: number;
}

/** Reported earnings history: estimate, actual and surprise per quarter. */
export async function finnhubEarnings(symbol: string): Promise<FinnhubEarningsRow[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');
  const url = `https://finnhub.io/api/v1/stock/earnings?symbol=${encodeURIComponent(symbol)}&token=${key}`;
  const t0 = Date.now();
  try {
    const rows = await fetchJson<FinnhubEarningsRow[]>(url, { provider: 'finnhub', timeoutMs: 9000 });
    recordSuccess('finnhub', Date.now() - t0);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}

export interface FinnhubCalendarRow {
  symbol: string;
  date: string;
  hour?: string;
  quarter?: number;
  year?: number;
  epsEstimate?: number | null;
  epsActual?: number | null;
  revenueEstimate?: number | null;
  revenueActual?: number | null;
}

/** The forward earnings calendar — when the next report actually lands.
 *  A trade plan that ignores a report three days out is not a plan. */
export async function finnhubEarningsCalendar(
  symbol: string, fromMs: number, toMs: number,
): Promise<FinnhubCalendarRow[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${iso(fromMs)}&to=${iso(toMs)}`
    + `&symbol=${encodeURIComponent(symbol)}&token=${key}`;
  const t0 = Date.now();
  try {
    const d = await fetchJson<{ earningsCalendar?: FinnhubCalendarRow[] }>(url, {
      provider: 'finnhub', timeoutMs: 9000,
    });
    recordSuccess('finnhub', Date.now() - t0);
    return d.earningsCalendar ?? [];
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}

export interface FinnhubMetrics { [key: string]: number | string | null | undefined }

/** 130+ reported ratios: valuation, margins, returns, leverage, 52-week
 *  range, growth. The single richest free call Finnhub serves. */
export async function finnhubMetrics(symbol: string): Promise<FinnhubMetrics> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');
  const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${key}`;
  const t0 = Date.now();
  try {
    const d = await fetchJson<{ metric?: FinnhubMetrics }>(url, { provider: 'finnhub', timeoutMs: 10000 });
    recordSuccess('finnhub', Date.now() - t0);
    return d.metric ?? {};
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}

export interface FinnhubProfile {
  name?: string; ticker?: string; finnhubIndustry?: string; currency?: string;
  marketCapitalization?: number; shareOutstanding?: number; floatingShare?: number;
  exchange?: string; country?: string; ipo?: string; weburl?: string;
}

export async function finnhubProfile(symbol: string): Promise<FinnhubProfile> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');
  const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${key}`;
  const t0 = Date.now();
  try {
    const d = await fetchJson<FinnhubProfile>(url, { provider: 'finnhub', timeoutMs: 9000 });
    recordSuccess('finnhub', Date.now() - t0);
    return d ?? {};
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}

export interface FinnhubNewsRow {
  category?: string;
  datetime?: number;
  headline?: string;
  id?: number;
  source?: string;
  summary?: string;
  url?: string;
}

/** Company news. Finnhub's free tier carries the articles but not a
 *  sentiment score, so the analyser reads the headlines itself. */
export async function finnhubNews(
  symbol: string, fromMs: number, toMs: number,
): Promise<FinnhubNewsRow[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}`
    + `&from=${iso(fromMs)}&to=${iso(toMs)}&token=${key}`;
  const t0 = Date.now();
  try {
    const rows = await fetchJson<FinnhubNewsRow[]>(url, { provider: 'finnhub', timeoutMs: 10000 });
    recordSuccess('finnhub', Date.now() - t0);
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}
