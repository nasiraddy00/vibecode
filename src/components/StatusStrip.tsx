import { providerStatus } from '@/lib/providers';

/** Bottom status strip. Always shows exactly which feeds are alive, because
 *  the single most dangerous state for a trading tool is looking authoritative
 *  while running on fallback data. */
export function StatusStrip() {
  const status = providerStatus();

  const modeMeta = {
    live: { label: 'LIVE DATA', colour: 'var(--color-long)', dot: '' },
    mixed: { label: 'PARTIAL FEEDS', colour: 'var(--color-ice)', dot: 'sim' },
    simulated: { label: 'SIMULATED DATA', colour: 'var(--color-amber)', dot: 'sim' },
    // Nothing has been asked of any feed yet in this process. That is not a
    // failure and must not be drawn as one; the per-panel provenance badges
    // are authoritative for what is actually on screen.
    unknown: { label: 'FEEDS IDLE', colour: 'var(--color-ink-3)', dot: 'cold' },
  }[status.mode] ?? { label: 'FEEDS IDLE', colour: 'var(--color-ink-3)', dot: 'cold' };

  return (
    <footer className="h-6 border-t border-hairline bg-terminal flex items-center px-3 gap-4 shrink-0 overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={`live-dot ${modeMeta.dot}`} />
        <span className="label-xs" style={{ color: modeMeta.colour }}>{modeMeta.label}</span>
      </div>

      <div className="h-3 w-px bg-hairline shrink-0" />

      <div className="flex items-center gap-3 shrink-0">
        {status.feeds.map((f) => (
          <div
            key={f.id}
            className="flex items-center gap-1 shrink-0"
            title={
              f.state === 'unconfigured'
                ? `${f.label}: no API key configured. Add one in .env.local to enable this feed.`
                : f.state === 'unknown'
                  ? `${f.label}: configured, not yet called in this process.`
                : f.lastError
                  ? `${f.label}: ${f.lastError}`
                  : `${f.label}: ${f.state}${f.avgLatencyMs ? ` (${f.avgLatencyMs.toFixed(0)}ms avg)` : ''}`
            }
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                background:
                  f.state === 'live' ? 'var(--color-long)'
                  : f.state === 'degraded' ? 'var(--color-amber)'
                  : f.state === 'unconfigured' || f.state === 'unknown' ? 'var(--color-ink-4)'
                  : 'var(--color-short)',
              }}
            />
            <span className="label-xs cursor-help">{f.label}</span>
          </div>
        ))}
      </div>

      <div className="flex-1 min-w-4" />

      {status.mode === 'simulated' && (
        <div className="label-xs text-amber shrink-0 whitespace-nowrap">
          NO LIVE FEED REACHABLE — FIGURES ARE SYNTHETIC, NOT MARKET DATA
        </div>
      )}
    </footer>
  );
}
