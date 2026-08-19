/* ===========================================================================
   Display formatting. Terminal convention: fixed widths, explicit signs on
   deltas, compact suffixes on large notionals, em-dash for absent data.
   ========================================================================= */

const DASH = '—';

export function fmtNum(x: number | null | undefined, dp = 2): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  return x.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Price formatting with precision that adapts to magnitude — a $0.000021
 *  token and a $98,000 index cannot share a decimal count. */
export function fmtPrice(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  const a = Math.abs(x);
  if (a === 0) return '0.00';
  if (a < 0.0001) return x.toExponential(2);
  if (a < 0.01) return fmtNum(x, 6);
  if (a < 1) return fmtNum(x, 4);
  if (a < 1000) return fmtNum(x, 2);
  return fmtNum(x, 2);
}

export function fmtSigned(x: number | null | undefined, dp = 2): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  const s = fmtNum(Math.abs(x), dp);
  return x > 0 ? `+${s}` : x < 0 ? `-${s}` : s;
}

export function fmtPct(x: number | null | undefined, dp = 2, signed = true): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  const s = fmtNum(Math.abs(x), dp);
  const sign = signed ? (x > 0 ? '+' : x < 0 ? '-' : '') : x < 0 ? '-' : '';
  return `${sign}${s}%`;
}

/** Compact notation: 1.24B, 892.3M, 45.1K. */
export function fmtCompact(x: number | null | undefined, dp = 2): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  const a = Math.abs(x);
  const sign = x < 0 ? '-' : '';
  if (a >= 1e12) return `${sign}${fmtNum(a / 1e12, dp)}T`;
  if (a >= 1e9) return `${sign}${fmtNum(a / 1e9, dp)}B`;
  if (a >= 1e6) return `${sign}${fmtNum(a / 1e6, dp)}M`;
  if (a >= 1e3) return `${sign}${fmtNum(a / 1e3, dp <= 1 ? dp : 1)}K`;
  return `${sign}${fmtNum(a, dp)}`;
}

export function fmtUsd(x: number | null | undefined, dp = 2): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  const sign = x < 0 ? '-' : '';
  return `${sign}$${fmtNum(Math.abs(x), dp)}`;
}

export function fmtUsdCompact(x: number | null | undefined, dp = 2): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  const sign = x < 0 ? '-' : '';
  return `${sign}$${fmtCompact(Math.abs(x), dp)}`;
}

/** Multiple, e.g. 24.3x. */
export function fmtX(x: number | null | undefined, dp = 1): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  return `${fmtNum(x, dp)}x`;
}

export function fmtTime(ms: number, tz = 'America/New_York'): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    timeZone: tz,
  });
}

export function fmtDate(ms: number, tz = 'America/New_York'): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    timeZone: tz,
  });
}

export function fmtDateShort(ms: number, tz = 'America/New_York'): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: tz,
  });
}

/** "3m ago", "just now", "2d ago". */
export function fmtAge(ms: number, now = Date.now()): string {
  const d = Math.max(0, now - ms);
  const s = Math.floor(d / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

/** Tailwind text colour class for a directional number. */
export function dirColor(x: number | null | undefined, neutral = 'text-ink-2'): string {
  if (x == null || !Number.isFinite(x) || x === 0) return neutral;
  return x > 0 ? 'text-long' : 'text-short';
}

export const DASH_CHAR = DASH;
