import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Bar } from '@/lib/types';
import { generateSignal } from '@/lib/signals';
import { classifyRegime, familyWeight } from '@/lib/signals/regime';
import { computeSnapshot } from '@/lib/indicators';
import { simulateSeries } from '@/lib/providers/simulator';
import { resolveInstrument, searchInstruments, ALL_INSTRUMENTS } from '@/lib/market/universe';
import {
  analyseInsiders, analyseSocial, analyseNews, scoreHeadline, categoriseHeadline,
  type InsiderTransaction,
} from '@/lib/sentiment';
import { assessVix, classifyVolRegime } from '@/lib/vol';
import { piotroskiFScore, altmanZScore } from '@/lib/fundamentals';
import { generateFundamentals } from '@/lib/fundamentals/generate';

const DAY = 86_400_000;

const seriesFor = (sym: string, n = 500): Bar[] =>
  simulateSeries(resolveInstrument(sym)!, { bars: n, timeframe: '1d' }).bars;

/* --- universe -------------------------------------------------------------- */

test('instrument resolution handles aliases and shorthands', () => {
  assert.equal(resolveInstrument('btc')?.symbol, 'BTC-USD');
  assert.equal(resolveInstrument('BITCOIN')?.symbol, 'BTC-USD');
  assert.equal(resolveInstrument('gold')?.symbol, 'GC=F');
  assert.equal(resolveInstrument('sp500')?.symbol, 'SPX');
  assert.equal(resolveInstrument('nvda')?.symbol, 'NVDA');
  assert.equal(resolveInstrument('GOOG')?.symbol, 'GOOGL');
  assert.equal(resolveInstrument('  aapl  ')?.symbol, 'AAPL');
  assert.equal(resolveInstrument('NOTATICKER'), undefined);
  assert.equal(resolveInstrument(''), undefined);
});

test('search ranks an exact symbol match first', () => {
  assert.equal(searchInstruments('NVDA')[0].symbol, 'NVDA');
  assert.ok(searchInstruments('bit').some((i) => i.symbol === 'BTC-USD'));
});

test('every instrument has a positive anchor and volatility', () => {
  for (const i of ALL_INSTRUMENTS) {
    assert.ok(i.anchor > 0, `${i.symbol} anchor`);
    assert.ok(i.typicalVol > 0, `${i.symbol} vol`);
    assert.ok(i.currency.length === 3, `${i.symbol} currency`);
  }
});

test('instrument symbols are unique', () => {
  const seen = new Set<string>();
  for (const i of ALL_INSTRUMENTS) {
    assert.ok(!seen.has(i.symbol), `duplicate symbol ${i.symbol}`);
    seen.add(i.symbol);
  }
});

/* --- regime ---------------------------------------------------------------- */

test('regime classification returns a known label with a description', () => {
  const snap = computeSnapshot(seriesFor('NVDA'));
  const r = classifyRegime(snap);
  assert.ok(r.label.length > 0);
  assert.ok(r.description.length > 40, 'regime must explain itself');
  assert.ok(Number.isFinite(r.trendStrength));
  assert.ok(r.hurst >= 0 && r.hurst <= 1);
});

test('regime weighting amplifies trend and suppresses mean reversion in a trend', () => {
  const trendUp = familyWeight('trend', 'strong_uptrend');
  const trendRange = familyWeight('trend', 'range');
  assert.ok(trendUp > trendRange, 'trend must matter more in a trend');

  const mrUp = familyWeight('meanreversion', 'strong_uptrend');
  const mrRange = familyWeight('meanreversion', 'range');
  assert.ok(mrRange > mrUp, 'mean reversion must matter more in a range');
});

test('a volatility shock damps directional families and lifts volatility ones', () => {
  assert.ok(familyWeight('trend', 'high_vol_shock') < familyWeight('trend', 'uptrend'));
  assert.ok(familyWeight('volatility', 'high_vol_shock') > familyWeight('volatility', 'uptrend'));
});

/* --- signal engine ---------------------------------------------------------- */

