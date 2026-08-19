import { NextResponse } from 'next/server';
import { getQuotes } from '@/lib/providers';

export const dynamic = 'force-dynamic';

/** Batch quote endpoint for client components (the paper blotter marks its
 *  positions against it). Symbols resolve against the instrument universe
 *  inside getQuotes, so an unknown symbol is dropped rather than proxied on. */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('symbols') ?? '';
  const symbols = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40);

  if (!symbols.length) return NextResponse.json({ quotes: {}, provenance: {} });

  const quotes = await getQuotes(symbols, 6);
  const prices: Record<string, number> = {};
  const provenance: Record<string, string> = {};
  for (const q of quotes) {
    prices[q.symbol] = q.price;
    provenance[q.symbol] = q.provenance;
  }

  return NextResponse.json({ quotes: prices, provenance });
}
