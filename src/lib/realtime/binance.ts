/* ===========================================================================
   Binance public WebSocket — browser-direct.

   Binance's market streams are public and unauthenticated, so the browser can
   connect straight to them. That is the right architecture: routing crypto
   ticks through our own server would add a hop, a process to keep alive and a
   fan-out problem, all to proxy data that is already public.

   Equities are the opposite case — the API key cannot go to the browser — and
   are handled server-side over SSE instead.
   ========================================================================= */

import type { Tick, StreamStatus } from './types';
import { resolveInstrument } from '../market/universe';

const WS_BASE = 'wss://stream.binance.com:9443/stream';
const MAX_ATTEMPTS = 8;

interface MiniTickerFrame {
  stream: string;
  data: {
    s: string;   // symbol, e.g. BTCUSDT
    c: string;   // last price
    o: string;   // open, rolling 24h
    E: number;   // event time, epoch ms
  };
}

export interface StreamHandle {
  close: () => void;
}

/** Map our symbols onto Binance pairs, dropping any without a mapping. */
export function binancePairs(symbols: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of symbols) {
    const inst = resolveInstrument(s);
    if (inst?.binanceSymbol) out.set(inst.binanceSymbol.toLowerCase(), inst.symbol);
  }
  return out;
}

/** Full-jitter exponential backoff, capped. A fixed backoff makes every client
 *  reconnect in lockstep after an outage, which turns a blip into a thundering
 *  herd against the venue. */
export function backoffDelay(attempt: number, rand: () => number = Math.random): number {
  const ceiling = Math.min(30_000, 1_000 * 2 ** attempt);
  return rand() * ceiling;
}

export function openBinanceStream(
  symbols: readonly string[],
  onTick: (t: Tick) => void,
  onStatus: (s: StreamStatus) => void,
): StreamHandle {
  const pairs = binancePairs(symbols);

  if (pairs.size === 0) {
    onStatus({
      state: 'unavailable', venue: 'binance', lastTickAt: null, attempts: 0,
      detail: 'None of these symbols trade on Binance.',
    });
    return { close: () => {} };
  }

  let ws: WebSocket | null = null;
  let attempts = 0;
  let closed = false;
  let retryTimer: number | undefined;

  const streams = [...pairs.keys()].map((p) => `${p}@miniTicker`).join('/');
  const url = `${WS_BASE}?streams=${streams}`;

  const scheduleRetry = (detail: string): void => {
    attempts++;
    if (attempts > MAX_ATTEMPTS) {
      onStatus({
        state: 'unavailable', venue: 'binance', lastTickAt: null, attempts,
        detail: `Gave up after ${attempts} attempts. ${detail}`,
      });
      return;
    }
    const wait = backoffDelay(attempts);
    onStatus({
      state: 'reconnecting', venue: 'binance', lastTickAt: null, attempts,
      detail: `${detail} Retrying in ${(wait / 1000).toFixed(1)}s.`,
    });
    retryTimer = window.setTimeout(connect, wait);
  };

  function connect(): void {
    if (closed) return;
    onStatus({
      state: attempts === 0 ? 'connecting' : 'reconnecting',
      venue: 'binance', lastTickAt: null, attempts,
      detail: attempts === 0 ? 'Opening Binance stream…' : `Reconnecting (attempt ${attempts})…`,
    });

    try {
      ws = new WebSocket(url);
    } catch (err) {
      scheduleRetry((err as Error).message);
      return;
    }

    ws.onopen = () => {
      attempts = 0;
      onStatus({
        state: 'live', venue: 'binance', lastTickAt: null, attempts: 0,
        detail: `Streaming ${pairs.size} pair${pairs.size > 1 ? 's' : ''} live from Binance.`,
      });
    };

    ws.onmessage = (ev: MessageEvent<string>) => {
      const tick = parseMiniTicker(ev.data, pairs);
      if (tick) onTick(tick);
    };

    // onclose always follows onerror, so retry logic lives there and runs once.
    ws.onclose = () => {
      if (!closed) scheduleRetry('Connection closed by the venue.');
    };
  }

  connect();

  return {
    close: () => {
      closed = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      if (ws) {
        // Clear handlers before closing so teardown does not trigger a retry.
        ws.onclose = null;
        ws.onerror = null;
        ws.onmessage = null;
        ws.close();
      }
    },
  };
}

/** Parse one combined-stream frame. Exported so the shape can be tested
 *  without standing up a socket. */
export function parseMiniTicker(raw: string, pairs: Map<string, string>): Tick | null {
  try {
    const msg = JSON.parse(raw) as MiniTickerFrame;
    if (!msg?.data?.s) return null;
    const symbol = pairs.get(msg.data.s.toLowerCase());
    if (!symbol) return null;

    const price = parseFloat(msg.data.c);
    if (!Number.isFinite(price) || price <= 0) return null;

    const open = parseFloat(msg.data.o);
    const hasOpen = Number.isFinite(open) && open > 0;

    return {
      symbol,
      price,
      ts: msg.data.E,
      change: hasOpen ? price - open : undefined,
      changePct: hasOpen ? ((price - open) / open) * 100 : undefined,
      venue: 'binance',
    };
  } catch {
    // A malformed frame is not worth tearing the socket down for.
    return null;
  }
}
