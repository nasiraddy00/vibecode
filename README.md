# Meridian Terminal

A day-trading signal terminal. You type a ticker; it returns a directional
verdict with a conviction score, an executable trade plan (entry, stop,
targets, position size), an options expression where one is warranted, and the
full reasoning behind all of it — every analytic that voted, what it read, how
much it was trusted, and why.

The home screen is a market cockpit: indexes, crypto, commodities, FX and
rates, the volatility complex, breadth, sector rotation, a written read on the
opening session, and the top ten ranked setups in each asset class.

---

## Read this first

Three things are true about this system, and it is better to know them now
than to discover them with money on the line.

**1. In this environment, the prices are synthetic.**
Meridian ships adapters for Yahoo Finance, Binance, CoinGecko, Finnhub and SEC
EDGAR. If none of them is reachable — no API key configured, or an egress
policy blocking the host — the terminal falls back to a deterministic market
simulator and **badges every affected figure `SIM`**. The analytics are real and
running for real; the prices they run on are not market data. The status strip
at the bottom of every screen always shows which feeds are live.

**2. The backtest measures the engine, not the market.**
The $10 Bitcoin run below executed against simulated bars because no crypto
feed was reachable. The simulator reproduces volatility clustering, fat tails
and regime persistence, so it is a genuinely hostile series to trade — but it
is not Bitcoin's history. Point the terminal at a live feed and re-run before
drawing any conclusion about the strategy's real-world profitability.

**3. No signal system is confident in the way the word usually means.**
Meridian reports conviction, agreement between its inputs, and data quality as
three separate numbers, because they answer three different questions. It
refuses to issue a direction below a conviction floor, and says so. It runs a
t-test on its own backtest expectancy and will tell you when the result is
indistinguishable from luck. A tool that always has an answer is not more
useful than one that admits when it doesn't — it is just less honest.

**This is research software, not investment advice.** No part of it has been
validated against live trading.

---

## Quick start

```bash
npm install
npm run dev            # http://localhost:3000
```

Runs immediately with zero configuration — on simulated data, clearly badged.
To use real market data:

```bash
cp .env.example .env.local
# fill in whichever keys you have; every one is optional
npm run dev
```

Each feed you configure flips its badge from `SIM` to `LIVE` independently.
There is no all-or-nothing switch.

```bash
npm run backtest:btc   # the $10 Bitcoin run
npm test               # 140 unit tests
npm run typecheck
npm run build
```

### Single-file browser build

```bash
npm run build:standalone
```

Compiles the whole terminal — engine, UI and the BTC backtest artefact — into
one self-contained ~770 KB HTML file at
`dist-standalone/meridian-terminal.html`. Open it directly in a browser; there
is no server, no install and no network call except the Google Fonts
stylesheet.

This works because the engine is pure TypeScript with no server dependency
once the data source is the simulator: indicators, signals, options pricing
and backtest metrics all run client-side. It is the right way to hand someone
a demo, and the wrong way to trade — the browser build has no path to a live
feed at all, so it is permanently in simulator mode and says so in its banner
and status strip.

The three page views (`MarketCockpit`, `TickerDossier`, `BacktestReport`) are
shared components rather than duplicates, so the browser build and the
Next.js app render identical markup from identical analytics. `next/link` and
`next/navigation` are aliased to hash-routing shims at bundle time.

---

## The $10 Bitcoin backtest

Run: `npm run backtest:btc` — 1,240 testable daily bars, $10 starting capital,
10bp commission and 5bp slippage per side, 5% annualised funding on carried
notional, 2% equity risk per trade.

| | |
|---|---|
| Starting capital | **$10.00** |
| Final equity | **$13.86** |
| Total return | **+38.65%** |
| CAGR | +10.10% |
| Max drawdown | −10.87% |
| Sharpe / Sortino | 0.64 / 0.86 |
| Trades | 87 (40W / 47L) |
| Win rate | 46.0% |
| Profit factor | 1.72 |
| Expectancy | **+0.351R** per trade |
| Average win / loss | +1.72R / −0.81R |
| Costs paid | $0.67 (6.67% of starting capital) |

**Is it an edge or is it luck?** Mean R of 0.351 over 87 trades gives
t = 2.44, p = 0.017. Significant at the 5% level — but only just, and this is
in-sample. A dozen trades either way flips the conclusion.

