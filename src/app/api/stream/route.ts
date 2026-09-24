/* ===========================================================================
   Server-sent events stream for non-crypto ticks.

   Crypto goes browser-direct to Binance (public, unauthenticated). Equities
   cannot: the upstream needs an API key, and a key that reaches the browser is
   a key that is published. So the server holds the upstream connection and
   fans out over SSE, which keeps the credential server-side and lets every
   open tab share one upstream poll.

   SSE rather than a WebSocket because the data only flows one way. A socket
   would buy bidirectionality nobody needs and cost us the reconnect handling
   that EventSource already does in the browser.
   ========================================================================= */

import { getQuotes } from '@/lib/providers';
import { resolveInstrument } from '@/lib/market/universe';
import { resolveAny } from '@/lib/market/resolve';
import type { Tick } from '@/lib/realtime/types';

// Route handlers are uncached by default in Next 16, but a stream must never
// be cached under any configuration, so say so explicitly.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const POLL_MS = Math.max(1000, Number(process.env.MERIDIAN_STREAM_POLL_MS ?? 4000));
const MAX_SYMBOLS = 25;
/** Hard ceiling so an abandoned tab cannot hold a connection open forever. */
const MAX_DURATION_MS = 15 * 60 * 1000;

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const requested = (searchParams.get('symbols') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_SYMBOLS);

  // A dynamically resolved symbol may not be registered in this process yet
  // — the page that discovered it can have been rendered by another worker.
  const symbols = (await Promise.all(
    requested.map(async (s) => (resolveInstrument(s) ?? await resolveAny(s))?.symbol),
  )).filter((s): s is string => Boolean(s));

  if (!symbols.length) {
    return new Response(
      'event: error\ndata: {"detail":"No resolvable symbols"}\n\n',
      { status: 400, headers: { 'Content-Type': 'text/event-stream' } },
    );
  }

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const startedAt = Date.now();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: unknown): void => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const shutdown = (): void => {
        if (closed) return;
        closed = true;
        if (timer) clearInterval(timer);
        try { controller.close(); } catch { /* already closed */ }
      };

      // The browser aborts the request when the tab closes or navigates away.
      request.signal.addEventListener('abort', shutdown);

      send('status', { state: 'connecting', symbols, pollMs: POLL_MS });

      const poll = async (): Promise<void> => {
        if (closed) return;

        if (Date.now() - startedAt > MAX_DURATION_MS) {
          send('status', {
            state: 'closed',
            detail: 'Stream reached its maximum duration. Reconnect to continue.',
          });
          shutdown();
          return;
        }

        try {
          const quotes = await getQuotes(symbols, 6);
          const ticks: Tick[] = quotes.map((q) => ({
            symbol: q.symbol,
            price: q.price,
            ts: q.asOf,
            change: q.change,
            changePct: q.changePct,
            venue: q.source,
          }));
          const anyLive = quotes.some((q) => q.provenance === 'live' || q.provenance === 'cached');
          send('ticks', {
            ticks,
            state: anyLive ? 'polling' : 'unavailable',
            venue: quotes[0]?.source ?? null,
            detail: anyLive
              ? `Polling ${quotes[0]?.source ?? 'provider'} every ${(POLL_MS / 1000).toFixed(0)}s.`
              : 'No live provider is reachable — these values come from the simulator.',
          });
        } catch (err) {
          send('status', { state: 'reconnecting', detail: (err as Error).message });
        }
      };

      await poll();
      timer = setInterval(() => void poll(), POLL_MS);
    },

    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Nginx and similar proxies buffer by default, which defeats streaming.
      'X-Accel-Buffering': 'no',
    },
  });
}
