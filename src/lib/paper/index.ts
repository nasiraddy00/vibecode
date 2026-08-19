/* ===========================================================================
   Paper trading blotter.

   Positions live in the browser's localStorage: this is a single-user
   analysis tool, not a brokerage, and putting a database behind a paper
   blotter would add operational weight without adding truth. Marks are
   computed against live/simulated quotes on each render.
   ========================================================================= */

import type { Direction, AssetClass } from '../types';

export interface PaperPosition {
  id: string;
  symbol: string;
  name: string;
  assetClass: AssetClass;
  direction: Direction;
  instrument: 'spot' | 'call' | 'put';
  quantity: number;
  entryPrice: number;
  entryTime: number;
  stop: number;
  target: number;
  strike?: number;
  expiry?: number;
  iv?: number;
  /** Conviction at the time the ticket was raised, for later calibration. */
  convictionAtEntry: number;
  note?: string;
  closed?: { exitPrice: number; exitTime: number; reason: string };
}

export interface MarkedPosition extends PaperPosition {
  mark: number;
  marketValue: number;
  costBasis: number;
  unrealisedPnl: number;
  unrealisedPct: number;
  /** Profit in units of the initial risk. */
  rMultiple: number;
  distanceToStopPct: number;
  distanceToTargetPct: number;
  daysHeld: number;
  isOpen: boolean;
}

export interface BlotterSummary {
  positions: MarkedPosition[];
  openCount: number;
  closedCount: number;
  totalCost: number;
  totalValue: number;
  openPnl: number;
  realisedPnl: number;
  totalPnl: number;
  totalPnlPct: number;
  winners: number;
  losers: number;
  winRate: number;
  avgR: number;
  bestR: number;
  worstR: number;
  netLongExposure: number;
  netShortExposure: number;
  grossExposure: number;
  /** Realised calibration: does high conviction actually pay better? */
  convictionCalibration: { bucket: string; trades: number; avgR: number }[];
  warnings: string[];
}

const MULTIPLIER = (p: PaperPosition): number => (p.instrument === 'spot' ? 1 : 100);

export function markPositions(
  positions: readonly PaperPosition[],
  prices: Record<string, number>,
  now = Date.now(),
): BlotterSummary {
  const marked: MarkedPosition[] = positions.map((p) => {
    const isOpen = !p.closed;
    const spot = prices[p.symbol] ?? p.entryPrice;
    const mark = p.closed ? p.closed.exitPrice : spot;
    const mult = MULTIPLIER(p);
    const sign = p.direction === 'short' ? -1 : 1;

    const costBasis = p.entryPrice * p.quantity * mult;
    const marketValue = mark * p.quantity * mult;
    const unrealisedPnl = (mark - p.entryPrice) * p.quantity * mult * sign;

    const riskPerUnit = Math.abs(p.entryPrice - p.stop);
    const rMultiple = riskPerUnit > 0 ? ((mark - p.entryPrice) * sign) / riskPerUnit : 0;

    return {
      ...p,
      mark,
      marketValue,
      costBasis,
      unrealisedPnl,
      unrealisedPct: costBasis !== 0 ? (unrealisedPnl / Math.abs(costBasis)) * 100 : 0,
      rMultiple,
      distanceToStopPct: mark !== 0 ? ((p.stop - mark) / mark) * 100 : 0,
      distanceToTargetPct: mark !== 0 ? ((p.target - mark) / mark) * 100 : 0,
      daysHeld: (now - p.entryTime) / 86_400_000,
      isOpen,
    };
  });

  const open = marked.filter((m) => m.isOpen);
  const closed = marked.filter((m) => !m.isOpen);

  const openPnl = open.reduce((a, m) => a + m.unrealisedPnl, 0);
  const realisedPnl = closed.reduce((a, m) => a + m.unrealisedPnl, 0);
  const totalCost = marked.reduce((a, m) => a + Math.abs(m.costBasis), 0);

  const winners = closed.filter((m) => m.unrealisedPnl > 0).length;
  const losers = closed.length - winners;

  const rs = closed.map((m) => m.rMultiple);
  const avgR = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0;

  // Conviction calibration: the single most useful thing a paper blotter can
  // tell you is whether the engine's confidence means anything. If the 80+
  // bucket does not out-earn the 30s, the conviction number is decoration.
  const buckets = [
    { bucket: '32-49', lo: 32, hi: 50 },
    { bucket: '50-64', lo: 50, hi: 65 },
    { bucket: '65-79', lo: 65, hi: 80 },
    { bucket: '80+', lo: 80, hi: 1e9 },
  ];
  const convictionCalibration = buckets.map((b) => {
    const inBucket = closed.filter(
      (m) => m.convictionAtEntry >= b.lo && m.convictionAtEntry < b.hi,
    );
    return {
      bucket: b.bucket,
      trades: inBucket.length,
      avgR: inBucket.length
        ? inBucket.reduce((a, m) => a + m.rMultiple, 0) / inBucket.length
        : NaN,
    };
  });

  const netLong = open
    .filter((m) => m.direction === 'long')
    .reduce((a, m) => a + Math.abs(m.marketValue), 0);
  const netShort = open
    .filter((m) => m.direction === 'short')
    .reduce((a, m) => a + Math.abs(m.marketValue), 0);
  const gross = netLong + netShort;

  const warnings: string[] = [];
  const bySymbol = new Map<string, number>();
  for (const m of open) {
    bySymbol.set(m.symbol, (bySymbol.get(m.symbol) ?? 0) + Math.abs(m.marketValue));
  }
  for (const [sym, v] of bySymbol) {
    if (gross > 0 && v / gross > 0.4) {
      warnings.push(`${sym} is ${((v / gross) * 100).toFixed(0)}% of gross exposure — single-name concentration risk.`);
    }
  }
  for (const b of open) {
    const breached =
      (b.direction === 'long' && b.mark <= b.stop) ||
      (b.direction === 'short' && b.mark >= b.stop);
    if (breached) {
      warnings.push(`${b.symbol} has traded through its stop at ${b.stop.toFixed(2)} and is still open.`);
    }
  }
  for (const e of open) {
    if (e.expiry && (e.expiry - now) / 86_400_000 < 7) {
      warnings.push(`${e.symbol} option expires in under 7 days — gamma and theta both go vertical here.`);
    }
  }

  return {
    positions: marked.sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || b.entryTime - a.entryTime),
    openCount: open.length,
    closedCount: closed.length,
    totalCost,
    totalValue: marked.reduce((a, m) => a + m.marketValue, 0),
    openPnl,
    realisedPnl,
    totalPnl: openPnl + realisedPnl,
    totalPnlPct: totalCost !== 0 ? ((openPnl + realisedPnl) / totalCost) * 100 : 0,
    winners,
    losers,
    winRate: closed.length ? winners / closed.length : 0,
    avgR,
    bestR: rs.length ? Math.max(...rs) : 0,
    worstR: rs.length ? Math.min(...rs) : 0,
    netLongExposure: netLong,
    netShortExposure: netShort,
    grossExposure: gross,
    convictionCalibration,
    warnings,
  };
}

export const STORAGE_KEY = 'meridian.blotter.v1';

export function loadPositions(): PaperPosition[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PaperPosition[]) : [];
  } catch {
    return [];
  }
}

export function savePositions(positions: PaperPosition[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
  } catch {
    // Quota exceeded or storage disabled: the blotter degrades to
    // session-only rather than throwing inside a render path.
  }
}