**It loses to buy-and-hold.** Bitcoin returned +161.6% over the same window;
the strategy returned +38.65%. That is not a bug. At 2% risk per trade the
system runs at roughly 8.6% annualised volatility against Bitcoin's ~52% — it
is taking about a sixth of the risk, and gets about a sixth of the return. The
edge is real but small, and the risk budget is what decides whether it
compounds into anything.

The sweep below is the same signals at different risk budgets — not parameter
tuning, just leverage:

| Risk/trade | Final | Return | Max DD | Sharpe |
|---|---|---|---|---|
| 1% | $11.82 | +18.2% | −5.6% | 0.12 |
| 2% | $13.86 | +38.6% | −10.9% | 0.64 |
| 5% | $21.15 | +111.5% | −25.2% | 0.95 |
| 10% | **$27.81** | **+178.1%** | −38.0% | 0.96 |
| 20% | $28.95 | +189.5% | −40.9% | 0.88 |
| *Buy & hold* | *$26.16* | *+161.6%* | | |

Beating buy-and-hold requires ~10% risk per trade and costs you a 38%
drawdown. Note that returns saturate between 10% and 20% while drawdown keeps
growing — that is the Kelly curve bending over, and it is the argument against
sizing by how confident you feel.

Bootstrap Monte Carlo over 5,000 resamples: 5th percentile $10.82, median
$14.15, 95th percentile $18.69, probability of ending below the starting
capital 1.5%, worst drawdown −27.3%.

---

## Adding real-time data

**There is no connector or plugin to install.** Market data does not arrive
through a Claude connector or skill — those cover Drive, Figma, GitHub and
similar. Real-time prices come from a market data vendor's API, which means two
things and only two things: a key in `.env.local`, and outbound network access
to that vendor.

### 1. Get a key

One key, and only one, is worth getting: **Finnhub** (finnhub.io/register,
free, sixty seconds). It is what makes real-time quotes, the full symbol
directory, analyst coverage, earnings and insider filings work. Everything
else below needs no credentials at all.

```bash
cp .env.example .env.local     # paste the key in
npm run dev
```

### Where each number actually comes from

| What | Source | Key? |
|---|---|---|
| Equity / ETF / bond quotes | Finnhub | yes |
| Equity / ETF / bond / index bars | Nasdaq public history | no |
| Crypto bars and quotes | Binance data mirror → CoinGecko | no |
| FX | Yahoo → ECB fixings (Frankfurter) | no |
| Symbol directory (31k US listings) | Finnhub | yes |
| Analyst consensus, earnings, insider filings, news | Finnhub | yes |

Three of those deserve an explanation, because the obvious choice was wrong
in each case:

- **Bars do not come from Finnhub.** Its free tier serves no candles at all,
  and candles are what every indicator is computed from. Nasdaq's own public
  endpoint carries the daily history instead — 750 sessions, and its closes
  agree with Finnhub's quotes to the cent.
- **Crypto does not come from `api.binance.com`.** That host answers `451` to
  datacentre IPs. The public data mirror serves the same market data without
  the geo-block.
- **Yahoo is a fallback, not a primary.** It rate-limits hard enough to be
  unreliable under load, so it sits last in every chain where something else
  works.

### What is still modelled

Being able to tell these apart is the point of the provenance badge, so they
are listed rather than blurred:

| Modelled | Why |
|---|---|
| Financial statements, DCF, Piotroski, Altman, Beneish | Full statements are not on any free tier |
| Institutional / 13F holdings | Not free, and 45 days stale by the time they file |
| Social and retail positioning | No free feed exists |
| Options chains and implied volatility | Not free |

These keep their `SIM` badge and their `simulated` provenance everywhere they
appear. Real data always wins where a real feed exists; where it does not,
the model says so rather than quietly filling in.

### 2. Allow the outbound connection

Keys are useless if the network blocks the vendor. If prices stay `SIM` with a
valid key, check the status strip: it names the provider and the error. A `403`
on connect is a network policy denying the host, not a bad key.

On your own machine this is a non-issue. In a sandboxed or corporate
environment, the vendor's hostname has to be allowed:
`api.binance.com`, `stream.binance.com`, `query1.finance.yahoo.com`,
`finnhub.io`, `api.coingecko.com`, `data.sec.gov`.

### If every feed reports down while curl works

