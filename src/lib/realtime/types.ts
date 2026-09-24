/* ===========================================================================
   Real-time tick model.
   ========================================================================= */

export interface Tick {
  symbol: string;
  price: number;
  /** Epoch ms of the trade or quote. */
  ts: number;
  /** Change against the session open or previous close, when the venue says. */
  change?: number;
  changePct?: number;
  /** Which venue produced it, for the provenance badge. */
  venue: string;
}

export type StreamState =
  | 'idle'
  | 'connecting'
  | 'live'          // a true push stream is open
  | 'polling'       // streaming unavailable; periodic REST instead
  | 'reconnecting'
  | 'unavailable';  // no transport and no key — the UI must say so

export interface StreamStatus {
  state: StreamState;
  venue: string | null;
  /** Epoch ms of the last tick received. */
  lastTickAt: number | null;
  /** Human-readable reason, shown when the state is degraded. */
  detail: string;
  attempts: number;
}

export const IDLE_STATUS: StreamStatus = {
  state: 'idle', venue: null, lastTickAt: null, detail: '', attempts: 0,
};
