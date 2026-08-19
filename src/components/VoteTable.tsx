import { ScoreBar } from './Gauge';
import { ProvenanceBadge } from './ProvenanceBadge';
import type { Vote, FamilyAttribution } from '@/lib/types';
import { fmtNum } from '@/lib/util/format';

const FAMILY_LABEL: Record<string, string> = {
  trend: 'Trend', momentum: 'Momentum', meanreversion: 'Mean reversion',
  volatility: 'Volatility', volume: 'Volume', structure: 'Structure',
  pattern: 'Pattern', fundamental: 'Fundamental', valuation: 'Valuation',
  quality: 'Quality', earnings: 'Earnings', insider: 'Insider',
  institutional: 'Institutional', social: 'Social', news: 'News',
  macro: 'Macro', options: 'Options', seasonality: 'Seasonality',
  intermarket: 'Intermarket',
};

export function AttributionChart({ attribution }: { attribution: FamilyAttribution[] }) {
  const shown = attribution.filter((a) => Math.abs(a.contribution) > 0.0005);
  if (!shown.length) return <div className="label p-4">No attribution data</div>;
  const max = Math.max(...shown.map((a) => Math.abs(a.contribution)), 0.01);

  return (
    <div className="p-3 space-y-[5px]">
      {shown.map((a) => {
        const pos = a.contribution >= 0;
        const w = (Math.abs(a.contribution) / max) * 100;
        return (
          <div key={a.family} className="flex items-center gap-2">
            <span className="text-[10px] text-ink-2 w-[92px] shrink-0 truncate">
              {FAMILY_LABEL[a.family] ?? a.family}
            </span>
            <span className="label-xs w-5 shrink-0 text-right">{a.voteCount}</span>
            <div className="flex-1 flex items-center h-3.5 min-w-[80px]">
              <div className="w-1/2 flex justify-end h-full items-center">
                {!pos && <div className="h-2.5 bg-short/75" style={{ width: `${w}%` }} />}
              </div>
              <div className="w-px h-3.5 bg-hairline-bright shrink-0" />
              <div className="w-1/2 h-full flex items-center">
                {pos && <div className="h-2.5 bg-long/75" style={{ width: `${w}%` }} />}
              </div>
            </div>
            <span className={`num text-[10px] w-14 text-right shrink-0 ${pos ? 'text-long' : 'text-short'}`}>
              {pos ? '+' : ''}{fmtNum(a.contribution, 3)}
            </span>
          </div>
        );
      })}
      <p className="text-[9.5px] text-ink-4 leading-relaxed pt-2 mt-1 border-t border-hairline">
        Contribution is each family&apos;s share of the net score after regime weighting, horizon
        weighting and per-vote confidence. Families sum to the headline score, so this is a
        decomposition of the verdict rather than a separate opinion about it.
      </p>
    </div>
  );
}

export function VoteTable({ votes }: { votes: Vote[] }) {
  const sorted = [...votes].sort(
    (a, b) => Math.abs(b.score * b.confidence) - Math.abs(a.score * a.confidence),
  );

  return (
    <div className="overflow-x-auto">
      <table className="dt">
        <thead>
          <tr>
            <th className="!text-left">Analytic</th>
            <th className="!text-left hidden sm:table-cell">Family</th>
            <th>Reading</th>
            <th className="w-[74px]">Score</th>
            <th>Conf</th>
            <th className="!text-left hidden lg:table-cell">Interpretation</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((v) => (
            <tr key={v.id}>
              <td className="!text-left">
                <span className="text-[11px] text-ink font-medium">{v.label}</span>
              </td>
              <td className="!text-left hidden sm:table-cell">
                <span className="label-xs">{FAMILY_LABEL[v.family] ?? v.family}</span>
              </td>
              <td className="num text-[10.5px] text-ink-2 whitespace-nowrap">{v.reading ?? '—'}</td>
              <td>
                <div className="flex justify-end">
                  <ScoreBar score={v.score} width={64} height={7} />
                </div>
              </td>
              <td className="num text-[10px] text-ink-3">{(v.confidence * 100).toFixed(0)}%</td>
              <td className="!text-left hidden lg:table-cell max-w-[520px]">
                <span className="text-[10px] text-ink-3 leading-snug block">{v.rationale}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
