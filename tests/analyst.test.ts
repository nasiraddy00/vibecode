import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeAnalystNote } from '@/lib/signals/analyst';
import { generateSignal } from '@/lib/signals';
import { computeSnapshot } from '@/lib/indicators';
import { simulateSeries } from '@/lib/providers/simulator';
import { resolveInstrument } from '@/lib/market/universe';
import { assessFundamentals } from '@/lib/fundamentals';
import { generateFundamentals } from '@/lib/fundamentals/generate';
import type { Bar } from '@/lib/types';

function noteFor(sym: string, bars?: Bar[]) {
  const inst = resolveInstrument(sym)!;
  const series = bars ?? simulateSeries(inst, { bars: 600, timeframe: '1d' }).bars;
  const snapshot = computeSnapshot(series);
  const raw = inst.assetClass === 'equity' ? generateFundamentals(inst, series) : null;
  const fundamentals = raw ? assessFundamentals(raw, snapshot.price) : null;
  const signal = generateSignal({
    symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
    bars: series, provenance: 'simulated', horizon: 'swing', equity: 10_000,
    fundamentals: fundamentals ?? undefined,
  });
  return {
    note: writeAnalystNote({
      signal, snapshot, name: inst.name, assetClass: inst.assetClass,
      fundamentals, simulated: true,
    }),
    signal,
  };
}

const SYMBOLS = ['NVDA', 'GE', 'BTC-USD', 'SPX', 'GC=F', 'KO', 'XLE'];

test('the call always agrees with the engine plan', () => {
  for (const sym of SYMBOLS) {
    const { note, signal } = noteFor(sym);
    const dir = signal.plan.direction;
    if (dir === 'flat') {
      assert.equal(note.action, 'NO TRADE', `${sym}`);
      assert.equal(note.direction, 'FLAT', `${sym}`);
      assert.equal(note.expression, 'no position', `${sym}`);
    } else if (dir === 'long') {
      assert.equal(note.action, 'BUY', `${sym}`);
      assert.equal(note.direction, 'LONG', `${sym}`);
    } else {
      assert.equal(note.action, 'SELL', `${sym}`);
      assert.equal(note.direction, 'SHORT', `${sym}`);
    }
  }
});

test('every section is substantive prose, never a stub', () => {
  for (const sym of SYMBOLS) {
    const { note } = noteFor(sym);
    assert.ok(note.headline.length > 60, `${sym} headline`);
    assert.ok(note.thesis.length > 150, `${sym} thesis`);
    assert.ok(note.technical.length > 80, `${sym} technical`);
    assert.ok(note.volatility.length > 40, `${sym} volatility`);
    assert.ok(note.invalidation.length > 80, `${sym} invalidation`);
    assert.ok(note.execution.length > 60, `${sym} execution`);
    assert.ok(note.bottomLine.length > 30, `${sym} bottom line`);
  }
});

test('both cases are shown even when there is no trade', () => {
  let sawFlat = false;
  for (const sym of SYMBOLS) {
    const { note } = noteFor(sym);
    if (note.action !== 'NO TRADE') continue;
    sawFlat = true;
    // On a no-trade the two competing cases are the entire content.
    assert.ok(note.supporting.length > 0, `${sym} bull case must not be empty`);
    assert.ok(note.against.length > 0, `${sym} bear case must not be empty`);
    assert.equal(note.supportingHeading, 'The bull case');
    assert.equal(note.againstHeading, 'The bear case');
  }
  assert.ok(sawFlat, 'expected at least one no-trade across the sample');
});

test('a directional call always names an invalidation level', () => {
  for (const sym of SYMBOLS) {
    const { note, signal } = noteFor(sym);
    if (note.action === 'NO TRADE') continue;
    const stop = signal.plan.stop.toFixed(2);
    assert.ok(
      note.invalidation.includes(stop),
      `${sym}: invalidation must quote the stop (${stop})`,
    );
    assert.ok(/\b(below|above)\b/.test(note.invalidation), `${sym}: must name a side`);
  }
});

test('simulated runs always disclose it, in capitals, up front', () => {
  for (const sym of SYMBOLS) {
    const { note } = noteFor(sym);
    assert.ok(note.disclosure.startsWith('PRICES ARE SIMULATED'), `${sym}`);
    assert.ok(note.disclosure.includes('Do not trade on this'), `${sym}`);
  }
});

test('names ending in a period do not produce a double period', () => {
  const { note } = noteFor('NVDA'); // "NVIDIA Corp."
  assert.ok(!/Corp\.\./.test(note.headline), 'headline');
  assert.ok(!/Corp\.\./.test(note.thesis), 'thesis');
  assert.ok(!/Corp\.\./.test(note.bottomLine), 'bottom line');
});

test('percentile ordinals are well formed', () => {
  for (const sym of SYMBOLS) {
    const { note } = noteFor(sym);
    // "82th" / "1th" / "3th" are the classic naive-suffix bugs.
    assert.ok(!/\b\d*[02-9]1th\b/.test(note.volatility), `${sym}: bad -1th`);
    assert.ok(!/\b(?<!1)[123]th\b/.test(note.volatility), `${sym}: bad small ordinal`);
  }
});

test('the technical read names a conflict when the indicators disagree', () => {
  let sawConflict = false;
  for (const sym of SYMBOLS) {
    const { note } = noteFor(sym);
    const hasBoth =
      note.technical.includes('Arguing higher:') && note.technical.includes('Arguing lower:');
    if (!hasBoth) continue;
    sawConflict = true;
    // A split book must be announced, not smuggled in behind an "and".
    assert.ok(
      /contradict each other/.test(note.technical),
      `${sym}: a split technical picture must say so`,
    );
  }
  assert.ok(sawConflict, 'expected at least one conflicted technical read in the sample');
});

test('a motionless series produces a no-trade note that explains itself', () => {
  const flat: Bar[] = Array.from({ length: 400 }, (_, i) => ({
    t: i * 86_400_000, o: 100, h: 100, l: 100, c: 100, v: 1000,
  }));
  const { note } = noteFor('KO', flat);
  assert.equal(note.action, 'NO TRADE');
  assert.ok(note.execution.toLowerCase().includes('no position'));
  assert.ok(note.thesis.length > 100, 'a refusal still has to be argued');
});

test('conviction wording tracks the score', () => {
  for (const sym of SYMBOLS) {
    const { note, signal } = noteFor(sym);
    const c = signal.conviction;
    const expected =
      c >= 80 ? 'high' : c >= 65 ? 'solid' : c >= 50 ? 'moderate' : c >= 32 ? 'marginal' : 'insufficient';
    assert.equal(note.convictionWord, expected, `${sym} at ${c.toFixed(0)}`);
  }
});
