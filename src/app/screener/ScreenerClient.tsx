'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Sparkline } from '@/components/Sparkline';
import { ScoreBar } from '@/components/Gauge';
import { fmtPrice, fmtPct, fmtNum } from '@/lib/util/format';
import { TradeButton } from '@/components/TradeButton';
import type { ScreenerRow } from '@/lib/market/screener';

type SortKey = keyof Pick<
  ScreenerRow,
  'conviction' | 'score' | 'changePct' | 'ret5' | 'ret20' | 'ret60'
  | 'rsi' | 'adx' | 'atrPct' | 'relVolume' | 'pctFrom52wHigh' | 'riskReward' | 'price'
>;

const PRESETS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'buy', label: 'Buy signals', test: (r: ScreenerRow) => r.direction === 'long' },
  { id: 'sell', label: 'Sell signals', test: (r: ScreenerRow) => r.direction === 'short' },
  { id: 'high', label: 'High conviction', test: (r: ScreenerRow) => r.conviction >= 60 },
  { id: 'trend', label: 'Trending (ADX>25)', test: (r: ScreenerRow) => r.adx > 25 },
  { id: 'squeeze', label: 'In squeeze', test: (r: ScreenerRow) => r.squeeze },
  { id: 'oversold', label: 'Oversold (RSI<35)', test: (r: ScreenerRow) => r.rsi < 35 },
  { id: 'overbought', label: 'Overbought (RSI>65)', test: (r: ScreenerRow) => r.rsi > 65 },
  { id: 'stage2', label: 'Above 50 & 200DMA', test: (r: ScreenerRow) => r.aboveSma50 && r.aboveSma200 },
  { id: 'volume', label: 'Volume surge', test: (r: ScreenerRow) => r.relVolume > 1.5 },
  { id: 'nearhigh', label: 'Near 52w high', test: (r: ScreenerRow) => r.pctFrom52wHigh > -5 },
] as const;

const CLASSES = ['all', 'equity', 'etf', 'index', 'crypto', 'commodity', 'fx'] as const;

const ACTION_STYLE: Record<string, string> = {
  'STRONG BUY': 'bg-long text-void',
  'BUY': 'bg-long/20 text-long border border-long/50',
  'ACCUMULATE': 'bg-long/10 text-long/90 border border-long/30',
  'HOLD': 'bg-raised text-ink-3 border border-hairline',
  'REDUCE': 'bg-short/10 text-short/90 border border-short/30',
  'SELL': 'bg-short/20 text-short border border-short/50',
  'STRONG SELL': 'bg-short text-void',
};

