/* ===========================================================================
   Numeric helpers. Every function here tolerates short/empty input and never
   throws — indicator code calls these on partially-warmed series constantly.
   ========================================================================= */

export const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

/** Map x from [inLo, inHi] onto [outLo, outHi], clamped at the ends. */
export function scale(x: number, inLo: number, inHi: number, outLo = -1, outHi = 1): number {
  if (inHi === inLo) return (outLo + outHi) / 2;
  const t = clamp((x - inLo) / (inHi - inLo), 0, 1);
  return outLo + t * (outHi - outLo);
}

/** Smooth squash of an unbounded value into [-1, 1]. `k` sets the knee. */
export const squash = (x: number, k = 1): number => Math.tanh(x / k);

export const sum = (a: readonly number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
};

export const mean = (a: readonly number[]): number => (a.length ? sum(a) / a.length : NaN);

export function variance(a: readonly number[], sample = true): number {
  const n = a.length;
  if (n < 2) return 0;
  const m = mean(a);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - m;
    acc += d * d;
  }
  return acc / (sample ? n - 1 : n);
}

export const stdev = (a: readonly number[], sample = true): number => Math.sqrt(variance(a, sample));

export function median(a: readonly number[]): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Linear-interpolated quantile. `q` in [0,1]. */
export function quantile(a: readonly number[], q: number): number {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const pos = clamp(q, 0, 1) * (s.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return s[lo];
  return s[lo] + (pos - lo) * (s[hi] - s[lo]);
}

/** Fraction of `a` strictly below `x`, i.e. the percentile rank of x. */
export function percentileRank(a: readonly number[], x: number): number {
  if (!a.length) return NaN;
  let below = 0;
  for (let i = 0; i < a.length; i++) if (a[i] < x) below++;
  return below / a.length;
}

export function zScore(a: readonly number[], x: number): number {
  const sd = stdev(a);
  return sd === 0 ? 0 : (x - mean(a)) / sd;
}

export function correlation(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const ax = a.slice(-n);
  const bx = b.slice(-n);
  const ma = mean(ax);
  const mb = mean(bx);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = ax[i] - ma;
    const db = bx[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const d = Math.sqrt(va * vb);
  return d === 0 ? 0 : cov / d;
}

export interface LinReg {
  slope: number;
  intercept: number;
  /** Coefficient of determination, [0,1]. */
  r2: number;
  /** Standard error of the residuals, in price units. */
  stderr: number;
}

/** Ordinary least squares of `y` against its own index. */
export function linreg(y: readonly number[]): LinReg {
  const n = y.length;
  if (n < 2) return { slope: 0, intercept: n ? y[0] : 0, r2: 0, stderr: 0 };
  const mx = (n - 1) / 2;
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - mx;
    sxy += dx * (y[i] - my);
    sxx += dx * dx;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const fit = intercept + slope * i;
    ssRes += (y[i] - fit) ** 2;
    ssTot += (y[i] - my) ** 2;
  }
  return {
    slope,
    intercept,
    r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot,
    stderr: Math.sqrt(ssRes / Math.max(1, n - 2)),
  };
}

/** Simple returns: r[i] = x[i]/x[i-1] - 1. Length n-1. */
export function returns(x: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < x.length; i++) {
    const p = x[i - 1];
    out.push(p === 0 ? 0 : x[i] / p - 1);
  }
  return out;
}

/** Log returns. Length n-1. */
export function logReturns(x: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < x.length; i++) {
    const p = x[i - 1];
    out.push(p > 0 && x[i] > 0 ? Math.log(x[i] / p) : 0);
  }
  return out;
}

/** Annualised realised volatility from a price series. */
export function realisedVol(prices: readonly number[], periodsPerYear = 252): number {
  const r = logReturns(prices);
  if (r.length < 2) return 0;
  return stdev(r) * Math.sqrt(periodsPerYear);
}

/** Hurst exponent via rescaled-range analysis. >0.5 persistent (trending),
 *  <0.5 anti-persistent (mean-reverting), ~0.5 random walk. */
export function hurstExponent(series: readonly number[]): number {
  const r = logReturns(series);
  const n = r.length;
  if (n < 32) return 0.5;

  const maxPow = Math.floor(Math.log2(n));
  const xs: number[] = [];
  const ys: number[] = [];

  for (let p = 2; p <= maxPow; p++) {
    const size = 2 ** p;
    if (size > n) break;
    const chunks = Math.floor(n / size);
    const rsValues: number[] = [];

    for (let c = 0; c < chunks; c++) {
      const seg = r.slice(c * size, (c + 1) * size);
      const m = mean(seg);
      let cumul = 0;
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < seg.length; i++) {
        cumul += seg[i] - m;
        if (cumul < min) min = cumul;
        if (cumul > max) max = cumul;
      }
      const range = max - min;
      const sd = stdev(seg, false);
      if (sd > 0 && range > 0) rsValues.push(range / sd);
    }

    if (rsValues.length) {
      xs.push(Math.log(size));
      ys.push(Math.log(mean(rsValues)));
    }
  }

  if (xs.length < 2) return 0.5;

  // Slope of log(R/S) vs log(n) is the Hurst exponent.
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  return sxx === 0 ? 0.5 : clamp(sxy / sxx, 0, 1);
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, ~1e-7 abs error). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - (Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)) * poly;
  return x >= 0 ? cdf : 1 - cdf;
}

/** Standard normal PDF. */
export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Inverse standard normal CDF (Acklam's rational approximation). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425;

  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - plow) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Mulberry32 — tiny, fast, well-distributed seedable PRNG. Determinism
 *  matters: the simulator must produce byte-identical output for a given
 *  seed so that screenshots, tests, and backtests are reproducible. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller normal draws from a uniform generator. */
export function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Deterministic 32-bit string hash (FNV-1a). Used to seed per-symbol RNGs. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export const isFiniteNum = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x);

/** Replace NaN/Infinity with a fallback. */
export const safe = (x: number, fallback = 0): number => (Number.isFinite(x) ? x : fallback);