test('signal output is well formed for every asset class', () => {
  for (const sym of ['NVDA', 'BTC-USD', 'SPX', 'GC=F', 'EURUSD=X', 'XLK']) {
    const inst = resolveInstrument(sym)!;
    const sig = generateSignal({
      symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
      bars: seriesFor(sym), provenance: 'simulated', horizon: 'swing', equity: 10_000,
    });

    assert.ok(sig.score >= -1 && sig.score <= 1, `${sym} score out of range`);
    assert.ok(sig.conviction >= 0 && sig.conviction <= 100, `${sym} conviction out of range`);
    assert.ok(sig.agreement >= 0 && sig.agreement <= 1, `${sym} agreement out of range`);
    assert.ok(sig.dataQuality >= 0 && sig.dataQuality <= 1, `${sym} dataQuality out of range`);
    assert.ok(sig.votes.length > 15, `${sym} produced only ${sig.votes.length} votes`);

    for (const v of sig.votes) {
      assert.ok(v.score >= -1 && v.score <= 1, `${sym}/${v.id} score out of range`);
      assert.ok(v.confidence >= 0 && v.confidence <= 1, `${sym}/${v.id} confidence out of range`);
      assert.ok(v.rationale.length > 20, `${sym}/${v.id} rationale too thin`);
    }
  }
});

test('simulated inputs cap data quality below 0.6', () => {
  const sig = generateSignal({
    symbol: 'NVDA', name: 'NVIDIA', assetClass: 'equity',
    bars: seriesFor('NVDA'), provenance: 'simulated', horizon: 'swing', equity: 10_000,
  });
  assert.ok(sig.dataQuality <= 0.6, `simulated data must not read as trustworthy (${sig.dataQuality})`);
  assert.ok(sig.warnings.some((w) => w.includes('SIMULATED')), 'must warn that prices are simulated');
});

test('a flat, motionless series produces no position', () => {
  const flat: Bar[] = Array.from({ length: 400 }, (_, i) => ({
    t: i * DAY, o: 100, h: 100, l: 100, c: 100, v: 1000,
  }));
  const sig = generateSignal({
    symbol: 'FLAT', name: 'Flat', assetClass: 'equity',
    bars: flat, provenance: 'simulated', horizon: 'swing', equity: 10_000,
  });
  assert.equal(sig.plan.direction, 'flat', 'a motionless instrument must not be traded');
  assert.equal(sig.plan.size, 0);
  assert.ok(sig.plan.notes.length > 0, 'refusing to trade must be explained');
});

test('attribution contributions reconstruct the headline score', () => {
  const sig = generateSignal({
    symbol: 'BTC-USD', name: 'Bitcoin', assetClass: 'crypto',
    bars: seriesFor('BTC-USD'), provenance: 'simulated', horizon: 'swing', equity: 10_000,
  });
  const sum = sig.attribution.reduce((a, f) => a + f.contribution, 0);
  assert.ok(Math.abs(sum - sig.score) < 1e-9, `attribution ${sum} != score ${sig.score}`);
});

test('a trade plan is internally consistent whenever one is issued', () => {
  let planned = 0;
  for (const sym of ['NVDA', 'BTC-USD', 'SPX', 'GC=F', 'AAPL', 'TSLA', 'XLE', 'SOL-USD']) {
    const inst = resolveInstrument(sym)!;
    const sig = generateSignal({
      symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
      bars: seriesFor(sym, 600), provenance: 'simulated', horizon: 'swing', equity: 10_000,
    });
    const p = sig.plan;
    if (p.direction === 'flat') continue;
    planned++;

    if (p.direction === 'long') {
      assert.ok(p.stop < p.entry, `${sym}: long stop above entry`);
      for (const t of p.targets) assert.ok(t > p.entry, `${sym}: long target below entry`);
    } else {
      assert.ok(p.stop > p.entry, `${sym}: short stop below entry`);
      for (const t of p.targets) assert.ok(t < p.entry, `${sym}: short target above entry`);
    }
    for (const t of p.targets) assert.ok(t > 0, `${sym}: non-positive target ${t}`);
    assert.ok(p.riskFraction > 0 && p.riskFraction <= 0.02, `${sym}: risk fraction ${p.riskFraction}`);
    assert.ok(p.size > 0, `${sym}: non-positive size`);
    assert.ok(Math.abs(p.entry - p.stop) / p.entry <= 0.35, `${sym}: stop beyond the 35% ceiling`);
    assert.ok(p.notes.length > 0, `${sym}: plan must explain itself`);
  }
  assert.ok(planned > 0, 'no plans were produced across the sample');
});