Node's built-in fetch ignores `HTTPS_PROXY`. Behind a proxying network the
request leaves by a different route and is refused, so every feed reports
itself down while `curl` against the same host from the same machine
succeeds. It looks exactly like a bad API key.

`scripts/run.mjs` fixes this: it sets Node's `--use-env-proxy` when, and only
when, a proxy is configured, and every npm script goes through it. If you run
`tsx` or `next` directly and feeds are down, that is why — use the npm script,
or export `NODE_USE_ENV_PROXY=1`.

### 3. Diagnose it

```bash
npm run doctor
```

Probes one instrument per provider path and says what is live, what is not,
and why. It distinguishes the two failures that look identical on the wire and
need opposite fixes:

- **A keyless provider refused.** Yahoo and Binance need no credentials, so a
  `403` from them cannot be a key problem. It is the network blocking the host.
- **A credentialled provider refused.** Could be the key or the network —
  the doctor says so rather than guessing.

That distinction is the whole diagnosis. If Yahoo is refused, no key will fix
it and there is nothing to debug in this repo: open the egress policy.

### How the streaming works

Two transports, chosen per symbol, behind one `useLiveQuote` hook:

```
crypto      browser ──WebSocket──▶ stream.binance.com     (public, no key)
everything  browser ◀──SSE── your server ──▶ vendor API   (key stays server-side)
```

Crypto connects **browser-direct** because Binance's market streams are public.
Proxying them through our own server would add a hop and a process to keep
alive, to relay data that is already public.

Equities cannot do that: the vendor needs a key, and a key that reaches the
browser is a key that is published. So the server holds the upstream connection
and fans out over server-sent events. SSE rather than a WebSocket because the
data only flows one way — a socket would buy bidirectionality nobody needs and
cost us the reconnect handling `EventSource` already does.

Reconnects use **exponential backoff with full jitter**, capped at 30 seconds. A
fixed backoff makes every client reconnect in lockstep after an outage, turning
a blip into a thundering herd against the vendor.

The price display states which mode it is in — `LIVE` (push stream), `POLLING`
(periodic REST), `NO FEED`, or `STATIC` — because the difference matters to
anyone deciding whether to act on the number.

### What "real-time" honestly means here

Free tiers are not real-time. Yahoo is delayed 15 minutes for most US equities;
Finnhub's free tier gives you a WebSocket but throttles; only paid vendors
deliver true tick-level data. The terminal will use whatever you give it and
label it accurately — it will not call a 15-minute-delayed quote "live".

---

## What you can trade

446 curated instruments, and an open-ended lookup for everything else.

| Class | Count | What is in it |
|---|---|---|
| Equities | 163 | S&P 100 plus the names that carry real retail volume |
| ETFs | 100 | Sector, industry, factor, international, commodity, crypto wrappers, leveraged |
| Bonds | 56 | The treasury ladder, TIPS, IG and high-yield credit, munis, mortgages, EM, floating rate, converts |
| Crypto | 43 | Majors through to the liquid memecoins, Binance pair where one exists |
| Indexes | 29 | US benchmarks, the volatility complex, 16 international indexes |
| Commodities | 27 | Metals, the full energy strip, grains, softs, livestock |
| FX | 24 | G10 majors, the crosses that matter, EM |
| Rates | 4 | The treasury curve as yields, not prices |

**Anything not on that list still works.** The full US listed-symbol
directory — 31,107 tickers — is pulled from Finnhub once, cached for a day
and indexed in memory, so the command bar reaches every listed stock, ETF,
ADR, REIT and closed-end fund, and answers in under 20ms. The terminal
synthesises an instrument, marks it `EXT` in the search results, and runs the
same engine on it. The only difference is that its fallback calibration is
inferred from its own price history rather than set by hand.

Fixed income is classed by behaviour rather than by wrapper. A bond fund is an
ETF to the vendor and duration risk to a trader, and the trader is right, so
`inferAssetClass` reads the name and routes `BIV` or `SCHO` to `bond` even
though both vendors label them `ETF`. Each bond carries its effective
duration, because that — not price — is what the rates signal keys on.

### A note on rate limits

The screener runs the full engine over 422 instruments, one price request
each. On free tiers that is enough to get throttled if you reload it hard.
It is cached for two minutes, and bars are cached for five; raise
`MERIDIAN_CACHE_TTL` if you are sharing one key across users.

## The Trade call

