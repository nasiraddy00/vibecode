import { ConvictionGauge, ScoreBar, Meter } from './Gauge';
import { fmtPrice, fmtPct, fmtNum, fmtUsd } from '@/lib/util/format';
import type { SignalResult } from '@/lib/types';

const ACTION_TONE: Record<string, { bg: string; fg: string }> = {
  'STRONG BUY': { bg: 'var(--color-long)', fg: 'var(--color-void)' },
  'BUY': { bg: 'color-mix(in srgb, var(--color-long) 22%, transparent)', fg: 'var(--color-long)' },
  'ACCUMULATE': { bg: 'color-mix(in srgb, var(--color-long) 12%, transparent)', fg: 'var(--color-long)' },
  'HOLD': { bg: 'var(--color-raised)', fg: 'var(--color-ink-2)' },
  'REDUCE': { bg: 'color-mix(in srgb, var(--color-short) 12%, transparent)', fg: 'var(--color-short)' },
  'SELL': { bg: 'color-mix(in srgb, var(--color-short) 22%, transparent)', fg: 'var(--color-short)' },
  'STRONG SELL': { bg: 'var(--color-short)', fg: 'var(--color-void)' },
};

export function VerdictCard({ signal }: { signal: SignalResult }) {
  const tone = ACTION_TONE[signal.action] ?? ACTION_TONE.HOLD;
  const p = signal.plan;
  const isFlat = p.direction === 'flat';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,200px)_1fr] gap-4 p-4">
      {/* ---- gauge column ---- */}
      <div className="flex flex-col items-center gap-3">
        <ConvictionGauge score={signal.score} conviction={signal.conviction} size={186} />

        <div
          className="w-full text-center py-2 font-bold tracking-[0.18em] text-[15px]"
          style={{ background: tone.bg, color: tone.fg }}
        >
          {signal.action}
        </div>

        <div className="w-full grid grid-cols-2 gap-2">
          <MicroStat
            label="DIRECTION"
            value={isFlat ? 'FLAT' : p.direction.toUpperCase()}
            tone={isFlat ? undefined : p.direction === 'long' ? 'long' : 'short'}
          />
          <MicroStat
            label="EXPRESSION"
            value={p.instrument === 'none' ? '—' : p.instrument.replace('_', ' ').toUpperCase()}
          />
        </div>

        <div className="w-full">
          <div className="flex justify-between items-baseline mb-1">
            <span className="label">DATA QUALITY</span>
            <span className="num text-[10.5px] text-ink-2">{(signal.dataQuality * 100).toFixed(0)}%</span>
          </div>
          <Meter
            value={signal.dataQuality * 100}
            width={999} height={4}
            colour={signal.dataQuality > 0.7 ? 'var(--color-long)' : signal.dataQuality > 0.5 ? 'var(--color-ice)' : 'var(--color-amber)'}
          />
          <p className="text-[9.5px] text-ink-4 mt-1.5 leading-snug">
            {signal.dataQuality < 0.6
              ? 'Conviction reflects signal strength only. This score is computed on simulated prices, so it measures the engine, not the market.'
              : 'Share of inputs backed by real market data. Reported separately from conviction so a strong signal on weak data cannot hide.'}
          </p>
        </div>
      </div>

      {/* ---- detail column ---- */}
      <div className="min-w-0 flex flex-col gap-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pb-3 border-b border-hairline">
          <Stat label="NET SCORE" value={`${signal.score >= 0 ? '+' : ''}${fmtNum(signal.score, 3)}`}
            tone={signal.score > 0 ? 'long' : signal.score < 0 ? 'short' : undefined} />
          <Stat label="AGREEMENT" value={`${(signal.agreement * 100).toFixed(0)}%`}
            tone={signal.agreement > 0.7 ? 'long' : signal.agreement < 0.55 ? 'short' : undefined} />
          <Stat label="ANALYTICS" value={String(signal.votes.length)} />
          <Stat label="REGIME" value={signal.regime.label} small />
        </div>

        <p className="text-[11.5px] leading-[1.6] text-ink-2">{signal.regime.description}</p>

        {!isFlat ? (
          <div className="border border-hairline bg-raised/40">
            <div className="px-3 py-1.5 border-b border-hairline flex items-center justify-between">
              <span className="label">EXECUTION PLAN</span>
              <span className="label-xs">{p.horizon.toUpperCase()} · ~{p.expectedBars} BARS</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2.5 p-3">
              <Stat label="ENTRY" value={fmtPrice(p.entry)} />
              <Stat label="STOP" value={fmtPrice(p.stop)} tone="short" />
              <Stat label="TARGET 1" value={fmtPrice(p.targets[0])} tone="long" />
              <Stat
                label="REWARD:RISK"
                value={Number.isFinite(p.riskReward) ? `${fmtNum(p.riskReward, 2)}:1` : '—'}
                tone={p.riskReward >= 2 ? 'long' : p.riskReward < 1.3 ? 'short' : undefined}
              />
              <Stat label="RISK / TRADE" value={`${(p.riskFraction * 100).toFixed(2)}%`} />
              <Stat label="SIZE" value={fmtNum(p.size, p.size < 1 ? 6 : 2)} />
              <Stat label="NOTIONAL" value={fmtUsd(p.notional)} />
              <Stat
                label="STOP DISTANCE"
                value={`${(Math.abs(p.entry - p.stop) / p.entry * 100).toFixed(2)}%`}
              />
            </div>

            {p.optionLeg && (
              <div className="border-t border-hairline p-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mb-2">
                  <span className="label text-amber">OPTIONS LEG</span>
                  <span className="num text-[13px] font-bold text-ink">
                    {p.optionLeg.type.toUpperCase()} {fmtPrice(p.optionLeg.strike)}
                  </span>
                  <span className="num text-[11px] text-ink-2">{p.optionLeg.dte}DTE · {p.optionLeg.expiry}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-2">
                  <Stat label="TARGET DELTA" value={fmtNum(p.optionLeg.targetDelta, 2)} />
                  <Stat label="EST. PREMIUM" value={fmtPrice(p.optionLeg.estimatedPremium)} />
                  <Stat label="BREAKEVEN" value={fmtPrice(p.optionLeg.breakeven)} />
                  <Stat label="EST. IV" value={`${(p.optionLeg.estimatedIV * 100).toFixed(1)}%`} />
                </div>
                <p className="text-[10.5px] leading-[1.6] text-ink-3">{p.optionLeg.reason}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="border border-hairline bg-raised/40 p-3">
            <div className="label mb-2">NO POSITION</div>
            {p.notes.map((n, i) => (
              <p key={i} className="text-[11px] leading-[1.6] text-ink-2 mb-1.5 last:mb-0">{n}</p>
            ))}
          </div>
        )}

        {!isFlat && p.notes.length > 0 && (
          <ul className="space-y-1.5">
            {p.notes.map((n, i) => (
              <li key={i} className="flex gap-2 text-[10.5px] leading-[1.6] text-ink-3">
                <span className="text-amber shrink-0">▸</span>
                <span>{n}</span>
              </li>
            ))}
          </ul>
        )}

        {signal.warnings.length > 0 && (
          <div className="border-l-2 border-amber bg-amber/[0.05] p-2.5">
            <div className="label text-amber mb-1.5">RISK NOTICES</div>
            <ul className="space-y-1">
              {signal.warnings.map((w, i) => (
                <li key={i} className="text-[10.5px] leading-[1.55] text-ink-2">— {w}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label, value, tone, small = false,
}: { label: string; value: string; tone?: 'long' | 'short'; small?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label-xs mb-1 truncate">{label}</div>
      <div className={`num ${small ? 'text-[10.5px]' : 'text-[13px]'} font-semibold truncate ${
        tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink'
      }`}>
        {value}
      </div>
    </div>
  );
}

function MicroStat({ label, value, tone }: { label: string; value: string; tone?: 'long' | 'short' }) {
  return (
    <div className="border border-hairline bg-panel px-2 py-1.5 min-w-0">
      <div className="label-xs mb-0.5 truncate">{label}</div>
      <div className={`num text-[11px] font-bold truncate ${
        tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink-2'
      }`}>
        {value}
      </div>
    </div>
  );
}