test('conviction below the floor always yields a flat plan', () => {
  for (const sym of ['NVDA', 'BTC-USD', 'SPX', 'GC=F', 'AAPL', 'INTC', 'KO']) {
    const inst = resolveInstrument(sym)!;
    const sig = generateSignal({
      symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
      bars: seriesFor(sym, 550), provenance: 'simulated', horizon: 'swing', equity: 10_000,
    });
    if (sig.conviction < 32) {
      assert.equal(sig.plan.direction, 'flat', `${sym}: traded below the conviction floor`);
    }
  }
});

test('plan direction agrees with the sign of the net score', () => {
  for (const sym of ['NVDA', 'BTC-USD', 'SPX', 'GC=F', 'META', 'XOM']) {
    const inst = resolveInstrument(sym)!;
    const sig = generateSignal({
      symbol: inst.symbol, name: inst.name, assetClass: inst.assetClass,
      bars: seriesFor(sym, 550), provenance: 'simulated', horizon: 'swing', equity: 10_000,
    });
    if (sig.plan.direction === 'long') assert.ok(sig.score > 0, `${sym}: long on a negative score`);
    if (sig.plan.direction === 'short') assert.ok(sig.score < 0, `${sym}: short on a positive score`);
  }
});

/* --- sentiment -------------------------------------------------------------- */

test('insider cluster buying scores more bullishly than a single purchase', () => {
  const now = Date.now();
  const mk = (name: string, code: string, value: number, daysAgo: number): InsiderTransaction => ({
    insiderName: name, role: 'Director', transactionCode: code,
    shares: 1000, pricePerShare: 100, value,
    transactionDate: now - daysAgo * DAY, filingDate: now - (daysAgo - 1) * DAY,
    sharesAfter: 10_000, holdingChangePct: 10,
  });

  const single = analyseInsiders([mk('A', 'P', 1_000_000, 10)], 'live', 'sec', now);
  const cluster = analyseInsiders(
    [mk('A', 'P', 1_000_000, 10), mk('B', 'P', 800_000, 12), mk('C', 'P', 600_000, 15)],
    'live', 'sec', now,
  );
  assert.ok(cluster.clusterBuy, 'three distinct buyers in 30 days is a cluster');
  assert.ok(cluster.score > single.score, 'cluster buying must outscore a lone purchase');
});

test('insider selling is discounted relative to buying of equal size', () => {
  const now = Date.now();
  const base = {
    role: 'Director', shares: 1000, pricePerShare: 100,
    transactionDate: now - 10 * DAY, filingDate: now - 9 * DAY,
    sharesAfter: 10_000, holdingChangePct: 10,
  };
  const buy = analyseInsiders(
    [{ ...base, insiderName: 'A', transactionCode: 'P', value: 2_000_000 }], 'live', 'sec', now,
  );
  const sell = analyseInsiders(
    [{ ...base, insiderName: 'A', transactionCode: 'S', value: -2_000_000 }], 'live', 'sec', now,
  );
  assert.ok(buy.score > 0 && sell.score < 0);
  assert.ok(Math.abs(sell.score) < Math.abs(buy.score), 'sales must carry less weight than purchases');
});

test('extreme retail bullishness scores contrarian', () => {
  const euphoric = analyseSocial(
    [{ channel: 'X', sentiment: 0.85, mentions: 50_000, mentionChangePct: 300, bullishShare: 0.9, note: '' }],
    'live', 'x',
  );
  assert.equal(euphoric.crowding, 'extreme_bullish');
  assert.ok(euphoric.score < 0, 'euphoria must fade, not follow');

  const capitulation = analyseSocial(
    [{ channel: 'X', sentiment: -0.85, mentions: 50_000, mentionChangePct: 300, bullishShare: 0.1, note: '' }],
    'live', 'x',
  );
  assert.ok(capitulation.score > 0, 'capitulation must be read as washed out');
});

