import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { buildDossier } from '@/lib/market/dossier';
import { TickerDossier } from '@/components/TickerDossier';

export const revalidate = 45;

export async function generateMetadata(
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Metadata> {
  const { symbol } = await params;
  return { title: `${decodeURIComponent(symbol).toUpperCase()} — Meridian Terminal` };
}

export default async function TickerPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const d = await buildDossier(decodeURIComponent(symbol));
  if (!d) notFound();

  return <TickerDossier d={d} />;
}
