/* ===========================================================================
   Live-data doctor.

     npm run doctor

   Answers one question: is this terminal running on real market data, and if
   not, exactly what is stopping it? Every check names the next step rather
   than just failing.
   ========================================================================= */

import { getQuote, providerStatus } from '../src/lib/providers';
import { finnhubConfigured } from '../src/lib/providers/adapters';
import { resolveAny } from '../src/lib/market/resolve';
import { CURATED_COUNT } from '../src/lib/market/universe';

const GREEN = '\x1b[32m', RED = '\x1b[31m', YEL = '\x1b[33m', DIM = '\x1b[2m', OFF = '\x1b[0m';
const ok = (s: string): string => `${GREEN}✓${OFF} ${s}`;
const bad = (s: string): string => `${RED}✗${OFF} ${s}`;
const warn = (s: string): string => `${YEL}!${OFF} ${s}`;

console.log(`\n${DIM}── configuration ──────────────────────────────────────${OFF}`);
console.log(`  universe        ${CURATED_COUNT} curated instruments, plus vendor lookup for anything else`);

const key = process.env.FINNHUB_API_KEY;
console.log(key
  ? ok(`FINNHUB_API_KEY  set (${key.slice(0, 6)}…${key.slice(-4)})`)
  : warn('FINNHUB_API_KEY  not set — US equity quotes fall back to Yahoo, which is ~15 min delayed'));

if (process.env.MERIDIAN_OFFLINE === '1' || process.env.MERIDIAN_OFFLINE === 'true') {
  console.log(warn('MERIDIAN_OFFLINE is 1 — every outbound call is disabled by your own config.'));
  console.log(`  ${DIM}Unset it in .env.local to go live.${OFF}`);
}

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
if (proxy) console.log(`  HTTPS_PROXY     ${proxy} ${DIM}(all traffic is policed by this)${OFF}`);

/* --- per-class probes: one instrument per provider path ------------------ */

console.log(`\n${DIM}── feed probes ────────────────────────────────────────${OFF}`);

const PROBES: [string, string][] = [
  ['BTC-USD', 'crypto     → binance → coingecko → yahoo'],
  ['AAPL', `equity     → ${finnhubConfigured() ? 'finnhub → ' : ''}yahoo`],
  ['TLT', `bond       → ${finnhubConfigured() ? 'finnhub → ' : ''}yahoo`],
  ['GC=F', 'commodity  → yahoo'],
  ['SPX', 'index      → yahoo'],
  ['EURUSD=X', 'fx         → yahoo'],
];

let liveCount = 0;
const reasons = new Set<string>();

for (const [symbol, path] of PROBES) {
  const q = await getQuote(symbol);
  const live = q.provenance === 'live' || q.provenance === 'cached';
  if (live) liveCount++;
  const label = `${symbol.padEnd(9)} ${DIM}${path.padEnd(42)}${OFF}`;
  console.log(live
    ? ok(`${label} ${q.price} via ${q.source}`)
    : bad(`${label} ${DIM}simulated${OFF}`));
  if (q.fallbackReason) for (const r of q.fallbackReason.split(' | ')) reasons.add(r.trim());
}

/* --- open-ended lookup --------------------------------------------------- */

console.log(`\n${DIM}── symbol reach ───────────────────────────────────────${OFF}`);
const dyn = await resolveAny('RKLB');
console.log(dyn
  ? ok(`vendor lookup works — resolved RKLB to "${dyn.name}"`)
  : bad('vendor lookup unavailable — search is limited to the curated universe'));

/* --- verdict ------------------------------------------------------------- */

console.log(`\n${DIM}── verdict ────────────────────────────────────────────${OFF}`);

if (liveCount === PROBES.length) {
  console.log(ok('Every asset class is on live data.\n'));
  process.exit(0);
}

if (liveCount > 0) {
  console.log(warn(`${liveCount} of ${PROBES.length} classes are live; the rest are simulated.\n`));
} else {
  console.log(bad('No live feed reached. Everything on screen is simulated and labelled SIM.'));
}

if (reasons.size) {
  console.log(`\n  ${DIM}why:${OFF}`);
  for (const r of reasons) console.log(`    · ${r}`);
}

// A keyless provider being refused is the tell: nothing about a credential
// can explain it, so the block is upstream of this process.
const keylessBlocked = [...reasons].some((r) => /needs no key/.test(r));
if (keylessBlocked) {
  console.log(`\n  ${DIM}Yahoo and Binance need no credentials, so a refusal from them is a`);
  console.log(`  network egress policy, not a key problem. Allow these hosts:${OFF}`);
  for (const h of [
    'query1.finance.yahoo.com', 'query2.finance.yahoo.com',
    'api.binance.com', 'stream.binance.com',
    'finnhub.io', 'api.coingecko.com', 'data.sec.gov',
  ]) console.log(`    · ${h}`);
}

console.log(`\n${DIM}── feed health ────────────────────────────────────────${OFF}`);
for (const f of providerStatus().feeds) {
  console.log(`  ${f.id.padEnd(11)} ${String(f.state)}`);
}
console.log();
