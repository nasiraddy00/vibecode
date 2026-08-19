import { buildCockpit } from '@/lib/market/cockpit';
import { Panel } from '@/components/Panel';
import { TickerTable } from '@/components/TickerTable';
import { IdeaTable } from '@/components/IdeaTable';
import { Sparkline } from '@/components/Sparkline';
import { Meter } from '@/components/Gauge';
import { fmtPct, fmtNum, fmtPrice, fmtTime } from '@/lib/util/format';
import { VOL_REGIME_META } from '@/lib/vol';
import Link from 'next/link';

// The cockpit runs the full engine across ~90 instruments. Cache the render
// for a minute so a page refresh is instant and providers are not hammered.
export const revalidate = 60;

export default async function HomePage() {
  const d = await buildCockpit();

  return (
    <div className="min-h-full">
      <Tape rows={[...d.indexes, ...d.crypto, ...d.commodities, ...d.fx]} />

      {d.mode === 'simulated' && <SimulationBanner />}

      <div className="p-2 grid grid-cols-1 xl:grid-cols-12 gap-2">
        {/* ================= LEFT RAIL ================= */}
        <div className="xl:col-span-3 flex flex-col gap-2">
          <Panel title="Indexes" provenance={d.indexes[0]?.provenance} source={d.indexes[0]?.source} accent>
            <TickerTable rows={d.indexes} showRsi={false} compact />
          </Panel>

          <Panel title="Crypto" subtitle="24/7" provenance={d.crypto[0]?.provenance} source={d.crypto[0]?.source}>
            <TickerTable rows={d.crypto} showRsi={false} compact />
          </Panel>

          <Panel title="Commodities" provenance={d.commodities[0]?.provenance}>
            <TickerTable rows={d.commodities} showRsi={false} compact />
          </Panel>

          <Panel title="FX & Rates" provenance={d.fx[0]?.provenance}>
            <TickerTable rows={[...d.fx, ...d.rates]} showRsi={false} compact />
          </Panel>
        </div>

        {/* ================= CENTRE ================= */}
        <div className="xl:col-span-6 flex flex-col gap-2">
          <Panel
            title="Opening session playbook"
            subtitle={fmtTime(d.asOf)}
            accent
            provenance={d.anySimulated ? 'simulated' : 'derived'}
          >
            <div className="p-3">
              <p className="text-[12.5px] leading-relaxed text-ink mb-3 pb-3 border-b border-hairline">
                {d.playbook.headline}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                {d.playbook.bullets.map((b) => (
                  <div key={b.label} className="flex gap-2.5">
                    <div
                      className="w-0.5 shrink-0 mt-0.5"
                      style={{
                        background:
                          b.tone === 'long' ? 'var(--color-long)'
                          : b.tone === 'short' ? 'var(--color-short)'
                          : b.tone === 'warn' ? 'var(--color-amber)'
                          : 'var(--color-hairline-bright)',
                      }}
                    />
                    <div className="min-w-0">
                      <div className="label mb-1">{b.label}</div>
                      <p className="text-[11px] leading-[1.55] text-ink-2">{b.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Panel>

          <Panel
            title="Top 10 equities & ETFs"
            subtitle="ranked by conviction × reward-to-risk"
            provenance={d.ideas.equities[0]?.provenance}
          >
            <IdeaTable ideas={d.ideas.equities} />
          </Panel>

          <Panel title="Top 10 crypto" provenance={d.ideas.crypto[0]?.provenance}>
            <IdeaTable ideas={d.ideas.crypto} />
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            <Panel title="Top indexes & sectors" provenance={d.ideas.indexes[0]?.provenance}>
              <IdeaTable ideas={d.ideas.indexes.slice(0, 10)} />
            </Panel>
            <Panel title="Top commodities" provenance={d.ideas.commodities[0]?.provenance}>
              <IdeaTable ideas={d.ideas.commodities.slice(0, 10)} />
            </Panel>
          </div>
        </div>

        {/* ================= RIGHT RAIL ================= */}
        <div className="xl:col-span-3 flex flex-col gap-2">
          <VixPanel vix={d.vix} />
          <StressPanel stress={d.stress} />
          <BreadthPanel breadth={d.breadth} />
          <SectorPanel sectors={d.sectors} />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function Tape({ rows }: { rows: { symbol: string; price: number; changePct: number }[] }) {
  if (!rows.length) return null;
  // Duplicated so the marquee loops seamlessly at -50% translation.
  const doubled = [...rows, ...rows];
  return (
    <div className="h-7 border-b border-hairline bg-terminal overflow-hidden relative">
      <div className="tape-track h-7 items-center">
        {doubled.map((r, i) => (
          <Link
            key={`${r.symbol}-${i}`}
            href={`/ticker/${encodeURIComponent(r.symbol)}`}
            className="flex items-baseline gap-2 px-3.5 border-r border-hairline h-7 hover:bg-panel transition-colors shrink-0"
          >
            <span className="num text-[10.5px] font-bold text-ink-2">{r.symbol}</span>
            <span className="num text-[10.5px] text-ink">{fmtPrice(r.price)}</span>
            <span className={`num text-[10px] ${r.changePct >= 0 ? 'text-long' : 'text-short'}`}>
              {fmtPct(r.changePct)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SimulationBanner() {
  return (
    <div className="border-b border-amber/30 bg-amber/[0.07] px-3 py-2 flex items-start gap-2.5">
      <span className="live-dot sim mt-1" />
      <div className="min-w-0">
        <div className="label text-amber mb-0.5">SIMULATED DATA MODE</div>
        <p className="text-[11px] text-ink-2 leading-relaxed">
          No market data provider is reachable from this environment, so every price on this
          screen is produced by the deterministic simulator. The analytics, signal engine and
          backtester are running for real against that synthetic series — but these are not
          market prices, and nothing here is a tradeable signal.{' '}
          <span className="text-ink-3">
            Add an API key to <span className="num text-amber/80">.env.local</span> or run where
            outbound HTTPS to a data vendor is permitted, and every SIM badge flips to LIVE.
          </span>
        </p>
      </div>
    </div>
  );
}

function VixPanel({ vix }: { vix: import('@/lib/vol').VixComplex }) {
  const meta = VOL_REGIME_META[vix.regime];
  const colour = `var(--color-${meta.colour === 'ink' ? 'ink-2' : meta.colour})`;

  return (
    <Panel title="Volatility complex" provenance={vix.provenance} accent>
      <div className="p-3">
        <div className="flex items-end justify-between mb-3">
          <div>
            <div className="num text-3xl font-bold leading-none" style={{ color: colour }}>
              {fmtNum(vix.vix, 2)}
            </div>
            <div className={`num text-[11px] mt-1 ${vix.vixChangePct >= 0 ? 'text-short' : 'text-long'}`}>
              {fmtPct(vix.vixChangePct)} today
            </div>
          </div>
          <div className="text-right">
            <div
              className="px-2 py-1 text-[9px] font-bold tracking-[0.13em] border"
              style={{ color: colour, borderColor: colour, background: `color-mix(in srgb, ${colour} 10%, transparent)` }}
            >
              {meta.label}
            </div>
            <div className="label-xs mt-1.5">
              {Number.isFinite(vix.vixPercentile) ? `${(vix.vixPercentile * 100).toFixed(0)}TH PCTILE 1Y` : ''}
            </div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 mb-3 pb-3 border-b border-hairline">
          <Stat label="VIX9D" value={fmtNum(vix.vix9d, 2)} />
          <Stat label="VIX3M" value={fmtNum(vix.vix3m, 2)} />
          <Stat
            label="30D/3M"
            value={fmtNum(vix.ratio30d3m, 3)}
            tone={vix.ratio30d3m > 1 ? 'short' : 'long'}
          />
          <Stat label="TERM" value={vix.term.replace('_', ' ').toUpperCase()} small />
          <Stat label="REALISED 21D" value={Number.isFinite(vix.realised21d) ? `${vix.realised21d.toFixed(1)}%` : '—'} />
          <Stat
            label="VOL RISK PREM"
            value={Number.isFinite(vix.vrp) ? `${vix.vrp >= 0 ? '+' : ''}${vix.vrp.toFixed(1)}` : '—'}
            tone={vix.vrp > 0 ? 'long' : 'short'}
          />
        </dl>

        <p className="text-[10.5px] leading-[1.6] text-ink-2">{vix.tradingImplication}</p>
      </div>
    </Panel>
  );
}

function StressPanel({ stress }: { stress: import('@/lib/vol').StressGauge }) {
  const colour =
    stress.state === 'risk_on' ? 'var(--color-long)'
    : stress.state === 'neutral' ? 'var(--color-ink-2)'
    : stress.state === 'risk_off' ? 'var(--color-amber)'
    : 'var(--color-short)';

  return (
    <Panel title="Cross-asset stress" provenance="derived">
      <div className="p-3">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="num text-2xl font-bold" style={{ color: colour }}>
            {stress.level.toFixed(0)}
          </span>
          <span className="label" style={{ color: colour }}>
            {stress.state.replace('_', ' ')}
          </span>
        </div>
        <Meter value={stress.level} width={999} height={5} colour={colour} />

        <div className="mt-3 space-y-1.5">
          {stress.components.map((c) => (
            <div key={c.name} className="flex items-center gap-2">
              <span className="label-xs w-[104px] shrink-0 truncate">{c.name}</span>
              <div className="flex-1 min-w-0">
                <Meter value={c.contribution} width={999} height={3} colour="var(--color-ink-3)" />
              </div>
              <span className="num text-[9.5px] text-ink-3 w-12 text-right shrink-0">{c.note}</span>
            </div>
          ))}
        </div>

        <p className="text-[10.5px] leading-[1.6] text-ink-2 mt-3 pt-3 border-t border-hairline">
          {stress.note}
        </p>
      </div>
    </Panel>
  );
}

function BreadthPanel({ breadth }: { breadth: import('@/lib/market/cockpit').Breadth }) {
  return (
    <Panel title="Market breadth" subtitle="40-name sample" provenance="derived">
      <div className="p-3">
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="label mb-1">ABOVE 50DMA</div>
            <div className="num text-xl font-bold text-ink">
              {Number.isFinite(breadth.above50) ? `${breadth.above50.toFixed(0)}%` : '—'}
            </div>
            <Meter
              value={breadth.above50}
              width={999} height={4}
              colour={breadth.above50 > 55 ? 'var(--color-long)' : breadth.above50 > 35 ? 'var(--color-amber)' : 'var(--color-short)'}
            />
          </div>
          <div>
            <div className="label mb-1">ABOVE 200DMA</div>
            <div className="num text-xl font-bold text-ink">
              {Number.isFinite(breadth.above200) ? `${breadth.above200.toFixed(0)}%` : '—'}
            </div>
            <Meter
              value={breadth.above200}
              width={999} height={4}
              colour={breadth.above200 > 55 ? 'var(--color-long)' : breadth.above200 > 35 ? 'var(--color-amber)' : 'var(--color-short)'}
            />
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-2 pb-3 mb-3 border-b border-hairline">
          <Stat label="ADVANCE" value={String(breadth.advancers)} tone="long" />
          <Stat label="DECLINE" value={String(breadth.decliners)} tone="short" />
          <Stat
            label="NET HI-LO"
            value={`${breadth.netNewHighs >= 0 ? '+' : ''}${breadth.netNewHighs}`}
            tone={breadth.netNewHighs >= 0 ? 'long' : 'short'}
          />
        </dl>

        <p className="text-[10.5px] leading-[1.6] text-ink-2">{breadth.note}</p>
      </div>
    </Panel>
  );
}

function SectorPanel({ sectors }: { sectors: import('@/lib/market/cockpit').SectorRow[] }) {
  if (!sectors.length) return null;
  const maxAbs = Math.max(...sectors.map((s) => Math.abs(s.relative20)), 1);

  return (
    <Panel title="Sector rotation" subtitle="20d vs SPY" provenance={sectors[0]?.provenance}>
      <div className="p-2 space-y-[3px]">
        {sectors.map((s) => {
          const pos = s.relative20 >= 0;
          const w = (Math.abs(s.relative20) / maxAbs) * 50;
          return (
            <Link
              key={s.symbol}
              href={`/ticker/${encodeURIComponent(s.symbol)}`}
              className="flex items-center gap-2 px-1 py-[3px] hover:bg-raised transition-colors group"
            >
              <span className="num text-[10px] font-bold text-ink-2 w-9 shrink-0 group-hover:text-amber transition-colors">
                {s.symbol}
              </span>
              <span className="text-[9.5px] text-ink-3 flex-1 truncate hidden 2xl:block">{s.name}</span>
              <div className="flex-1 flex items-center h-3 min-w-[70px]">
                <div className="w-1/2 flex justify-end h-full items-center">
                  {!pos && <div className="h-2 bg-short/70" style={{ width: `${w * 2}%` }} />}
                </div>
                <div className="w-px h-3 bg-hairline-bright shrink-0" />
                <div className="w-1/2 h-full flex items-center">
                  {pos && <div className="h-2 bg-long/70" style={{ width: `${w * 2}%` }} />}
                </div>
              </div>
              <span className={`num text-[10px] w-12 text-right shrink-0 ${pos ? 'text-long' : 'text-short'}`}>
                {fmtPct(s.relative20, 1)}
              </span>
            </Link>
          );
        })}
      </div>
    </Panel>
  );
}

function Stat({
  label, value, tone, small = false,
}: { label: string; value: string; tone?: 'long' | 'short'; small?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="label-xs mb-0.5 truncate">{label}</dt>
      <dd className={`num ${small ? 'text-[10px]' : 'text-[12px]'} font-semibold truncate ${
        tone === 'long' ? 'text-long' : tone === 'short' ? 'text-short' : 'text-ink'
      }`}>
        {value}
      </dd>
    </div>
  );
}
