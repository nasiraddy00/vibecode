/* ===========================================================================
   The full US listed-symbol directory.

   Finnhub publishes every symbol on US exchanges in one call — about 31,000
   of them. Pulling it once and indexing it in memory is what turns the search
   bar from "the names we shipped" into "anything listed", without a vendor
   round trip on every keystroke.

   Server-only: it touches the filesystem to cache the payload between
   restarts. Nothing in the browser bundle imports this.
   ========================================================================= */

import { fetchJson, ProviderError } from './http';
import { recordSuccess, recordFailure } from './health';

export interface DirectoryEntry {
  symbol: string;
  name: string;
  /** Finnhub's own type label: "Common Stock", "ETP", "ADR", "REIT", … */
  type: string;
  /** Market Identifier Code. XNAS/XNYS/ARCX/BATS are the real exchanges;
   *  OOTC is over-the-counter and ranks below them. */
  mic: string;
}

interface FinnhubSymbolRow {
  symbol?: string;
  displaySymbol?: string;
  description?: string;
  type?: string;
  mic?: string;
  currency?: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_FILE = '.cache/us-symbols.json';

/** Instrument types that are not tradable propositions in this terminal's
 *  sense: a warrant or a subscription right is a claim on a security, not the
 *  security, and its price series does not mean what the engine assumes. */
const EXCLUDED_TYPES = new Set(['Equity WRT', 'Right', 'Warrant', 'Unit']);

let memo: { entries: DirectoryEntry[]; loadedAt: number } | null = null;
let inflight: Promise<DirectoryEntry[]> | null = null;

/* --- persistence ---------------------------------------------------------
   Best effort in both directions. A read-only filesystem (a container, a
   serverless runtime) must degrade to re-fetching, never to crashing.
   ------------------------------------------------------------------------- */

async function readCache(): Promise<DirectoryEntry[] | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { savedAt: number; entries: DirectoryEntry[] };
    if (!parsed?.entries?.length) return null;
    if (Date.now() - parsed.savedAt > CACHE_TTL_MS) return null;
    return parsed.entries;
  } catch {
    return null;
  }
}

async function writeCache(entries: DirectoryEntry[]): Promise<void> {
  try {
    const { writeFile, mkdir } = await import('node:fs/promises');
    const { dirname } = await import('node:path');
    await mkdir(dirname(CACHE_FILE), { recursive: true });
    await writeFile(CACHE_FILE, JSON.stringify({ savedAt: Date.now(), entries }), 'utf8');
  } catch {
    // Caching is an optimisation; failing to cache is not failing.
  }
}

/* --- loading -------------------------------------------------------------- */

async function fetchDirectory(): Promise<DirectoryEntry[]> {
  const key = process.env.FINNHUB_API_KEY;
  if (!key) throw new ProviderError('FINNHUB_API_KEY not configured', 'finnhub');

  const t0 = Date.now();
  try {
    const rows = await fetchJson<FinnhubSymbolRow[]>(
      `https://finnhub.io/api/v1/stock/symbol?exchange=US&token=${key}`,
      { provider: 'finnhub', timeoutMs: 45000, retries: 1 },
    );
    if (!Array.isArray(rows) || rows.length < 1000) {
      throw new ProviderError(`implausible directory size: ${rows?.length ?? 0}`, 'finnhub');
    }

    const entries: DirectoryEntry[] = [];
    for (const r of rows) {
      const symbol = (r.displaySymbol || r.symbol || '').trim().toUpperCase();
      if (!symbol) continue;
      const type = r.type || 'Common Stock';
      if (EXCLUDED_TYPES.has(type)) continue;
      entries.push({
        symbol,
        name: titleCase(r.description || symbol),
        type,
        mic: r.mic || '',
      });
    }

    recordSuccess('finnhub', Date.now() - t0);
    return entries;
  } catch (err) {
    recordFailure('finnhub', (err as Error).message);
    throw err;
  }
}

/** Finnhub shouts its descriptions ("ROCKET LAB CORP"). Sentence-cased names
 *  sit better next to the curated ones, but acronyms must survive. */
function titleCase(raw: string): string {
  if (raw !== raw.toUpperCase()) return raw;
  return raw.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .replace(/\b(Etf|Reit|Adr|Usa|Us|Llc|Inc|Plc|Sa|Nv|Ag|Ab|As|Ii|Iii|Iv)\b/g,
      (w) => (w.length <= 3 ? w.toUpperCase() : w));
}

/** Load the directory: memory, then disk, then the vendor. Concurrent callers
 *  share one in-flight fetch rather than each pulling 7MB. */
export async function loadDirectory(): Promise<DirectoryEntry[]> {
  if (memo && Date.now() - memo.loadedAt < CACHE_TTL_MS) return memo.entries;
  if (inflight) return inflight;

  inflight = (async () => {
    const cached = await readCache();
    if (cached) {
      memo = { entries: cached, loadedAt: Date.now() };
      return cached;
    }
    const fresh = await fetchDirectory();
    memo = { entries: fresh, loadedAt: Date.now() };
    void writeCache(fresh);
    return fresh;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}

/** Non-blocking accessor for callers that must not wait (render paths). */
export const directoryIfLoaded = (): DirectoryEntry[] | null => memo?.entries ?? null;

export const directorySize = (): number => memo?.entries.length ?? 0;

/* --- search ---------------------------------------------------------------
   Ranked so that what a trader most likely meant comes first: the exact
   ticker, then tickers that start with what they typed, then names. A
   listing on a real exchange outranks the same string over-the-counter,
   because an OTC shell sharing a prefix with a real company is noise.
   ------------------------------------------------------------------------- */

const MAJOR_MIC = new Set(['XNAS', 'XNYS', 'ARCX', 'BATS', 'XASE', 'IEXG', 'EDGX', 'XCBO']);

export function searchDirectory(entries: DirectoryEntry[], query: string, limit = 12): DirectoryEntry[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];

  const scored: { e: DirectoryEntry; score: number }[] = [];

  for (const e of entries) {
    const sym = e.symbol;
    const name = e.name.toUpperCase();
    let score = 0;

    if (sym === q) score = 10000;
    else if (sym.startsWith(q)) score = 5000 - sym.length * 10;
    else if (name.startsWith(q)) score = 3000 - Math.min(name.length, 60);
    else if (sym.includes(q)) score = 1200 - sym.length * 10;
    else if (name.includes(` ${q}`)) score = 800;
    else if (name.includes(q)) score = 400;
    else continue;

    if (MAJOR_MIC.has(e.mic)) score += 250;
    else if (e.mic === 'OOTC') score -= 400;

    // A plain listed company is more often what was meant than a fund
    // tracking it or a depositary receipt for it.
    if (e.type === 'Common Stock') score += 60;
    else if (e.type === 'ETP') score += 40;
    else if (e.type === 'Closed-End Fund' || e.type === 'NVDR' || e.type === 'GDR') score -= 120;

    scored.push({ e, score });
  }

  scored.sort((a, b) => b.score - a.score || a.e.symbol.length - b.e.symbol.length);
  return scored.slice(0, limit).map((x) => x.e);
}

/** Exact lookup, for resolving a ticker the user typed in full. */
export function lookupDirectory(entries: DirectoryEntry[], symbol: string): DirectoryEntry | undefined {
  const want = symbol.trim().toUpperCase();
  let best: DirectoryEntry | undefined;
  for (const e of entries) {
    if (e.symbol !== want) continue;
    if (!best || (MAJOR_MIC.has(e.mic) && !MAJOR_MIC.has(best.mic))) best = e;
  }
  return best;
}
