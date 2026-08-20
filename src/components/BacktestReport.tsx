/* ===========================================================================
   Backtest report view.

   Shared by the Next.js route (which loads the artefact from disk) and the
   standalone browser build (which embeds it), so both render the exact run
   that was executed rather than recomputing anything.
   ========================================================================= */

'use client';

import { Panel } from '@/components/Panel';
import { EquityChart } from '@/components/PriceChart';
import { ScoreBar } from '@/components/Gauge';
import { fmtUsd, fmtPct, fmtNum, fmtDateShort } from '@/lib/util/format';
import type { BacktestResult } from '@/lib/backtest/types';
import type { MonteCarloResult } from '@/lib/backtest/metrics';

export type Artefact = BacktestResult & { monteCarlo: MonteCarloResult; generatedAt: number };

export function BacktestReport({ run }: { run: Artefact }) {
  return (
    <div className="p-2 flex flex-col gap-2">
      <RunHeader run={run} />

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-2">
        <div className="xl:col-span-8 flex flex-col gap-2 min-w-0">
          <Panel
            title="Equity curve"
            subtitle={`${fmtDateShort(run.startTime)} — ${fmtDateShort(run.endTime)} · ${run.barsTested} bars`}
            provenance={run.dataProvenance === 'simulated' ? 'simulated' : 'derived'}
            source={run.dataSource}
            accent
          >
            <div className="p-2">
              <EquityChart
                equity={run.equityCurve.map((e) => ({ time: e.time, value: e.markToMarket }))}
                initial={run.metrics.initialCapital}
                height={250}
              />
              <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 mt-2 pt-2 border-t border-hairline">
                <Metric label="FINAL" value={fmtUsd(run.metrics.finalEquity)} big
                  tone={run.metrics.totalReturn >= 0 ? 'long' : 'short'} />
                <Metric label="RETURN" value={fmtPct(run.metrics.totalReturnPct)}
                  tone={run.metrics.totalReturnPct >= 0 ? 'long' : 'short'} />
                <Metric label="CAGR" value={fmtPct(run.metrics.cagr)} />
                <Metric label="MAX DD" value={fmtPct(run.metrics.maxDrawdownPct)} tone="short" />
                <Metric label="BUY & HOLD" value={fmtPct(run.metrics.buyHoldReturnPct)} />
                <Metric label="ALPHA" value={fmtPct(run.metrics.alphaVsBuyHold)}
                  tone={run.metrics.alphaVsBuyHold >= 0 ? 'long' : 'short'} />
              </div>
            </div>
          </Panel>

          <SignificancePanel run={run} />

          <Panel title="Trade log" subtitle={`${run.trades.length} closed trades`} provenance="derived">
            <div className="overflow-x-auto max-h-[420px]">
              <table className="dt">
                <thead>
                  <tr>
                    <th className="!text-left">#</th>
                    <th className="!text-left">Dir</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th className="!text-left">Reason</th>
                    <th>Bars</th>
                    <th>R</th>
                    <th>P&amp;L</th>
                    <th>Equity</th>
                    <th className="hidden lg:table-cell">MAE</th>
                    <th className="hidden lg:table-cell">MFE</th>
                    <th className="hidden xl:table-cell">Conv</th>
                  </tr>
                </thead>
                <tbody>
                  {run.trades.map((t) => (
                    <tr key={t.id}>
                      <td className="!text-left num text-ink-4">{t.id}</td>
                      <td className="!text-left">
                        <span className={`label-xs ${t.direction === 'long' ? 'text-long' : 'text-short'}`}>
                          {t.direction.toUpperCase()}
                        </span>
                      </td>
                      <td className="num text-[10.5px]">{fmtNum(t.entryFill, 2)}</td>
                      <td className="num text-[10.5px]">{fmtNum(t.exitFill, 2)}</td>
                      <td className="!text-left">
                        <span className="label-xs">{t.exitReason.replace('_', ' ')}</span>
                      </td>
                      <td className="num text-ink-3">{t.barsHeld}</td>
                      <td>
                        <div className="flex items-center justify-end gap-1.5">
                          <ScoreBar score={Math.max(-1, Math.min(1, t.rMultiple / 3))} width={34} height={6} />
                          <span className={`num text-[10.5px] w-10 text-right ${t.rMultiple >= 0 ? 'text-long' : 'text-short'}`}>
                            {fmtNum(t.rMultiple, 2)}
                          </span>
                        </div>
                      </td>
                      <td className={`num text-[10.5px] ${t.netPnl >= 0 ? 'text-long' : 'text-short'}`}>
                        {fmtUsd(t.netPnl)}
                      </td>
                      <td className="num text-[10.5px] text-ink-2">{fmtUsd(t.equityAfter)}</td>
                      <td className="num text-[10px] text-short/70 hidden lg:table-cell">
                        {fmtNum(t.maxAdverseR, 2)}
                      </td>
                      <td className="num text-[10px] text-long/70 hidden lg:table-cell">
                        {fmtNum(t.maxFavourableR, 2)}
                      </td>
                      <td className="num text-[10px] text-ink-3 hidden xl:table-cell">
                        {t.convictionAtEntry.toFixed(0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <Panel title="What this result does and does not establish" accent>
            <ul className="p-3 space-y-2">
              {run.caveats.map((c, i) => (
                <li key={i} className="flex gap-2.5 text-[11px] leading-[1.6] text-ink-2">
                  <span className="text-amber shrink-0">▸</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="xl:col-span-4 flex flex-col gap-2 min-w-0">
          <MetricsPanel run={run} />
          <MonteCarloPanel mc={run.monteCarlo} initial={run.metrics.initialCapital} />
          <ExitPanel run={run} />
          <ConfigPanel run={run} />
        </div>
      </div>

    </div>
  );
}

/* ------------------------------------------------------------------ */

function RunHeader({ run }: { run: Artefact }) {
  const m = run.metrics;
  const up = m.totalReturnPct >= 0;
  return (
    <div className="border border-hairline bg-terminal px-3 py-2.5 flex flex-wrap items-center gap-x-8 gap-y-3">
      <div>
        <div className="flex items-baseline gap-2.5">
          <h1 className="num text-xl font-bold text-ink">{run.symbol}</h1>
          <span className="label-xs border border-hairline px-1.5 py-0.5">BACKTEST</span>
          {run.dataProvenance === 'simulated' && (
            <span className="label-xs text-amber border border-amber/40 bg-amber/10 px-1.5 py-0.5">
              SYNTHETIC PRICES
            </span>
          )}
        </div>
        <div className="label-xs mt-1.5">
          {fmtDateShort(run.startTime)} → {fmtDateShort(run.endTime)} · {run.barsTested} bars · {run.config.horizon}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <div>
          <div className="label-xs mb-1">STARTING CAPITAL</div>
          <div className="num text-2xl font-bold text-ink-2">{fmtUsd(m.initialCapital)}</div>
        </div>
        <span className="text-ink-4 text-xl mb-1">→</span>
        <div>
          <div className="label-xs mb-1">FINAL EQUITY</div>
          <div className={`num text-2xl font-bold ${up ? 'text-long' : 'text-short'}`}>
            {fmtUsd(m.finalEquity)}
          </div>
        </div>
        <div className={`num text-[13px] font-semibold mb-1.5 ml-2 ${up ? 'text-long' : 'text-short'}`}>
          {fmtPct(m.totalReturnPct)}
        </div>
      </div>
    </div>
  );
}

function SignificancePanel({ run }: { run: Artefact }) {
  const m = run.metrics;
  const significant = Number.isFinite(m.pValue) && m.pValue < 0.05;
  return (
    <Panel
      title="Is this an edge, or is this luck?"
      accent
      actions={
        <span className={`label-xs ${significant ? 'text-long' : 'text-amber'}`}>
          {significant ? 'SIGNIFICANT AT 5%' : 'NOT SIGNIFICANT'}
        </span>
      }
    >
      <div className="p-3">
        <p className="text-[12px] leading-[1.65] text-ink mb-3">{m.significance}</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Metric label="MEAN R / TRADE" value={fmtNum(m.expectancyR, 3)}
            tone={m.expectancyR > 0 ? 'long' : 'short'} />
          <Metric label="t-STATISTIC" value={fmtNum(m.tStat, 3)} />
          <Metric label="p-VALUE" value={Number.isFinite(m.pValue) ? m.pValue.toFixed(4) : '—'} />
          <Metric label="STD ERROR" value={fmtNum(m.standardError, 4)} />
        </div>
        <p className="text-[10px] text-ink-4 leading-relaxed mt-3 pt-3 border-t border-hairline">
          A t-test of mean R against zero. This is the question every backtest should answer and most
          do not: with a few dozen trades, a positive average is entirely consistent with noise. Note
          that in-sample significance is a far weaker claim than out-of-sample significance — this
          says the sample is unlikely under a zero-edge null, not that the edge will persist.
        </p>
      </div>
    </Panel>
  );
}

function MetricsPanel({ run }: { run: Artefact }) {
  const m = run.metrics;
  const groups: { title: string; rows: [string, string, ('long' | 'short' | undefined)?][] }[] = [
    {
      title: 'RISK-ADJUSTED',
      rows: [
        ['Sharpe ratio', fmtNum(m.sharpe, 2), m.sharpe > 0 ? 'long' : 'short'],
        ['Sortino ratio', fmtNum(m.sortino, 2), m.sortino > 0 ? 'long' : 'short'],
        ['Calmar ratio', fmtNum(m.calmar, 2)],
        ['Martin ratio', fmtNum(m.martin, 2)],
      ],
    },
    {
      title: 'RISK',
      rows: [
        ['Max drawdown', fmtPct(m.maxDrawdownPct), 'short'],
        ['DD duration', `${m.maxDrawdownDurationBars} bars`],
        ['Volatility p.a.', fmtPct(m.volatility, 1, false)],
        ['Ulcer index', fmtNum(m.ulcerIndex, 2)],
        ['VaR 95%', Number.isFinite(m.var95) ? fmtPct(m.var95) : '—'],
        ['CVaR 95%', Number.isFinite(m.cvar95) ? fmtPct(m.cvar95) : '—'],
      ],
    },
    {
      title: 'TRADE STATISTICS',
      rows: [
        ['Total trades', String(m.totalTrades)],
        ['Win rate', fmtPct(m.winRate * 100, 1, false), m.winRate > 0.5 ? 'long' : undefined],
        ['Profit factor', Number.isFinite(m.profitFactor) ? fmtNum(m.profitFactor, 2) : 'n/a',
          m.profitFactor > 1 ? 'long' : 'short'],
        ['Expectancy', fmtUsd(m.expectancy), m.expectancy > 0 ? 'long' : 'short'],
        ['Avg win / loss', `${fmtNum(m.avgWinR, 2)}R / ${fmtNum(m.avgLossR, 2)}R`],
        ['Payoff ratio', fmtNum(m.payoffRatio, 2)],
        ['Best / worst', `${fmtNum(m.bestTradeR, 2)}R / ${fmtNum(m.worstTradeR, 2)}R`],
        ['Max consec W/L', `${m.maxConsecutiveWins} / ${m.maxConsecutiveLosses}`],
        ['Avg bars held', fmtNum(m.avgBarsHeld, 1)],
        ['Time in market', fmtPct(m.exposureTime * 100, 0, false)],
        ['Tail ratio', fmtNum(m.tailRatio, 2)],
        ['Implied Kelly', Number.isFinite(m.impliedKelly) ? fmtPct(m.impliedKelly * 100, 1, false) : '—'],
      ],
    },
    {
      title: 'DIRECTION & COST',
      rows: [
        ['Long trades', `${m.longTrades} @ ${fmtPct(m.longWinRate * 100, 0, false)}`],
        ['Short trades', `${m.shortTrades} @ ${fmtPct(m.shortWinRate * 100, 0, false)}`],
        ['Total costs', fmtUsd(m.totalCosts), 'short'],
        ['Cost drag', fmtPct(m.costDragPct, 2, false), 'short'],
      ],
    },
  ];

  return (
    <Panel title="Performance metrics" provenance="derived">
      <div className="p-3 space-y-3">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="label mb-1.5">{g.title}</div>
            <div className="space-y-[3px]">
              {g.rows.map(([label, value, tone]) => (
                <div key={label} className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] text-ink-3 truncate">{label}</span>
                  <span className={`num text-[10.5px] font-semibold shrink-0 ${
                    tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink-2'
                  }`}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function MonteCarloPanel({ mc, initial }: { mc: MonteCarloResult; initial: number }) {
  if (!mc || mc.runs === 0) return null;
  const band = [
    ['5th pct', mc.p5], ['25th pct', mc.p25], ['Median', mc.median],
    ['75th pct', mc.p75], ['95th pct', mc.p95],
  ] as const;
  const lo = Math.min(mc.p5, initial);
  const hi = Math.max(mc.p95, initial);
  const span = hi - lo || 1;

  return (
    <Panel title="Monte Carlo" subtitle={`${mc.runs.toLocaleString()} bootstrap resamples`} provenance="derived">
      <div className="p-3">
        <div className="space-y-[5px] mb-3">
          {band.map(([label, v]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-[10px] text-ink-3 w-14 shrink-0">{label}</span>
              <div className="flex-1 h-3 bg-[#10151d] relative min-w-[60px]">
                <div
                  className={`h-full ${v >= initial ? 'bg-long/55' : 'bg-short/55'}`}
                  style={{ width: `${((v - lo) / span) * 100}%` }}
                />
                <div
                  className="absolute top-0 bottom-0 w-px bg-ink-3"
                  style={{ left: `${((initial - lo) / span) * 100}%` }}
                  title="starting capital"
                />
              </div>
              <span className={`num text-[10px] w-14 text-right shrink-0 ${v >= initial ? 'text-long' : 'text-short'}`}>
                {fmtUsd(v)}
              </span>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2 pb-3 mb-3 border-b border-hairline">
          <div>
            <div className="label-xs mb-0.5">P(LOSS)</div>
            <div className={`num text-[13px] font-bold ${mc.probLoss > 0.3 ? 'text-short' : 'text-ink'}`}>
              {fmtPct(mc.probLoss * 100, 1, false)}
            </div>
          </div>
          <div>
            <div className="label-xs mb-0.5">MED MAX DD</div>
            <div className="num text-[13px] font-bold text-short">{fmtPct(mc.medianMaxDd)}</div>
          </div>
          <div>
            <div className="label-xs mb-0.5">WORST DD</div>
            <div className="num text-[13px] font-bold text-short">{fmtPct(mc.worstMaxDd)}</div>
          </div>
        </div>

        <p className="text-[10px] leading-[1.6] text-ink-3">{mc.note}</p>
      </div>
    </Panel>
  );
}

function ExitPanel({ run }: { run: Artefact }) {
  const entries = Object.entries(run.metrics.byExitReason).sort((a, b) => b[1] - a[1]);
  const total = run.metrics.totalTrades || 1;
  const COLOURS: Record<string, string> = {
    target: 'var(--color-long)', trailing_stop: 'var(--color-long)',
    stop: 'var(--color-short)', signal_flip: 'var(--color-amber)',
    signal_decay: 'var(--color-amber)', max_hold: 'var(--color-ice)',
    end_of_data: 'var(--color-ink-4)',
  };
  return (
    <Panel title="Exit distribution" provenance="derived">
      <div className="p-3 space-y-1.5">
        {entries.map(([reason, count]) => (
          <div key={reason} className="flex items-center gap-2">
            <span className="text-[10px] text-ink-3 w-[86px] shrink-0 truncate">
              {reason.replace('_', ' ')}
            </span>
            <div className="flex-1 h-3 bg-[#10151d] min-w-[50px]">
              <div className="h-full" style={{
                width: `${(count / total) * 100}%`,
                background: COLOURS[reason] ?? 'var(--color-ink-3)',
                opacity: 0.7,
              }} />
            </div>
            <span className="num text-[10px] text-ink-2 w-12 text-right shrink-0">
              {count} · {((count / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function ConfigPanel({ run }: { run: Artefact }) {
  const c = run.config;
  const rows: [string, string][] = [
    ['Initial capital', fmtUsd(c.initialCapital)],
    ['Commission', `${(c.commission * 10000).toFixed(1)}bp / side`],
    ['Slippage', `${(c.slippage * 10000).toFixed(1)}bp / side`],
    ['Funding', `${(c.fundingRate * 100).toFixed(1)}% p.a.`],
    ['Max risk / trade', `${(c.maxRiskFraction * 100).toFixed(1)}%`],
    ['Conviction floor', String(c.convictionThreshold)],
    ['Shorts allowed', c.allowShorts ? 'yes' : 'no'],
    ['Max hold', `${c.maxHoldBars} bars`],
    ['Breakeven at', `${c.breakevenAtR}R`],
    ['Trail multiple', `${c.trailAtrMultiple}x`],
    ['Warmup', `${c.warmupBars} bars`],
    ['Periods / year', String(c.periodsPerYear)],
  ];
  return (
    <Panel title="Run configuration" provenance="derived">
      <div className="p-3 space-y-[3px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] text-ink-3 truncate">{k}</span>
            <span className="num text-[10.5px] text-ink-2 shrink-0">{v}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function Metric({
  label, value, tone, big = false,
}: { label: string; value: string; tone?: 'long' | 'short'; big?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="label-xs mb-1">{label}</div>
      <div className={`num ${big ? 'text-[17px]' : 'text-[13px]'} font-bold truncate ${
        tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink'
      }`}>{value}</div>
    </div>
  );
}
