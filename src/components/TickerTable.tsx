import Link from 'next/link';
import { Sparkline } from './Sparkline';
import { fmtPrice, fmtPct, fmtCompact } from '@/lib/util/format';
import type { TickerRow } from '@/lib/market/cockpit';

export function TickerTable({
  rows, showVolume = false, showRsi = true, compact = false,
}: { rows: TickerRow[]; showVolume?: boolean; showRsi?: boolean; compact?: boolean }) {
  // Tailwind breakpoints key off the VIEWPORT, not the container. In a narrow
  // rail on a wide screen that means columns appear that the panel cannot fit,
  // so the compact variant drops them explicitly rather than relying on media
  // queries that are measuring the wrong box.
  if (!rows.length) {
    return <div className="label p-4 text-center">No data available</div>;
  }

  return (
    <div className={compact ? '' : 'overflow-x-auto'}>
      <table className={`dt ${compact ? 'compact' : ''}`}>
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Last</th>
            <th>Chg%</th>
            <th className={compact ? '' : 'hidden sm:table-cell'}>5D</th>
            {!compact && <th className="hidden md:table-cell">20D</th>}
            {showRsi && <th className="hidden lg:table-cell">RSI</th>}
            {showVolume && <th className="hidden lg:table-cell">Vol</th>}
            <th className={compact ? 'w-[58px]' : 'w-[92px]'}>Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol}>
              <td>
                <Link
                  href={`/ticker/${encodeURIComponent(r.symbol)}`}
                  className="group flex items-baseline gap-2 min-w-0"
                >
                  <span className="num font-bold text-[11.5px] text-ink group-hover:text-amber transition-colors shrink-0">
                    {r.symbol}
                  </span>
                  {!compact && (
                    <span className="text-[10px] text-ink-3 truncate hidden 2xl:inline">{r.name}</span>
                  )}
                </Link>
              </td>
              <td className="num">{fmtPrice(r.price)}</td>
              <td className={`num font-semibold ${r.changePct > 0 ? 'text-long' : r.changePct < 0 ? 'text-short' : 'text-ink-2'}`}>
                {fmtPct(r.changePct)}
              </td>
              <td className={`num ${compact ? '' : 'hidden sm:table-cell'} ${r.ret5 > 0 ? 'text-long/85' : r.ret5 < 0 ? 'text-short/85' : 'text-ink-3'}`}>
                {fmtPct(r.ret5, 1)}
              </td>
              {!compact && (
                <td className={`num hidden md:table-cell ${r.ret20 > 0 ? 'text-long/85' : r.ret20 < 0 ? 'text-short/85' : 'text-ink-3'}`}>
                  {fmtPct(r.ret20, 1)}
                </td>
              )}
              {showRsi && (
                <td className="num hidden lg:table-cell">
                  <span className={
                    r.rsi > 70 ? 'text-short' : r.rsi < 30 ? 'text-long' : 'text-ink-2'
                  }>
                    {Number.isFinite(r.rsi) ? r.rsi.toFixed(0) : '—'}
                  </span>
                </td>
              )}
              {showVolume && (
                <td className="num hidden lg:table-cell text-ink-3">{fmtCompact(r.volume, 1)}</td>
              )}
              <td className="pr-2">
                <div className="flex justify-end">
                  <Sparkline data={r.spark} width={compact ? 52 : 84} height={20} />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
