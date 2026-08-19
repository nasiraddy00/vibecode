import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markPositions, type PaperPosition } from '@/lib/paper';

const near = (a: number, b: number, tol = 1e-9): boolean => Math.abs(a - b) <= tol;
const base = {
  name: 'Test', assetClass: 'equity' as const, entryTime: Date.now() - 86_400_000,
  convictionAtEntry: 60,
};

test('a long position gains when the mark rises', () => {
  const pos: PaperPosition[] = [{
    ...base, id: '1', symbol: 'X', direction: 'long', instrument: 'spot',
    quantity: 10, entryPrice: 100, stop: 95, target: 115,
  }];
  const s = markPositions(pos, { X: 110 });
  assert.ok(near(s.openPnl, 100));
  assert.ok(near(s.positions[0].rMultiple, 2));
});

test('a short position gains when the mark falls', () => {
  const pos: PaperPosition[] = [{
    ...base, id: '1', symbol: 'X', direction: 'short', instrument: 'spot',
    quantity: 10, entryPrice: 100, stop: 105, target: 85,
  }];
  const s = markPositions(pos, { X: 90 });
  assert.ok(near(s.openPnl, 100), `expected +100, got ${s.openPnl}`);
  assert.ok(near(s.positions[0].rMultiple, 2));
});

test('a short position loses when the mark rises', () => {
  const pos: PaperPosition[] = [{
    ...base, id: '1', symbol: 'X', direction: 'short', instrument: 'spot',
    quantity: 10, entryPrice: 100, stop: 105, target: 85,
  }];
  const s = markPositions(pos, { X: 103 });
  assert.ok(s.openPnl < 0);
  assert.ok(near(s.positions[0].rMultiple, -0.6));
});

test('options positions apply the 100x contract multiplier', () => {
  const pos: PaperPosition[] = [{
    ...base, id: '1', symbol: 'X', direction: 'long', instrument: 'call',
    quantity: 2, entryPrice: 3, stop: 1.5, target: 9, strike: 100,
  }];
  const s = markPositions(pos, { X: 5 });
  assert.ok(near(s.positions[0].costBasis, 600));
  assert.ok(near(s.openPnl, 400));
});

test('closed positions move into realised P&L', () => {
  const pos: PaperPosition[] = [{
    ...base, id: '1', symbol: 'X', direction: 'long', instrument: 'spot',
    quantity: 10, entryPrice: 100, stop: 95, target: 115,
    closed: { exitPrice: 108, exitTime: Date.now(), reason: 'manual' },
  }];
  const s = markPositions(pos, { X: 200 });
  assert.equal(s.openCount, 0);
  assert.equal(s.closedCount, 1);
  // The live quote must be ignored for a closed position.
  assert.ok(near(s.realisedPnl, 80));
  assert.ok(near(s.openPnl, 0));
});

test('a breached stop on an open position raises a warning', () => {
  const pos: PaperPosition[] = [{
    ...base, id: '1', symbol: 'X', direction: 'long', instrument: 'spot',
    quantity: 10, entryPrice: 100, stop: 95, target: 115,
  }];
  const s = markPositions(pos, { X: 92 });
  assert.ok(s.warnings.some((w) => w.includes('traded through its stop')));
});

test('single-name concentration is flagged', () => {
  const pos: PaperPosition[] = [
    { ...base, id: '1', symbol: 'X', direction: 'long', instrument: 'spot', quantity: 100, entryPrice: 100, stop: 95, target: 115 },
    { ...base, id: '2', symbol: 'Y', direction: 'long', instrument: 'spot', quantity: 1, entryPrice: 100, stop: 95, target: 115 },
  ];
  const s = markPositions(pos, { X: 100, Y: 100 });
  assert.ok(s.warnings.some((w) => w.startsWith('X is')));
});

test('conviction calibration buckets only closed trades', () => {
  const mk = (id: string, conviction: number, exit: number): PaperPosition => ({
    ...base, id, symbol: 'X', direction: 'long', instrument: 'spot',
    quantity: 1, entryPrice: 100, stop: 90, target: 130,
    convictionAtEntry: conviction,
    closed: { exitPrice: exit, exitTime: Date.now(), reason: 'manual' },
  });
  const s = markPositions([mk('1', 85, 120), mk('2', 82, 110), mk('3', 40, 95)], { X: 100 });
  const high = s.convictionCalibration.find((b) => b.bucket === '80+');
  const low = s.convictionCalibration.find((b) => b.bucket === '32-49');
  assert.equal(high?.trades, 2);
  assert.equal(low?.trades, 1);
  assert.ok((high?.avgR ?? 0) > (low?.avgR ?? 0));
});

test('an unpriced symbol falls back to entry rather than marking to zero', () => {
  const pos: PaperPosition[] = [{
    ...base, id: '1', symbol: 'UNKNOWN', direction: 'long', instrument: 'spot',
    quantity: 10, entryPrice: 100, stop: 95, target: 115,
  }];
  const s = markPositions(pos, {});
  assert.ok(near(s.openPnl, 0), 'a missing quote must not fabricate a loss');
});

test('gross exposure sums both sides', () => {
  const pos: PaperPosition[] = [
    { ...base, id: '1', symbol: 'X', direction: 'long', instrument: 'spot', quantity: 10, entryPrice: 100, stop: 95, target: 115 },
    { ...base, id: '2', symbol: 'Y', direction: 'short', instrument: 'spot', quantity: 5, entryPrice: 100, stop: 105, target: 85 },
  ];
  const s = markPositions(pos, { X: 100, Y: 100 });
  assert.ok(near(s.netLongExposure, 1000));
  assert.ok(near(s.netShortExposure, 500));
  assert.ok(near(s.grossExposure, 1500));
});
