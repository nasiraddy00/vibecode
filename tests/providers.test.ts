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
