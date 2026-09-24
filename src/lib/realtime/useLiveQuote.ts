'use client';

/* ===========================================================================
   useLiveQuote — one hook, two transports.

   Crypto symbols connect browser-direct to Binance's public WebSocket. Anything
   else is fanned out from the server over SSE, because those feeds need a key
   that must not reach the browser. Callers do not have to know which applies;
   they get ticks and a status they can render honestly.
   ========================================================================= */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Tick, StreamStatus } from './types';
import { IDLE_STATUS } from './types';
import { openBinanceStream, binancePairs } from './binance';
import { resolveInstrument } from '../market/universe';

export interface LiveQuotes {
  /** Latest tick per symbol. Absent until the first tick arrives. */
  ticks: Record<string, Tick>;
  status: StreamStatus;
  /** Symbols that flashed on the most recent update, for the flash animation. */
  flashed: Record<string, 'up' | 'down'>;
}

/** The single-file browser build has no server to stream from, and the artifact
 *  sandbox blocks outbound WebSockets. Retrying against either would produce a
 *  flickering "reconnecting" badge that describes nothing real, so the build
 *  flag turns streaming off and the UI reports STATIC — which is the truth. */
const STREAMING_DISABLED =
  typeof process !== 'undefined' && process.env?.MERIDIAN_STANDALONE === '1';

export function useLiveQuote(symbols: readonly string[], enabledInput = true): LiveQuotes {
  const enabled = enabledInput && !STREAMING_DISABLED;
  // Stabilise the dependency so a caller passing an inline array literal does
  // not tear the socket down and rebuild it on every render.
  const key = useMemo(() => [...symbols].sort().join(','), [symbols]);
  const list = useMemo(() => key.split(',').filter(Boolean), [key]);

  const [ticks, setTicks] = useState<Record<string, Tick>>({});
  const [status, setStatus] = useState<StreamStatus>(IDLE_STATUS);
  const [flashed, setFlashed] = useState<Record<string, 'up' | 'down'>>({});
  const prices = useRef<Record<string, number>>({});

  const applyTick = useCallback((t: Tick) => {
    const prev = prices.current[t.symbol];
    prices.current[t.symbol] = t.price;
    setTicks((cur) => ({ ...cur, [t.symbol]: t }));
    if (prev !== undefined && prev !== t.price) {
      setFlashed((cur) => ({ ...cur, [t.symbol]: t.price > prev ? 'up' : 'down' }));
    }
    setStatus((cur) => (cur.lastTickAt === t.ts ? cur : { ...cur, lastTickAt: t.ts }));
  }, []);

  // Clear flash markers shortly after they are set, so the CSS animation can
  // re-trigger on the next change rather than latching on.
  useEffect(() => {
    if (!Object.keys(flashed).length) return;
    const id = window.setTimeout(() => setFlashed({}), 700);
    return () => window.clearTimeout(id);
  }, [flashed]);

  const { cryptoSymbols, otherSymbols } = useMemo(() => {
    const crypto: string[] = [];
    const other: string[] = [];
    for (const s of list) {
      const inst = resolveInstrument(s);
      if (inst?.binanceSymbol) crypto.push(inst.symbol);
      else if (inst) other.push(inst.symbol);
    }
    return { cryptoSymbols: crypto, otherSymbols: other };
  }, [list]);

  // --- crypto: browser-direct WebSocket ------------------------------------
  useEffect(() => {
    if (!enabled || cryptoSymbols.length === 0) return;
    if (typeof window === 'undefined' || !('WebSocket' in window)) return;
    if (binancePairs(cryptoSymbols).size === 0) return;

    const handle = openBinanceStream(cryptoSymbols, applyTick, (s) => {
      // Do not let a crypto socket overwrite a healthier equity status.
      setStatus((cur) => (cur.state === 'live' && s.state !== 'live' ? cur : s));
    });
    return () => handle.close();
  }, [enabled, cryptoSymbols, applyTick]);

  // --- everything else: server-sent events ----------------------------------
  useEffect(() => {
    if (!enabled || otherSymbols.length === 0) return;
    if (typeof window === 'undefined' || !('EventSource' in window)) return;

    const es = new EventSource(`/api/stream?symbols=${encodeURIComponent(otherSymbols.join(','))}`);

    es.addEventListener('ticks', (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent<string>).data) as {
          ticks: Tick[]; state: StreamStatus['state']; venue: string | null; detail: string;
        };
        for (const t of payload.ticks) applyTick(t);
        setStatus((cur) => ({
          ...cur,
          state: payload.state,
          venue: payload.venue,
          detail: payload.detail,
          attempts: 0,
        }));
      } catch {
        // Ignore a malformed frame rather than dropping the stream.
      }
    });

    es.addEventListener('status', (ev) => {
      try {
        const payload = JSON.parse((ev as MessageEvent<string>).data) as Partial<StreamStatus>;
        setStatus((cur) => ({ ...cur, ...payload }));
      } catch { /* ignore */ }
    });

    // EventSource reconnects on its own; surface that rather than tearing down.
    es.onerror = () => {
      setStatus((cur) => ({
        ...cur,
        state: 'reconnecting',
        detail: 'Stream interrupted — the browser is retrying.',
      }));
    };

    return () => es.close();
  }, [enabled, otherSymbols, applyTick]);

  useEffect(() => {
    if (!enabled) setStatus(IDLE_STATUS);
  }, [enabled]);

  return { ticks, status, flashed };
}
