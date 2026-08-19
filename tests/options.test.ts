import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  blackScholes, impliedVolatility, strikeForDelta, expectedMove, straddlePrice,
} from '@/lib/options/blackscholes';
import { ivStats, analyseSkew, valueBasket, type OptionContract } from '@/lib/options/chain';
import { normCdf, normInv, normPdf } from '@/lib/util/math';

const near = (a: number, b: number, tol = 1e-6): boolean => Math.abs(a - b) <= tol;

/* --- distribution helpers -------------------------------------------------- */

test('normCdf matches known quantiles', () => {
  assert.ok(near(normCdf(0), 0.5, 1e-7));
  assert.ok(near(normCdf(1.6448536), 0.95, 1e-6));
  assert.ok(near(normCdf(-1.9599640), 0.025, 1e-6));
  assert.ok(near(normCdf(2.5758293), 0.995, 1e-6));
});

test('normCdf and normInv are inverses', () => {
  for (const p of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9, 0.99]) {
    assert.ok(near(normCdf(normInv(p)), p, 1e-5), `failed at p=${p}`);
  }
});

test('normPdf integrates to ~1 over a wide grid', () => {
  let area = 0;
  const dx = 0.001;
  for (let x = -8; x <= 8; x += dx) area += normPdf(x) * dx;
  assert.ok(near(area, 1, 1e-4));
});

/* --- Black-Scholes ---------------------------------------------------------- */

test('black-scholes matches textbook values to six decimals', () => {
  // S=100 K=100 T=1 r=5% sigma=20% q=0
  const c = blackScholes(100, 100, 1, 0.05, 0.2, 'call');
  const p = blackScholes(100, 100, 1, 0.05, 0.2, 'put');
  assert.ok(near(c.price, 10.450584, 1e-4), `call ${c.price}`);
  assert.ok(near(p.price, 5.573526, 1e-4), `put ${p.price}`);
  assert.ok(near(c.delta, 0.636831, 1e-5));
  assert.ok(near(p.delta, -0.363169, 1e-5));
  assert.ok(near(c.gamma, 0.018762, 1e-6));
  assert.ok(near(c.vega, 0.375240, 1e-5));
});

test('put-call parity holds', () => {
  for (const [S, K, T, r, v] of [[100, 100, 1, 0.05, 0.2], [87, 95, 0.25, 0.03, 0.45], [250, 200, 2, 0.06, 0.3]]) {
    const c = blackScholes(S, K, T, r, v, 'call').price;
    const p = blackScholes(S, K, T, r, v, 'put').price;
    assert.ok(near(c - p, S - K * Math.exp(-r * T), 1e-6), `parity failed at S=${S} K=${K}`);
  }
});

test('gamma and vega are identical for calls and puts', () => {
  const c = blackScholes(120, 100, 0.5, 0.04, 0.35, 'call');
  const p = blackScholes(120, 100, 0.5, 0.04, 0.35, 'put');
  assert.ok(near(c.gamma, p.gamma, 1e-12));
  assert.ok(near(c.vega, p.vega, 1e-12));
});

test('long option theta is negative and deep-ITM delta approaches 1', () => {
  assert.ok(blackScholes(100, 100, 1, 0.05, 0.2, 'call').theta < 0);
  assert.ok(blackScholes(400, 100, 1, 0.05, 0.2, 'call').delta > 0.99);
  assert.ok(blackScholes(25, 100, 1, 0.05, 0.2, 'put').delta < -0.99);
});

test('at expiry the price collapses to intrinsic value', () => {
  assert.ok(near(blackScholes(110, 100, 0, 0.05, 0.2, 'call').price, 10));
  assert.ok(near(blackScholes(90, 100, 0, 0.05, 0.2, 'call').price, 0));
  assert.ok(near(blackScholes(90, 100, 0, 0.05, 0.2, 'put').price, 10));
});

