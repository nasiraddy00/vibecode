/** Semicircular conviction dial. The needle position encodes the score
 *  (-1 left to +1 right) and the arc fill encodes conviction. */
export function ConvictionGauge({
  score, conviction, size = 168,
}: { score: number; conviction: number; size?: number }) {
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = h - 8;
  const r = w / 2 - 16;

  // -1 -> 180deg (left), +1 -> 0deg (right)
  const clamped = Math.max(-1, Math.min(1, score));
  const angle = Math.PI * (1 - (clamped + 1) / 2);
  const nx = cx + Math.cos(angle) * (r - 6);
  const ny = cy - Math.sin(angle) * (r - 6);

  const arc = (from: number, to: number): string => {
    const a0 = Math.PI * (1 - from);
    const a1 = Math.PI * (1 - to);
    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy - Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy - Math.sin(a1) * r;
    return `M${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1}`;
  };

  const tone =
    conviction < 32 ? 'var(--color-flat)'
    : score > 0 ? 'var(--color-long)'
    : 'var(--color-short)';

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
      {/* zone bands */}
      <path d={arc(0, 0.3)} fill="none" stroke="var(--color-short-dim)" strokeWidth="7" strokeLinecap="butt" />
      <path d={arc(0.3, 0.42)} fill="none" stroke="#2a2016" strokeWidth="7" strokeLinecap="butt" />
      <path d={arc(0.42, 0.58)} fill="none" stroke="#1c222c" strokeWidth="7" strokeLinecap="butt" />
      <path d={arc(0.58, 0.7)} fill="none" stroke="#16301f" strokeWidth="7" strokeLinecap="butt" />
      <path d={arc(0.7, 1)} fill="none" stroke="var(--color-long-dim)" strokeWidth="7" strokeLinecap="butt" />

      {/* tick marks */}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => {
        const a = Math.PI * (1 - t);
        return (
          <line
            key={t}
            x1={cx + Math.cos(a) * (r + 5)} y1={cy - Math.sin(a) * (r + 5)}
            x2={cx + Math.cos(a) * (r + 9)} y2={cy - Math.sin(a) * (r + 9)}
            stroke="var(--color-ink-4)" strokeWidth="1"
          />
        );
      })}

      {/* needle */}
      <line
        x1={cx} y1={cy} x2={nx} y2={ny}
        stroke={tone} strokeWidth="2.5" strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="4" fill={tone} />
      <circle cx={cx} cy={cy} r="7" fill="none" stroke={tone} strokeOpacity="0.3" strokeWidth="1" />

      <text
        x={cx} y={cy - r * 0.42} textAnchor="middle"
        className="num" fontSize="26" fontWeight="700" fill={tone}
      >
        {conviction.toFixed(0)}
      </text>
      <text
        x={cx} y={cy - r * 0.42 + 13} textAnchor="middle"
        fontSize="7.5" letterSpacing="0.16em" fill="var(--color-ink-3)" fontWeight="600"
      >
        CONVICTION
      </text>

      <text x={10} y={h - 1} fontSize="7.5" fill="var(--color-short)" letterSpacing="0.1em" fontWeight="600">SHORT</text>
      <text x={w - 10} y={h - 1} textAnchor="end" fontSize="7.5" fill="var(--color-long)" letterSpacing="0.1em" fontWeight="600">LONG</text>
    </svg>
  );
}

/** Horizontal signed bar for score attribution. */
export function ScoreBar({
  score, width = 100, height = 8, showZero = true,
}: { score: number; width?: number; height?: number; showZero?: boolean }) {
  const s = Math.max(-1, Math.min(1, Number.isFinite(score) ? score : 0));
  const mid = width / 2;
  const len = Math.abs(s) * mid;
  const colour = s >= 0 ? 'var(--color-long)' : 'var(--color-short)';

  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <rect x="0" y={height / 2 - 1} width={width} height="2" fill="#161d27" />
      <rect
        x={s >= 0 ? mid : mid - len} y="0"
        width={Math.max(len, s === 0 ? 0 : 1)} height={height}
        fill={colour} opacity="0.85"
      />
      {showZero && <rect x={mid - 0.5} y="0" width="1" height={height} fill="var(--color-ink-4)" />}
    </svg>
  );
}

/** Horizontal 0-100 meter. */
export function Meter({
  value, width = 100, height = 6, colour = 'var(--color-amber)', track = '#161d27',
}: { value: number; width?: number; height?: number; colour?: string; track?: string }) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <svg width={width} height={height} className="shrink-0" aria-hidden="true">
      <rect x="0" y="0" width={width} height={height} fill={track} />
      <rect x="0" y="0" width={(v / 100) * width} height={height} fill={colour} />
    </svg>
  );
}
