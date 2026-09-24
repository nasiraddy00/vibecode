import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { buildTradeCall } from '@/lib/market/trade';
import { TradeVerdict } from '@/components/TradeVerdict';

export const revalidate = 45;

export async function generateMetadata(
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Metadata> {
  const { symbol } = await params;
  return { title: `${decodeURIComponent(symbol).toUpperCase()} trade call — Meridian Terminal` };
}

export default async function TradePage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const v = await buildTradeCall(decodeURIComponent(symbol));
  if (!v) notFound();

  return <TradeVerdict v={v} />;
}
