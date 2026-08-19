/* ===========================================================================
   Black-Scholes-Merton pricing, greeks and implied-volatility inversion.

   Continuous dividend yield `q` covers equities; set q = 0 for crypto and
   q = foreign risk-free for FX (Garman-Kohlhagen falls out of the same form).
   ========================================================================= */

import { normCdf, normPdf, clamp } from '../util/math';

export type OptionType = 'call' | 'put';

export interface Greeks {
  price: number;
  delta: number;
  gamma: number;
  /** Per calendar day, not per year — the number a trader actually feels. */
  theta: number;
  /** Per 1 volatility point (1%), not per 1.00 of vol. */
  vega: number;
  /** Per 1% change in rates. */
  rho: number;
  /** dGamma/dSpot — matters for large positions near expiry. */
  speed: number;
  /** dVega/dVol. */
  vomma: number;
  /** dDelta/dVol. */
  vanna: number;
  /** Risk-neutral probability of finishing in the money. */
  probItm: number;
}

interface D1D2 { d1: number; d2: number; sqrtT: number; }

function d1d2(S: number, K: number, T: number, r: number, sigma: number, q: number): D1D2 {
  const sqrtT = Math.sqrt(T);
  const denom = sigma * sqrtT;
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / denom;
  return { d1, d2: d1 - denom, sqrtT };
}

/** Full analytic greeks. Degenerate inputs (T<=0, sigma<=0) fall back to
 *  intrinsic value with step-function delta rather than returning NaN. */
export function blackScholes(
  S: number,
  K: number,
  T: number,
  r: number,
  sigma: number,
  type: OptionType,
  q = 0,
): Greeks {
  const intrinsic = type === 'call' ? Math.max(0, S - K) : Math.max(0, K - S);

  if (!(S > 0) || !(K > 0) || !(T > 0) || !(sigma > 0)) {
    const itm = type === 'call' ? S > K : S < K;
    return {
      price: intrinsic,
      delta: itm ? (type === 'call' ? 1 : -1) : 0,
      gamma: 0, theta: 0, vega: 0, rho: 0, speed: 0, vomma: 0, vanna: 0,
      probItm: itm ? 1 : 0,
    };
  }

  const { d1, d2, sqrtT } = d1d2(S, K, T, r, sigma, q);
  const dfR = Math.exp(-r * T);
  const dfQ = Math.exp(-q * T);
  const nd1 = normCdf(d1);
  const nd2 = normCdf(d2);
  const pdf1 = normPdf(d1);

  const price =
    type === 'call'
      ? S * dfQ * nd1 - K * dfR * nd2
      : K * dfR * normCdf(-d2) - S * dfQ * normCdf(-d1);

  const delta = type === 'call' ? dfQ * nd1 : dfQ * (nd1 - 1);
  const gamma = (dfQ * pdf1) / (S * sigma * sqrtT);
  const vega = (S * dfQ * pdf1 * sqrtT) / 100;

  const thetaAnnual =
    type === 'call'
      ? -(S * dfQ * pdf1 * sigma) / (2 * sqrtT) - r * K * dfR * nd2 + q * S * dfQ * nd1
      : -(S * dfQ * pdf1 * sigma) / (2 * sqrtT) + r * K * dfR * normCdf(-d2) - q * S * dfQ * normCdf(-d1);

  const rho =
    type === 'call'
      ? (K * T * dfR * nd2) / 100
      : (-K * T * dfR * normCdf(-d2)) / 100;

  return {
    price,
    delta,
    gamma,
    theta: thetaAnnual / 365,
    vega,
    rho,
    speed: (-gamma / S) * (d1 / (sigma * sqrtT) + 1),
    vomma: (vega * d1 * d2) / sigma,
    vanna: (-dfQ * pdf1 * d2) / sigma,
    probItm: type === 'call' ? nd2 : normCdf(-d2),
  };
}

/** Implied volatility by Newton-Raphson with a bisection safety net.
 *  Newton alone diverges for deep-ITM/OTM options where vega collapses, so
 *  the bracketed fallback is not optional in production. */
