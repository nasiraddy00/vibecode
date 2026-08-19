/* ===========================================================================
   Event-driven backtest engine.

   CORRECTNESS RULES THIS ENGINE ENFORCES
   --------------------------------------
   1. NO LOOKAHEAD. The signal at bar i is computed from bars[0..i] only, and
      the resulting order fills at bar i+1's open. A backtest that decides on
      the close and fills at that same close is reporting returns nobody could
      have captured.

   2. INTRABAR PESSIMISM. When a bar's range contains both the stop and the
      target, the STOP is assumed to have been hit first. Without tick data
      the sequence is unknowable, and assuming the favourable one is how
      backtests manufacture edge that evaporates live.

   3. COSTS ARE CHARGED, NOT ASSUMED AWAY. Commission on both sides, slippage
      against the trade on both sides, and funding on carried exposure.

   4. GAPS ARE HONOURED. If a bar opens beyond the stop, the fill is the open,
      not the stop price. This is where real accounts take their worst losses
      and where naive backtests quietly pretend otherwise.
   ========================================================================= */

import type { Bar, Direction, Provenance } from '../types';
import type { BacktestConfig, Trade, EquityPoint, ExitReason, BacktestResult } from './types';
import { DEFAULT_CONFIG } from './types';
import { computeSnapshot } from '../indicators';
import { generateSignal } from '../signals';
import { computeMetrics } from './metrics';
import { clamp } from '../util/math';

export interface RunOptions {
  bars: readonly Bar[];
  config: Partial<BacktestConfig> & { symbol: string };
  assetClass?: 'equity' | 'crypto' | 'index' | 'etf' | 'commodity' | 'fx' | 'rate';
  name?: string;
  dataProvenance?: 'live' | 'cached' | 'simulated';
  dataSource?: string;
  /** Recompute the signal every N bars instead of every bar. The full
   *  indicator stack over 750 bars is not free; for a swing-horizon system
   *  every bar is correct, and this exists for intraday series where the
   *  cost is prohibitive. */
  signalEvery?: number;
  /** Progress callback for long runs. */
  onProgress?: (pct: number) => void;
}

interface OpenPosition {
  direction: Direction;
  entryBar: number;
  entryTime: number;
  entryPrice: number;
  entryFill: number;
  size: number;
  notional: number;
  stop: number;
  initialStop: number;
  target: number;
  riskPerUnit: number;
  convictionAtEntry: number;
  scoreAtEntry: number;
  regimeAtEntry: string;
  commissionPaid: number;
  maxAdverse: number;
  maxFavourable: number;
  movedToBreakeven: boolean;
}

