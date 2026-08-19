/** Inline SVG sparkline. No dependencies, no hydration cost, scales cleanly. */
export function Sparkline({
  data, width = 88, height = 24, className = '', showArea = true, strokeWidth = 1.25,
}: {
  data: readonly number[];
  width?: number;
  height?: number;
  className?: string;
  showArea?: boolean;
  strokeWidth?: number;
}) {
  const clean = data.filter(Number.isFinite);
  if (clean.length < 2) {
    return <svg width={width} height={height} className={className} aria-hidden="true" />;
  }

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const pad = 1.5;
  const usableH = height - pad * 2;

  const pts = clean.map((v, i) => {
    const x = (i / (clean.length - 1)) * width;
    const y = pad + usableH - ((v - min) / span) * usableH;
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;

  const rising = clean[clean.length - 1] >= clean[0];
  const colour = rising ? 'var(--color-long)' : 'var(--color-short)';
  const gradId = `sg-${rising ? 'u' : 'd'}`;

  return (
    <svg
      width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      className={className} preserveAspectRatio="none" aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity="0.30" />
          <stop offset="100%" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      {showArea && <path d={area} fill={`url(#${gradId})`} />}
      <path
        d={line} fill="none" stroke={colour}
        strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
