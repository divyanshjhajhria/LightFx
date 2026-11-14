// Things a desk itself did or saw, kept for its briefing. Recording them never changes what any desk decides.
import type { BodyId, Mode } from './types';

export type DeskEventDetail =
  | { kind: 'mode'; from: Mode; to: Mode }
  | { kind: 'refused'; reason: 'allowance' | 'playing-safe' | 'limit' }
  | { kind: 'handed-over'; to: BodyId; units: number }
  | { kind: 'took-on'; from: BodyId; units: number }
  | { kind: 'allowance-given'; to: BodyId; units: number }
  | { kind: 'allowance-received'; from: BodyId; units: number }
  | { kind: 'visitor-trade'; side: 'buy' | 'sell'; units: number; filled: number };

export type DeskEvent = { t: number } & DeskEventDetail;

/** What a desk knows of one peer: how long since its newest word, and the last position it reported. */
export interface PeerView {
  body: BodyId;
  heardMinAgo: number | null;
  lastKnownHolds: number | null;
}
