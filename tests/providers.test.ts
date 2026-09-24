import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { describeDenial } from '../src/lib/providers/http';

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('denial diagnostics', () => {
  // A 403 from a credentialled vendor and a 403 from an egress proxy look
  // identical on the wire and need opposite fixes. Getting this message wrong
  // sends someone hunting for a bad key when the network is the problem.

  test('names the missing variable when no key is configured', () => {
    delete process.env.FINNHUB_API_KEY;
    const msg = describeDenial('finnhub', 403);
    assert.match(msg, /FINNHUB_API_KEY/);
    assert.match(msg, /no FINNHUB_API_KEY is set/);
  });

  test('a keyless provider behind a proxy can only be a network block', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:8080';
    const msg = describeDenial('yahoo', 403);
    assert.match(msg, /needs no key/);
    assert.match(msg, /network policy/);
    // It must not send the reader looking for a credential that cannot exist.
    assert.doesNotMatch(msg, /API_KEY/);
  });

  test('a configured key behind a proxy names both possibilities', () => {
    process.env.HTTPS_PROXY = 'http://127.0.0.1:8080';
    process.env.FINNHUB_API_KEY = 'test-key';
    const msg = describeDenial('finnhub', 403);
    assert.match(msg, /FINNHUB_API_KEY is set/);
    assert.match(msg, /invalid\/over-quota key or the network policy/);
  });

  test('407 is always the proxy, never the vendor', () => {
    process.env.FINNHUB_API_KEY = 'test-key';
    const msg = describeDenial('finnhub', 407);
    assert.match(msg, /proxy refused to open the tunnel/);
    assert.match(msg, /egress policy, not a data problem/);
  });

  test('with no proxy set, a configured key is the thing to check', () => {
    delete process.env.HTTPS_PROXY;
    delete process.env.https_proxy;
    process.env.FINNHUB_API_KEY = 'test-key';
    const msg = describeDenial('finnhub', 401);
    assert.match(msg, /valid and within quota/);
  });
});

import { parseMoney, parseNasdaqDate, foldWeekly, parseFxPair } from '../src/lib/providers/adapters';

describe('nasdaq payload parsing', () => {
  // Nasdaq returns prices formatted for a web page, not for a program.
  // Every one of these shapes appears in real responses.
  test('unpicks display-formatted money', () => {
    assert.equal(parseMoney('$341.075'), 341.075);
    assert.equal(parseMoney('31,658,820'), 31658820);
    assert.equal(parseMoney('26,936.04'), 26936.04);
    assert.equal(parseMoney('80.46'), 80.46);
    // Indexes report no volume; halted sessions report nothing at all.
    assert.ok(Number.isNaN(parseMoney('--')));
    assert.ok(Number.isNaN(parseMoney('N/A')));
    assert.ok(Number.isNaN(parseMoney('')));
    assert.ok(Number.isNaN(parseMoney(undefined)));
  });

  test('parses MM/DD/YYYY at UTC noon so no bar slips a day', () => {
    const t = parseNasdaqDate('09/23/2026');
    const d = new Date(t);
    assert.equal(d.getUTCFullYear(), 2026);
    assert.equal(d.getUTCMonth(), 8); // September
    assert.equal(d.getUTCDate(), 23);
    // Noon UTC survives a +/-12h timezone render without changing date.
    assert.equal(d.getUTCHours(), 12);
    assert.ok(Number.isNaN(parseNasdaqDate('2026-09-23')));
    assert.ok(Number.isNaN(parseNasdaqDate('garbage')));
  });

  test('weekly folding keeps OHLC semantics', () => {
    // Two calendar weeks of daily bars.
    const day = 86400000;
    const base = Date.UTC(2026, 0, 5, 12); // a Monday
    const bars = Array.from({ length: 10 }, (_, i) => ({
      t: base + i * day,
      o: 100 + i, h: 110 + i, l: 90 + i, c: 105 + i, v: 1000,
    }));

    const weekly = foldWeekly(bars);
    assert.ok(weekly.length >= 2, 'ten daily bars must fold into at least two weeks');

    const first = weekly[0];
    const members = bars.filter((b) => b.t < weekly[1].t);
    assert.equal(first.o, members[0].o, 'week opens at the first bar');
    assert.equal(first.c, members[members.length - 1].c, 'week closes at the last bar');
    assert.equal(first.h, Math.max(...members.map((m) => m.h)), 'week high is the max');
    assert.equal(first.l, Math.min(...members.map((m) => m.l)), 'week low is the min');
    assert.equal(first.v, members.reduce((a, m) => a + m.v, 0), 'volume sums');
  });
});

describe('fx pair parsing', () => {
  test('splits a Yahoo-style pair into base and quote', () => {
    assert.deepEqual(parseFxPair('EURUSD=X'), { base: 'EUR', quote: 'USD' });
    assert.deepEqual(parseFxPair('usdjpy=x'), { base: 'USD', quote: 'JPY' });
    assert.equal(parseFxPair('AAPL'), undefined);
    assert.equal(parseFxPair('BTC-USD'), undefined);
    assert.equal(parseFxPair('DX-Y.NYB'), undefined);
  });
});

import {
  registerFeed, recordSuccess, recordFailure, allFeeds, feedSummary,
} from '../src/lib/providers/health';

describe('feed health states', () => {
  // The bug this guards against: a configured-but-never-called feed was
  // registered as 'down', so a cold process announced "NO LIVE FEED
  // REACHABLE — FIGURES ARE SYNTHETIC" in the status strip while live
  // prices rendered in the panels directly above it. Contradicting yourself
  // about provenance is worse than either answer alone.

  const get = (id: string) => allFeeds().find((f) => f.id === id);

  test('a feed nobody has called is unknown, not down', () => {
    registerFeed('t-unknown', 'Test Unknown', true);
    assert.equal(get('t-unknown')?.state, 'unknown');
  });

  test('a feed with no key is unconfigured', () => {
    registerFeed('t-nokey', 'Test NoKey', false);
    assert.equal(get('t-nokey')?.state, 'unconfigured');
  });

  test('success and failure move the state as expected', () => {
    registerFeed('t-flow', 'Test Flow', true);
    assert.equal(get('t-flow')?.state, 'unknown');

    recordSuccess('t-flow', 120);
    assert.equal(get('t-flow')?.state, 'live');

    // One failure straight after a success is a blip, not an outage.
    recordFailure('t-flow', 'transient');
    assert.equal(get('t-flow')?.state, 'degraded');
  });

  test('a first-ever failure goes straight to down', () => {
    registerFeed('t-dead', 'Test Dead', true);
    recordFailure('t-dead', 'refused');
    assert.equal(get('t-dead')?.state, 'down');
  });

  test('summary counts only feeds that were actually called', () => {
    registerFeed('t-sum-a', 'A', true);
    registerFeed('t-sum-b', 'B', false);
    const before = feedSummary().attempted;
    recordSuccess('t-sum-a', 50);
    const after = feedSummary().attempted;
    assert.equal(after, before + 1, 'calling a feed makes it count as attempted');
    // The unconfigured one never counts, however many times we ask.
    assert.equal(get('t-sum-b')?.state, 'unconfigured');
  });
});
