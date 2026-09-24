/* ===========================================================================
   Per-instrument dossier view.

   Shared by the Next.js route and the standalone browser build, so both render
   identical markup from identical analytics. The prop type is structural
   rather than importing either build's Dossier: the server variant carries
   provider metadata the browser build has no equivalent for.
   ========================================================================= */

'use client';

import { Panel } from '@/components/Panel';
import { PriceChart } from '@/components/PriceChart';
import { VerdictCard } from '@/components/VerdictCard';
import { VoteTable, AttributionChart } from '@/components/VoteTable';
import { Sparkline } from '@/components/Sparkline';
import { Meter, ScoreBar } from '@/components/Gauge';
import { TradeButton } from '@/components/TradeButton';
import { LivePrice } from '@/components/LivePrice';
import type { Bar, Provenance, SignalResult } from '@/lib/types';
import type { Instrument } from '@/lib/market/universe';
import type { IndicatorSnapshot } from '@/lib/indicators';
import type { FundamentalAssessment, EarningsAnalysis, Fundamentals } from '@/lib/fundamentals';
import type {
  InsiderAnalysis, InstitutionalAnalysis, SocialAnalysis, NewsAnalysis, AnalystConsensus,
} from '@/lib/sentiment';
import type { OptionChain, IvStats, SkewAnalysis, TermStructure, Positioning } from '@/lib/options/chain';
import type { VixComplex } from '@/lib/vol';
import {
  fmtPrice, fmtPct, fmtNum, fmtCompact, fmtUsdCompact, fmtX, fmtAge, fmtDateShort,
} from '@/lib/util/format';

export interface DossierView {
  instrument: Instrument;
  quote: { price: number; change: number; changePct: number; open: number; high: number; low: number; prevClose: number; volume: number; marketCap?: number };
  bars: Bar[];
  snapshot: IndicatorSnapshot;
  signal: SignalResult;
  fundamentals: FundamentalAssessment | null;
  raw: Fundamentals | null;
  earnings: EarningsAnalysis | null;
  insider: InsiderAnalysis | null;
  institutional: InstitutionalAnalysis | null;
  social: SocialAnalysis;
  news: NewsAnalysis;
  analysts: AnalystConsensus | null;
  chain: OptionChain | null;
  iv: IvStats | null;
  skew: SkewAnalysis | null;
  term: TermStructure | null;
  positioning: Positioning | null;
  vix: VixComplex;
  /** Present only in the server build, which knows which provider answered. */
  barsProvenance?: Provenance;
  barsSource?: string;
  fallbackReason?: string;
}

export function TickerDossier({ d }: { d: DossierView }) {
  const s = d.snapshot;
  const sig = d.signal;
  const isSim = (d.barsProvenance ?? 'simulated') === 'simulated';

  return (
    <div className="min-h-full">
      <InstrumentHeader d={d} />

      <div className="p-2 grid grid-cols-1 2xl:grid-cols-12 gap-2">
        {/* ========== MAIN COLUMN ========== */}
        <div className="2xl:col-span-8 flex flex-col gap-2 min-w-0">
          <Panel
            title="Signal verdict"
            subtitle={`${sig.votes.length} analytics · swing horizon`}
            accent
            provenance={isSim ? 'simulated' : 'derived'}
            source={d.barsSource}
          >
            <VerdictCard signal={sig} />
          </Panel>

          <Panel
            title={`${d.instrument.symbol} daily`}
            subtitle="180 sessions"
            provenance={d.barsProvenance ?? 'simulated'}
            source={d.barsSource}
            actions={
              <div className="flex items-center gap-2.5">
                <Legend colour="var(--color-ice)" label="EMA21" />
                <Legend colour="var(--color-violet)" label="SMA50" />
                <Legend colour="var(--color-amber)" label="SMA200" />
              </div>
            }
          >
            <div className="p-1">
              <PriceChart
                bars={d.bars}
                height={330}
                maxBars={180}
                overlays={[
                  { data: s.ema21Series, colour: 'var(--color-ice)', label: 'EMA21' },
                  { data: s.sma50Series, colour: 'var(--color-violet)', label: 'SMA50' },
                  { data: s.sma200Series, colour: 'var(--color-amber)', label: 'SMA200' },
                ]}
                markers={[
                  ...(sig.plan.direction !== 'flat'
                    ? [
                        { price: sig.plan.entry, label: 'ENTRY', colour: 'var(--color-ink-2)' },
                        { price: sig.plan.stop, label: 'STOP', colour: 'var(--color-short)' },
                        ...sig.plan.targets.slice(0, 2).map((t, i) => ({
                          price: t, label: `T${i + 1}`, colour: 'var(--color-long)',
                        })),
                      ]
                    : []),
                  ...(Number.isFinite(s.profile.poc)
                    ? [{ price: s.profile.poc, label: 'POC', colour: 'var(--color-violet)' }]
                    : []),
                ]}
              />
            </div>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <Panel title="Score attribution" provenance="derived">
              <AttributionChart attribution={sig.attribution} />
            </Panel>
            <TechnicalGrid s={s} isSim={isSim} />
          </div>

          <Panel
            title="Analytic detail"
            subtitle="every input, its reading and why it votes that way"
            provenance="derived"
          >
            <VoteTable votes={sig.votes} />
          </Panel>

          {d.fundamentals && d.raw && (
            <FundamentalsPanel f={d.fundamentals} raw={d.raw} price={s.price} />
          )}

          {d.chain && d.iv && (
            <OptionsPanel
              iv={d.iv} skew={d.skew} term={d.term}
              positioning={d.positioning} chain={d.chain} price={s.price}
            />
          )}
        </div>

        {/* ========== SIDE COLUMN ========== */}
        <div className="2xl:col-span-4 flex flex-col gap-2 min-w-0">
          <LevelsPanel s={s} />
          {d.earnings && <EarningsPanel e={d.earnings} />}
          {d.insider && <InsiderPanel i={d.insider} />}
          {d.institutional && <InstitutionalPanel i={d.institutional} />}
          <ConsensusPanel social={d.social} analysts={d.analysts} />
          <NewsPanel n={d.news} />
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2.5 h-[2px]" style={{ background: colour }} />
      <span className="label-xs">{label}</span>
    </span>
  );
}

