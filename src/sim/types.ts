// Shared types. Agree changes to this file as a team: everything else depends on it.

export type BodyId = 'earth' | 'moon' | 'mars';
export const BODIES: readonly BodyId[] = ['earth', 'moon', 'mars'];

export type StrategyId = 'leased' | 'naive' | 'central';
export const STRATEGIES: readonly StrategyId[] = ['leased', 'naive', 'central'];

/** normal: all peers fresh. degraded: some peers silent. reduce-only: lease expired. halted: waiting on head office. */
export type Mode = 'normal' | 'degraded' | 'reduce-only' | 'halted';

export type PerBody<T> = Record<BodyId, T>;
export function perBody<T>(f: (b: BodyId) => T): PerBody<T> {
  return { earth: f('earth'), moon: f('moon'), mars: f('mars') };
}

// ---- Messages -------------------------------------------------------------

/** Public market data: one price component, stamped with when it left its origin. */
export interface NewsMsg {
  kind: 'news';
  origin: BodyId;
  at: number;
  value: number;
}

/** Desk-to-desk state for the leased and naive strategies. */
export interface GossipMsg {
  kind: 'gossip';
  from: BodyId;
  seq: number;
  sentAt: number;
  pos: number;
  free: number;
  /** Cumulative budget this desk has granted to each peer. Merged with max(), so repeats and losses are harmless. */
  sentRow: PerBody<number>;
}

/** Central strategy: remote desk asks head office to approve a trade. */
export interface RfqMsg {
  kind: 'rfq';
  from: BodyId;
  id: string;
  delta: number;
}
export interface ApproveMsg {
  kind: 'approve';
  id: string;
}
export interface ConfirmMsg {
  kind: 'confirm';
  id: string;
  filled: boolean;
}

export type Payload = NewsMsg | GossipMsg | RfqMsg | ApproveMsg | ConfirmMsg;

export interface Envelope {
  id: number;
  from: BodyId;
  to: BodyId;
  sentAt: number;
  deliverAt: number;
  payload: Payload;
}

// ---- Market ---------------------------------------------------------------

export interface Customer {
  id: number;
  at: BodyId;
  /** 'buy' = customer buys Mars credits from the desk (desk position goes down). */
  side: 'buy' | 'sell';
  size: number;
  /** Worst price the customer accepts, as a fraction away from the local fair price. */
  tol: number;
  /** Minutes the customer will wait for a fill. */
  patience: number;
  arrivedAt: number;
}

export interface Quote {
  bid: number;
  ask: number;
}

// ---- Views for the UI -----------------------------------------------------

export interface DeskView {
  id: BodyId;
  pos: number;
  budget: number | null;
  mode: Mode;
  bid: number | null;
  ask: number | null;
  halfSpreadBps: number | null;
  pnl: number;
  volFilled: number;
  /** Minutes until the desk goes reduce-only if it hears nothing more. Null for strategies without leases. */
  leaseLeft: number | null;
}

export interface LinkView {
  a: BodyId;
  b: BodyId;
  delayMin: number;
  open: boolean;
}

export interface Metrics {
  breachTicks: number;
  maxAbsTotal: number;
  arrived: number;
  volRequested: number;
  served: number;
  volFilled: number;
  dropped: number;
}
