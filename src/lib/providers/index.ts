/* ===========================================================================
   Provider registry — the single door every consumer goes through.

   Resolution order per instrument class, falling through on failure:

     crypto     binance -> coingecko -> yahoo -> simulator
     equity/etf finnhub -> yahoo             -> simulator
     other      yahoo                        -> simulator

   The return value always carries provenance. A caller can render a figure
   without knowing which branch produced it, but can never mistake a simulated
   number for a measured one.
   ========================================================================= */

import type { Bar, Quote, Timeframe } from '../types';
import type { Instrument } from '../market/universe';
import { resolveInstrument } from '../market/universe';
import { simulateSeries, simulateQuote } from './simulator';
import {
  yahooBars, yahooQuote, binanceBars, binanceQuote, coingeckoBars,
  finnhubQuote, finnhubConfigured, secConfigured,
} from './adapters';
import { cacheGet, cacheSet, isOffline } from './http';
import { registerFeed, recordFailure, setFeedState, allFeeds, feedSummary } from './health';

export * from './health';
export { cacheClear } from './http';
export type { Instrument } from '../market/universe';

let initialised = false;

function init(): void {
  if (initialised) return;
  initialised = true;
  registerFeed('yahoo', 'Yahoo Finance', true);
  registerFeed('binance', 'Binance', true);
  registerFeed('coingecko', 'CoinGecko', true);
  registerFeed('finnhub', 'Finnhub', finnhubConfigured());
  registerFeed('sec-edgar', 'SEC EDGAR', secConfigured());
  registerFeed('simulator', 'Simulator', true);

  if (isOffline()) {
    for (const f of allFeeds()) {
      if (f.id !== 'simulator') setFeedState(f.id, 'offline');
    }
  }
  setFeedState('simulator', 'live');
}

export interface BarsResult {
  bars: Bar[];
  provenance: 'live' | 'cached' | 'simulated';
  source: string;
  /** Populated when every live provider failed, so the UI can explain why. */
  fallbackReason?: string;
  asOf: number;
}

/** How many bars of history each timeframe should carry by default. Enough
 *  to warm a 200-period moving average with room to spare. */
export const DEFAULT_BAR_COUNT: Record<Timeframe, number> = {
  '1m': 390, '5m': 500, '15m': 500, '1h': 500, '4h': 500, '1d': 750, '1w': 400,
};

/** Fetch OHLCV for an instrument, falling back through the provider chain. */
export async function getBars(
  symbolOrInst: string | Instrument,
  tf: Timeframe = '1d',
  limit?: number,
): Promise<BarsResult> {
  init();
  const inst = typeof symbolOrInst === 'string' ? resolveInstrument(symbolOrInst) : symbolOrInst;
  if (!inst) throw new Error(`Unknown instrument: ${String(symbolOrInst)}`);

  const count = limit ?? DEFAULT_BAR_COUNT[tf];
  const cacheKey = `bars:${inst.symbol}:${tf}:${count}`;

  const hit = cacheGet<BarsResult>(cacheKey);
  if (hit) return { ...hit.value, provenance: hit.value.provenance === 'simulated' ? 'simulated' : 'cached' };

  const errors: string[] = [];
  const chain = barProviderChain(inst);

  for (const step of chain) {
    try {
      const bars = await step.run(inst, tf, count);
      if (bars.length >= 20) {
        const result: BarsResult = {
          bars, provenance: 'live', source: step.id, asOf: Date.now(),
        };
        cacheSet(cacheKey, result, tf === '1d' ? 300_000 : 45_000);
        return result;
      }
      errors.push(`${step.id}: only ${bars.length} bars returned`);
    } catch (err) {
      errors.push(`${step.id}: ${(err as Error).message}`);
    }
  }

  // Every live path failed — fall back to the simulator, loudly.
  const sim = simulateSeries(inst, { bars: count, timeframe: tf });
  const result: BarsResult = {
    bars: sim.bars,
    provenance: 'simulated',
    source: 'simulator',
    fallbackReason: errors.length
      ? errors.join(' | ')
      : 'No live provider was reachable or configured',
    asOf: Date.now(),
  };
  cacheSet(cacheKey, result, 60_000);
  return result;
}

interface ProviderStep {
  id: string;
  run: (inst: Instrument, tf: Timeframe, limit: number) => Promise<Bar[]>;
}