export function runBacktest(opts: RunOptions): BacktestResult {
  const config: BacktestConfig = { ...DEFAULT_CONFIG, ...opts.config };
  const bars = opts.bars;
  const {
    assetClass = 'crypto', name = config.symbol,
    dataProvenance = 'simulated', dataSource = 'simulator',
    signalEvery = 1, onProgress,
  } = opts;

  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  let equity = config.initialCapital;
  let peak = equity;
  let position: OpenPosition | null = null;
  let tradeId = 0;
  let barsInMarket = 0;
  /** A signal-driven exit decided on the previous bar's close. It fills at
   *  THIS bar's open, exactly like a newly opened position does. */
  let pendingSignalExit: ExitReason | null = null;
  /** Consecutive signal evaluations in which conviction has been decayed.
   *  A single weak reading is noise; two in a row is deterioration. */
  let decayStreak = 0;

  // Cached signal, recomputed every `signalEvery` bars.
  let cachedDirection: Direction = 'flat';
  let cachedConviction = 0;
  let cachedScore = 0;
  let cachedStop = NaN;
  let cachedTarget = NaN;
  let cachedSize = 0;
  let cachedRegime = 'range';
  let cachedAtr = NaN;

  const start = Math.max(config.warmupBars, 30);

  for (let i = start; i < bars.length; i++) {
    const bar = bars[i];
    const prevBar = bars[i - 1];

    // ---------------------------------------------------------------------
    // 1. MANAGE AN OPEN POSITION FIRST, using THIS bar's range.
    // ---------------------------------------------------------------------
    if (position) {
      const isLong = position.direction === 'long';

      // A signal exit decided last bar fills at this bar's open, before any
      // stop or target on this bar is considered.
      const exit: ExitDecision | null = pendingSignalExit
        ? {
            fill: bar.o * (1 + (isLong ? -config.slippage : config.slippage)),
            reason: pendingSignalExit,
          }
        : evaluateExit(position, bar, prevBar, config, i);
      pendingSignalExit = null;

      // Track excursions for MAE/MFE regardless of whether we exit.
      const adverse = isLong
        ? position.entryFill - bar.l
        : bar.h - position.entryFill;
      const favourable = isLong
        ? bar.h - position.entryFill
        : position.entryFill - bar.l;
      position.maxAdverse = Math.max(position.maxAdverse, adverse);
      position.maxFavourable = Math.max(position.maxFavourable, favourable);

      if (exit) {
        const closed = closePosition(position, exit.fill, exit.reason, bar, i, config, equity);
        equity = closed.equityAfter;
        trades.push({ ...closed, id: ++tradeId });
        position = null;
      } else {
        // Stop management on a surviving position.
        manageStop(position, bar, config);
      }
    }

    // ---------------------------------------------------------------------
    // 2. COMPUTE THE SIGNAL from data up to and including THIS bar.
    //    The order it produces cannot fill until the NEXT bar.
    // ---------------------------------------------------------------------
    const shouldRecompute = (i - start) % signalEvery === 0;
    if (shouldRecompute) {
      const history = bars.slice(0, i + 1);
      const sig = generateSignal({
        symbol: config.symbol,
        name,
        assetClass,
        bars: history,
        provenance: dataProvenance === 'simulated' ? 'simulated' : 'live',
        horizon: config.horizon,
        equity,
        maxRiskFraction: config.maxRiskFraction,
        now: new Date(bar.t),
      });

      cachedDirection = sig.plan.direction;
      cachedConviction = sig.conviction;
      cachedScore = sig.score;
      cachedStop = sig.plan.stop;
      cachedTarget = sig.plan.targets[0] ?? NaN;
      cachedSize = sig.plan.size;
      cachedRegime = sig.regime.regime;
      cachedAtr = Number.isFinite(sig.plan.entry) && Number.isFinite(sig.plan.stop)
        ? Math.abs(sig.plan.entry - sig.plan.stop)
        : NaN;

      // A flipped or decayed signal closes an existing position at the next
      // open, handled below via the pending-exit path.
      if (position) {
        const flipped = cachedDirection !== 'flat' && cachedDirection !== position.direction;
        const decayed = cachedConviction < config.convictionThreshold * config.decayExitRatio;
        decayStreak = decayed ? decayStreak + 1 : 0;

        // A flip is acted on immediately — the ensemble now believes the
        // opposite. Decay requires persistence: conviction oscillating around
        // the threshold on a single bar is noise, and exiting on it churns the
        // book into a series of small losses that the costs then compound.
        if (flipped || decayStreak >= config.decayExitBars) {
          pendingSignalExit = flipped ? 'signal_flip' : 'signal_decay';
        }
      } else {
        decayStreak = 0;
      }
    }

    // ---------------------------------------------------------------------
    // 3. OPEN A NEW POSITION at the NEXT bar's open, if flat and signalled.
    // ---------------------------------------------------------------------
    if (!position && !pendingSignalExit && i + 1 < bars.length) {
      const canTrade =
        cachedDirection !== 'flat' &&
        cachedConviction >= config.convictionThreshold &&
        cachedSize > 0 &&
        Number.isFinite(cachedStop) &&
        Number.isFinite(cachedTarget) &&
        (config.allowShorts || cachedDirection === 'long');

      if (canTrade) {
        const nextBar = bars[i + 1];
        const isLong = cachedDirection === 'long';
        // Slippage always works against the trade.
        const fill = nextBar.o * (1 + (isLong ? config.slippage : -config.slippage));
        const riskPerUnit = Math.abs(fill - cachedStop);

        if (riskPerUnit > 0) {
          // Re-derive size from the actual fill so the risk budget is honoured
          // against the price we really got, not the one we hoped for.
          const riskCapital = equity * effectiveRisk(cachedConviction, config);
          const sizeByRisk = riskCapital / riskPerUnit;
          const sizeByNotional = (equity * 0.95) / fill;
          const size = Math.min(sizeByRisk, sizeByNotional);

          if (size > 0 && size * fill > equity * 0.001) {
            const notional = size * fill;
            const commission = notional * config.commission;
            equity -= commission;

            position = {
              direction: cachedDirection,
              entryBar: i + 1,
              entryTime: nextBar.t,
              entryPrice: nextBar.o,
              entryFill: fill,
              size,
              notional,
              stop: cachedStop,
              initialStop: cachedStop,
              target: cachedTarget,
              riskPerUnit,
              convictionAtEntry: cachedConviction,
              scoreAtEntry: cachedScore,
              regimeAtEntry: cachedRegime,
              commissionPaid: commission,
              maxAdverse: 0,
              maxFavourable: 0,
              movedToBreakeven: false,
            };
          }
        }
      }
    }

    // ---------------------------------------------------------------------
    // 4. MARK TO MARKET
    // ---------------------------------------------------------------------
    if (position) barsInMarket++;
    const mtm = position
      ? equity + unrealised(position, bar.c)
      : equity;

    if (mtm > peak) peak = mtm;
    equityCurve.push({
      bar: i,
      time: bar.t,
      equity,
      markToMarket: mtm,
      drawdown: mtm - peak,
      drawdownPct: peak > 0 ? ((mtm - peak) / peak) * 100 : 0,
      exposure: position ? position.notional / Math.max(mtm, 1e-9) : 0,
      price: bar.c,
    });

    if (onProgress && i % 50 === 0) {
      onProgress((i - start) / Math.max(1, bars.length - start));
    }
  }

  // --- close any position still open at the end of the data ---------------
  if (position && bars.length > 0) {
    const lastBar = bars[bars.length - 1];
    const closed = closePosition(
      position, lastBar.c, 'end_of_data', lastBar, bars.length - 1, config, equity,
    );
    equity = closed.equityAfter;
    trades.push({ ...closed, id: ++tradeId });
  }

  const metrics = computeMetrics(
    trades, equityCurve, config, bars, barsInMarket,
  );

  return {
    config,
    symbol: config.symbol,
    dataProvenance,
    dataSource,
    barsTested: bars.length - start,
    startTime: bars[start]?.t ?? 0,
    endTime: bars[bars.length - 1]?.t ?? 0,
    trades,
    equityCurve,
    metrics,
    caveats: buildCaveats(dataProvenance, dataSource, trades.length, config, bars.length - start),
  };
}

