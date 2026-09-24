/* ===========================================================================
   Real reported earnings, where a free feed carries them.

   Same rule as the sentiment side: real where it exists, nothing where it
   does not, and never a plausible substitute wearing a live badge.
   ========================================================================= */

import type { EarningsEvent } from './types';
import { finnhubEarnings, finnhubEarningsCalendar } from '../providers/adapters';

const DAY = 86_400_000;

/** Map Finnhub's quarter/year onto the "Q3 2026" form the UI prints. */
function fiscalLabel(row: { period: string; quarter?: number; year?: number }): string {
  if (row.quarter && row.year) return `Q${row.quarter} ${row.year}`;
  const d = new Date(row.period);
  if (!Number.isNaN(d.getTime())) {
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  }
  return row.period;
}

/**
 * Reported history plus the next scheduled report.
 *
 * Two things are deliberately left null rather than filled:
 *
 *  - `revenueActual`/`revenueEstimate` on historical rows, because the free
 *    earnings endpoint carries EPS only.
 *  - `reactionPct`, the next session's move. It is derivable from bars, but
 *    doing it here would mean guessing which session followed the print
 *    without knowing whether the report landed before or after the bell.
 *    The analyser treats null as "unknown" and weights accordingly.
 */
export async function liveEarnings(
  symbol: string, now = Date.now(),
): Promise<{ history: EarningsEvent[]; next: EarningsEvent | null } | null> {
  const [reported, calendar] = await Promise.all([
    finnhubEarnings(symbol).catch(() => []),
    finnhubEarningsCalendar(symbol, now - 7 * DAY, now + 180 * DAY).catch(() => []),
  ]);

  if (!reported.length && !calendar.length) return null;

  const history: EarningsEvent[] = reported
    .filter((r) => r.period)
    .map((r) => {
      const date = Date.parse(`${r.period}T00:00:00Z`);
      return {
        date: Number.isFinite(date) ? date : now,
        fiscalPeriod: fiscalLabel(r),
        epsEstimate: r.estimate ?? NaN,
        epsActual: r.actual ?? null,
        revenueEstimate: NaN,
        revenueActual: null,
        surprisePct: r.surprisePercent ?? null,
        reactionPct: null,
        time: 'unknown' as const,
        confirmed: true,
      };
    })
    // The analyser reads this newest-first.
    .sort((a, b) => b.date - a.date);

  // The next report is the first calendar entry that has not happened yet.
  let next: EarningsEvent | null = null;
  const upcoming = calendar
    .map((c) => ({ c, t: Date.parse(`${c.date}T00:00:00Z`) }))
    .filter((x) => Number.isFinite(x.t) && x.t >= now - DAY && x.c.epsActual == null)
    .sort((a, b) => a.t - b.t)[0];

  if (upcoming) {
    const hour = (upcoming.c.hour ?? '').toLowerCase();
    next = {
      date: upcoming.t,
      fiscalPeriod: fiscalLabel({
        period: upcoming.c.date, quarter: upcoming.c.quarter, year: upcoming.c.year,
      }),
      epsEstimate: upcoming.c.epsEstimate ?? NaN,
      epsActual: null,
      revenueEstimate: upcoming.c.revenueEstimate ?? NaN,
      revenueActual: null,
      surprisePct: null,
      reactionPct: null,
      time: hour === 'bmo' ? 'bmo' : hour === 'amc' ? 'amc' : 'unknown',
      confirmed: true,
    };
  }

  if (!history.length && !next) return null;
  return { history, next };
}