export function impliedVolatility(
  marketPrice: number,
  S: number,
  K: number,
  T: number,
  r: number,
  type: OptionType,
  q = 0,
): number {
  const intrinsic =
    type === 'call'
      ? Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T))
      : Math.max(0, K * Math.exp(-r * T) - S * Math.exp(-q * T));

  // No volatility can explain a price below intrinsic or above the bound.
  if (marketPrice <= intrinsic + 1e-10) return NaN;
  if (T <= 0 || S <= 0 || K <= 0) return NaN;

  // Brenner-Subrahmanyam seed: a good ATM starting guess.
  let sigma = clamp(Math.sqrt((2 * Math.PI) / T) * (marketPrice / S), 0.05, 3);

  for (let i = 0; i < 60; i++) {
    const g = blackScholes(S, K, T, r, sigma, type, q);
    const diff = g.price - marketPrice;
    if (Math.abs(diff) < 1e-8) return sigma;
    const vegaRaw = g.vega * 100;   // back to per-1.00-of-vol
    if (vegaRaw < 1e-8) break;      // vega too small: Newton is unstable here
    const step = diff / vegaRaw;
    const next = sigma - step;
    if (!Number.isFinite(next) || next <= 0 || next > 10) break;
    sigma = next;
  }

  // Bisection fallback over a wide bracket.
  let lo = 1e-4;
  let hi = 10;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const p = blackScholes(S, K, T, r, mid, type, q).price;
    if (Math.abs(p - marketPrice) < 1e-8) return mid;
    if (p > marketPrice) hi = mid;
    else lo = mid;
  }
  const result = (lo + hi) / 2;
  return result > 9.99 || result < 1e-3 ? NaN : result;
}

/** Strike that produces a given delta — how desks actually quote structures
 *  ("sell the 25-delta put"), and how this terminal selects option legs. */
export function strikeForDelta(
  S: number,
  T: number,
  r: number,
  sigma: number,
  targetDelta: number,
  type: OptionType,
  q = 0,
): number {
  if (!(S > 0) || !(T > 0) || !(sigma > 0)) return S;
  const target = Math.abs(targetDelta);

  // Invert the closed form: for a call, delta = e^{-qT} N(d1).
  const nInv = (p: number): number => {
    // Local inverse normal via bisection — cheap and robust at this scale.
    let lo = -8;
    let hi = 8;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (normCdf(mid) < p) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };

  // call:  delta = e^{-qT} N(d1)        -> d1 = N^-1(target * e^{qT})
  // put:   delta = e^{-qT}(N(d1) - 1)    -> d1 = N^-1(1 - target * e^{qT})
  const adj = clamp(target * Math.exp(q * T), 1e-6, 1 - 1e-6);
  const d1 = type === 'call' ? nInv(adj) : nInv(1 - adj);

  // Invert d1 = [ln(S/K) + (r - q + s^2/2)T] / (s*sqrt(T)) for K.
  return S * Math.exp(-d1 * sigma * Math.sqrt(T) + (r - q + (sigma * sigma) / 2) * T);
}

/** Expected move over horizon T at volatility sigma: the one-standard-
 *  deviation range the options market is pricing. */
export function expectedMove(S: number, T: number, sigma: number): {
  absolute: number;
  pct: number;
  upper: number;
  lower: number;
  /** The 2-sigma (~95%) bounds. */
  upper2: number;
  lower2: number;
} {
  const move = S * sigma * Math.sqrt(T);
  return {
    absolute: move,
    pct: S > 0 ? (move / S) * 100 : NaN,
    upper: S + move,
    lower: S - move,
    upper2: S + 2 * move,
    lower2: S - 2 * move,
  };
}

/** Straddle price approximation — the classic ATM expected-move proxy. */
export function straddlePrice(S: number, T: number, r: number, sigma: number, q = 0): number {
  const call = blackScholes(S, S, T, r, sigma, 'call', q).price;
  const put = blackScholes(S, S, T, r, sigma, 'put', q).price;
  return call + put;
}
