// The story of one visitor trade at one bank: what happened, where and when, in order.
import type { BodyId } from './types';

/** One step of the story, without the time and place World stamps on it. */
export type TraceDetail =
  | { kind: 'placed'; side: 'buy' | 'sell'; size: number }
  | {
      kind: 'filled';
      units: number;
      of: number;
      price: number;
      /** The leased desk's spare allowance after the fill; null for other strategies. */
      allowanceLeft: number | null;
      /** Minutes the visitor waited for the answer. */
      waited: number;
    }
  | { kind: 'refused'; reason: 'allowance' | 'playing-safe' | 'limit' }
  | { kind: 'asked-earth'; landsAt: number }
  | { kind: 'earth-approved'; landsAt: number }
  | { kind: 'earth-declined' }
  | { kind: 'too-late'; waited: number }
  | { kind: 'gave-up'; waited: number }
  | { kind: 'told'; to: BodyId; landsAt: number }
  | { kind: 'not-delivered'; to: BodyId }
  /** A message carrying the trade's news was travelling when its link closed, and was lost in space. */
  | { kind: 'destroyed'; to: BodyId }
  | { kind: 'heard'; from: BodyId };

export type TraceEvent = { t: number; body: BodyId } & TraceDetail;

export type RefusalReason = 'allowance' | 'playing-safe' | 'limit';
