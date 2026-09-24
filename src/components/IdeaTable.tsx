import Link from 'next/link';
import { Sparkline } from './Sparkline';
import { ScoreBar } from './Gauge';
import { fmtPrice, fmtPct, fmtNum } from '@/lib/util/format';
import { TradeButton } from '@/components/TradeButton';
import type { TradeIdea } from '@/lib/market/cockpit';

const ACTION_STYLE: Record<string, string> = {
  'STRONG BUY': 'bg-long text-void',
  'BUY': 'bg-long/20 text-long border border-long/50',
  'ACCUMULATE': 'bg-long/10 text-long/90 border border-long/30',
  'HOLD': 'bg-raised text-ink-3 border border-hairline',
  'REDUCE': 'bg-short/10 text-short/90 border border-short/30',
  'SELL': 'bg-short/20 text-short border border-short/50',
  'STRONG SELL': 'bg-short text-void',
};

export function IdeaRow({ idea, rank }: { idea: TradeIdea; rank: number }) {
  const isLong = idea.direction === 'long';
  return (
    <tr>
      <td className="num text-ink-4 text-[10px]">{String(rank).padStart(2, '0')}</td>
      <td className="!text-left">
        <Link href={`/ticker/${encodeURIComponent(idea.symbol)}`} className="group block min-w-0">
          <div className="num font-bold text-[11.5px] text-ink group-hover:text-amber transition-colors">
            {idea.symbol}
          </div>
          <div className="text-[9.5px] text-ink-4 truncate max-w-[200px]">{idea.headline}</div>
        </Link>
      </td>
      <td className="num">{fmtPrice(idea.price)}</td>
      <td className={`num ${idea.changePct >= 0 ? 'text-long' : 'text-short'}`}>
        {fmtPct(idea.changePct)}
      </td>
      <td>
        <span className={`inline-block px-1.5 py-[2px] text-[9px] font-bold tracking-[0.1em] whitespace-nowrap ${ACTION_STYLE[idea.action] ?? ACTION_STYLE.HOLD}`}>
          {idea.action}
        </span>
      </td>
      <td>
        <div className="flex items-center justify-end gap-1.5">
          <ScoreBar score={idea.score} width={44} height={7} />
          <span className="num text-[10.5px] text-ink-2 w-6 text-right">{idea.conviction.toFixed(0)}</span>
        </div>
      </td>
      <td className="num text-[10.5px] hidden md:table-cell">
        <span className={isLong ? 'text-long/80' : 'text-short/80'}>{fmtPrice(idea.entry)}</span>
      </td>
      <td className="num text-[10.5px] text-short/80 hidden md:table-cell">{fmtPrice(idea.stop)}</td>
      <td className="num text-[10.5px] text-long/80 hidden lg:table-cell">{fmtPrice(idea.target)}</td>
      <td className="num text-[10.5px] hidden lg:table-cell">
        <span className={idea.riskReward >= 2 ? 'text-long' : idea.riskReward >= 1.4 ? 'text-amber' : 'text-ink-3'}>
          {Number.isFinite(idea.riskReward) ? `${fmtNum(idea.riskReward, 1)}:1` : '—'}
        </span>
      </td>
      <td className="pr-2">
        <div className="flex items-center justify-end gap-2">
          <Sparkline data={idea.spark} width={70} height={18} />
          <TradeButton symbol={idea.symbol} size="xs" />
        </div>
      </td>
    </tr>
  );
}

export function IdeaTable({ ideas }: { ideas: TradeIdea[] }) {
  if (!ideas.length) {
    return (
      <div className="p-5 text-center">
        <div className="label mb-1.5">No qualifying setups</div>
        <p className="text-[10.5px] text-ink-3 max-w-md mx-auto leading-relaxed">
          Every instrument in this class scored below the conviction floor. That is a
          finding, not a gap: when the signals disagree, the correct position is no position.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="dt">
        <thead>
          <tr>
            <th className="w-8">#</th>
            <th className="!text-left">Instrument</th>
            <th>Last</th>
            <th>Chg%</th>
            <th>Signal</th>
            <th>Conviction</th>
            <th className="hidden md:table-cell">Entry</th>
            <th className="hidden md:table-cell">Stop</th>
            <th className="hidden lg:table-cell">Target</th>
            <th className="hidden lg:table-cell">R:R</th>
            <th className="w-[136px]">30D</th>
          </tr>
        </thead>
        <tbody>
          {ideas.map((idea, i) => <IdeaRow key={idea.symbol} idea={idea} rank={i + 1} />)}
        </tbody>
      </table>
    </div>
  );
}