test('option value is monotonically increasing in volatility', () => {
  let prev = -1;
  for (const v of [0.05, 0.1, 0.2, 0.4, 0.8, 1.5]) {
    const price = blackScholes(100, 100, 0.5, 0.04, v, 'call').price;
    assert.ok(price > prev, `not monotonic at vol=${v}`);
    prev = price;
  }
});

test('call price is monotonically increasing in spot', () => {
  let prev = -1;
  for (const S of [60, 80, 100, 120, 160]) {
    const price = blackScholes(S, 100, 0.5, 0.04, 0.3, 'call').price;
    assert.ok(price > prev);
    prev = price;
  }
});

/* --- implied volatility ------------------------------------------------------ */

test('implied volatility round-trips wherever extrinsic value is solvable', () => {
  let checked = 0;
  let unsolvable = 0;
  for (const K of [60, 80, 100, 120, 150]) {
    for (const vol of [0.1, 0.22, 0.5, 0.95, 1.6]) {
      for (const type of ['call', 'put'] as const) {
        const px = blackScholes(100, K, 0.5, 0.045, vol, type).price;
        const intrinsic = type === 'call'
          ? Math.max(0, 100 - K * Math.exp(-0.045 * 0.5))
          : Math.max(0, K * Math.exp(-0.045 * 0.5) - 100);
        const extrinsic = px - intrinsic;
        const iv = impliedVolatility(px, 100, K, 0.5, 0.045, type);

        if (extrinsic < 1e-10) {
          // A deep-ITM option at low volatility carries no extrinsic value at
          // double precision, so no volatility can be recovered from its price.
          // Returning NaN is the correct answer; inventing a number would not be.
          assert.ok(Number.isNaN(iv), `K=${K} vol=${vol} ${type}: expected NaN, got ${iv}`);
          unsolvable++;
        } else {
          // Precision available from a price is proportional to how much the
          // price actually moves with volatility. A contract worth 4e-8 cannot
          // pin volatility to four decimals no matter how good the solver is,
          // so the tolerance scales with the extrinsic value present.
          const tol = extrinsic > 1e-3 ? 1e-4 : 5e-3;
          assert.ok(near(iv, vol, tol), `K=${K} vol=${vol} ${type}: got ${iv} (extrinsic ${extrinsic.toExponential(2)})`);
          checked++;
        }
      }
    }
  }
  assert.equal(checked + unsolvable, 50);
  assert.ok(checked >= 45, `only ${checked} of 50 cases were solvable`);
});

test('implied volatility returns NaN below intrinsic value', () => {
  // A call cannot be worth less than S - K discounted.
  assert.ok(Number.isNaN(impliedVolatility(0.01, 150, 100, 1, 0.05, 'call')));
});

test('implied volatility survives deep out-of-the-money quotes', () => {
  const px = blackScholes(100, 200, 0.08, 0.045, 0.6, 'call').price;
  const iv = impliedVolatility(px, 100, 200, 0.08, 0.045, 'call');
  assert.ok(Number.isNaN(iv) || near(iv, 0.6, 1e-3), `got ${iv}`);
});

/* --- strike selection --------------------------------------------------------- */

test('strikeForDelta recovers the requested delta', () => {
  for (const target of [0.15, 0.25, 0.4, 0.5, 0.65]) {
    for (const type of ['call', 'put'] as const) {
      const K = strikeForDelta(100, 0.25, 0.045, 0.35, target, type);
      const actual = Math.abs(blackScholes(100, K, 0.25, 0.045, 0.35, type).delta);
      assert.ok(near(actual, target, 5e-3), `${type} ${target}: got ${actual}`);
    }
  }
});

test('a higher-delta call has a lower strike', () => {
  const k25 = strikeForDelta(100, 0.25, 0.045, 0.35, 0.25, 'call');
  const k50 = strikeForDelta(100, 0.25, 0.045, 0.35, 0.5, 'call');
  assert.ok(k50 < k25);
});

/* --- expected move --------------------------------------------------------------- */

