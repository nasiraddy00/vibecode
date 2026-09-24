/* ===========================================================================
   Standalone terminal shell.

   Renders the same view components the Next.js build renders, driven by hash
   routing and the synchronous simulator-backed data layer. Heavy views
   (cockpit, screener) compute on a deferred tick so the shell paints first
   rather than blocking on ~100 engine runs.
   ========================================================================= */

import { useEffect, useState, useMemo } from 'react';
import { usePathname } from './nextnav';
import { CommandBar } from '@/components/CommandBar';
import { StatusStrip } from './StatusStrip';
import { MarketCockpit } from '@/components/MarketCockpit';
import { TickerDossier } from '@/components/TickerDossier';
import { TradeVerdict } from '@/components/TradeVerdict';
import { BacktestReport, type Artefact } from '@/components/BacktestReport';
import { ScreenerClient } from '@/app/screener/ScreenerClient';
import { PaperClient } from '@/app/paper/PaperClient';
import { Panel } from '@/components/Panel';
import { buildCockpit, buildDossier, runScreener, buildTradeCall } from './data';
import btcRun from '../../artifacts/backtest-BTCUSD-1d.json';

/** Defers an expensive synchronous computation by one paint, so the terminal
 *  chrome appears immediately instead of the tab hanging on a white screen. */
function useDeferred<T>(compute: () => T, deps: unknown[]): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    setValue(null);
    const id = window.setTimeout(() => setValue(compute()), 16);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

function Loading({ what }: { what: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 gap-3">
      <div className="flex items-center gap-2">
        <span className="live-dot sim" />
        <span className="label text-amber">RUNNING ENGINE</span>
      </div>
      <p className="text-[11.5px] text-ink-3 max-w-md text-center leading-relaxed">
        Computing {what}. Every indicator, signal and score is being calculated
        in your browser right now — nothing is fetched from a server.
      </p>
    </div>
  );
}

export function App() {
  const path = usePathname();

  const route = useMemo(() => {
    const clean = path.split('?')[0];
    if (clean.startsWith('/trade/')) {
      return { view: 'trade' as const, symbol: decodeURIComponent(clean.slice('/trade/'.length)) };
    }
    if (clean.startsWith('/ticker/')) {
      return { view: 'ticker' as const, symbol: decodeURIComponent(clean.slice('/ticker/'.length)) };
    }
    if (clean.startsWith('/screener')) return { view: 'screener' as const, symbol: '' };
    if (clean.startsWith('/backtest')) return { view: 'backtest' as const, symbol: '' };
    if (clean.startsWith('/paper')) return { view: 'paper' as const, symbol: '' };
    return { view: 'home' as const, symbol: '' };
  }, [path]);

  useEffect(() => {
    window.scrollTo(0, 0);
    const el = document.querySelector('main');
    if (el) el.scrollTop = 0;
  }, [path]);

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <CommandBar />
      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-void">
        {route.view === 'home' && <HomeView />}
        {route.view === 'trade' && <TradeView symbol={route.symbol} />}
        {route.view === 'ticker' && <TickerView symbol={route.symbol} />}
        {route.view === 'screener' && <ScreenerView />}
        {route.view === 'backtest' && <BacktestReport run={btcRun as unknown as Artefact} />}
        {route.view === 'paper' && <PaperClient />}
      </main>
      <StatusStrip />
    </div>
  );
}

function HomeView() {
  const data = useDeferred(() => buildCockpit(), []);
  if (!data) return <Loading what="the market cockpit across 90 instruments" />;
  return <MarketCockpit d={{ ...data, mode: 'simulated', build: 'browser' }} />;
}

function TickerView({ symbol }: { symbol: string }) {
  const result = useDeferred(
    () => ({ d: buildDossier(symbol) }),
    [symbol],
  );
  if (!result) return <Loading what={`the full dossier for ${symbol.toUpperCase()}`} />;
  if (!result.d) return <UnknownInstrument symbol={symbol} />;
  return <TickerDossier d={result.d} />;
}

function TradeView({ symbol }: { symbol: string }) {
  const result = useDeferred(() => ({ v: buildTradeCall(symbol) }), [symbol]);
  if (!result) return <Loading what={`the trade call for ${symbol.toUpperCase()}`} />;
  if (!result.v) return <UnknownInstrument symbol={symbol} />;
  return <TradeVerdict v={result.v} />;
}

function ScreenerView() {
  const rows = useDeferred(() => runScreener(), []);
  if (!rows) return <Loading what="signals across all 99 instruments" />;
  return (
    <div className="p-2">
      <Panel
        title="Screener"
        subtitle={`${rows.length} instruments · full engine run on every name`}
        provenance="simulated"
        accent
      >
        <ScreenerClient rows={rows} />
      </Panel>
    </div>
  );
}

function UnknownInstrument({ symbol }: { symbol: string }) {
  return (
    <div className="p-6 max-w-2xl">
      <Panel title="Unknown instrument" accent>
        <div className="p-5">
          <p className="text-[12.5px] text-ink mb-2">
            <span className="num font-bold text-amber">{symbol.toUpperCase()}</span> is not in this
            build&apos;s instrument universe.
          </p>
          <p className="text-[11px] text-ink-3 leading-relaxed">
            The browser build ships a fixed universe of 99 instruments across equities, ETFs,
            indexes, crypto, commodities, FX and rates. Try the search bar above — it accepts
            shorthands like <span className="num text-ink-2">btc</span>,{' '}
            <span className="num text-ink-2">gold</span> and{' '}
            <span className="num text-ink-2">sp500</span>.
          </p>
        </div>
      </Panel>
    </div>
  );
}
