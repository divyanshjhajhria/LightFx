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
  /** Units this desk handed to the receiver since its last update. A label for the view only; the protocol never reads it. */
  handover?: number;
  /** Size of the sender's open offer to absorb the receiver's long position. A label for the view only. */
  openOffer?: number;
  /**
   * Netting state (leased strategy only). Full tables, sent every time, so a lost message is repaired by the next.
   * A receiver reads only the entries keyed by its own id; epochs make stale and repeated copies harmless.
   */
  netting?: {
    /** offers[peer]: "I will absorb up to `amount` units of long position from you; this is my offer `epoch` to you." */
    offers: PerBody<{ epoch: number; amount: number }>;
    /** replies[peer]: "For your offer `epoch` I handed over `given` units at `price`; that offer is now closed." */
    replies: PerBody<{ epoch: number; given: number; price: number }>;
  };
}

/** Central strategy: remote desk asks head office to approve a trade. */
export interface RfqMsg {
  kind: 'rfq';
  from: BodyId;
  id: string;
  delta: number;
  /** The visitor trade this request is for, so the story can follow it. */
  trade?: number;
}
export interface ApproveMsg {
  kind: 'approve';
  id: string;
  trade?: number;
}
export interface ConfirmMsg {
  kind: 'confirm';
  id: string;
  filled: boolean;
  trade?: number;
}

export type Payload = NewsMsg | GossipMsg | RfqMsg | ApproveMsg | ConfirmMsg;

export interface Envelope {
  id: number;
  from: BodyId;
  to: BodyId;
  sentAt: number;
  deliverAt: number;
  payload: Payload;
  /** The visitor trade whose news this message carries, if any. Set by World for the story; desks never see it. */
  trade?: number;
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
  /** A person using the app, not the background stream. */
  visitor?: true;
  /** The visitor trade this customer represents. */
  trade?: number;
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
  /** Customers this desk has traded with. */
  served: number;
  /** Minutes until the desk goes reduce-only if it hears nothing more. Null for strategies without leases. */
  leaseLeft: number | null;
  /** Units this desk has netted with its peers, handed over plus taken in. Always 0 for strategies without netting. */
  netted: number;
  /** What this desk believes the bank holds in total, as a range; null if it keeps no such figure. */
  believed: { low: number; high: number } | null;
  /** Why it is playing safe: the rule (out of touch too long), its agent's choice, or not at all. */
  playingSafeBy: 'rule' | 'choice' | null;
  /** What is making this desk's judgment calls right now. Only our bank's desks are ever agent-run. */
  runBy: RunBy;
}

/** 'rules (agent silent)': handed to an agent that has not spoken lately, so the desk is on its rules in full. */
export type RunBy = 'rules' | 'model' | 'replay' | 'stand-in' | 'rules (agent silent)';

export interface LinkView {
  a: BodyId;
  b: BodyId;
  delayMin: number;
  open: boolean;
  /** Cut by hand. A cut link is also closed; a closed link need not be cut. */
  cut: boolean;
}

export interface Metrics {
  breachTicks: number;
  maxAbsTotal: number;
  arrived: number;
  volRequested: number;
  served: number;
  volFilled: number;
  dropped: number;
  /** Units of position netted between desks so far (counted when the receiving desk applies them). */
  nettedUnits: number;
}
