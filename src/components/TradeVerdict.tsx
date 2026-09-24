/* ===========================================================================
   The Trade view: one decision, and the reasoning behind it.

   The dossier shows every analytic and lets the reader synthesise. This does
   the synthesis and commits — a single call, written the way an analyst writes
   a note. Shared by the Next.js route and the standalone browser build.
   ========================================================================= */

'use client';

import Link from 'next/link';
import { Panel } from '@/components/Panel';
import { PriceChart } from '@/components/PriceChart';
import { ConvictionGauge, Meter, ScoreBar } from '@/components/Gauge';
import { ProvenanceBadge } from '@/components/ProvenanceBadge';
import { fmtPrice, fmtNum } from '@/lib/util/format';
import type { AnalystNote } from '@/lib/signals/analyst';
import type { SignalResult, Bar } from '@/lib/types';
import type { IndicatorSnapshot } from '@/lib/indicators';
import type { Instrument } from '@/lib/market/universe';

export interface TradeView {
  instrument: Instrument;
  note: AnalystNote;
  signal: SignalResult;
  snapshot: IndicatorSnapshot;
  bars: Bar[];
  simulated: boolean;
  source?: string;
}

const TONE = {
  BUY: { fg: 'var(--color-long)', bg: 'var(--color-long)' },
  SELL: { fg: 'var(--color-short)', bg: 'var(--color-short)' },
  'NO TRADE': { fg: 'var(--color-ink-2)', bg: 'var(--color-flat)' },
} as const;