Every place a symbol appears — the search dropdown, the ticker header, screener
rows, every idea table — carries a **TRADE** button. One click gives a single
decision at `/trade/[symbol]`, with the reasoning written out. `Shift+Enter` in
the search box goes straight there.

The dossier shows you 40 analytics and lets you synthesise. The Trade call does
the synthesis and commits: **BUY or SELL, LONG or SHORT**, how to express it,
and the five numbers you need to act — entry, stop, target, reward-to-risk, and
position size.

Underneath it reads like a research note:

- **The thesis** — what the weight of evidence says and why it matters *in this
  regime*
- **The case for** and **the case against** — the strongest evidence on both
  sides, ranked. The counter-case is not optional; a note that argues one side
  is marketing.
- **Technical, fundamental, flow and volatility reads** — in prose
- **What would prove this wrong** — the exact level, and why that level rather
  than a round percentage
- **How to express it** — instrument, size, and the options leg where one is
  warranted

Three things the generator will not do:

**It will not smooth over a conflict.** The technical paragraph sorts readings
by what they *argue*. Stringing "+DI below -DI" together with "trading above the
cloud" using "and" reads as though they agree, when they are the two sides of
the disagreement you most need to see. A split book opens by saying so.

**It will not manufacture confidence.** Below the conviction floor it returns
NO TRADE and argues why — and still shows both the bull and bear case, because
on a no-trade those two competing cases are the entire content.

**It will not hide the data problem.** A simulated run opens its disclosure with
`PRICES ARE SIMULATED` in capitals and says "do not trade on this".

---

## How a signal is produced

```
bars ──▶ ~35 analytics ──▶ regime classifier ──▶ weighted ensemble ──▶ trade plan
             │                     │                      │                 │
        each emits a         8 regimes from        family weight ×     structural stop,
        Vote: direction,     ADX, choppiness,      horizon weight ×    R-multiple targets,
        confidence,          Hurst, MA stack,      vote confidence     conviction-scaled
        horizon, rationale   vol percentile                            size, options leg
```

**Every analytic reduces to a common `Vote`** — direction in [−1, +1],
confidence in [0, 1], the horizon it speaks to, and a plain-English rationale.
Score and confidence are kept separate throughout: a vote can be strongly
directional and barely trustworthy (an oscillator in a runaway trend), or
weakly directional and highly trustworthy (a 200-day slope).

**Regime is classified before anything is weighted.** The same RSI reading
means opposite things in a trend and in a range, so RSI votes *momentum* when
ADX is above 25 and *mean-reversion* when it isn't. Treating RSI 70 as "sell"
during an uptrend is the single most expensive beginner error in technical
analysis, and an ensemble that ignores regime averages both interpretations
into mush.

