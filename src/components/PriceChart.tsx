import type { Bar } from '@/lib/types';

interface Overlay {
  data: readonly number[];
  colour: string;
  label: string;
  dash?: string;
  width?: number;
}

interface Marker { price: number; label: string; colour: string; dash?: boolean; }

/** Candlestick chart with volume, moving-average overlays and level markers.
 *  Hand-rolled SVG: no charting dependency, renders on the server, and gives
 *  exact control over the terminal aesthetic. */
export function PriceChart({
  bars, width = 900, height = 320, overlays = [], markers = [],
  showVolume = true, maxBars = 180,
}: {
  bars: readonly Bar[];
  width?: number;
  height?: number;
  overlays?: Overlay[];
  markers?: Marker[];
  showVolume?: boolean;
  maxBars?: number;
}) {
  const slice = bars.slice(-maxBars);
  if (slice.length < 2) {
    return (
      <div className="flex items-center justify-center h-40 label">Insufficient data</div>
    );
  }

  const offset = bars.length - slice.length;
  const volH = showVolume ? Math.round(height * 0.18) : 0;
  const priceH = height - volH - 18;
  const padL = 0;
  const padR = 58;
  const plotW = width - padL - padR;

  // Price range includes any overlay and marker so nothing clips.
  let lo = Math.min(...slice.map((b) => b.l));
  let hi = Math.max(...slice.map((b) => b.h));
  for (const o of overlays) {
    const seg = o.data.slice(offset).filter(Number.isFinite);
    if (seg.length) {
      lo = Math.min(lo, Math.min(...seg));
      hi = Math.max(hi, Math.max(...seg));
    }
  }
  for (const m of markers) {
    if (Number.isFinite(m.price)) {
      lo = Math.min(lo, m.price);
      hi = Math.max(hi, m.price);
    }
  }
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad;
  hi += pad;
  const span = hi - lo || 1;

  const x = (i: number): number => padL + (i / (slice.length - 1)) * plotW;
  const y = (p: number): number => ((hi - p) / span) * priceH;
  const candleW = Math.max(1.2, (plotW / slice.length) * 0.62);

  const maxVol = Math.max(...slice.map((b) => b.v)) || 1;
  const vy = (v: number): number => volH - (v / maxVol) * volH;

  // Gridlines at five price levels.
  const grid = Array.from({ length: 5 }, (_, i) => lo + (span * (i + 0.5)) / 5);

  return (
    <svg
      width="100%" height={height} viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none" className="block"
    >
      {/* --- price gridlines + axis labels --- */}
      {grid.map((g, i) => (
        <g key={i}>
          <line x1={0} y1={y(g)} x2={width - padR} y2={y(g)} stroke="var(--color-grid)" strokeWidth="1" />
          <text
            x={width - padR + 5} y={y(g) + 3}
            fontSize="9" className="num" fill="var(--color-ink-3)"
          >
            {formatAxis(g)}
          </text>
        </g>
      ))}

      {/* --- level markers --- */}
      {markers.filter((m) => Number.isFinite(m.price) && m.price >= lo && m.price <= hi).map((m, i) => (
        <g key={i}>
          <line
            x1={0} y1={y(m.price)} x2={width - padR} y2={y(m.price)}
            stroke={m.colour} strokeWidth="1" strokeDasharray={m.dash === false ? undefined : '3 3'}
            opacity="0.75"
          />
          <rect
            x={width - padR + 1} y={y(m.price) - 7}
            width={padR - 2} height={14} fill={m.colour} opacity="0.18"
          />
          <text
            x={width - padR + 5} y={y(m.price) + 3}
            fontSize="8.5" className="num" fill={m.colour} fontWeight="600"
          >
            {m.label}
          </text>
        </g>
      ))}

      {/* --- candles --- */}
      {slice.map((b, i) => {
        const up = b.c >= b.o;
        const colour = up ? 'var(--color-long)' : 'var(--color-short)';
        const bodyTop = y(Math.max(b.o, b.c));
        const bodyBottom = y(Math.min(b.o, b.c));
        const bodyH = Math.max(0.8, bodyBottom - bodyTop);
        return (
          <g key={i}>
            <line
              x1={x(i)} y1={y(b.h)} x2={x(i)} y2={y(b.l)}
              stroke={colour} strokeWidth="1" opacity="0.85"
            />
            <rect
              x={x(i) - candleW / 2} y={bodyTop}
              width={candleW} height={bodyH}
              fill={up ? 'transparent' : colour}
              stroke={colour}
              strokeWidth={up ? 1 : 0}
              opacity={up ? 1 : 0.9}
            />
          </g>
        );
      })}

      {/* --- overlays --- */}
      {overlays.map((o, oi) => {
        const seg = o.data.slice(offset);
        const pts: string[] = [];
        let started = false;
        for (let i = 0; i < seg.length; i++) {
          if (!Number.isFinite(seg[i])) { started = false; continue; }
          pts.push(`${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(seg[i]).toFixed(1)}`);
          started = true;
        }
        return pts.length ? (
          <path
            key={oi} d={pts.join(' ')} fill="none"
            stroke={o.colour} strokeWidth={o.width ?? 1.2}
            strokeDasharray={o.dash} opacity="0.9"
            vectorEffect="non-scaling-stroke"
          />
        ) : null;
      })}

      {/* --- volume --- */}
      {showVolume && (
        <g transform={`translate(0, ${priceH + 16})`}>
          <line x1={0} y1={0} x2={width - padR} y2={0} stroke="var(--color-hairline)" strokeWidth="1" />
          {slice.map((b, i) => {
            const up = b.c >= b.o;
            return (
              <rect
                key={i}
                x={x(i) - candleW / 2} y={vy(b.v)}
                width={candleW} height={volH - vy(b.v)}
                fill={up ? 'var(--color-long)' : 'var(--color-short)'}
                opacity="0.32"
              />
            );
          })}
        </g>
      )}

      {/* --- overlay legend --- */}
      {overlays.length > 0 && (
        <g transform="translate(6, 12)">
          {overlays.map((o, i) => (
            <g key={i} transform={`translate(${i * 74}, 0)`}>
              <line x1={0} y1={-3} x2={12} y2={-3} stroke={o.colour} strokeWidth="1.5" strokeDasharray={o.dash} />
              <text x={16} y={0} fontSize="8" fill="var(--color-ink-3)" letterSpacing="0.06em">{o.label}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

function formatAxis(v: number): string {
  const a = Math.abs(v);
  if (a >= 10000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(4);
}

/** Equity curve with drawdown shading beneath. */
export function EquityChart({
  equity, benchmark, width = 900, height = 220, initial,
}: {
  equity: { time: number; value: number }[];
  benchmark?: { time: number; value: number }[];
  width?: number;
  height?: number;
  initial: number;
}) {
  if (equity.length < 2) return <div className="label p-4">No equity data</div>;

  const padR = 56;
  const plotW = width - padR;
  const all = [...equity.map((e) => e.value), ...(benchmark?.map((b) => b.value) ?? []), initial];
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const span = hi - lo || 1;

  const x = (i: number, n: number): number => (i / (n - 1)) * plotW;
  const y = (v: number): number => ((hi - v) / span) * height;

  const path = (pts: { value: number }[]): string =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i, pts.length).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');

  const equityPath = path(equity);
  const areaPath = `${equityPath} L${plotW},${height} L0,${height} Z`;

  // Running peak, for drawdown shading.
  let peak = -Infinity;
  const peaks = equity.map((e) => { peak = Math.max(peak, e.value); return peak; });
  const ddPath =
    equity.map((e, i) => `${i === 0 ? 'M' : 'L'}${x(i, equity.length).toFixed(1)},${y(peaks[i]).toFixed(1)}`).join(' ') +
    ' ' +
    equity.slice().reverse().map((e, ri) => {
      const i = equity.length - 1 - ri;
      return `L${x(i, equity.length).toFixed(1)},${y(e.value).toFixed(1)}`;
    }).join(' ') + ' Z';

  const final = equity[equity.length - 1].value;
  const up = final >= initial;

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="eqg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={up ? 'var(--color-long)' : 'var(--color-short)'} stopOpacity="0.22" />
          <stop offset="100%" stopColor={up ? 'var(--color-long)' : 'var(--color-short)'} stopOpacity="0" />
        </linearGradient>
      </defs>

      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={0} y1={height * f} x2={plotW} y2={height * f} stroke="var(--color-grid)" />
      ))}

      {/* starting capital reference */}
      <line
        x1={0} y1={y(initial)} x2={plotW} y2={y(initial)}
        stroke="var(--color-ink-4)" strokeWidth="1" strokeDasharray="4 3"
      />
      <text x={plotW + 4} y={y(initial) + 3} fontSize="8.5" className="num" fill="var(--color-ink-4)">
        {initial.toFixed(2)}
      </text>

      {/* drawdown shading */}
      <path d={ddPath} fill="var(--color-short)" opacity="0.10" />

      {benchmark && benchmark.length > 1 && (
        <path d={path(benchmark)} fill="none" stroke="var(--color-ink-4)" strokeWidth="1" strokeDasharray="3 3" />
      )}

      <path d={areaPath} fill="url(#eqg)" />
      <path
        d={equityPath} fill="none"
        stroke={up ? 'var(--color-long)' : 'var(--color-short)'}
        strokeWidth="1.6" vectorEffect="non-scaling-stroke"
      />

      <text
        x={plotW + 4} y={y(final) + 3} fontSize="9" className="num" fontWeight="700"
        fill={up ? 'var(--color-long)' : 'var(--color-short)'}
      >
        {final.toFixed(2)}
      </text>
    </svg>
  );
}
