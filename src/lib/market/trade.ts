/* ===========================================================================
   Trade-call assembly: everything the Trade view needs, in one pass.
   ========================================================================= */

import { buildDossier } from './dossier';
import { writeAnalystNote } from '../signals/analyst';
import type { TradeView } from '../../components/TradeVerdict';

export async function buildTradeCall(symbolRaw: string): Promise<TradeView | null> {
  const d = await buildDossier(symbolRaw);
  if (!d) return null;

  const note = writeAnalystNote({
    signal: d.signal,
    snapshot: d.snapshot,
    name: d.instrument.name,
    assetClass: d.instrument.assetClass,
    fundamentals: d.fundamentals,
    earnings: d.earnings,
    insider: d.insider,
    institutional: d.institutional,
    social: d.social,
    news: d.news,
    iv: d.iv,
    vix: d.vix,
    simulated: d.barsProvenance === 'simulated',
  });

  return {
    instrument: d.instrument,
    note,
    signal: d.signal,
    snapshot: d.snapshot,
    bars: d.bars,
    simulated: d.barsProvenance === 'simulated',
    source: d.barsSource,
  };
}