**Conviction is built from magnitude, agreement, breadth and dispersion** —
and *not* from data quality, which is reported as its own number. They answer
different questions ("how strongly does the ensemble believe this" versus "how
real is the input"), and collapsing them into one figure produces a number that
means neither while hiding a simulated feed behind a merely-mediocre score.

**Below the conviction floor the engine returns FLAT and explains why.**
Refusing to manufacture a trade is a feature.

### What feeds the ensemble

| Family | Inputs |
|---|---|
| Trend | MA stack alignment, 50/200 cross, ADX/DMI, SuperTrend, Parabolic SAR, Ichimoku, Aroon, Vortex, regression channel |
| Momentum | RSI, Connors RSI, MACD, Stochastic, StochRSI, CCI, Williams %R, ROC, TRIX, KST, Ultimate/Awesome oscillators, PPO, CMO, RVI, Fisher, Coppock, efficiency ratio |
| Mean reversion | RSI(2) pullback, Bollinger %B, close streaks, oscillator extremes |
| Volatility | Bollinger/Keltner/Donchian, TTM squeeze, volatility cone, Parkinson/Garman-Klass/Yang-Zhang estimators, range usage |
| Volume | OBV, CMF, MFI, Chaikin oscillator, Force index, rolling VWAP, relative volume, volume/price confirmation, volume profile with POC and value area |
| Structure | Fractal swings, market-structure classification, ATR-clustered S/R, five pivot methods, Fibonacci, 52-week range position |
| Pattern | 18 candlestick formations, regular and hidden divergence, gap analysis |
| Fundamental | Valuation composite, quality, Piotroski F-Score, Altman Z, Beneish M, analyst revisions |
| Earnings | Surprise history, beat rate, post-earnings drift, event risk |
| Flow | Insider Form 4 (cluster-buy weighted), institutional 13F cohorts |
| Sentiment | Social crowding (contrarian at extremes), news with time decay |
| Options | IV rank, volatility risk premium, 25Δ skew, term structure, dealer gamma, put/call, max pain |
| Macro | VIX complex, term structure, cross-asset stress |
| Seasonality | Six-month, turn-of-month, day-of-week |

### The trade plan

Stops anchor to **structure** — swing lows, S/R clusters, the SuperTrend rail,
value-area edges — with an ATR buffer, falling back to an ATR multiple only
when no usable level is in range. Stops placed at round ATR distances sit
exactly where everyone else's sit, which is where price goes to find liquidity.

Sizing scales with conviction, is damped by regime, capped at **quarter-Kelly**
where a win rate is available, and separately capped by notional exposure so a
tight stop cannot imply a concentrated position.

The **options decision is made on implied volatility, not direction**. Rich IV
routes to a debit spread or declines options entirely in favour of spot; cheap
IV routes to outright long premium. Strikes are selected by delta. Buying a
call because you are bullish, without checking what you are paying for
volatility, is how most retail option buyers lose money even when they get the
direction right.

If the volatility-implied stop would exceed 35% of price, **the engine declines
the trade** rather than truncating the stop to a level the analysis never
justified.

---

## Data, provenance and honesty

Every figure carries one of six provenance states, rendered as a badge:

| Badge | Meaning |
|---|---|
| `LIVE` | Fetched from an upstream provider on this request |
| `CACHE` | Fetched recently from a live provider |
| `CALC` | Computed from live or cached inputs |
| `SIM` | **Simulated.** Not market data. |
| `STALE` | Upstream failed; last known good value, age flagged |
| `N/A` | No data, and no estimate offered |

Resolution order per asset class, falling through on failure:

```
crypto      binance → coingecko → yahoo → simulator
equity/etf  finnhub → yahoo             → simulator
everything  yahoo                       → simulator
```

Policy denials (401/403/407) are never retried — a missing key or an egress
rule will not resolve itself.

### Two rules the modelled-data path obeys

**No fabricated attribution.** No real person or firm is ever named as holding
an opinion or a position. Insiders are role-labelled, funds are category
aggregates ("Multi-strategy hedge funds", "Public pension funds"), analysts are
tier aggregates. When live SEC filings are available the real names come from
the filings, which are public record. Putting a fabricated "BUY" in a named
fund manager's mouth is not a UX shortcut; it is a fabrication about a real
person.

**No lookahead.** Every modelled record derives from trailing price only, so it
cannot flatter a backtest.

### About the simulator

A plain random walk would make any backtest against it meaninglessly
optimistic. The simulator reproduces the four stylised facts that make timing
hard:

- **Volatility clustering** — GJR-GARCH(1,1) with a leverage term
- **Fat tails** — Student-t innovations plus an asymmetric jump process
- **Regime persistence** — three-state Markov chain, runs averaging ~21 bars
- **Leverage effect** — negative shocks raise next-period variance more

Variance targeting pins realised volatility to each instrument's calibration
exactly. Verified: volatility within 10% of target across every asset class,
excess kurtosis ~14, ACF(1) of squared returns ~0.10 with raw returns
uncorrelated, ATR at 1.21× daily sigma (real markets run 1.2–1.7×), and
byte-identical output across reruns.

**Known limitation:** each instrument is seeded independently, so simulated
series carry no cross-sectional correlation. In simulator mode you will see
SPY and SPX — or ETH and BTC — disagree, sometimes sharply, because they are
unrelated random processes rather than the near-identical instruments they are
in reality. Sector rotation and breadth are similarly uninformative under
simulation. This affects presentation only: every per-instrument analytic is
computed correctly on its own series, and the moment a live feed is attached
the real correlation structure comes with it.

---

## Backtester

Four rules separate a usable backtest from a flattering one, and this engine
enforces all four:

1. **No lookahead.** The signal at bar *i* uses bars 0..*i* and fills at bar
   *i+1*'s open. Signal-driven exits queue and fill at the next open too.
2. **Intrabar pessimism.** When a bar's range contains both the stop and the
   target, the **stop** is assumed hit first. Without tick data the sequence is
   unknowable, and assuming the favourable one is how backtests manufacture
   edge that evaporates live.
3. **Gaps are honoured.** A bar opening beyond the stop fills at the open, not
   the stop price. This is where real accounts take their worst losses.
4. **Costs are charged**, both sides, plus funding on carried notional.

Metrics: CAGR, Sharpe, Sortino, Calmar, Martin, Ulcer, VaR/CVaR, profit factor,
expectancy in R, payoff ratio, MAE/MFE per trade, exposure, tail ratio, implied
Kelly, and a full breakdown by direction and exit reason.

**Statistical significance**: a t-test of mean R against zero, with p-values
from the incomplete beta function, validated against published t-tables at
df = 10/30/100 to five decimal places.

**Monte Carlo by bootstrap resampling with replacement.** Permutation alone
leaves final equity mathematically unchanged, because multiplicative returns
commute — a permutation-based Monte Carlo reports a zero-width confidence
interval and looks far more certain than it is. That bug was found and fixed
during development.

---

## Project layout

```
src/
  app/
    page.tsx                  market cockpit
    trade/[symbol]/           the decisive trade call
    ticker/[symbol]/          per-instrument dossier
    backtest/                 renders the artefact from artifacts/
    screener/                 full-universe engine run, filterable
    paper/                    paper blotter with live marks
    api/quotes/               batch quote endpoint
    api/search/               symbol search: curated + vendor lookup
    api/stream/               server-sent event tick stream
  components/                 panels, charts, gauges, tables (hand-rolled SVG)
                              plus the three shared page views
  standalone/                 browser-build shell: hash router, sync data layer
  lib/
    indicators/               ~2,000 lines of pure TA, NaN-padded, composable
    fundamentals/             valuation, quality, Piotroski, Altman, Beneish, DCF
    options/                  Black-Scholes, greeks, IV solver, chain analytics
    vol/                      VIX complex, cross-asset stress
    signals/                  votes, regime, ensemble, trade plan, analyst note
    realtime/                 Binance WebSocket, SSE hook, tick model
    backtest/                 engine, metrics, Monte Carlo
    providers/                adapters, registry, simulator, health,
                              31k-symbol US directory
    sentiment/                insider, institutional, social, news, analysts
    market/                   universe (446 instruments), open-ended resolver,
                              cockpit, dossier, screener
    paper/                    blotter marking and calibration
tests/                        164 unit tests
scripts/run-backtest.ts       backtest CLI
scripts/doctor.mts            live-data diagnosis
scripts/build-standalone.mjs  single-file browser build
```

## Testing

```bash
npm test
```

164 tests. Indicator math is checked against hand-computed values (Wilder's RMA
recursion, WMA weighting, RSI boundary conditions, true range across a gap,
ADX/DI ordering); Black-Scholes against textbook values to six decimals, with
put-call parity, call/put gamma equality, and IV round-trip across 50
strike/vol/type combinations; the p-value implementation against published
t-distribution critical values; and the backtester for no-lookahead, cost
monotonicity, and R/P&L sign agreement.

The suite includes degenerate-input tests, which is how three real bugs were
caught: RSI and MFI both returned 100 on a motionless series (the "zero average
loss ⇒ 100" convention fires even with no gains either), and `price > MA` read
false at exact equality — so a halted or illiquid instrument scored as
maximally overbought and generated short signals out of nothing.

The universe has its own integrity tests, because a data table is code that
fails silently: symbols must be unique, calibration must be finite and
plausible, every crypto entry must carry the ids its providers need, every
home-panel symbol must resolve, and the bond ladder's durations and
volatilities must both increase with maturity — if `TLT` is calibrated calmer
than `SHY`, every rates-driven signal downstream is wrong and nothing else in
the suite would notice.

## Keyboard

`/` focus search · `Enter` dossier · `Shift+Enter` trade call · `F1` markets ·
`F2` trade · `F3` signal · `F4` screener · `F5` backtest · `F6` blotter · `Esc` dismiss

## Configuration

All keys optional; see `.env.example`. `MERIDIAN_OFFLINE=1` forces simulator
mode. `MERIDIAN_CACHE_TTL` sets the in-process cache TTL in seconds. SEC EDGAR
requires `SEC_USER_AGENT` with a contact address — the SEC blocks anonymous
automated requests.

## Licence

Research and educational use. Not investment advice.