function barProviderChain(inst: Instrument): ProviderStep[] {
  if (isOffline()) return [];

  if (inst.assetClass === 'crypto') {
    const chain: ProviderStep[] = [];
    if (inst.binanceSymbol) chain.push({ id: 'binance', run: binanceBars });
    if (inst.coingeckoId) {
      chain.push({
        id: 'coingecko',
        run: (i, tf, limit) => coingeckoBars(i, tf === '1d' ? Math.min(365, limit) : 90),
      });
    }
    chain.push({ id: 'yahoo', run: yahooBars });
    return chain;
  }
  return [{ id: 'yahoo', run: yahooBars }];
}

export interface QuoteResult extends Quote {
  fallbackReason?: string;
}

/** Fetch a quote, falling back through the provider chain. */
export async function getQuote(symbolOrInst: string | Instrument): Promise<QuoteResult> {
  init();
  const inst = typeof symbolOrInst === 'string' ? resolveInstrument(symbolOrInst) : symbolOrInst;
  if (!inst) throw new Error(`Unknown instrument: ${String(symbolOrInst)}`);

  const cacheKey = `quote:${inst.symbol}`;
  const hit = cacheGet<QuoteResult>(cacheKey);
  if (hit) {
    return { ...hit.value, provenance: hit.value.provenance === 'simulated' ? 'simulated' : 'cached' };
  }

  const errors: string[] = [];
  if (!isOffline()) {
    const chain: { id: string; run: (i: Instrument) => Promise<Quote> }[] =
      inst.assetClass === 'crypto' && inst.binanceSymbol
        ? [{ id: 'binance', run: binanceQuote }, { id: 'yahoo', run: yahooQuote }]
        : finnhubConfigured() && (inst.assetClass === 'equity' || inst.assetClass === 'etf')
          ? [{ id: 'finnhub', run: finnhubQuote }, { id: 'yahoo', run: yahooQuote }]
          : [{ id: 'yahoo', run: yahooQuote }];

    for (const step of chain) {
      try {
        const q = await step.run(inst);
        if (Number.isFinite(q.price) && q.price > 0) {
          cacheSet(cacheKey, q, 20_000);
          return q;
        }
        errors.push(`${step.id}: invalid price`);
      } catch (err) {
        errors.push(`${step.id}: ${(err as Error).message}`);
      }
    }
  }

  // Derive the quote from the (possibly simulated) bar series so price and
  // chart never disagree on screen.
  const barsResult = await getBars(inst, '1d', 260);
  const q = simulateQuote(inst, barsResult.bars);
  const result: QuoteResult = {
    ...q,
    provenance: barsResult.provenance === 'simulated' ? 'simulated' : 'derived',
    source: barsResult.source,
    fallbackReason: errors.length ? errors.join(' | ') : barsResult.fallbackReason,
  };
  cacheSet(cacheKey, result, 30_000);
  return result;
}

/** Batch quotes with bounded concurrency — the home page needs ~40 of these
 *  and firing them all at once trips every rate limiter in existence. */
export async function getQuotes(symbols: readonly string[], concurrency = 6): Promise<QuoteResult[]> {
  const out: QuoteResult[] = [];
  const queue = [...symbols];

  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const sym = queue.shift();
      if (!sym) break;
      try {
        out.push(await getQuote(sym));
      } catch {
        // A single unknown symbol must not sink the whole panel.
      }
    }
  });

  await Promise.all(workers);
  // Preserve the caller's ordering.
  const order = new Map(symbols.map((s, i) => [s.toUpperCase(), i]));
  return out.sort((a, b) => (order.get(a.symbol.toUpperCase()) ?? 0) - (order.get(b.symbol.toUpperCase()) ?? 0));
}

/** Snapshot of feed health for the status strip. */
export function providerStatus(): {
  feeds: ReturnType<typeof allFeeds>;
  summary: ReturnType<typeof feedSummary>;
  offline: boolean;
  mode: 'live' | 'mixed' | 'simulated';
} {
  init();
  const feeds = allFeeds();
  const summary = feedSummary();
  const nonSim = feeds.filter((f) => f.id !== 'simulator');
  const liveCount = nonSim.filter((f) => f.state === 'live').length;
  return {
    feeds,
    summary,
    offline: isOffline(),
    mode: liveCount === 0 ? 'simulated' : liveCount === nonSim.length ? 'live' : 'mixed',
  };
}
