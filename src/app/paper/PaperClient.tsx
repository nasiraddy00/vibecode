'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import Link from 'next/link';
import { Panel } from '@/components/Panel';
import { ScoreBar, Meter } from '@/components/Gauge';
import { fmtPrice, fmtPct, fmtNum, fmtUsd, fmtAge } from '@/lib/util/format';
import {
  markPositions, loadPositions, savePositions,
  type PaperPosition, type BlotterSummary,
} from '@/lib/paper';
import { searchInstruments, resolveInstrument } from '@/lib/market/universe';

export function PaperClient() {
  const [positions, setPositions] = useState<PaperPosition[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [provenance, setProvenance] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    setPositions(loadPositions());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) savePositions(positions);
  }, [positions, loaded]);

  const symbols = useMemo(
    () => [...new Set(positions.filter((p) => !p.closed).map((p) => p.symbol))],
    [positions],
  );

  const refresh = useCallback(async () => {
    if (!symbols.length) return;
    try {
      const res = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(','))}`);
      if (!res.ok) return;
      const json = (await res.json()) as { quotes: Record<string, number>; provenance: Record<string, string> };
      setPrices(json.quotes);
      setProvenance(json.provenance);
    } catch {
      // Leave the previous marks in place rather than zeroing the blotter.
    }
  }, [symbols]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const summary: BlotterSummary = useMemo(
    () => markPositions(positions, prices),
    [positions, prices],
  );

  const addPosition = (p: PaperPosition): void => {
    setPositions((prev) => [p, ...prev]);
    setShowForm(false);
  };

  const closePosition = (id: string): void => {
    setPositions((prev) =>
      prev.map((p) =>
        p.id === id && !p.closed
          ? { ...p, closed: { exitPrice: prices[p.symbol] ?? p.entryPrice, exitTime: Date.now(), reason: 'manual' } }
          : p,
      ),
    );
  };

  const removePosition = (id: string): void => {
    setPositions((prev) => prev.filter((p) => p.id !== id));
  };

  if (!loaded) {
    return <div className="p-6 label">Loading blotter…</div>;
  }

  const anySim = Object.values(provenance).some((p) => p === 'simulated');

  return (
    <div className="p-2 flex flex-col gap-2">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-2">
        <div className="xl:col-span-9 flex flex-col gap-2 min-w-0">
          <Panel
            title="Paper blotter"
            subtitle={`${summary.openCount} open · ${summary.closedCount} closed`}
            provenance={anySim ? 'simulated' : positions.length ? 'live' : undefined}
            accent
            actions={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="label-xs border border-hairline px-2 py-1 hover:border-hairline-bright hover:text-ink-2 transition-colors"
                >
                  REFRESH
                </button>
                <button
                  type="button"
                  onClick={() => setShowForm((s) => !s)}
                  className="label-xs border border-amber/50 text-amber bg-amber/10 px-2 py-1 hover:bg-amber/20 transition-colors"
                >
                  {showForm ? 'CANCEL' : '+ TICKET'}
                </button>
              </div>
            }
          >
            {showForm && <TicketForm onSubmit={addPosition} />}

            {positions.length === 0 ? (
              <div className="p-6 text-center">
                <div className="label mb-2">Blotter is empty</div>
                <p className="text-[11px] text-ink-3 max-w-lg mx-auto leading-relaxed">
                  Raise a ticket to track a hypothetical position. Marks refresh every 30 seconds
                  against the same feeds the rest of the terminal uses, and positions persist in this
                  browser only — nothing is transmitted anywhere.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="dt">
                  <thead>
                    <tr>
                      <th className="!text-left">Symbol</th>
                      <th className="!text-left">Side</th>
                      <th>Qty</th>
                      <th>Entry</th>
                      <th>Mark</th>
                      <th>P&amp;L</th>
                      <th>%</th>
                      <th>R</th>
                      <th className="hidden md:table-cell">Stop</th>
                      <th className="hidden md:table-cell">Target</th>
                      <th className="hidden lg:table-cell">Held</th>
                      <th className="hidden lg:table-cell">Conv</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {summary.positions.map((p) => (
                      <tr key={p.id} className={p.isOpen ? '' : 'opacity-55'}>
                        <td className="!text-left">
                          <Link
                            href={`/ticker/${encodeURIComponent(p.symbol)}`}
                            className="num text-[11px] font-bold text-ink hover:text-amber transition-colors"
                          >
                            {p.symbol}
                          </Link>
                          {p.instrument !== 'spot' && (
                            <span className="label-xs ml-1.5 text-amber">
                              {p.instrument.toUpperCase()} {p.strike}
                            </span>
                          )}
                        </td>
                        <td className="!text-left">
                          <span className={`label-xs ${p.direction === 'long' ? 'text-long' : 'text-short'}`}>
                            {p.direction.toUpperCase()}
                          </span>
                          {!p.isOpen && <span className="label-xs text-ink-4 ml-1">CLOSED</span>}
                        </td>
                        <td className="num text-ink-2">{fmtNum(p.quantity, p.quantity < 1 ? 4 : 0)}</td>
                        <td className="num">{fmtPrice(p.entryPrice)}</td>
                        <td className="num">{fmtPrice(p.mark)}</td>
                        <td className={`num font-semibold ${p.unrealisedPnl >= 0 ? 'text-long' : 'text-short'}`}>
                          {fmtUsd(p.unrealisedPnl)}
                        </td>
                        <td className={`num ${p.unrealisedPct >= 0 ? 'text-long' : 'text-short'}`}>
                          {fmtPct(p.unrealisedPct, 1)}
                        </td>
                        <td>
                          <div className="flex items-center justify-end gap-1.5">
                            <ScoreBar score={Math.max(-1, Math.min(1, p.rMultiple / 3))} width={32} height={6} />
                            <span className={`num text-[10px] w-9 text-right ${p.rMultiple >= 0 ? 'text-long' : 'text-short'}`}>
                              {fmtNum(p.rMultiple, 2)}
                            </span>
                          </div>
                        </td>
                        <td className="num text-[10px] text-short/75 hidden md:table-cell">
                          {fmtPrice(p.stop)}
                        </td>
                        <td className="num text-[10px] text-long/75 hidden md:table-cell">
                          {fmtPrice(p.target)}
                        </td>
                        <td className="num text-[10px] text-ink-4 hidden lg:table-cell">
                          {p.daysHeld < 1 ? `${(p.daysHeld * 24).toFixed(0)}h` : `${p.daysHeld.toFixed(0)}d`}
                        </td>
                        <td className="num text-[10px] text-ink-3 hidden lg:table-cell">
                          {p.convictionAtEntry.toFixed(0)}
                        </td>
                        <td className="pr-1.5">
                          <div className="flex justify-end gap-1.5">
                            {p.isOpen && (
                              <button
                                type="button"
                                onClick={() => closePosition(p.id)}
                                className="label-xs border border-hairline px-1.5 py-0.5 hover:border-short/60 hover:text-short transition-colors"
                              >
                                CLOSE
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => removePosition(p.id)}
                              className="label-xs text-ink-4 hover:text-short transition-colors px-1"
                              aria-label={`Delete ${p.symbol} ticket`}
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          {summary.closedCount >= 3 && <CalibrationPanel summary={summary} />}
        </div>

        <div className="xl:col-span-3 flex flex-col gap-2 min-w-0">
          <SummaryPanel summary={summary} />
          {summary.warnings.length > 0 && (
            <Panel title="Risk notices" accent>
              <ul className="p-3 space-y-1.5">
                {summary.warnings.map((w, i) => (
                  <li key={i} className="text-[10.5px] leading-[1.55] text-ink-2 flex gap-2">
                    <span className="text-amber shrink-0">▸</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function SummaryPanel({ summary }: { summary: BlotterSummary }) {
  const up = summary.totalPnl >= 0;
  return (
    <Panel title="Account summary" provenance="derived">
      <div className="p-3">
        <div className="mb-3 pb-3 border-b border-hairline">
          <div className="label-xs mb-1">TOTAL P&amp;L</div>
          <div className={`num text-2xl font-bold ${up ? 'text-long' : 'text-short'}`}>
            {fmtUsd(summary.totalPnl)}
          </div>
          <div className={`num text-[11px] mt-0.5 ${up ? 'text-long' : 'text-short'}`}>
            {fmtPct(summary.totalPnlPct, 2)}
          </div>
        </div>

        <div className="space-y-[3px] mb-3 pb-3 border-b border-hairline">
          <KV label="Open P&L" value={fmtUsd(summary.openPnl)} tone={summary.openPnl >= 0 ? 'long' : 'short'} />
          <KV label="Realised P&L" value={fmtUsd(summary.realisedPnl)} tone={summary.realisedPnl >= 0 ? 'long' : 'short'} />
          <KV label="Cost basis" value={fmtUsd(summary.totalCost)} />
          <KV label="Market value" value={fmtUsd(summary.totalValue)} />
        </div>

        <div className="space-y-[3px] mb-3 pb-3 border-b border-hairline">
          <KV label="Gross exposure" value={fmtUsd(summary.grossExposure)} />
          <KV label="Long" value={fmtUsd(summary.netLongExposure)} tone="long" />
          <KV label="Short" value={fmtUsd(summary.netShortExposure)} tone="short" />
        </div>

        <div className="space-y-[3px]">
          <KV label="Closed trades" value={String(summary.closedCount)} />
          <KV
            label="Win rate"
            value={summary.closedCount ? fmtPct(summary.winRate * 100, 0, false) : '—'}
            tone={summary.winRate > 0.5 ? 'long' : undefined}
          />
          <KV label="Avg R" value={summary.closedCount ? fmtNum(summary.avgR, 2) : '—'}
            tone={summary.avgR > 0 ? 'long' : summary.avgR < 0 ? 'short' : undefined} />
          <KV label="Best / worst R" value={summary.closedCount ? `${fmtNum(summary.bestR, 2)} / ${fmtNum(summary.worstR, 2)}` : '—'} />
        </div>
      </div>
    </Panel>
  );
}

function CalibrationPanel({ summary }: { summary: BlotterSummary }) {
  const buckets = summary.convictionCalibration.filter((b) => b.trades > 0);
  const maxAbs = Math.max(...buckets.map((b) => Math.abs(b.avgR)), 0.5);

  return (
    <Panel title="Conviction calibration" subtitle="does the engine's confidence actually pay?" provenance="derived">
      <div className="p-3">
        <div className="space-y-2 mb-3">
          {buckets.map((b) => {
            const pos = b.avgR >= 0;
            const w = (Math.abs(b.avgR) / maxAbs) * 50;
            return (
              <div key={b.bucket} className="flex items-center gap-2">
                <span className="num text-[10px] text-ink-2 w-12 shrink-0">{b.bucket}</span>
                <span className="label-xs w-8 shrink-0">{b.trades}T</span>
                <div className="flex-1 flex items-center h-3 min-w-[70px]">
                  <div className="w-1/2 flex justify-end h-full items-center">
                    {!pos && <div className="h-2.5 bg-short/70" style={{ width: `${w * 2}%` }} />}
                  </div>
                  <div className="w-px h-3 bg-hairline-bright shrink-0" />
                  <div className="w-1/2 h-full flex items-center">
                    {pos && <div className="h-2.5 bg-long/70" style={{ width: `${w * 2}%` }} />}
                  </div>
                </div>
                <span className={`num text-[10px] w-12 text-right shrink-0 ${pos ? 'text-long' : 'text-short'}`}>
                  {fmtNum(b.avgR, 2)}R
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-[10px] leading-[1.6] text-ink-3 pt-2.5 border-t border-hairline">
          Average R by the conviction the engine assigned at entry. If the high buckets do not
          out-earn the low ones over a meaningful sample, the conviction score is decoration and
          should be ignored when sizing. This is the only honest way to find that out.
        </p>
      </div>
    </Panel>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: 'long' | 'short' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-[10px] text-ink-3 truncate">{label}</span>
      <span className={`num text-[10.5px] font-semibold shrink-0 ${
        tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink-2'
      }`}>{value}</span>
    </div>
  );
}

function TicketForm({ onSubmit }: { onSubmit: (p: PaperPosition) => void }) {
  const [symbol, setSymbol] = useState('');
  const [direction, setDirection] = useState<'long' | 'short'>('long');
  const [instrument, setInstrument] = useState<'spot' | 'call' | 'put'>('spot');
  const [quantity, setQuantity] = useState('1');
  const [entryPrice, setEntryPrice] = useState('');
  const [stop, setStop] = useState('');
  const [target, setTarget] = useState('');
  const [strike, setStrike] = useState('');
  const [conviction, setConviction] = useState('50');
  const [error, setError] = useState('');

  const suggestions = symbol.trim() ? searchInstruments(symbol, 5) : [];

  const submit = (e: React.FormEvent): void => {
    e.preventDefault();
    const inst = resolveInstrument(symbol);
    if (!inst) { setError(`Unknown instrument "${symbol}"`); return; }

    const qty = Number(quantity);
    const entry = Number(entryPrice);
    const stopN = Number(stop);
    const targetN = Number(target);

    if (!(qty > 0)) { setError('Quantity must be greater than zero'); return; }
    if (!(entry > 0)) { setError('Entry price must be greater than zero'); return; }
    if (!(stopN > 0)) { setError('A stop is required — a position without one is not a trade'); return; }
    if (direction === 'long' && stopN >= entry) { setError('A long stop must sit below the entry'); return; }
    if (direction === 'short' && stopN <= entry) { setError('A short stop must sit above the entry'); return; }
    if (targetN > 0) {
      if (direction === 'long' && targetN <= entry) { setError('A long target must sit above the entry'); return; }
      if (direction === 'short' && targetN >= entry) { setError('A short target must sit below the entry'); return; }
    }

    onSubmit({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: inst.symbol,
      name: inst.name,
      assetClass: inst.assetClass,
      direction,
      instrument,
      quantity: qty,
      entryPrice: entry,
      entryTime: Date.now(),
      stop: stopN,
      target: targetN > 0 ? targetN : entry * (direction === 'long' ? 1.05 : 0.95),
      strike: instrument !== 'spot' && Number(strike) > 0 ? Number(strike) : undefined,
      convictionAtEntry: Number(conviction) || 50,
    });
  };

  return (
    <form onSubmit={submit} className="p-3 border-b border-hairline bg-raised/30">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        <Field label="SYMBOL">
          <input
            value={symbol}
            onChange={(e) => { setSymbol(e.target.value); setError(''); }}
            placeholder="NVDA"
            className="ticket-input"
            spellCheck={false}
          />
          {suggestions.length > 0 && symbol && !resolveInstrument(symbol) && (
            <div className="absolute z-20 mt-0.5 bg-overlay border border-hairline-bright min-w-full">
              {suggestions.map((s) => (
                <button
                  key={s.symbol}
                  type="button"
                  onClick={() => setSymbol(s.symbol)}
                  className="block w-full text-left px-2 py-1 num text-[10px] text-ink-2 hover:bg-raised whitespace-nowrap"
                >
                  {s.symbol}
                </button>
              ))}
            </div>
          )}
        </Field>

        <Field label="SIDE">
          <div className="flex gap-1">
            {(['long', 'short'] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={`flex-1 py-1 text-[9.5px] font-bold tracking-wider border transition-colors ${
                  direction === d
                    ? d === 'long' ? 'border-long text-long bg-long/10' : 'border-short text-short bg-short/10'
                    : 'border-hairline text-ink-4'
                }`}
              >
                {d.toUpperCase()}
              </button>
            ))}
          </div>
        </Field>

        <Field label="TYPE">
          <select
            value={instrument}
            onChange={(e) => setInstrument(e.target.value as 'spot' | 'call' | 'put')}
            className="ticket-input"
          >
            <option value="spot">Spot</option>
            <option value="call">Call</option>
            <option value="put">Put</option>
          </select>
        </Field>

        <Field label="QUANTITY">
          <input value={quantity} onChange={(e) => setQuantity(e.target.value)} className="ticket-input" inputMode="decimal" />
        </Field>

        <Field label="ENTRY">
          <input value={entryPrice} onChange={(e) => setEntryPrice(e.target.value)} className="ticket-input" inputMode="decimal" />
        </Field>

        <Field label="STOP">
          <input value={stop} onChange={(e) => setStop(e.target.value)} className="ticket-input" inputMode="decimal" />
        </Field>

        <Field label="TARGET">
          <input value={target} onChange={(e) => setTarget(e.target.value)} className="ticket-input" inputMode="decimal" />
        </Field>

        <Field label={instrument === 'spot' ? 'CONVICTION' : 'STRIKE'}>
          {instrument === 'spot' ? (
            <input value={conviction} onChange={(e) => setConviction(e.target.value)} className="ticket-input" inputMode="numeric" />
          ) : (
            <input value={strike} onChange={(e) => setStrike(e.target.value)} className="ticket-input" inputMode="decimal" />
          )}
        </Field>
      </div>

      <div className="flex items-center gap-3 mt-3">
        <button
          type="submit"
          className="px-3 py-1.5 text-[10px] font-bold tracking-[0.12em] bg-amber text-void hover:bg-amber-bright transition-colors"
        >
          RAISE TICKET
        </button>
        {error && <span className="text-[10.5px] text-short">{error}</span>}
        {!error && (
          <span className="text-[10px] text-ink-4">
            A stop is mandatory. A position without an exit plan is an opinion, not a trade.
          </span>
        )}
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block relative min-w-0">
      <span className="label-xs block mb-1">{label}</span>
      {children}
    </label>
  );
}
