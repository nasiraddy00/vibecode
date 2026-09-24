import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_INSTRUMENTS, CURATED_COUNT, BONDS, CRYPTO, EQUITIES, HOME_PANELS,
  resolveInstrument, searchInstruments, registerInstrument, isCurated,
  type Instrument,
} from '../src/lib/market/universe';
import { inferAssetClass, synthesise, calibrateFromBars } from '../src/lib/market/resolve';

describe('instrument universe', () => {
  test('every symbol is unique', () => {
    const seen = new Map<string, string>();
    for (const i of ALL_INSTRUMENTS) {
      const key = i.symbol.toUpperCase();
      assert.equal(seen.has(key), false, `duplicate symbol ${key} (${i.name} vs ${seen.get(key)})`);
      seen.set(key, i.name);
    }
  });

  test('every instrument carries usable simulator calibration', () => {
    for (const i of ALL_INSTRUMENTS) {
      assert.ok(Number.isFinite(i.anchor) && i.anchor > 0, `${i.symbol}: bad anchor ${i.anchor}`);
      assert.ok(i.typicalVol > 0 && i.typicalVol < 2, `${i.symbol}: implausible vol ${i.typicalVol}`);
      assert.ok(Number.isFinite(i.drift), `${i.symbol}: bad drift`);
      assert.ok(i.currency.length === 3, `${i.symbol}: bad currency ${i.currency}`);
      assert.ok(i.venue.length > 0, `${i.symbol}: missing venue`);
    }
  });

  test('covers every asset class the terminal claims to trade', () => {
    const classes = new Set(ALL_INSTRUMENTS.map((i) => i.assetClass));
    for (const c of ['equity', 'etf', 'bond', 'index', 'crypto', 'commodity', 'fx', 'rate']) {
      assert.ok(classes.has(c as Instrument['assetClass']), `no instruments for class ${c}`);
    }
    // The curated list is the shipped floor, not an aspiration.
    assert.ok(CURATED_COUNT > 400, `expected a broad universe, got ${CURATED_COUNT}`);
    assert.ok(BONDS.length >= 40, `expected real fixed-income coverage, got ${BONDS.length}`);
  });

  test('crypto entries carry the ids their providers need', () => {
    for (const c of CRYPTO) {
      assert.ok(c.coingeckoId, `${c.symbol}: missing coingeckoId — the keyless fallback cannot run`);
      assert.match(c.symbol, /-USD$/, `${c.symbol}: crypto symbols are quoted against USD`);
      if (c.binanceSymbol) {
        assert.match(c.binanceSymbol, /USDT$/, `${c.symbol}: Binance pairs settle in USDT`);
      }
    }
  });

  test('bonds are ordered by duration the way the curve is', () => {
    const dur = (s: string): number => {
      const b = BONDS.find((x) => x.symbol === s);
      assert.ok(b, `${s} missing from the bond list`);
      assert.ok(b.bondKind, `${s} has no bond kind`);
      assert.ok(typeof b.duration === 'number', `${s} has no duration`);
      return b.duration as number;
    };
    // Duration is the whole point of a bond fund; if this ordering is wrong
    // every rates-driven signal downstream is wrong with it.
    const ladder = ['SGOV', 'SHY', 'IEI', 'IEF', 'TLH', 'TLT', 'EDV'];
    for (let i = 1; i < ladder.length; i++) {
      assert.ok(
        dur(ladder[i]) > dur(ladder[i - 1]),
        `${ladder[i]} (${dur(ladder[i])}y) should be longer than ${ladder[i - 1]} (${dur(ladder[i - 1])}y)`,
      );
    }
    // Volatility has to rise with duration too, or the simulator will make
    // a 25-year zero look as calm as a T-bill.
    const vol = (s: string): number => BONDS.find((x) => x.symbol === s)!.typicalVol;
    assert.ok(vol('TLT') > vol('IEF'));
    assert.ok(vol('IEF') > vol('SHY'));
    assert.ok(vol('SHY') > vol('SGOV'));
  });

  test('every home panel symbol resolves', () => {
    for (const [panel, symbols] of Object.entries(HOME_PANELS)) {
      for (const s of symbols as readonly string[]) {
        assert.ok(resolveInstrument(s), `panel ${panel}: ${s} does not resolve`);
      }
    }
  });

  test('aliases and shorthand resolve the way a trader types them', () => {
    const cases: [string, string][] = [
      ['btc', 'BTC-USD'], ['BTCUSDT', 'BTC-USD'], ['bitcoin', 'BTC-USD'],
      ['eurusd', 'EURUSD=X'], ['gold', 'GC=F'], ['oil', 'CL=F'],
      ['10y', 'TNX'], ['30y', 'TYX'], ['junk', 'HYG'], ['tips', 'TIP'],
      ['brk.b', 'BRK-B'], ['goog', 'GOOGL'], ['fb', 'META'],
      ['nikkei', 'N225'], ['aapl', 'AAPL'],
    ];
    for (const [input, expected] of cases) {
      assert.equal(resolveInstrument(input)?.symbol, expected, `${input} -> ${expected}`);
    }
  });

  test('search ranks an exact ticker above a name match', () => {
    const hits = searchInstruments('V', 5);
    assert.equal(hits[0].symbol, 'V', 'an exact symbol match must come first');
  });
});

