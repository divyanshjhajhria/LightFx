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

  send(from: BodyId, to: BodyId, payload: Payload, now: number): boolean {
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
    });
    return true;
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
