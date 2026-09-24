import { NextResponse } from 'next/server';
import { searchAll } from '@/lib/market/resolve';

export const dynamic = 'force-dynamic';

/** Symbol search for the command bar.
 *
 *  Curated instruments answer instantly from memory; vendor lookups top the
 *  list up so the bar reaches any listed security. The route never fails the
 *  request on a dead vendor — it degrades to the curated matches, and the
 *  client already has those, so a blocked network costs nothing but reach. */
export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get('q') ?? '').trim().slice(0, 64);
  const limit = Math.min(25, Math.max(1, Number(searchParams.get('limit')) || 12));

  if (!q) return NextResponse.json({ hits: [] });

  try {
    const hits = await searchAll(q, limit);
    return NextResponse.json({ hits });
  } catch {
    return NextResponse.json({ hits: [] });
  }
}
