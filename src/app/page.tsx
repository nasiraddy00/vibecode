import { buildCockpit } from '@/lib/market/cockpit';
import { MarketCockpit } from '@/components/MarketCockpit';

// The cockpit runs the full engine across ~90 instruments. Cache the render
// for a minute so a page refresh is instant and providers are not hammered.
export const revalidate = 60;

export default async function HomePage() {
  const d = await buildCockpit();
  return <MarketCockpit d={{ ...d, build: 'server' }} />;
}
