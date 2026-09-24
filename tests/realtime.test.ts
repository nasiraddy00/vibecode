import { test } from 'node:test';
import assert from 'node:assert/strict';
import { binancePairs, parseMiniTicker, backoffDelay } from '@/lib/realtime/binance';

/* --- symbol mapping --------------------------------------------------------- */

test('binancePairs maps only symbols that trade on Binance', () => {
  const pairs = binancePairs(['BTC-USD', 'ETH-USD', 'NVDA', 'GC=F', 'NOTREAL']);
  assert.equal(pairs.get('btcusdt'), 'BTC-USD');
  assert.equal(pairs.get('ethusdt'), 'ETH-USD');
  // Equities and commodities have no Binance mapping and must be dropped.
  assert.equal(pairs.size, 2);
});

test('binancePairs accepts the shorthands the search box accepts', () => {
  const pairs = binancePairs(['btc', 'BITCOIN']);
  assert.equal(pairs.get('btcusdt'), 'BTC-USD');
  assert.equal(pairs.size, 1, 'both aliases resolve to the same pair');
});

/* --- frame parsing ---------------------------------------------------------- */

const pairs = binancePairs(['BTC-USD']);
const frame = (data: Record<string, unknown>): string =>
  JSON.stringify({ stream: 'btcusdt@miniTicker', data });

test('parseMiniTicker extracts price, timestamp and change', () => {
  const t = parseMiniTicker(frame({ s: 'BTCUSDT', c: '110.0', o: '100.0', E: 1234 }), pairs);
  assert.ok(t);
  assert.equal(t.symbol, 'BTC-USD');
  assert.equal(t.price, 110);
  assert.equal(t.ts, 1234);
  assert.ok(Math.abs((t.change ?? 0) - 10) < 1e-9);
  assert.ok(Math.abs((t.changePct ?? 0) - 10) < 1e-9);
  assert.equal(t.venue, 'binance');
});

test('parseMiniTicker ignores frames for unsubscribed symbols', () => {
  assert.equal(parseMiniTicker(frame({ s: 'ETHUSDT', c: '1', o: '1', E: 1 }), pairs), null);
});

test('parseMiniTicker rejects malformed and unusable frames rather than throwing', () => {
  assert.equal(parseMiniTicker('not json', pairs), null);
  assert.equal(parseMiniTicker('{}', pairs), null);
  assert.equal(parseMiniTicker(frame({ s: 'BTCUSDT', c: 'abc', o: '1', E: 1 }), pairs), null);
  // A zero or negative price is a bad frame, not a real quote.
  assert.equal(parseMiniTicker(frame({ s: 'BTCUSDT', c: '0', o: '1', E: 1 }), pairs), null);
});

test('parseMiniTicker omits change when the open is unusable', () => {
  const t = parseMiniTicker(frame({ s: 'BTCUSDT', c: '50', o: '0', E: 9 }), pairs);
  assert.ok(t);
  assert.equal(t.price, 50);
  // Dividing by a zero open would produce Infinity; omitting is the honest move.
  assert.equal(t.change, undefined);
  assert.equal(t.changePct, undefined);
});

test('parseMiniTicker is case-insensitive on the venue symbol', () => {
  const t = parseMiniTicker(frame({ s: 'btcusdt', c: '5', o: '4', E: 1 }), pairs);
  assert.ok(t, 'venue casing must not drop a tick');
});

/* --- reconnect backoff ------------------------------------------------------- */

test('backoff grows exponentially and caps at 30s', () => {
  // rand() = 1 gives the ceiling for that attempt.
  const ceilingAt = (n: number): number => backoffDelay(n, () => 1);
  assert.equal(ceilingAt(1), 2_000);
  assert.equal(ceilingAt(2), 4_000);
  assert.equal(ceilingAt(3), 8_000);
  assert.equal(ceilingAt(10), 30_000, 'must cap rather than grow without bound');
});

test('backoff is fully jittered', () => {
  // Full jitter means the delay is uniform over [0, ceiling), not a fixed
  // value — that is what stops every client reconnecting in lockstep.
  assert.equal(backoffDelay(5, () => 0), 0);
  const ceiling = backoffDelay(5, () => 1);
  const mid = backoffDelay(5, () => 0.5);
  assert.ok(Math.abs(mid - ceiling / 2) < 1e-9);
});
