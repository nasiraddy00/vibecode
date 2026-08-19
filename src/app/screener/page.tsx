import { runScreener } from '@/lib/market/screener';
import { ScreenerClient } from './ScreenerClient';
import { Panel } from '@/components/Panel';

export const metadata = { title: 'Screener — Meridian Terminal' };
export const revalidate = 120;

export default async function ScreenerPage() {
  const rows = await runScreener();
  const anySim = rows.some((r) => r.provenance === 'simulated');

  return (
    <div className="p-2">
      <Panel
        title="Screener"
        subtitle={`${rows.length} instruments · full engine run on every name`}
        provenance={anySim ? 'simulated' : 'live'}
        accent
      >
        <ScreenerClient rows={rows} />
      </Panel>
    </div>
  );
}