/* ---------------------------------------------------------------------------
   EXIT EVALUATION
   ------------------------------------------------------------------------- */

interface ExitDecision { fill: number; reason: ExitReason; }

function evaluateExit(
  pos: OpenPosition, bar: Bar, prevBar: Bar, config: BacktestConfig, barIndex: number,
): ExitDecision | null {
  const isLong = pos.direction === 'long';

  // --- gap through the stop: fill at the open, not at the stop -----------
  if (isLong && bar.o <= pos.stop) {
    return { fill: bar.o * (1 - config.slippage), reason: 'stop' };
  }
  if (!isLong && bar.o >= pos.stop) {
    return { fill: bar.o * (1 + config.slippage), reason: 'stop' };
  }

  // --- gap through the target -------------------------------------------
  if (isLong && bar.o >= pos.target) {
    return { fill: bar.o * (1 - config.slippage), reason: 'target' };
  }
  if (!isLong && bar.o <= pos.target) {
    return { fill: bar.o * (1 + config.slippage), reason: 'target' };
  }

  const stopHit = isLong ? bar.l <= pos.stop : bar.h >= pos.stop;
  const targetHit = isLong ? bar.h >= pos.target : bar.l <= pos.target;

  // --- both touched in the same bar: assume the stop came first ----------
  // Without tick data the true sequence is unknowable. Assuming the
  // favourable ordering is the single most common way backtests invent edge.
  if (stopHit) {
    const reason: ExitReason = pos.movedToBreakeven || pos.stop !== pos.initialStop
      ? 'trailing_stop'
      : 'stop';
    return {
      fill: pos.stop * (1 + (isLong ? -config.slippage : config.slippage)),
      reason,
    };
  }
  if (targetHit) {
    return {
      fill: pos.target * (1 + (isLong ? -config.slippage : config.slippage)),
      reason: 'target',
    };
  }

  // --- time stop ----------------------------------------------------------
  if (barIndex - pos.entryBar >= config.maxHoldBars) {
    return {
      fill: bar.c * (1 + (isLong ? -config.slippage : config.slippage)),
      reason: 'max_hold',
    };
  }

  return null;
}

/** Move the stop to breakeven and then trail it, once the trade is working. */
function manageStop(pos: OpenPosition, bar: Bar, config: BacktestConfig): void {
  const isLong = pos.direction === 'long';
  const profit = isLong ? bar.c - pos.entryFill : pos.entryFill - bar.c;
  const rProfit = pos.riskPerUnit > 0 ? profit / pos.riskPerUnit : 0;

  if (!pos.movedToBreakeven && config.breakevenAtR > 0 && rProfit >= config.breakevenAtR) {
    pos.stop = pos.entryFill;
    pos.movedToBreakeven = true;
  }

  if (config.trailAtrMultiple > 0 && rProfit > config.breakevenAtR) {
    const trailDistance = pos.riskPerUnit * config.trailAtrMultiple;
    const candidate = isLong ? bar.c - trailDistance : bar.c + trailDistance;
    // A trailing stop only ever moves in the favourable direction.
    if (isLong && candidate > pos.stop) pos.stop = candidate;
    if (!isLong && candidate < pos.stop) pos.stop = candidate;
  }
}

