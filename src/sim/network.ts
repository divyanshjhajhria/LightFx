import type { BodyId, Envelope, Payload } from './types';

/**
 * Every message in the simulation goes through here. A message is delayed by the light-travel
 * time at the moment it is sent, or dropped if the link is closed at that moment.
 * Senders are never told about a drop.
 */
export interface Drop {
  id: number;
  from: BodyId;
  to: BodyId;
  at: number;
  kind: Payload['kind'];
  /** Destroyed while travelling (its link closed under it), rather than refused at the sender. */
  inFlight?: true;
  /** How far along the link it had got, 0 to 1. Only for in-flight losses. */
  progress?: number;
}

export class DelayNetwork {
  inFlight: Envelope[] = [];
  dropped = 0;
  delivered = 0;
  /** The most recent drops, oldest first, for the view to animate. Ids only ever increase. */
  drops: Drop[] = [];
  private nextId = 1;

  constructor(
    private readonly linkOpen: (a: BodyId, b: BodyId) => boolean,
    private readonly delayMin: (a: BodyId, b: BodyId) => number,
  ) {}

  /** `trade` tags the envelope with the visitor trade whose news it carries; it changes nothing about delivery. */
  send(from: BodyId, to: BodyId, payload: Payload, now: number, trade?: number): boolean {
    if (!this.linkOpen(from, to)) {
      this.dropped++;
      this.drops.push({ id: this.dropped, from, to, at: now, kind: payload.kind });
      if (this.drops.length > 64) this.drops.shift();
      return false;
    }
    this.inFlight.push({
      id: this.nextId++,
      from,
      to,
      sentAt: now,
      deliverAt: now + this.delayMin(from, to),
      payload,
      trade,
    });
    return true;
  }

  /**
   * Destroy matching messages that are still travelling: each counts as dropped, and is recorded as a drop with how
   * far it had got. Returns what was removed. Senders are not told.
   */
  purge(match: (e: Envelope) => boolean, now: number): Envelope[] {
    const gone: Envelope[] = [];
    const rest: Envelope[] = [];
    for (const e of this.inFlight) (match(e) ? gone : rest).push(e);
    this.inFlight = rest;
    for (const e of gone) {
      this.dropped++;
      const span = e.deliverAt - e.sentAt;
      const progress = span > 0 ? Math.max(0, Math.min(1, (now - e.sentAt) / span)) : 1;
      this.drops.push({ id: this.dropped, from: e.from, to: e.to, at: now, kind: e.payload.kind, inFlight: true, progress });
    }
    while (this.drops.length > 64) this.drops.shift();
    return gone;
  }

  /** Remove and return everything due by `now`, in arrival order. */
  deliver(now: number): Envelope[] {
    const due: Envelope[] = [];
    const rest: Envelope[] = [];
    for (const e of this.inFlight) (e.deliverAt <= now ? due : rest).push(e);
    this.inFlight = rest;
    due.sort((x, y) => x.deliverAt - y.deliverAt || x.id - y.id);
    this.delivered += due.length;
    return due;
  }
}