export function ScreenerClient({ rows }: { rows: ScreenerRow[] }) {
  const [preset, setPreset] = useState<string>('all');
  const [assetClass, setAssetClass] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('conviction');
  const [desc, setDesc] = useState(true);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const p = PRESETS.find((x) => x.id === preset) ?? PRESETS[0];
    const q = query.trim().toUpperCase();
    return rows
      .filter((r) => p.test(r))
      .filter((r) => assetClass === 'all' || r.assetClass === assetClass)
      .filter((r) => !q || r.symbol.includes(q) || r.name.toUpperCase().includes(q))
      .sort((a, b) => {
        const av = a[sortKey];
        const bv = b[sortKey];
        const an = Number.isFinite(av as number) ? (av as number) : -Infinity;
        const bn = Number.isFinite(bv as number) ? (bv as number) : -Infinity;
        return desc ? bn - an : an - bn;
      });
  }, [rows, preset, assetClass, sortKey, desc, query]);

  const toggleSort = (k: SortKey): void => {
    if (k === sortKey) setDesc((d) => !d);
    else { setSortKey(k); setDesc(true); }
  };

  const Th = ({ k, children, className = '' }: { k: SortKey; children: React.ReactNode; className?: string }) => (
    <th
      className={`cursor-pointer select-none hover:text-ink transition-colors ${className}`}
      onClick={() => toggleSort(k)}
    >
      {children}
      {sortKey === k && <span className="text-amber ml-0.5">{desc ? '▾' : '▴'}</span>}
    </th>
  );

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex flex-wrap items-center gap-1.5 p-2 border-b border-hairline">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            className={`px-2 py-1 text-[9.5px] font-bold tracking-[0.1em] uppercase border transition-colors ${
              preset === p.id
                ? 'border-amber text-amber bg-amber/10'
                : 'border-hairline text-ink-3 hover:text-ink-2 hover:border-hairline-bright'
            }`}
          >
            {p.label}
          </button>
        ))}

        <div className="w-px h-4 bg-hairline mx-1" />

        {CLASSES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setAssetClass(c)}
            className={`px-2 py-1 text-[9.5px] font-bold tracking-[0.1em] uppercase border transition-colors ${
              assetClass === c
                ? 'border-ice text-ice bg-ice/10'
                : 'border-hairline text-ink-3 hover:text-ink-2 hover:border-hairline-bright'
            }`}
          >
            {c}
          </button>
        ))}

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="filter…"
          className="ml-auto bg-panel border border-hairline px-2 py-1 text-[10.5px] num text-ink placeholder:text-ink-4 outline-none focus:border-amber/60 w-32"
        />
        <span className="label-xs whitespace-nowrap">{filtered.length} MATCH</span>
      </div>

      <div className="overflow-x-auto">
        <table className="dt">
          <thead>
            <tr>
              <th className="!text-left">Symbol</th>
              <th className="!text-left hidden xl:table-cell">Name</th>
              <Th k="price">Last</Th>
              <Th k="changePct">Chg%</Th>
              <th>Signal</th>
              <Th k="conviction">Conv</Th>
              <Th k="score">Score</Th>
              <Th k="ret5" className="hidden sm:table-cell">5D</Th>
              <Th k="ret20" className="hidden md:table-cell">20D</Th>
              <Th k="ret60" className="hidden lg:table-cell">60D</Th>
              <Th k="rsi">RSI</Th>
              <Th k="adx" className="hidden md:table-cell">ADX</Th>
              <Th k="atrPct" className="hidden lg:table-cell">ATR%</Th>
              <Th k="relVolume" className="hidden lg:table-cell">RVol</Th>
              <Th k="pctFrom52wHigh" className="hidden xl:table-cell">52wH</Th>
              <Th k="riskReward" className="hidden xl:table-cell">R:R</Th>
              <th className="w-[122px]">Trend</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.symbol}>
                <td className="!text-left">
                  <Link
                    href={`/ticker/${encodeURIComponent(r.symbol)}`}
                    className="num text-[11px] font-bold text-ink hover:text-amber transition-colors"
                  >
                    {r.symbol}
                  </Link>
                </td>
                <td className="!text-left hidden xl:table-cell">
                  <span className="text-[10px] text-ink-3 truncate block max-w-[160px]">{r.name}</span>
                </td>
                <td className="num">{fmtPrice(r.price)}</td>
                <td className={`num ${r.changePct >= 0 ? 'text-long' : 'text-short'}`}>
                  {fmtPct(r.changePct)}
                </td>
                <td>
                  <span className={`inline-block px-1.5 py-[2px] text-[8.5px] font-bold tracking-[0.09em] whitespace-nowrap ${ACTION_STYLE[r.action] ?? ACTION_STYLE.HOLD}`}>
                    {r.action}
                  </span>
                </td>
                <td className="num font-semibold">{r.conviction.toFixed(0)}</td>
                <td>
                  <div className="flex justify-end"><ScoreBar score={r.score} width={40} height={6} /></div>
                </td>
                <td className={`num hidden sm:table-cell ${r.ret5 >= 0 ? 'text-long/80' : 'text-short/80'}`}>
                  {fmtPct(r.ret5, 1)}
                </td>
                <td className={`num hidden md:table-cell ${r.ret20 >= 0 ? 'text-long/80' : 'text-short/80'}`}>
                  {fmtPct(r.ret20, 1)}
                </td>
                <td className={`num hidden lg:table-cell ${r.ret60 >= 0 ? 'text-long/80' : 'text-short/80'}`}>
                  {fmtPct(r.ret60, 1)}
                </td>
                <td className={`num ${r.rsi > 70 ? 'text-short' : r.rsi < 30 ? 'text-long' : 'text-ink-2'}`}>
                  {fmtNum(r.rsi, 0)}
                </td>
                <td className={`num hidden md:table-cell ${r.adx > 25 ? 'text-ink' : 'text-ink-4'}`}>
                  {fmtNum(r.adx, 0)}
                </td>
                <td className="num hidden lg:table-cell text-ink-3">{fmtNum(r.atrPct, 1)}</td>
                <td className={`num hidden lg:table-cell ${r.relVolume > 1.5 ? 'text-amber' : 'text-ink-3'}`}>
                  {fmtNum(r.relVolume, 2)}
                </td>
                <td className="num hidden xl:table-cell text-ink-3">{fmtPct(r.pctFrom52wHigh, 0)}</td>
                <td className={`num hidden xl:table-cell ${r.riskReward >= 2 ? 'text-long' : 'text-ink-3'}`}>
                  {Number.isFinite(r.riskReward) ? fmtNum(r.riskReward, 1) : '—'}
                </td>
                <td className="pr-2">
                  <div className="flex items-center justify-end gap-2">
                    <Sparkline data={r.spark} width={56} height={18} />
                    <TradeButton symbol={r.symbol} size="xs" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filtered.length === 0 && (
        <div className="p-6 text-center">
          <div className="label mb-1">No matches</div>
          <p className="text-[11px] text-ink-3">Nothing in the universe satisfies this filter combination.</p>
        </div>
      )}
    </div>
  );
}