test('headline scoring separates bullish from bearish language', () => {
  assert.ok(scoreHeadline('Acme beats quarterly estimates as margins expand') > 0.3);
  assert.ok(scoreHeadline('Acme misses on revenue as demand softens') < -0.3);
  assert.ok(scoreHeadline('Regulatory probe reported into Acme practices') < -0.3);
  assert.ok(Math.abs(scoreHeadline('Acme to present at industry conference')) < 0.2);
});

test('headline categorisation identifies the obvious buckets', () => {
  assert.equal(categoriseHeadline('Acme Q3 earnings beat on strong revenue'), 'earnings');
  assert.equal(categoriseHeadline('Fed signals patience as CPI cools'), 'macro');
  assert.equal(categoriseHeadline('Acme faces lawsuit over practices'), 'legal');
  assert.equal(categoriseHeadline('Analyst raises price target on Acme'), 'analyst');
});

test('news sentiment decays with age', () => {
  const now = Date.now();
  const item = (hoursAgo: number, sentiment: number) => ({
    headline: 'x', summary: '', source: 's', url: '#',
    publishedAt: now - hoursAgo * 3_600_000,
    sentiment, relevance: 1, category: 'general' as const,
  });
  // A fresh positive item against an old negative one should net positive.
  const mixed = analyseNews([item(1, 0.8), item(200, -0.8)], 'live', 'n', now);
  assert.ok(mixed.aggregateSentiment > 0, 'recent news must dominate stale news');
});

/* --- volatility ------------------------------------------------------------- */

test('vix regime bands are ordered correctly', () => {
  assert.equal(classifyVolRegime(11), 'complacent');
  assert.equal(classifyVolRegime(14), 'calm');
  assert.equal(classifyVolRegime(18), 'normal');
  assert.equal(classifyVolRegime(24), 'elevated');
  assert.equal(classifyVolRegime(30), 'stressed');
  assert.equal(classifyVolRegime(45), 'panic');
});

test('vix assessment reads backwardation from the term ratio', () => {
  const back = assessVix({ vix: 28, vix3m: 24, vixPrev: 22 });
  assert.ok(back.ratio30d3m > 1);
  assert.ok(back.term.includes('backwardation'));

  const contango = assessVix({ vix: 14, vix3m: 18, vixPrev: 14 });
  assert.ok(contango.term.includes('contango'));
});

test('panic-level vix scores contrarian bullish', () => {
  const panic = assessVix({ vix: 45, vix3m: 34, vixPrev: 40 });
  assert.ok(panic.score > 0, 'extreme panic is historically a long signal, not a short one');
  assert.ok(panic.tradingImplication.length > 40);
});

/* --- fundamentals ------------------------------------------------------------ */

test('piotroski score stays within 0-9 and explains itself', () => {
  for (const sym of ['NVDA', 'KO', 'XOM']) {
    const inst = resolveInstrument(sym)!;
    const f = generateFundamentals(inst, seriesFor(sym, 400));
    const p = piotroskiFScore(f);
    assert.ok(p.score >= 0 && p.score <= 9, `${sym}: score ${p.score}`);
    assert.equal(p.signals.length, 9, `${sym}: expected nine tests`);
    assert.ok(p.interpretation.length > 5);
  }
});

test('altman z-score zones match the published thresholds', () => {
  const inst = resolveInstrument('NVDA')!;
  const f = generateFundamentals(inst, seriesFor('NVDA', 400));
  const z = altmanZScore(f);
  if (Number.isFinite(z.z)) {
    if (z.z > 2.99) assert.equal(z.zone, 'safe');
    else if (z.z >= 1.81) assert.equal(z.zone, 'grey');
    else assert.equal(z.zone, 'distress');
  }
});

test('generated fundamentals keep the balance sheet balanced', () => {
  const inst = resolveInstrument('AAPL')!;
  const f = generateFundamentals(inst, seriesFor('AAPL', 400));
  for (const b of f.balance) {
    assert.ok(
      Math.abs((b.totalLiabilities + b.equity) - b.totalAssets) < b.totalAssets * 1e-9,
      'assets must equal liabilities plus equity',
    );
  }
  // TTM aggregates must match the sum of the four most recent quarters.
  const ttmRevenue = f.income.slice(0, 4).reduce((a, x) => a + x.revenue, 0);
  assert.ok(Math.abs(f.ttm.revenue - ttmRevenue) < 1e-6);
});
