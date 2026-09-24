'use client';

/* ===========================================================================
   Live price display.

   Shows a streaming price when one is available and says plainly what it is
   doing when it is not. The distinction between "live push stream", "polled
   every few seconds" and "nothing is connected, this is the server-rendered
   figure" matters to anyone deciding whether to act on the number, so it is
   surfaced rather than smoothed over.
   ========================================================================= */

import { useLiveQuote } from '@/lib/realtime/useLiveQuote';
import { fmtPrice, fmtPct, fmtAge } from '@/lib/util/format';
import type { StreamState } from '@/lib/realtime/types';

const STATE_META: Record<StreamState, { label: string; dot: string; colour: string }> = {
  idle: { label: 'STATIC', dot: 'cold', colour: 'var(--color-ink-3)' },
  connecting: { label: 'CONNECTING', dot: 'sim', colour: 'var(--color-amber)' },
  live: { label: 'LIVE', dot: '', colour: 'var(--color-long)' },
  polling: { label: 'POLLING', dot: 'sim', colour: 'var(--color-ice)' },
  reconnecting: { label: 'RECONNECTING', dot: 'sim', colour: 'var(--color-amber)' },
  unavailable: { label: 'NO FEED', dot: 'cold', colour: 'var(--color-ink-3)' },
};

export function LivePrice({
  symbol, fallbackPrice, fallbackChangePct, size = 'lg',
}: {
  symbol: string;
  fallbackPrice: number;
  fallbackChangePct: number;
  size?: 'sm' | 'lg';
}) {
  const symbols = [symbol];
  const { ticks, status, flashed } = useLiveQuote(symbols);
  const tick = ticks[symbol];

  const price = tick?.price ?? fallbackPrice;
  const changePct = tick?.changePct ?? fallbackChangePct;
  const up = changePct >= 0;
  const meta = STATE_META[status.state];
  const flash = flashed[symbol];

  return (
    <div className="flex items-end gap-4">
      <div>
        <div
          className={`num ${size === 'lg' ? 'text-3xl' : 'text-xl'} font-bold leading-none ${
            up ? 'text-long' : 'text-short'
          } ${flash === 'up' ? 'flash-up' : flash === 'down' ? 'flash-down' : ''}`}
        >
          {fmtPrice(price)}
        </div>
        <div className={`num text-[12px] mt-1.5 ${up ? 'text-long' : 'text-short'}`}>
          {fmtPct(changePct)}
        </div>
      </div>

      <div
        className="flex flex-col gap-1 pb-1"
        title={status.detail || 'No stream is attached; this is the price the page was rendered with.'}
      >
        <span className="flex items-center gap-1.5 cursor-help">
          <span className={`live-dot ${meta.dot}`} />
          <span className="label-xs" style={{ color: meta.colour }}>{meta.label}</span>
        </span>
        {status.lastTickAt && (
          <span className="label-xs">{fmtAge(status.lastTickAt)}</span>
        )}
      </div>
    </div>
  );
}