/* ---------------------------------------------------------------------------
   POSITION CLOSING
   ------------------------------------------------------------------------- */

function unrealised(pos: OpenPosition, price: number): number {
  return pos.direction === 'long'
    ? (price - pos.entryFill) * pos.size
    : (pos.entryFill - price) * pos.size;
}

function closePosition(
  pos: OpenPosition,
  fill: number,
  reason: ExitReason,
  bar: Bar,
  barIndex: number,
  config: BacktestConfig,
  equityBefore: number,
): Omit<Trade, 'id'> {
  const barsHeld = Math.max(1, barIndex - pos.entryBar);
  const grossPnl = pos.direction === 'long'
    ? (fill - pos.entryFill) * pos.size
    : (pos.entryFill - fill) * pos.size;

  const exitCommission = fill * pos.size * config.commission;
  const commissionPaid = pos.commissionPaid + exitCommission;

  // Funding is charged on carried notional. Shorts pay borrow; longs pay
  // financing on any leveraged portion. Charged on the full notional here,
  // which is the conservative reading.
  const fundingPaid =
    pos.notional * config.fundingRate * (barsHeld / config.periodsPerYear);

  const netPnl = grossPnl - exitCommission - fundingPaid;
  const equityAfter = equityBefore + netPnl;

  return {
    direction: pos.direction,
    entryBar: pos.entryBar,
    entryTime: pos.entryTime,
    entryPrice: pos.entryPrice,
    entryFill: pos.entryFill,
    exitBar: barIndex,
    exitTime: bar.t,
    exitPrice: bar.c,
    exitFill: fill,
    size: pos.size,
    notional: pos.notional,
    stop: pos.initialStop,
    target: pos.target,
    exitReason: reason,
    grossPnl,
    commissionPaid,
    fundingPaid,
    netPnl,
    pnlPct: pos.notional > 0 ? (netPnl / pos.notional) * 100 : 0,
    rMultiple: pos.riskPerUnit > 0 ? netPnl / (pos.riskPerUnit * pos.size) : 0,
    barsHeld,
    equityAfter,
    convictionAtEntry: pos.convictionAtEntry,
    scoreAtEntry: pos.scoreAtEntry,
    regimeAtEntry: pos.regimeAtEntry as never,
    maxAdverseR: pos.riskPerUnit > 0 ? pos.maxAdverse / pos.riskPerUnit : 0,
    maxFavourableR: pos.riskPerUnit > 0 ? pos.maxFavourable / pos.riskPerUnit : 0,
  };
}

/** Risk fraction scaled by conviction, mirroring the live plan builder. */
function effectiveRisk(conviction: number, config: BacktestConfig): number {
  const t = clamp(
    (conviction - config.convictionThreshold) / (100 - config.convictionThreshold),
    0, 1,
  );
  return config.maxRiskFraction * (0.25 + 0.75 * t);
}

/* ---------------------------------------------------------------------------
   CAVEATS
   ------------------------------------------------------------------------- */

function buildCaveats(
  provenance: string, source: string, tradeCount: number,
  config: BacktestConfig, barsTested: number,
): string[] {
  const c: string[] = [];

  if (provenance === 'simulated') {
    c.push(
      'PRICE DATA IS SYNTHETIC. This run used the deterministic simulator, not real market history, ' +
      'because no live data provider was reachable. The simulator reproduces volatility clustering, fat tails and ' +
      'regime persistence, so the engine faces a realistically hostile series — but these are NOT real Bitcoin prices, ' +
      'and this result is evidence about the ENGINE, not about the strategy\'s real-world profitability.',
    );
  }

  if (tradeCount < 30) {
    c.push(
      `Only ${tradeCount} trades. Below roughly 30 trades the sample is too small for the win rate or profit factor ` +
      'to be statistically distinguishable from luck. Treat every ratio here as indicative at best.',
    );
  }

  c.push(
    'No survivorship or delisting adjustment, and no market-impact model. Fills assume the full size transacts at ' +
    'the modelled price, which is realistic at small size and optimistic at large size.',
  );

  c.push(
    `Costs charged: ${(config.commission * 10000).toFixed(0)}bp commission per side, ` +
    `${(config.slippage * 10000).toFixed(1)}bp slippage per side, ` +
    `${(config.fundingRate * 100).toFixed(1)}% annualised funding on carried notional.`,
  );

  c.push(
    'Orders are generated on a bar close and filled at the NEXT bar\'s open. When a bar\'s range contains both the ' +
    'stop and the target, the stop is assumed to have been hit first.',
  );

  if (barsTested < 500) {
    c.push(`Only ${barsTested} bars tested — too short to span multiple market regimes.`);
  }

  return c;
}