function InstrumentHeader({ d }: { d: DossierView }) {
  const q = d.quote;
  const s = d.snapshot;

  return (
    <div className="border-b border-hairline bg-terminal px-3 py-2.5">
      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <h1 className="num text-2xl font-bold text-ink tracking-wide">{d.instrument.symbol}</h1>
            <span className="text-[12px] text-ink-2 truncate">{d.instrument.name}</span>
            <span className="label-xs border border-hairline px-1.5 py-0.5">
              {d.instrument.assetClass.toUpperCase()}
            </span>
            <span className="label-xs">{d.instrument.venue}</span>
            <TradeButton symbol={d.instrument.symbol} size="md" className="ml-1" />
          </div>
          {d.instrument.description && (
            <p className="text-[10.5px] text-ink-3 mt-1.5 max-w-2xl leading-snug">
              {d.instrument.description}
            </p>
          )}
        </div>

        <div className="flex items-end gap-5">
          <LivePrice
            symbol={d.instrument.symbol}
            fallbackPrice={q.price}
            fallbackChangePct={q.changePct}
          />
          <Sparkline data={d.bars.slice(-90).map((b) => b.c)} width={150} height={44} />
        </div>

        <dl className="grid grid-cols-3 sm:grid-cols-6 gap-x-5 gap-y-2">
          <HStat label="OPEN" value={fmtPrice(q.open)} />
          <HStat label="HIGH" value={fmtPrice(q.high)} />
          <HStat label="LOW" value={fmtPrice(q.low)} />
          <HStat label="PREV CLOSE" value={fmtPrice(q.prevClose)} />
          <HStat label="VOLUME" value={fmtCompact(q.volume, 1)} />
          <HStat label="ATR%" value={Number.isFinite(s.natr14) ? `${s.natr14.toFixed(2)}%` : '—'} />
          <HStat label="52W HIGH" value={fmtPrice(s.high52w)} />
          <HStat label="52W LOW" value={fmtPrice(s.low52w)} />
          <HStat
            label="FROM HIGH"
            value={Number.isFinite(s.pctFrom52wHigh) ? fmtPct(s.pctFrom52wHigh, 1) : '—'}
            tone="short"
          />
          <HStat label="RSI(14)" value={Number.isFinite(s.rsi14) ? s.rsi14.toFixed(1) : '—'} />
          <HStat
            label="REL VOLUME"
            value={Number.isFinite(s.relVolume) ? `${s.relVolume.toFixed(2)}x` : '—'}
          />
          {q.marketCap && <HStat label="MKT CAP" value={fmtUsdCompact(q.marketCap, 1)} />}
        </dl>
      </div>

      {d.fallbackReason && (
        <p className="text-[9.5px] text-amber/70 mt-2.5 pt-2 border-t border-hairline leading-relaxed">
          <span className="font-bold">SIMULATED:</span> {d.fallbackReason.slice(0, 260)}
        </p>
      )}
    </div>
  );
}

function HStat({ label, value, tone }: { label: string; value: string; tone?: 'long' | 'short' }) {
  return (
    <div className="min-w-0">
      <dt className="label-xs mb-0.5 whitespace-nowrap">{label}</dt>
      <dd className={`num text-[11.5px] font-semibold ${
        tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink'
      }`}>
        {value}
      </dd>
    </div>
  );
}

/* ================================================================== */

