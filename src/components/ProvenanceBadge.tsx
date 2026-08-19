import type { Provenance } from '@/lib/types';

const META: Record<Provenance, { label: string; cls: string; title: string }> = {
  live: {
    label: 'LIVE',
    cls: 'text-long border-long/40 bg-long/10',
    title: 'Fetched from an upstream provider on this request.',
  },
  cached: {
    label: 'CACHE',
    cls: 'text-ice border-ice/40 bg-ice/10',
    title: 'Fetched recently from a live provider and served from cache.',
  },
  derived: {
    label: 'CALC',
    cls: 'text-ice border-ice/30 bg-ice/5',
    title: 'Computed from live or cached inputs.',
  },
  simulated: {
    label: 'SIM',
    cls: 'text-amber border-amber/50 bg-amber/10',
    title: 'SIMULATED DATA. No live provider was reachable. These are synthetic prices produced by the deterministic simulator — the analytics are real, the prices are not. Do not trade on this.',
  },
  stale: {
    label: 'STALE',
    cls: 'text-amber-deep border-amber-deep/40 bg-amber-deep/10',
    title: 'Upstream failed; showing the last known good value.',
  },
  missing: {
    label: 'N/A',
    cls: 'text-ink-4 border-hairline bg-transparent',
    title: 'No data available and no estimate offered.',
  },
};

export function ProvenanceBadge({
  provenance, source, className = '',
}: { provenance: Provenance; source?: string; className?: string }) {
  const m = META[provenance];
  return (
    <span
      title={source ? `${m.title}\nSource: ${source}` : m.title}
      className={`inline-flex items-center gap-1 px-1.5 py-[1px] border text-[8px] font-bold tracking-[0.14em] leading-none cursor-help ${m.cls} ${className}`}
    >
      {provenance === 'live' && <span className="live-dot" />}
      {provenance === 'simulated' && <span className="live-dot sim" />}
      {m.label}
    </span>
  );
}