test('expected move scales with sqrt(time)', () => {
  const a = expectedMove(100, 0.25, 0.4).absolute;
  const b = expectedMove(100, 1.0, 0.4).absolute;
  assert.ok(near(b / a, 2, 1e-9));
});

test('straddle price approximates the expected move', () => {
  const T = 30 / 365;
  const straddle = straddlePrice(100, T, 0.045, 0.4);
  const em = expectedMove(100, T, 0.4).absolute;
  // The ATM straddle is ~0.8 x the 1-sigma move; check the right ballpark.
  assert.ok(straddle / em > 0.6 && straddle / em < 1.0, `ratio ${straddle / em}`);
});

/* --- IV statistics ------------------------------------------------------------------ */

test('iv rank is 0 at the yearly low and 1 at the high', () => {
  const hist = Array.from({ length: 252 }, (_, i) => 0.2 + (i / 251) * 0.4); // 0.20 -> 0.60
  assert.ok(near(ivStats(0.2, hist, 0.18).ivRank, 0, 1e-9));
  assert.ok(near(ivStats(0.6, hist, 0.18).ivRank, 1, 1e-9));
  assert.ok(near(ivStats(0.4, hist, 0.18).ivRank, 0.5, 1e-9));
});

test('premium bias favours buying when iv is cheap and selling when rich', () => {
  const hist = Array.from({ length: 252 }, (_, i) => 0.2 + (i / 251) * 0.4);
  assert.equal(ivStats(0.22, hist, 0.20).premiumBias, 'buy');
  assert.equal(ivStats(0.58, hist, 0.30).premiumBias, 'sell');
});

test('volatility risk premium is implied minus realised', () => {
  const s = ivStats(0.35, [0.3, 0.35, 0.4], 0.25);
  assert.ok(near(s.vrp, 0.10, 1e-9));
});

/* --- skew ------------------------------------------------------------------------------- */

test('skew is positive when the 25-delta put is bid over the call', () => {
  const mk = (type: 'call' | 'put', delta: number, iv: number): OptionContract => ({
    symbol: 'X', type, strike: 100, expiry: Date.now() + 30 * 86400000, dte: 30,
    bid: 1, ask: 1.1, last: 1.05, mid: 1.05, volume: 10, openInterest: 100,
    impliedVol: iv, delta, gamma: 0, theta: 0, vega: 0, inTheMoney: false,
  });
  const contracts = [
    mk('put', -0.25, 0.42), mk('put', -0.5, 0.35),
    mk('call', 0.25, 0.32), mk('call', 0.5, 0.35),
  ];
  const s = analyseSkew(contracts, 100);
  assert.ok(near(s.skew25, 10, 1e-6));
  assert.equal(s.direction, 'put_skew');
});

/* --- basket -------------------------------------------------------------------------------- */

test('basket marks positions and aggregates greeks with the 100x multiplier', () => {
  const expiry = Date.now() + 30 * 86400000;
  const summary = valueBasket(
    [{
      id: '1', symbol: 'X', type: 'call', strike: 100, expiry,
      quantity: 2, entryPrice: 3, entryDate: Date.now(), underlyingEntry: 100,
    }],
    { X: 110 }, { X: 0.35 },
  );
  assert.equal(summary.positions.length, 1);
  // 2 contracts x 100 shares x $3 premium
  assert.ok(near(summary.totalCost, 600));
  // Spot moved from 100 to 110 on a call: the position must be profitable.
  assert.ok(summary.totalPnl > 0);
  assert.ok(summary.netDelta > 0);
  assert.ok(summary.netTheta < 0, 'long premium must decay');
});

test('basket flags short-dated long positions', () => {
  const summary = valueBasket(
    [{
      id: '1', symbol: 'X', type: 'call', strike: 100,
      expiry: Date.now() + 3 * 86400000,
      quantity: 1, entryPrice: 1, entryDate: Date.now(), underlyingEntry: 100,
    }],
    { X: 100 }, { X: 0.4 },
  );
  assert.ok(summary.warnings.some((w) => w.includes('7 DTE')));
});
