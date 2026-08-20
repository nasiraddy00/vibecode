/* Status strip for the standalone build.

   The server build reports live feed health. In the browser there are no feeds
   at all — the whole terminal runs on the simulator — so rather than render a
   row of grey dots that implies feeds exist but are down, this states the one
   fact that matters and points at the repository for the live version. */
export function StatusStrip() {
  return (
    <footer className="h-6 border-t border-hairline bg-terminal flex items-center px-3 gap-3 shrink-0 overflow-x-auto no-scrollbar">
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="live-dot sim" />
        <span className="label-xs text-amber">SIMULATED DATA</span>
      </div>
      <div className="h-3 w-px bg-hairline shrink-0" />
      <span className="label-xs shrink-0 whitespace-nowrap">
        BROWSER BUILD · ENGINE RUNS LOCALLY · NO MARKET FEED ATTACHED
      </span>
      <div className="flex-1 min-w-4" />
      <a
        href="https://github.com/nasiraddy00/vibecode/tree/claude/day-trading-signal-website-zcyeeg"
        target="_blank"
        rel="noopener noreferrer"
        className="label-xs text-ink-3 hover:text-amber transition-colors shrink-0 whitespace-nowrap"
      >
        RUN LOCALLY FOR LIVE FEEDS →
      </a>
    </footer>
  );
}