describe('dynamic resolution', () => {
  test('infers asset class from symbol shape before vendor labels', () => {
    // Shape is unambiguous where the vendor's label often is not.
    assert.equal(inferAssetClass('^GSPC', 'INDEX'), 'index');
    assert.equal(inferAssetClass('CL=F', 'FUTURE'), 'commodity');
    assert.equal(inferAssetClass('EURUSD=X', 'CURRENCY'), 'fx');
    assert.equal(inferAssetClass('BTC-USD', 'CRYPTOCURRENCY'), 'crypto');
    assert.equal(inferAssetClass('AAPL', 'Common Stock'), 'equity');
    assert.equal(inferAssetClass('VT', 'ETF'), 'etf');
  });

  test('classes a bond fund as a bond even when the vendor calls it an ETF', () => {
    // Yahoo and Finnhub both label these ETF. A trader cares that they
    // behave like duration, not like equity beta.
    assert.equal(inferAssetClass('BIV', 'ETF', 'Vanguard Intermediate-Term Bond ETF'), 'bond');
    assert.equal(inferAssetClass('SCHO', 'ETF', 'Schwab Short-Term US Treasury ETF'), 'bond');
    assert.equal(inferAssetClass('HYD', 'ETF', 'VanEck High Yield Muni ETF'), 'bond');
    // But a genuine equity fund stays an ETF.
    assert.equal(inferAssetClass('VTI', 'ETF', 'Vanguard Total Stock Market ETF'), 'etf');
  });

  test('synthesised instruments are usable and honestly labelled', () => {
    const inst = synthesise({
      symbol: 'rklb', name: 'Rocket Lab USA Inc', type: 'Common Stock', source: 'finnhub',
    });
    assert.equal(inst.symbol, 'RKLB', 'symbols are normalised to upper case');
    assert.equal(inst.assetClass, 'equity');
    assert.equal(inst.dynamic, true, 'a vendor-sourced entry must announce itself');
    assert.equal(inst.continuous, false);
    assert.equal(inst.binanceSymbol, undefined, 'only crypto gets a Binance pair');
    assert.ok(inst.anchor > 0 && inst.typicalVol > 0, 'must be simulator-safe');
  });

  test('registering never overwrites curated calibration', () => {
    const curated = resolveInstrument('AAPL');
    assert.ok(curated);
    const before = curated.typicalVol;

    const returned = registerInstrument(synthesise({
      symbol: 'AAPL', name: 'Apple Wrong Name', type: 'Common Stock', source: 'yahoo',
    }));

    assert.equal(returned.name, curated.name, 'the curated entry must win');
    assert.equal(resolveInstrument('AAPL')?.typicalVol, before);
    assert.equal(isCurated('AAPL'), true);
  });

  test('calibration is measured from bars, and only for dynamic entries', () => {
    // A series with a known daily sigma should recover roughly that vol.
    const dailySigma = 0.02;
    let price = 100;
    const bars: { c: number }[] = [];
    for (let i = 0; i < 500; i++) {
      // Deterministic alternating shock: realised sd is exactly dailySigma.
      price *= Math.exp(i % 2 === 0 ? dailySigma : -dailySigma);
      bars.push({ c: price });
    }

    const dyn = synthesise({ symbol: 'TEST1', name: 'Test', type: 'Common Stock', source: 'yahoo' });
    calibrateFromBars(dyn, bars);
    const expected = dailySigma * Math.sqrt(252);
    assert.ok(
      Math.abs(dyn.typicalVol - expected) < expected * 0.05,
      `expected ~${expected.toFixed(3)} annualised, got ${dyn.typicalVol.toFixed(3)}`,
    );
    assert.equal(dyn.anchor, bars[bars.length - 1].c, 'anchor follows the last close');

    // Curated instruments keep the calibration we set by hand.
    const curated = resolveInstrument('NVDA');
    assert.ok(curated);
    const before = curated.typicalVol;
    calibrateFromBars(curated, bars);
    assert.equal(curated.typicalVol, before, 'hand-set calibration must survive');
  });

  test('inferred drift is capped so a hot window cannot promise the moon', () => {
    // 1% a day compounds to roughly e^2.5 a year. Extrapolating that as an
    // expected return is exactly how a simulator starts lying.
    let price = 100;
    const bars: { c: number }[] = [];
    for (let i = 0; i < 300; i++) { price *= 1.01; bars.push({ c: price }); }

    const dyn = synthesise({ symbol: 'TEST2', name: 'Test', type: 'Common Stock', source: 'yahoo' });
    calibrateFromBars(dyn, bars);
    assert.ok(dyn.drift <= 0.5, `drift ${dyn.drift} exceeds the cap`);
    assert.ok(dyn.drift >= -0.5);
  });

  test('a series too short to measure leaves calibration untouched', () => {
    const dyn = synthesise({ symbol: 'TEST3', name: 'Test', type: 'Common Stock', source: 'yahoo' });
    const before = dyn.typicalVol;
    calibrateFromBars(dyn, [{ c: 10 }, { c: 11 }, { c: 12 }]);
    assert.equal(dyn.typicalVol, before);
  });
});
