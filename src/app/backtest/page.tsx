import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Panel } from '@/components/Panel';
import { BacktestReport, type Artefact } from '@/components/BacktestReport';
import { fmtUsd, fmtPct, fmtNum } from '@/lib/util/format';

export const metadata = { title: 'Backtest — Meridian Terminal' };
export const dynamic = 'force-dynamic';

function loadArtefacts(): Artefact[] {
  const dir = resolve(process.cwd(), 'artifacts');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('backtest-') && f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as Artefact;
      } catch {
        return null;
      }
    })
    .filter((a): a is Artefact => a !== null)
    .sort((a, b) => b.generatedAt - a.generatedAt);
}

export default function BacktestPage() {
  const runs = loadArtefacts();

  if (!runs.length) {
    return (
      <div className="p-6 max-w-3xl">
        <Panel title="Backtest lab" accent>
          <div className="p-5">
            <p className="text-[12px] text-ink-2 leading-relaxed mb-3">
              No backtest artefact has been generated yet. Run the engine from the command line:
            </p>
            <pre className="num text-[11px] bg-void border border-hairline p-3 text-amber overflow-x-auto">
npm run backtest:btc{'\n'}
npx tsx scripts/run-backtest.ts --symbol NVDA --capital 10000 --bars 1500
            </pre>
            <p className="text-[11px] text-ink-3 leading-relaxed mt-3">
              The run writes a JSON artefact to <span className="num text-amber/80">artifacts/</span>,
              which this page renders. Results are not recomputed in the browser, so what you see here
              is exactly the run that was executed — including its data provenance and its caveats.
            </p>
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <>
      <BacktestReport run={runs[0]} />
      {runs.length > 1 && (
        <div className="px-2 pb-2">
          <Panel title="Other runs" subtitle={`${runs.length - 1} more artefacts`}>
            <table className="dt">
              <thead>
                <tr>
                  <th className="!text-left">Symbol</th><th>Capital</th><th>Final</th>
                  <th>Return</th><th>Max DD</th><th>Sharpe</th><th>Trades</th><th>Win%</th>
                </tr>
              </thead>
              <tbody>
                {runs.slice(1).map((r, i) => (
                  <tr key={i}>
                    <td className="!text-left num font-bold text-ink">{r.symbol}</td>
                    <td className="num">{fmtUsd(r.metrics.initialCapital)}</td>
                    <td className="num">{fmtUsd(r.metrics.finalEquity)}</td>
                    <td className={`num ${r.metrics.totalReturnPct >= 0 ? 'text-long' : 'text-short'}`}>
                      {fmtPct(r.metrics.totalReturnPct)}
                    </td>
                    <td className="num text-short">{fmtPct(r.metrics.maxDrawdownPct)}</td>
                    <td className="num">{fmtNum(r.metrics.sharpe, 2)}</td>
                    <td className="num text-ink-3">{r.metrics.totalTrades}</td>
                    <td className="num">{fmtPct(r.metrics.winRate * 100, 0, false)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        </div>
      )}
    </>
  );
}
