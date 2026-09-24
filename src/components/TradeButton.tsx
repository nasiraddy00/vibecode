import Link from 'next/link';

/** The Trade button. Takes the reader from "here is the data" to "here is the
 *  call" in one click, from anywhere a symbol appears. */
export function TradeButton({
  symbol, size = 'sm', className = '',
}: { symbol: string; size?: 'xs' | 'sm' | 'md'; className?: string }) {
  const dims =
    size === 'xs' ? 'px-1.5 py-[2px] text-[8.5px]'
    : size === 'md' ? 'px-3 py-1.5 text-[11px]'
    : 'px-2 py-1 text-[9.5px]';

  return (
    <Link
      href={`/trade/${encodeURIComponent(symbol)}`}
      onClick={(e) => e.stopPropagation()}
      aria-label={`Get the trade call for ${symbol}`}
      className={`inline-flex items-center gap-1 font-bold tracking-[0.12em] border border-amber/55 bg-amber/10 text-amber hover:bg-amber hover:text-void transition-colors shrink-0 ${dims} ${className}`}
    >
      TRADE
    </Link>
  );
}
