#!/usr/bin/env tsx
/* ===========================================================================
   Backtest CLI.

     npm run backtest:btc
     npx tsx scripts/run-backtest.ts --symbol NVDA --capital 10000 --bars 1000

   Writes a JSON artefact to artifacts/ so the /backtest page can render the
   exact run rather than recomputing it in the browser.
   ========================================================================= */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { getBars } from '@/lib/providers';
import { resolveInstrument } from '@/lib/market/universe';
import { runBacktest, monteCarlo, type BacktestConfig } from '@/lib/backtest';
import { fmtUsd, fmtPct, fmtNum } from '@/lib/util/format';

interface Args { [k: string]: string | undefined; }

function parseArgs(): Args {
  const out: Args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { out[key] = next; i++; }
      else out[key] = 'true';
    }
  }
  return out;
}

const pad = (s: string, n: number): string => s.padEnd(n);
const rpad = (s: string, n: number): string => s.padStart(n);
const RULE = '─'.repeat(78);

/** Word-wrap prose to the terminal width. */
function wrap(text: string, bullet = '  '): void {
  const words = text.split(' ');
  let line = bullet;
  const indent = ' '.repeat(bullet.length);
  for (const w of words) {
    if ((line + ' ' + w).length > 77) { console.log(line); line = indent; }
    line += (line === indent ? '' : ' ') + w;
  }
  if (line.trim()) console.log(line);
}

