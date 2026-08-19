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
    `https://api.binance.com/api/v3/klines?symbol=${inst.binanceSymbol}` +
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
  const url = `https://api.binance.com/api/v3/ticker/24hr?symbol=${inst.binanceSymbol}`;
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