function TechnicalGrid({ s, isSim }: { s: import('@/lib/indicators').IndicatorSnapshot; isSim: boolean }) {
  const rows: { label: string; value: string; tone?: 'long' | 'short'; note?: string }[] = [
    { label: 'ADX (14)', value: fmtNum(s.adx14, 1), tone: s.adx14 > 25 ? 'long' : undefined, note: s.adx14 > 25 ? 'trending' : 'no trend' },
    { label: '+DI / -DI', value: `${fmtNum(s.plusDi, 1)} / ${fmtNum(s.minusDi, 1)}`, tone: s.plusDi > s.minusDi ? 'long' : 'short' },
    { label: 'RSI (14)', value: fmtNum(s.rsi14, 1), tone: s.rsi14 > 70 ? 'short' : s.rsi14 < 30 ? 'long' : undefined },
    { label: 'Stoch %K/%D', value: `${fmtNum(s.stoch.k[s.stoch.k.length - 1], 0)} / ${fmtNum(s.stoch.d[s.stoch.d.length - 1], 0)}` },
    { label: 'MACD hist', value: fmtNum(s.macd.histogram[s.macd.histogram.length - 1], 3), tone: (s.macd.histogram[s.macd.histogram.length - 1] ?? 0) > 0 ? 'long' : 'short' },
    { label: 'CCI (20)', value: fmtNum(s.cci20, 0) },
    { label: 'MFI (14)', value: fmtNum(s.mfi14, 1) },
    { label: 'CMF (20)', value: fmtNum(s.cmf20, 3), tone: s.cmf20 > 0 ? 'long' : 'short' },
    { label: 'Bollinger %B', value: fmtNum(s.bbPercentB, 2) },
    { label: 'BB width', value: `${fmtNum(s.bbWidthPct, 1)}%` },
    { label: 'Squeeze', value: s.squeeze.fired ? 'FIRED' : s.squeeze.barsInSqueeze > 0 ? `${s.squeeze.barsInSqueeze} bars` : 'none', tone: s.squeeze.fired ? 'long' : undefined },
    { label: 'SuperTrend', value: s.stDirection > 0 ? `LONG ${fmtPrice(s.stLevel)}` : `SHORT ${fmtPrice(s.stLevel)}`, tone: s.stDirection > 0 ? 'long' : 'short' },
    { label: 'Ichimoku', value: s.ichimokuBias.replace('_', ' ').toUpperCase(), tone: s.ichimokuBias === 'above_cloud' ? 'long' : s.ichimokuBias === 'below_cloud' ? 'short' : undefined },
    { label: 'Parabolic SAR', value: s.psarDirection > 0 ? `LONG ${fmtPrice(s.psarLevel)}` : `SHORT ${fmtPrice(s.psarLevel)}`, tone: s.psarDirection > 0 ? 'long' : 'short' },
    { label: 'Aroon osc', value: fmtNum(s.aroonOsc, 0), tone: s.aroonOsc > 0 ? 'long' : 'short' },
    { label: 'Choppiness', value: fmtNum(s.choppiness, 1), note: s.choppiness > 61.8 ? 'range' : s.choppiness < 38.2 ? 'trend' : 'mixed' },
    { label: 'Hurst', value: fmtNum(s.hurst, 3), note: s.hurst > 0.55 ? 'persistent' : s.hurst < 0.45 ? 'reverting' : 'random' },
    { label: 'Regression R²', value: fmtNum(s.regression.r2, 2) },
    { label: 'Reg slope p.a.', value: `${fmtNum(s.regression.slopePctAnnual, 0)}%`, tone: s.regression.slopePctAnnual > 0 ? 'long' : 'short' },
    { label: 'ATR (14)', value: fmtPrice(s.atr14) },
    { label: 'Realised vol', value: `${fmtNum(s.realisedVolAnnual * 100, 1)}%` },
    { label: 'Vol percentile', value: `p${(s.volCone.percentile * 100).toFixed(0)}`, note: s.volCone.state },
    { label: 'VWAP dist', value: `${fmtNum(s.vwapDistancePct, 2)}%`, tone: s.vwapDistancePct > 0 ? 'long' : 'short' },
    { label: 'OBV slope 20', value: `${fmtNum(s.obvSlope * 100, 1)}%`, tone: s.obvSlope > 0 ? 'long' : 'short' },
    { label: 'Structure', value: s.structure.state.replace(/_/g, ' ').toUpperCase() },
    { label: 'Value area', value: s.profile.position.replace('_', ' ').toUpperCase() },
  ];

  return (
    <Panel title="Technical readings" subtitle={`${rows.length} indicators`} provenance={isSim ? 'simulated' : 'derived'}>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0 p-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-baseline justify-between gap-2 py-[3px] border-b border-[#10151d] min-w-0">
            <span className="text-[10px] text-ink-3 truncate">{r.label}</span>
            <span className="flex items-baseline gap-1.5 shrink-0">
              {r.note && <span className="label-xs">{r.note}</span>}
              <span className={`num text-[10.5px] font-semibold ${
                r.tone === 'long' ? 'text-long' : r.tone === 'short' ? 'text-short' : 'text-ink-2'
              }`}>
                {r.value}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function LevelsPanel({ s }: { s: import('@/lib/indicators').IndicatorSnapshot }) {
  return (
    <Panel title="Key levels" subtitle="ATR-clustered swing points" provenance="derived" accent>
      <div className="p-2">
        {s.levels.length ? (
          <table className="dt">
            <thead>
              <tr>
                <th className="!text-left">Type</th>
                <th>Price</th>
                <th>Dist</th>
                <th>Touches</th>
                <th className="w-16">Strength</th>
              </tr>
            </thead>
            <tbody>
              {s.levels.map((l, i) => (
                <tr key={i}>
                  <td className="!text-left">
                    <span className={`label-xs ${l.type === 'resistance' ? 'text-short' : 'text-long'}`}>
                      {l.type.toUpperCase()}
                    </span>
                  </td>
                  <td className="num">{fmtPrice(l.price)}</td>
                  <td className={`num ${l.distancePct >= 0 ? 'text-ink-2' : 'text-ink-2'}`}>
                    {fmtPct(l.distancePct, 1)}
                  </td>
                  <td className="num text-ink-3">{l.touches}</td>
                  <td>
                    <div className="flex justify-end">
                      <Meter value={l.strength * 100} width={54} height={5} colour="var(--color-amber)" />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="label p-3 text-center">No clustered levels identified</div>
        )}

        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-hairline">
          <MiniStat label="PIVOT" value={fmtPrice(s.pivotsClassic.pivot)} />
          <MiniStat label="R1" value={fmtPrice(s.pivotsClassic.r1)} tone="short" />
          <MiniStat label="S1" value={fmtPrice(s.pivotsClassic.s1)} tone="long" />
          <MiniStat label="POC" value={fmtPrice(s.profile.poc)} />
          <MiniStat label="VAH" value={fmtPrice(s.profile.vah)} tone="short" />
          <MiniStat label="VAL" value={fmtPrice(s.profile.val)} tone="long" />
        </div>
      </div>
    </Panel>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: 'long' | 'short' }) {
  return (
    <div className="min-w-0">
      <div className="label-xs mb-0.5">{label}</div>
      <div className={`num text-[11px] font-semibold truncate ${
        tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink'
      }`}>{value}</div>
    </div>
  );
}

function FundamentalsPanel({
  f, raw, price,
}: { f: import('@/lib/fundamentals').FundamentalAssessment; raw: import('@/lib/fundamentals').Fundamentals; price: number }) {
  const v = f.valuation;
  const q = f.quality;
  return (
    <Panel
      title="Fundamentals"
      subtitle={`${raw.sector} · grade ${f.letterGrade}`}
      provenance={raw.provenance}
      source={raw.source}
      actions={
        <span className={`num text-[12px] font-bold ${f.grade >= 60 ? 'text-long' : f.grade >= 45 ? 'text-amber' : 'text-short'}`}>
          {f.grade}/100
        </span>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
        <div className="p-3 border-b lg:border-b-0 lg:border-r border-hairline">
          <div className="label mb-2">VALUATION</div>
          <div className="space-y-[3px]">
            <KV label="P/E (TTM)" value={fmtX(v.pe)} />
            <KV label="Forward P/E" value={fmtX(v.forwardPe)} />
            <KV label="PEG" value={fmtNum(v.peg, 2)} />
            <KV label="P/S" value={fmtX(v.ps)} />
            <KV label="P/B" value={fmtX(v.pb)} />
            <KV label="EV/EBITDA" value={fmtX(v.evEbitda)} />
            <KV label="FCF yield" value={`${fmtNum(v.fcfYield, 1)}%`} />
            <KV label="Graham upside" value={fmtPct(v.grahamUpside, 0)} tone={v.grahamUpside > 0 ? 'long' : 'short'} />
            <KV label="DCF upside" value={fmtPct(v.dcfUpside, 0)} tone={v.dcfUpside > 0 ? 'long' : 'short'} />
          </div>
        </div>

        <div className="p-3 border-b lg:border-b-0 lg:border-r border-hairline">
          <div className="label mb-2">QUALITY & GROWTH</div>
          <div className="space-y-[3px]">
            <KV label="Gross margin" value={`${fmtNum(q.grossMargin, 1)}%`} />
            <KV label="Operating margin" value={`${fmtNum(q.operatingMargin, 1)}%`} />
            <KV label="Net margin" value={`${fmtNum(q.netMargin, 1)}%`} />
            <KV label="ROE" value={`${fmtNum(q.roe, 1)}%`} />
            <KV label="ROIC" value={`${fmtNum(q.roic, 1)}%`} tone={q.roic > 10 ? 'long' : undefined} />
            <KV label="FCF margin" value={`${fmtNum(q.fcfMargin, 1)}%`} />
            <KV label="Cash conversion" value={fmtX(q.cashConversion, 2)} tone={q.cashConversion > 1 ? 'long' : 'short'} />
            <KV label="Revenue YoY" value={fmtPct(q.revenueGrowthYoY, 1)} tone={q.revenueGrowthYoY > 0 ? 'long' : 'short'} />
            <KV label="EPS YoY" value={fmtPct(q.epsGrowthYoY, 1)} tone={q.epsGrowthYoY > 0 ? 'long' : 'short'} />
          </div>
        </div>

        <div className="p-3">
          <div className="label mb-2">FINANCIAL HEALTH</div>
          <div className="space-y-2.5">
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[10px] text-ink-3">Piotroski F-Score</span>
                <span className="num text-[11px] font-bold text-ink">{f.piotroski.score}/9</span>
              </div>
              <Meter
                value={(f.piotroski.score / 9) * 100} width={999} height={4}
                colour={f.piotroski.score >= 6 ? 'var(--color-long)' : f.piotroski.score >= 4 ? 'var(--color-amber)' : 'var(--color-short)'}
              />
              <div className="text-[9.5px] text-ink-4 mt-1">{f.piotroski.interpretation}</div>
            </div>

            <div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[10px] text-ink-3">Altman Z-Score</span>
                <span className={`num text-[11px] font-bold ${
                  f.altman.zone === 'safe' ? 'text-long' : f.altman.zone === 'grey' ? 'text-amber' : 'text-short'
                }`}>{fmtNum(f.altman.z, 2)}</span>
              </div>
              <div className="text-[9.5px] text-ink-4">{f.altman.interpretation}</div>
            </div>

            <div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[10px] text-ink-3">Beneish M-Score</span>
                <span className={`num text-[11px] font-bold ${f.beneish.flag ? 'text-short' : 'text-long'}`}>
                  {fmtNum(f.beneish.m, 2)}
                </span>
              </div>
              <div className="text-[9.5px] text-ink-4 leading-snug">{f.beneish.interpretation}</div>
            </div>

            <div className="pt-2 border-t border-hairline space-y-[3px]">
              <KV label="Short % float" value={`${fmtNum(raw.shortPercentFloat, 1)}%`} tone={raw.shortPercentFloat > 15 ? 'short' : undefined} />
              <KV label="Beta" value={fmtNum(raw.beta, 2)} />
              <KV label="Market cap" value={fmtUsdCompact(raw.marketCap, 1)} />
            </div>
          </div>
        </div>
      </div>

      {f.redFlags.length > 0 && (
        <div className="border-t border-hairline p-3 bg-short/[0.04]">
          <div className="label text-short mb-1.5">RED FLAGS</div>
          <ul className="space-y-1">
            {f.redFlags.map((r, i) => (
              <li key={i} className="text-[10.5px] text-ink-2 leading-snug">— {r}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function KV({ label, value, tone }: { label: string; value: string; tone?: 'long' | 'short' }) {
  return (
    <div className="flex items-baseline justify-between gap-2 min-w-0">
      <span className="text-[10px] text-ink-3 truncate">{label}</span>
      <span className={`num text-[10.5px] font-semibold shrink-0 ${
        tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink-2'
      }`}>{value}</span>
    </div>
  );
}

function OptionsPanel({
  iv, skew, term, positioning, chain, price,
}: {
  iv: import('@/lib/options/chain').IvStats;
  skew: import('@/lib/options/chain').SkewAnalysis | null;
  term: import('@/lib/options/chain').TermStructure | null;
  positioning: import('@/lib/options/chain').Positioning | null;
  chain: import('@/lib/options/chain').OptionChain;
  price: number;
}) {
  const front = Math.min(...chain.expiries);
  const nearContracts = chain.contracts
    .filter((c) => c.expiry === front)
    .sort((a, b) => a.strike - b.strike);
  const atmIdx = nearContracts.reduce(
    (best, c, i) => (Math.abs(c.strike - price) < Math.abs(nearContracts[best].strike - price) ? i : best), 0,
  );
  const window = nearContracts.slice(Math.max(0, atmIdx - 12), atmIdx + 12);
  const strikes = [...new Set(window.map((c) => c.strike))].sort((a, b) => a - b);

  return (
    <Panel
      title="Options & implied volatility"
      subtitle={`${chain.contracts.length} contracts · ${chain.expiries.length} expiries`}
      provenance={chain.provenance}
      source={chain.source}
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 border-b border-hairline">
        <div className="p-3 border-b lg:border-b-0 lg:border-r border-hairline">
          <div className="label mb-2">IMPLIED VOLATILITY</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="num text-2xl font-bold text-ink">{(iv.iv30 * 100).toFixed(1)}%</span>
            <span className="label-xs">30D ATM</span>
          </div>
          <div className="mb-2">
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-[10px] text-ink-3">IV rank</span>
              <span className="num text-[11px] font-bold text-ink">{(iv.ivRank * 100).toFixed(0)}</span>
            </div>
            <Meter
              value={iv.ivRank * 100} width={999} height={5}
              colour={iv.ivRank > 0.7 ? 'var(--color-short)' : iv.ivRank < 0.3 ? 'var(--color-long)' : 'var(--color-amber)'}
            />
          </div>
          <div className="space-y-[3px] mb-2">
            <KV label="IV percentile" value={`p${(iv.ivPercentile * 100).toFixed(0)}`} />
            <KV label="52w IV range" value={`${(iv.ivLow52w * 100).toFixed(0)}-${(iv.ivHigh52w * 100).toFixed(0)}%`} />
            <KV label="Realised vol" value={`${(iv.realisedVol * 100).toFixed(1)}%`} />
            <KV label="Vol risk premium" value={`${iv.vrp >= 0 ? '+' : ''}${(iv.vrp * 100).toFixed(1)}pt`} tone={iv.vrp > 0 ? 'short' : 'long'} />
            <KV label="Premium bias" value={iv.premiumBias.toUpperCase()} tone={iv.premiumBias === 'buy' ? 'long' : iv.premiumBias === 'sell' ? 'short' : undefined} />
          </div>
          <p className="text-[10px] leading-[1.55] text-ink-3">{iv.note}</p>
        </div>

        <div className="p-3 border-b lg:border-b-0 lg:border-r border-hairline">
          <div className="label mb-2">SKEW & TERM STRUCTURE</div>
          {skew && (
            <>
              <div className="space-y-[3px] mb-2">
                <KV label="25Δ skew" value={`${skew.skew25 >= 0 ? '+' : ''}${fmtNum(skew.skew25, 1)}pt`} tone={skew.skew25 > 0 ? 'short' : 'long'} />
                <KV label="25Δ put IV" value={`${(skew.putIv25 * 100).toFixed(1)}%`} />
                <KV label="25Δ call IV" value={`${(skew.callIv25 * 100).toFixed(1)}%`} />
                <KV label="Severity" value={skew.severity.toUpperCase()} />
              </div>
              <p className="text-[10px] leading-[1.55] text-ink-3 mb-2.5">{skew.note}</p>
            </>
          )}
          {term && (
            <>
              <div className="flex items-end gap-[3px] h-12 mb-1.5">
                {term.points.map((p) => {
                  const maxIv = Math.max(...term.points.map((x) => x.iv), 0.01);
                  return (
                    <div key={p.dte} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className="w-full bg-ice/50"
                        style={{ height: `${(p.iv / maxIv) * 100}%` }}
                        title={`${p.dte.toFixed(0)}d: ${(p.iv * 100).toFixed(1)}%`}
                      />
                      <span className="label-xs">{p.dte.toFixed(0)}d</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] leading-[1.55] text-ink-3">{term.note}</p>
            </>
          )}
        </div>

        <div className="p-3">
          <div className="label mb-2">POSITIONING</div>
          {positioning && (
            <>
              <div className="space-y-[3px] mb-2">
                <KV label="Put/call volume" value={fmtNum(positioning.putCallVolume, 2)} tone={positioning.putCallVolume > 1 ? 'short' : 'long'} />
                <KV label="Put/call OI" value={fmtNum(positioning.putCallOi, 2)} />
                <KV label="Max pain" value={fmtPrice(positioning.maxPain)} />
                <KV label="Max pain dist" value={fmtPct(positioning.maxPainDistancePct, 1)} />
                <KV label="Gamma flip" value={fmtPrice(positioning.gammaFlip)} />
                <KV label="Dealer GEX" value={fmtCompact(positioning.gammaExposure, 1)} tone={positioning.gammaExposure > 0 ? 'long' : 'short'} />
              </div>
              <div className="label-xs mb-1 mt-2.5">OPEN INTEREST WALLS</div>
              <div className="space-y-[2px]">
                {positioning.oiWalls.map((w, i) => (
                  <div key={i} className="flex items-baseline justify-between text-[10px]">
                    <span className={w.type === 'call' ? 'text-long/80' : 'text-short/80'}>
                      {w.type.toUpperCase()} {fmtPrice(w.strike)}
                    </span>
                    <span className="num text-ink-3">{fmtCompact(w.oi, 1)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] leading-[1.55] text-ink-3 mt-2">{positioning.note}</p>
            </>
          )}
        </div>
      </div>

      <div className="overflow-x-auto max-h-[340px]">
        <table className="dt">
          <thead>
            <tr>
              <th>C Bid</th><th>C Ask</th><th>C IV</th><th>C Δ</th><th>C OI</th>
              <th className="!text-center">Strike</th>
              <th>P Bid</th><th>P Ask</th><th>P IV</th><th>P Δ</th><th>P OI</th>
            </tr>
          </thead>
          <tbody>
            {strikes.map((k) => {
              const c = window.find((x) => x.strike === k && x.type === 'call');
              const p = window.find((x) => x.strike === k && x.type === 'put');
              const atm = Math.abs(k - price) < (strikes[1] - strikes[0]) / 2;
              return (
                <tr key={k} className={atm ? 'sel' : ''}>
                  <td className="num text-long/80">{c ? fmtNum(c.bid, 2) : '—'}</td>
                  <td className="num text-long/80">{c ? fmtNum(c.ask, 2) : '—'}</td>
                  <td className="num text-ink-3">{c ? `${(c.impliedVol * 100).toFixed(0)}%` : '—'}</td>
                  <td className="num text-ink-3">{c ? fmtNum(c.delta, 2) : '—'}</td>
                  <td className="num text-ink-4">{c ? fmtCompact(c.openInterest, 0) : '—'}</td>
                  <td className={`num !text-center font-bold ${atm ? 'text-amber' : 'text-ink'}`}>
                    {fmtPrice(k)}
                  </td>
                  <td className="num text-short/80">{p ? fmtNum(p.bid, 2) : '—'}</td>
                  <td className="num text-short/80">{p ? fmtNum(p.ask, 2) : '—'}</td>
                  <td className="num text-ink-3">{p ? `${(p.impliedVol * 100).toFixed(0)}%` : '—'}</td>
                  <td className="num text-ink-3">{p ? fmtNum(p.delta, 2) : '—'}</td>
                  <td className="num text-ink-4">{p ? fmtCompact(p.openInterest, 0) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function EarningsPanel({ e }: { e: import('@/lib/fundamentals').EarningsAnalysis }) {
  return (
    <Panel title="Earnings" provenance="simulated" source="simulator">
      <div className="p-3">
        {e.next && (
          <div className={`mb-3 pb-3 border-b border-hairline ${e.eventRisk ? 'border-l-2 border-l-amber pl-2.5' : ''}`}>
            <div className="flex items-baseline justify-between mb-1">
              <span className="label">NEXT REPORT</span>
              <span className={`num text-[11px] font-bold ${e.eventRisk ? 'text-amber' : 'text-ink'}`}>
                {e.daysToNext}d
              </span>
            </div>
            <div className="text-[10.5px] text-ink-2">
              {fmtDateShort(e.next.date)} · {e.next.time.toUpperCase()} · est {fmtNum(e.next.epsEstimate, 2)} EPS
            </div>
            <p className="text-[10px] text-ink-3 mt-1.5 leading-snug">{e.note}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 mb-3">
          <MiniStat label="BEAT RATE" value={`${e.beatCount}/4`} tone={e.beatCount >= 3 ? 'long' : undefined} />
          <MiniStat label="AVG SURPRISE" value={fmtPct(e.avgSurprise, 1)} tone={e.avgSurprise > 0 ? 'long' : 'short'} />
          <MiniStat label="AVG MOVE" value={`${fmtNum(e.avgReaction, 1)}%`} />
        </div>

        <table className="dt">
          <thead>
            <tr><th className="!text-left">Period</th><th>Est</th><th>Act</th><th>Surp</th><th>Move</th></tr>
          </thead>
          <tbody>
            {e.history.slice(0, 6).map((h, i) => (
              <tr key={i}>
                <td className="!text-left text-[10px] text-ink-3">{h.fiscalPeriod}</td>
                <td className="num text-[10px]">{fmtNum(h.epsEstimate, 2)}</td>
                <td className="num text-[10px]">{fmtNum(h.epsActual, 2)}</td>
                <td className={`num text-[10px] ${(h.surprisePct ?? 0) >= 0 ? 'text-long' : 'text-short'}`}>
                  {fmtPct(h.surprisePct, 1)}
                </td>
                <td className={`num text-[10px] ${(h.reactionPct ?? 0) >= 0 ? 'text-long' : 'text-short'}`}>
                  {fmtPct(h.reactionPct, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function InsiderPanel({ i }: { i: import('@/lib/sentiment').InsiderAnalysis }) {
  return (
    <Panel
      title="Insider activity"
      subtitle="Form 4 · 90 days"
      provenance={i.provenance}
      source={i.source}
      actions={i.clusterBuy ? <span className="label-xs text-long">CLUSTER BUY</span> : undefined}
    >
      <div className="p-3">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <MiniStat label="NET VALUE" value={fmtUsdCompact(i.netValue90d, 1)} tone={i.netValue90d > 0 ? 'long' : 'short'} />
          <MiniStat label="BUYERS" value={String(i.uniqueBuyers)} tone="long" />
          <MiniStat label="SELLERS" value={String(i.uniqueSellers)} tone="short" />
        </div>

        <div className="flex items-center gap-2 mb-3">
          <span className="label-xs shrink-0">BUY RATIO</span>
          <div className="flex-1"><Meter value={i.buyRatio * 100} width={999} height={5} colour="var(--color-long)" /></div>
          <span className="num text-[10px] text-ink-2 shrink-0">{(i.buyRatio * 100).toFixed(0)}%</span>
        </div>

        <p className="text-[10.5px] leading-[1.6] text-ink-2 mb-3 pb-3 border-b border-hairline">{i.note}</p>

        <table className="dt">
          <thead>
            <tr><th className="!text-left">Role</th><th>Code</th><th>Shares</th><th>Value</th><th>When</th></tr>
          </thead>
          <tbody>
            {i.transactions.slice(0, 7).map((t, idx) => (
              <tr key={idx}>
                <td className="!text-left text-[9.5px] text-ink-2 max-w-[110px] truncate" title={`${t.insiderName} — ${t.role}`}>
                  {t.role}
                </td>
                <td>
                  <span className={`num text-[10px] font-bold ${t.transactionCode === 'P' ? 'text-long' : t.transactionCode === 'S' ? 'text-short' : 'text-ink-3'}`}>
                    {t.transactionCode}
                  </span>
                </td>
                <td className="num text-[10px] text-ink-2">{fmtCompact(t.shares, 0)}</td>
                <td className={`num text-[10px] ${t.value > 0 ? 'text-long' : 'text-short'}`}>
                  {fmtUsdCompact(Math.abs(t.value), 1)}
                </td>
                <td className="num text-[9.5px] text-ink-4">{fmtAge(t.transactionDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[9px] text-ink-4 mt-2 leading-snug">
          P = open-market purchase, S = sale, M = option exercise. Only P and S carry signal;
          awards and exercises are compensation, not conviction.
        </p>
      </div>
    </Panel>
  );
}

function InstitutionalPanel({ i }: { i: import('@/lib/sentiment').InstitutionalAnalysis }) {
  return (
    <Panel
      title="Institutional flow"
      subtitle="13F aggregates"
      provenance={i.provenance}
      source={i.source}
      actions={<span className="label-xs text-amber">{i.reportingLagDays}D LAG</span>}
    >
      <div className="p-3">
        <div className="grid grid-cols-3 gap-2 mb-3">
          <MiniStat label="OWNERSHIP" value={`${fmtNum(i.institutionalOwnership, 0)}%`} />
          <MiniStat label="ADDING" value={String(i.buyerCount)} tone="long" />
          <MiniStat label="REDUCING" value={String(i.sellerCount)} tone="short" />
        </div>

        <table className="dt mb-3">
          <thead>
            <tr><th className="!text-left">Cohort</th><th>Chg%</th><th>Action</th></tr>
          </thead>
          <tbody>
            {i.holders.map((h, idx) => (
              <tr key={idx}>
                <td className="!text-left text-[9.5px] text-ink-2 max-w-[150px] truncate" title={h.name}>
                  {h.name.replace(' (aggregate)', '')}
                </td>
                <td className={`num text-[10px] ${h.changePct >= 0 ? 'text-long' : 'text-short'}`}>
                  {fmtPct(h.changePct, 1)}
                </td>
                <td>
                  <span className={`label-xs ${
                    h.action === 'new' || h.action === 'added' ? 'text-long'
                    : h.action === 'exited' || h.action === 'trimmed' ? 'text-short' : 'text-ink-3'
                  }`}>{h.action.toUpperCase()}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="text-[10px] leading-[1.6] text-ink-3">{i.note}</p>
      </div>
    </Panel>
  );
}

function ConsensusPanel({
  social, analysts,
}: {
  social: import('@/lib/sentiment').SocialAnalysis;
  analysts: import('@/lib/sentiment').AnalystConsensus | null;
}) {
  return (
    <Panel title="Consensus & sentiment" provenance="simulated" source="simulator">
      <div className="p-3">
        {analysts && analysts.ratings.length > 0 && (
          <div className="mb-3 pb-3 border-b border-hairline">
            <div className="label mb-2">SELL-SIDE</div>
            <div className="flex items-center gap-[2px] h-5 mb-2">
              {([
                ['strongBuy', 'var(--color-long)'],
                ['buy', 'color-mix(in srgb, var(--color-long) 55%, transparent)'],
                ['hold', 'var(--color-ink-4)'],
                ['sell', 'color-mix(in srgb, var(--color-short) 55%, transparent)'],
                ['strongSell', 'var(--color-short)'],
              ] as const).map(([k, colour]) => {
                const count = analysts[k];
                const total = analysts.ratings.length || 1;
                return count > 0 ? (
                  <div
                    key={k}
                    className="h-full flex items-center justify-center"
                    style={{ background: colour, width: `${(count / total) * 100}%` }}
                    title={`${k}: ${count}`}
                  >
                    <span className="num text-[9px] font-bold text-void">{count}</span>
                  </div>
                ) : null;
              })}
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <MiniStat label="CONSENSUS" value={fmtNum(analysts.consensusScore, 2)} />
              <MiniStat label="MEAN TARGET" value={fmtPrice(analysts.meanTarget)} />
              <MiniStat label="UPSIDE" value={fmtPct(analysts.targetUpsidePct, 1)} tone={analysts.targetUpsidePct > 0 ? 'long' : 'short'} />
            </div>
            <p className="text-[10px] leading-[1.55] text-ink-3">{analysts.note}</p>
          </div>
        )}

        <div className="label mb-2">SOCIAL & RETAIL FLOW</div>
        <div className="space-y-[3px] mb-2.5">
          {social.signals.map((s) => (
            <div key={s.channel} className="flex items-center gap-2">
              <span className="text-[9.5px] text-ink-3 w-[132px] shrink-0 truncate" title={s.channel}>
                {s.channel}
              </span>
              <ScoreBar score={s.sentiment} width={54} height={6} />
              <span className="num text-[9.5px] text-ink-4 w-11 text-right shrink-0">
                {fmtCompact(s.mentions, 0)}
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="label-xs">CROWDING</span>
          <span className={`label-xs ${
            social.crowding.includes('extreme') ? 'text-amber'
            : social.crowding === 'bullish' ? 'text-long'
            : social.crowding === 'bearish' ? 'text-short' : 'text-ink-3'
          }`}>{social.crowding.replace('_', ' ')}</span>
        </div>
        <p className="text-[10px] leading-[1.6] text-ink-3">{social.note}</p>
        <p className="text-[9px] text-ink-4 mt-2 leading-snug border-t border-hairline pt-2">
          Aggregate cohort sentiment only. No individual account, influencer or fund manager is
          named or attributed an opinion — that would be a fabrication about a real person.
        </p>
      </div>
    </Panel>
  );
}

function NewsPanel({ n }: { n: import('@/lib/sentiment').NewsAnalysis }) {
  return (
    <Panel
      title="News flow"
      subtitle={`${n.volume24h} items / 24h`}
      provenance={n.provenance}
      source={n.source}
      actions={n.volumeSpike ? <span className="label-xs text-amber">VOLUME SPIKE</span> : undefined}
    >
      <div className="p-3">
        <div className="flex items-center gap-2 mb-2.5">
          <span className="label-xs shrink-0">TONE</span>
          <ScoreBar score={n.aggregateSentiment} width={80} height={7} />
          <span className={`num text-[10px] shrink-0 ${n.aggregateSentiment >= 0 ? 'text-long' : 'text-short'}`}>
            {n.aggregateSentiment >= 0 ? '+' : ''}{fmtNum(n.aggregateSentiment, 2)}
          </span>
          <span className="label-xs ml-auto">{n.dominantCategory.toUpperCase()}</span>
        </div>
        <p className="text-[10px] leading-[1.55] text-ink-3 mb-3 pb-2.5 border-b border-hairline">{n.note}</p>

        <ul className="space-y-2">
          {n.items.slice(0, 9).map((item, i) => (
            <li key={i} className="flex gap-2 min-w-0">
              <span
                className="w-0.5 shrink-0 mt-0.5"
                style={{
                  background:
                    item.sentiment > 0.15 ? 'var(--color-long)'
                    : item.sentiment < -0.15 ? 'var(--color-short)'
                    : 'var(--color-hairline-bright)',
                }}
              />
              <div className="min-w-0">
                <div className="text-[10.5px] text-ink-2 leading-snug">{item.headline}</div>
                <div className="flex items-baseline gap-2 mt-0.5">
                  <span className="label-xs">{item.source}</span>
                  <span className="label-xs">{fmtAge(item.publishedAt)}</span>
                  <span className="label-xs">{item.category}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}