export function TradeVerdict({ v }: { v: TradeView }) {
  const { note, signal: sig, snapshot: s, instrument: inst } = v;
  const tone = TONE[note.action];
  const isFlat = note.action === 'NO TRADE';
  const plan = sig.plan;

  // Evidence is coloured by what it ARGUES, not by which column it sits in.
  // On a SELL the supporting case is bearish, so colouring it green because it
  // happens to be the "supporting" column inverts the meaning of the colour.
  const supportTone: 'long' | 'short' = isFlat ? 'long' : note.direction === 'LONG' ? 'long' : 'short';
  const againstTone: 'long' | 'short' = supportTone === 'long' ? 'short' : 'long';

  return (
    <div className="min-h-full">
      {/* ================= THE CALL ================= */}
      <div
        className="border-b-2 px-3 py-4"
        style={{ borderColor: tone.fg, background: `color-mix(in srgb, ${tone.fg} 7%, var(--color-terminal))` }}
      >
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <div className="min-w-0">
            <div className="flex items-baseline gap-2.5 mb-2">
              <span className="label-xs">TRADE DESK CALL</span>
              <span className="num text-[11px] text-ink-3">{inst.symbol}</span>
              <ProvenanceBadge provenance={v.simulated ? 'simulated' : 'live'} source={v.source} />
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <div
                className="px-5 py-2.5 font-bold tracking-[0.2em] text-[28px] leading-none"
                style={{ background: tone.bg, color: 'var(--color-void)' }}
              >
                {note.action}
              </div>
              {!isFlat && (
                <div className="leading-tight">
                  <div className="num text-2xl font-bold" style={{ color: tone.fg }}>{note.direction}</div>
                  <div className="text-[11px] text-ink-2 mt-1">{note.expression}</div>
                </div>
              )}
            </div>
            <p className="text-[13px] leading-[1.6] text-ink mt-3 max-w-3xl">{note.headline}</p>
          </div>

          <div className="flex items-start gap-6 ml-auto">
            <ConvictionGauge score={sig.score} conviction={sig.conviction} size={158} />
            <div className="flex flex-col gap-2.5 pt-2">
              <Stat label="CONVICTION" value={`${sig.conviction.toFixed(0)} / 100`} note={note.convictionWord} />
              <Stat label="AGREEMENT" value={`${(sig.agreement * 100).toFixed(0)}%`} note={`${sig.votes.length} analytics`} />
              <Stat label="REGIME" value={sig.regime.label} small />
              <div>
                <div className="label-xs mb-1">DATA QUALITY</div>
                <Meter
                  value={sig.dataQuality * 100} width={110} height={4}
                  colour={sig.dataQuality > 0.7 ? 'var(--color-long)' : 'var(--color-amber)'}
                />
              </div>
            </div>
          </div>
        </div>

        {!isFlat && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-5 gap-y-3 mt-4 pt-4 border-t border-hairline max-w-4xl">
            <KeyNum label="ENTRY" value={fmtPrice(plan.entry)} />
            <KeyNum label="STOP" value={fmtPrice(plan.stop)} tone="short" />
            <KeyNum label="TARGET" value={fmtPrice(plan.targets[0])} tone="long" />
            <KeyNum
              label="REWARD : RISK"
              value={Number.isFinite(plan.riskReward) ? `${fmtNum(plan.riskReward, 2)} : 1` : '—'}
              tone={plan.riskReward >= 2 ? 'long' : undefined}
            />
            <KeyNum label="RISK / TRADE" value={`${(plan.riskFraction * 100).toFixed(2)}%`} />
          </div>
        )}
      </div>

      {/* ================= THE NOTE ================= */}
      <div className="p-2 grid grid-cols-1 xl:grid-cols-12 gap-2">
        <div className="xl:col-span-8 flex flex-col gap-2 min-w-0">
          <Panel title="The thesis" accent>
            <p className="p-4 text-[13px] leading-[1.75] text-ink">{note.thesis}</p>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <Panel
              title={note.supportingHeading}
              actions={<span className={`label-xs ${supportTone === 'long' ? 'text-long' : 'text-short'}`}>{note.supporting.length}</span>}
            >
              <Evidence items={note.supporting} tone={supportTone} />
            </Panel>
            <Panel
              title={note.againstHeading}
              actions={<span className={`label-xs ${againstTone === 'long' ? 'text-long' : 'text-short'}`}>{note.against.length}</span>}
            >
              <Evidence items={note.against} tone={againstTone} />
            </Panel>
          </div>

          <Panel title={`${inst.symbol} — the picture`} provenance={v.simulated ? 'simulated' : 'live'}>
            <div className="p-1">
              <PriceChart
                bars={v.bars}
                height={280}
                maxBars={150}
                overlays={[
                  { data: s.ema21Series, colour: 'var(--color-ice)', label: 'EMA21' },
                  { data: s.sma50Series, colour: 'var(--color-violet)', label: 'SMA50' },
                  { data: s.sma200Series, colour: 'var(--color-amber)', label: 'SMA200' },
                ]}
                markers={
                  isFlat
                    ? []
                    : [
                        { price: plan.entry, label: 'ENTRY', colour: 'var(--color-ink-2)' },
                        { price: plan.stop, label: 'STOP', colour: 'var(--color-short)' },
                        ...plan.targets.slice(0, 2).map((t, idx) => ({
                          price: t, label: `T${idx + 1}`, colour: 'var(--color-long)',
                        })),
                      ]
                }
              />
            </div>
          </Panel>

          <Prose title="Technical read" body={note.technical} />
          {note.fundamental && <Prose title="Fundamental read" body={note.fundamental} />}
          {note.flow && <Prose title="Flow, positioning and sentiment" body={note.flow} />}
          <Prose title="Volatility" body={note.volatility} />
        </div>

        <div className="xl:col-span-4 flex flex-col gap-2 min-w-0">
          <Panel title="What would prove this wrong" accent>
            <p className="p-3.5 text-[12px] leading-[1.7] text-ink-2">{note.invalidation}</p>
          </Panel>

          <Panel title="How to express it">
            <p className="p-3.5 text-[12px] leading-[1.7] text-ink-2">{note.execution}</p>
          </Panel>

          <Panel title="Bottom line" accent>
            <p className="p-3.5 text-[13px] leading-[1.7] text-ink font-medium">{note.bottomLine}</p>
          </Panel>

          {sig.warnings.length > 0 && (
            <Panel title="Risk notices">
              <ul className="p-3 space-y-1.5">
                {sig.warnings.map((w, idx) => (
                  <li key={idx} className="flex gap-2 text-[10.5px] leading-[1.6] text-ink-2">
                    <span className="text-amber shrink-0">▸</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <Panel title="Score attribution">
            <div className="p-3 space-y-1.5">
              {sig.attribution.filter((a) => Math.abs(a.contribution) > 0.001).slice(0, 9).map((a) => (
                <div key={a.family} className="flex items-center gap-2">
                  <span className="text-[10px] text-ink-3 w-[84px] shrink-0 truncate capitalize">
                    {a.family.replace('meanreversion', 'mean rev')}
                  </span>
                  <ScoreBar score={a.score} width={70} height={7} />
                  <span className={`num text-[10px] w-12 text-right shrink-0 ${a.contribution >= 0 ? 'text-long' : 'text-short'}`}>
                    {a.contribution >= 0 ? '+' : ''}{fmtNum(a.contribution, 3)}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Disclosure">
            <p className="p-3.5 text-[10.5px] leading-[1.65] text-ink-3">{note.disclosure}</p>
          </Panel>

          <Link
            href={`/ticker/${encodeURIComponent(inst.symbol)}`}
            className="text-center py-2 border border-hairline-bright text-[10px] font-bold tracking-[0.12em] text-ink-2 hover:border-amber hover:text-amber transition-colors"
          >
            FULL DOSSIER →
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Evidence({ items, tone }: { items: AnalystNote['supporting']; tone: 'long' | 'short' }) {
  if (!items.length) {
    return <div className="label p-4 text-center">Nothing material on this side</div>;
  }
  return (
    <ol className="p-3 space-y-3">
      {items.map((it, i) => (
        <li key={i} className="flex gap-2.5">
          <span
            className="num text-[10px] font-bold shrink-0 w-4 pt-0.5"
            style={{ color: tone === 'long' ? 'var(--color-long)' : 'var(--color-short)' }}
          >
            {String(i + 1).padStart(2, '0')}
          </span>
          <div className="min-w-0">
            <div className="text-[11.5px] font-semibold text-ink mb-1">{it.heading}</div>
            <p className="text-[11px] leading-[1.6] text-ink-3">{it.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Prose({ title, body }: { title: string; body: string }) {
  return (
    <Panel title={title}>
      <p className="p-4 text-[12.5px] leading-[1.75] text-ink-2">{body}</p>
    </Panel>
  );
}

function Stat({ label, value, note, small }: { label: string; value: string; note?: string; small?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label-xs mb-0.5">{label}</div>
      <div className={`num ${small ? 'text-[10.5px]' : 'text-[13px]'} font-bold text-ink truncate`}>{value}</div>
      {note && <div className="label-xs mt-0.5">{note}</div>}
    </div>
  );
}

function KeyNum({ label, value, tone }: { label: string; value: string; tone?: 'long' | 'short' }) {
  return (
    <div className="min-w-0">
      <div className="label-xs mb-1">{label}</div>
      <div className={`num text-[15px] font-bold truncate ${
        tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink'
      }`}>{value}</div>
    </div>
  );
}