async function main(): Promise<void> {
  const args = parseArgs();
  const symbol = args.symbol ?? 'BTC-USD';
  const capital = Number(args.capital ?? 10);
  const barCount = Number(args.bars ?? 1500);
  const timeframe = (args.timeframe ?? '1d') as '1d' | '4h' | '1h';

  const inst = resolveInstrument(symbol);
  if (!inst) {
    console.error(`Unknown symbol: ${symbol}`);
    process.exit(1);
  }

  console.log(`\n${RULE}`);
  console.log(`  MERIDIAN TERMINAL — BACKTEST`);
  console.log(`  ${inst.name} (${inst.symbol})   ${timeframe}   starting capital ${fmtUsd(capital)}`);
  console.log(RULE);

  const barsResult = await getBars(inst, timeframe, barCount);
  console.log(`\n  Data: ${barsResult.bars.length} bars from "${barsResult.source}" [${barsResult.provenance.toUpperCase()}]`);
  if (barsResult.fallbackReason) {
    console.log(`  Live feeds unavailable: ${barsResult.fallbackReason.slice(0, 300)}`);
  }

  const config: Partial<BacktestConfig> & { symbol: string } = {
    symbol: inst.symbol,
    initialCapital: capital,
    // Retail crypto costs: 10bp taker fee, 5bp slippage, 5% annualised funding.
    commission: Number(args.commission ?? (inst.assetClass === 'crypto' ? 0.001 : 0.0005)),
    slippage: Number(args.slippage ?? 0.0005),
    fundingRate: Number(args.funding ?? 0.05),
    warmupBars: Number(args.warmup ?? 260),
    maxRiskFraction: Number(args.risk ?? 0.02),
    convictionThreshold: Number(args.conviction ?? 32),
    allowShorts: args.longonly !== 'true',
    horizon: 'swing',
    maxHoldBars: Number(args.maxhold ?? 30),
    periodsPerYear: timeframe === '1d' ? 365 : timeframe === '4h' ? 365 * 6 : 365 * 24,
  };

  // Crypto trades every day of the year, unlike equities.
  if (inst.assetClass !== 'crypto' && timeframe === '1d') config.periodsPerYear = 252;

  console.log(`  Running engine over ${barsResult.bars.length - (config.warmupBars ?? 260)} testable bars...\n`);

  const t0 = Date.now();
  const result = runBacktest({
    bars: barsResult.bars,
    config,
    assetClass: inst.assetClass as never,
    name: inst.name,
    dataProvenance: barsResult.provenance,
    dataSource: barsResult.source,
  });
  const elapsed = Date.now() - t0;

  const m = result.metrics;

  // --- headline -----------------------------------------------------------
  console.log(RULE);
  console.log('  RESULT');
  console.log(RULE);
  const row = (label: string, value: string, note = ''): void =>
    console.log(`  ${pad(label, 30)}${rpad(value, 18)}  ${note}`);

  row('Starting capital', fmtUsd(m.initialCapital));
  row('Final equity', fmtUsd(m.finalEquity));
  row('Total return', fmtPct(m.totalReturnPct));
  row('CAGR', fmtPct(m.cagr));
  row('Buy & hold over same window', fmtPct(m.buyHoldReturnPct));
  row('Alpha vs buy & hold', fmtPct(m.alphaVsBuyHold),
    m.alphaVsBuyHold > 0 ? 'strategy ahead' : 'buy & hold ahead');

  console.log('');
  row('Max drawdown', fmtPct(m.maxDrawdownPct), `${m.maxDrawdownDurationBars} bars to recover`);
  row('Volatility (annualised)', fmtPct(m.volatility, 1, false));
  row('Ulcer index', fmtNum(m.ulcerIndex, 2));
  row('VaR 95% (per bar)', Number.isFinite(m.var95) ? fmtPct(m.var95) : '—');
  row('CVaR 95% (per bar)', Number.isFinite(m.cvar95) ? fmtPct(m.cvar95) : '—');

  console.log('');
  row('Sharpe ratio', fmtNum(m.sharpe, 2));
  row('Sortino ratio', fmtNum(m.sortino, 2));
  row('Calmar ratio', fmtNum(m.calmar, 2));
  row('Martin ratio', fmtNum(m.martin, 2));

  console.log('');
  row('Total trades', String(m.totalTrades));
  row('Win rate', fmtPct(m.winRate * 100, 1, false), `${m.winners}W / ${m.losers}L`);
  row('Profit factor', Number.isFinite(m.profitFactor) ? fmtNum(m.profitFactor, 2) : 'n/a (no losses)');
  row('Expectancy per trade', fmtUsd(m.expectancy), `${fmtNum(m.expectancyR, 3)}R`);
  row('Average win / loss', `${fmtUsd(m.avgWin)} / ${fmtUsd(m.avgLoss)}`);
  row('Average win / loss (R)', `${fmtNum(m.avgWinR, 2)}R / ${fmtNum(m.avgLossR, 2)}R`);
  row('Payoff ratio', Number.isFinite(m.payoffRatio) ? fmtNum(m.payoffRatio, 2) : '—');
  row('Best / worst trade', `${fmtNum(m.bestTradeR, 2)}R / ${fmtNum(m.worstTradeR, 2)}R`);
  row('Max consecutive W / L', `${m.maxConsecutiveWins} / ${m.maxConsecutiveLosses}`);
  row('Avg bars held', fmtNum(m.avgBarsHeld, 1));
  row('Time in market', fmtPct(m.exposureTime * 100, 1, false));
  row('Long / short trades', `${m.longTrades} / ${m.shortTrades}`,
    `win rate ${fmtPct(m.longWinRate * 100, 0, false)} / ${fmtPct(m.shortWinRate * 100, 0, false)}`);
  row('Total costs paid', fmtUsd(m.totalCosts), `${fmtPct(m.costDragPct, 2, false)} of starting capital`);
  row('Implied Kelly fraction', Number.isFinite(m.impliedKelly) ? fmtPct(m.impliedKelly * 100, 1, false) : '—');

  console.log(`\n${RULE}`);
  console.log('  IS THIS AN EDGE, OR IS THIS LUCK?');
  console.log(RULE);
  wrap(m.significance);
  row('  t-statistic', fmtNum(m.tStat, 3));
  row('  p-value (two-sided)', Number.isFinite(m.pValue) ? m.pValue.toFixed(4) : '—');
  row('  Std error of mean R', Number.isFinite(m.standardError) ? fmtNum(m.standardError, 4) : '—');

  console.log('\n  Exit reasons:');
  for (const [reason, count] of Object.entries(m.byExitReason).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(reason, 20)}${rpad(String(count), 5)}  ${fmtPct((count / Math.max(1, m.totalTrades)) * 100, 1, false)}`);
  }

  // --- Monte Carlo ---------------------------------------------------------
  const mc = monteCarlo(result.trades, m.initialCapital, 5000);
  if (mc.runs > 0) {
    console.log(`\n${RULE}`);
    console.log('  MONTE CARLO — 5,000 reshuffles of the same trade sequence');
    console.log(RULE);
    row('5th percentile', fmtUsd(mc.p5));
    row('25th percentile', fmtUsd(mc.p25));
    row('Median', fmtUsd(mc.median));
    row('75th percentile', fmtUsd(mc.p75));
    row('95th percentile', fmtUsd(mc.p95));
    row('P(end below start)', fmtPct(mc.probLoss * 100, 1, false));
    row('Median max drawdown', fmtPct(mc.medianMaxDd));
    row('Worst max drawdown', fmtPct(mc.worstMaxDd));
  }

  // --- trade log sample -----------------------------------------------------
  if (result.trades.length) {
    console.log(`\n${RULE}`);
    console.log('  TRADE LOG (first 12)');
    console.log(RULE);
    console.log(`  ${pad('#', 4)}${pad('DIR', 7)}${pad('ENTRY', 12)}${pad('EXIT', 12)}${pad('REASON', 15)}${rpad('R', 8)}${rpad('P&L', 12)}${rpad('EQUITY', 12)}`);
    for (const t of result.trades.slice(0, 12)) {
      console.log(
        `  ${pad(String(t.id), 4)}${pad(t.direction.toUpperCase(), 7)}` +
        `${pad(t.entryFill.toFixed(2), 12)}${pad(t.exitFill.toFixed(2), 12)}` +
        `${pad(t.exitReason, 15)}${rpad(fmtNum(t.rMultiple, 2), 8)}` +
        `${rpad(fmtUsd(t.netPnl), 12)}${rpad(fmtUsd(t.equityAfter), 12)}`,
      );
    }
    if (result.trades.length > 12) console.log(`  ... ${result.trades.length - 12} more`);
  }

  // --- risk sensitivity -------------------------------------------------------
  // The same signal at different risk budgets. This is not parameter tuning:
  // it is the same edge levered differently, and it shows the return/drawdown
  // trade-off the operator actually controls.
  if (args.sweep !== 'false') {
    console.log(`\n${RULE}`);
    console.log('  RISK SENSITIVITY — identical signals, different risk budget');
    console.log(RULE);
    console.log(`  ${pad('RISK/TRADE', 13)}${rpad('FINAL', 12)}${rpad('RETURN', 11)}${rpad('MAX DD', 10)}${rpad('SHARPE', 9)}${rpad('TRADES', 8)}${rpad('WIN%', 8)}`);
    for (const riskPct of [0.01, 0.02, 0.05, 0.10, 0.20]) {
      const r = runBacktest({
        bars: barsResult.bars,
        config: { ...config, maxRiskFraction: riskPct },
        assetClass: inst.assetClass as never,
        name: inst.name,
        dataProvenance: barsResult.provenance,
        dataSource: barsResult.source,
      });
      const rm = r.metrics;
      console.log(
        `  ${pad(fmtPct(riskPct * 100, 0, false), 13)}` +
        `${rpad(fmtUsd(rm.finalEquity), 12)}${rpad(fmtPct(rm.totalReturnPct, 1), 11)}` +
        `${rpad(fmtPct(rm.maxDrawdownPct, 1), 10)}${rpad(fmtNum(rm.sharpe, 2), 9)}` +
        `${rpad(String(rm.totalTrades), 8)}${rpad(fmtPct(rm.winRate * 100, 0, false), 8)}`,
      );
    }
    console.log(`  ${pad('BUY & HOLD', 13)}${rpad(fmtUsd(capital * (1 + m.buyHoldReturnPct / 100)), 12)}${rpad(fmtPct(m.buyHoldReturnPct, 1), 11)}`);
  }

  // --- caveats ---------------------------------------------------------------
  console.log(`\n${RULE}`);
  console.log('  WHAT THIS RESULT DOES AND DOES NOT ESTABLISH');
  console.log(RULE);
  for (const c of result.caveats) wrap(c, '  •');

  console.log(`\n  Engine time: ${elapsed}ms over ${result.barsTested} bars\n`);

  // --- persist ---------------------------------------------------------------
  const outDir = resolve(process.cwd(), 'artifacts');
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, `backtest-${inst.symbol.replace(/[^A-Za-z0-9]/g, '')}-${timeframe}.json`);

  // Thin the equity curve for the artefact; the UI does not need every bar.
  const step = Math.max(1, Math.floor(result.equityCurve.length / 900));
  writeFileSync(outPath, JSON.stringify({
    ...result,
    equityCurve: result.equityCurve.filter((_, i) => i % step === 0),
    monteCarlo: mc,
    generatedAt: Date.now(),
  }, null, 2));
  console.log(`  Artefact written: ${outPath}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
