import type { SimConfig } from './config';
import type { RefusalReason, TraceDetail } from './trace';
import { BODIES, perBody } from './types';
import type { BodyId, Customer, Mode, Payload, PerBody, Quote, StrategyId } from './types';

/** What a desk can see at its own location, plus a way to send messages. */
export interface DeskCtx {
  now: number;
  /** Local fair price: fresh for locally sourced news, light-delayed for remote news. */
  fair: number;
  /** Variance of the price move the desk cannot see yet: sum over remote components of sigma^2 * info age. */
  gapVar: number;
  send(to: BodyId, p: Payload): void;
  /**
   * Tell the story of a visitor trade (World stamps the time and place). Only for customers with a `trade` id.
   * Returns nothing, and a desk must never let what it reports change what it decides.
   */
  report?(trade: number, e: TraceDetail): void;
}

export interface Desk {
  readonly id: BodyId;
  /** Signed position in Mars credits. */
  pos: number;
  /** Dollars. */
  cash: number;
  served: number;
  volFilled: number;
  mode(now: number): Mode;
  /** Standing two-way price, or null if the desk does not quote instantly. */
  quote(ctx: DeskCtx): Quote | null;
  /** Largest size (<= size) the desk will take in direction `dir` (+1 = desk buys). */
  maxFill(dir: 1 | -1, size: number, ctx: DeskCtx): number;
  applyFill(delta: number, price: number): void;
  /** Return true to take over handling of this customer (used by the central strategy). */
  onCustomer?(c: Customer, ctx: DeskCtx): boolean;
  onMessage(p: Payload, ctx: DeskCtx): void;
  tick(ctx: DeskCtx): void;
  /** Local risk budget, or null if the strategy has none. */
  budget(): number | null;
  /** Age in minutes of the newest word from any peer, or null if the strategy does not track it. */
  heardAgo(now: number): number | null;
  /** Netting read-out: units held back for open offers, and cumulative units and cash handed out and taken in. */
  netting(): NettingStats;
  /** Why maxFill would turn down a trade in direction `dir`. Only for explaining; never used to decide. */
  refusalReason(dir: 1 | -1, ctx: DeskCtx): RefusalReason;
  /** What this desk believes the bank holds in total, or null if it keeps no such figure. */
  believedTotal(): { low: number; high: number } | null;
  /** A visitor has walked away. Only a desk still holding that customer does anything. */
  cancelVisitor?(trade: number, ctx: DeskCtx): void;
}

export interface NettingStats {
  reserved: number;
  outUnits: number;
  outCash: number;
  inUnits: number;
  inCash: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

abstract class BaseDesk implements Desk {
  pos = 0;
  cash = 0;
  served = 0;
  volFilled = 0;

  constructor(
    readonly id: BodyId,
    protected readonly cfg: SimConfig,
  ) {}

  protected get peers(): BodyId[] {
    return BODIES.filter((b) => b !== this.id);
  }

  applyFill(delta: number, price: number): void {
    this.pos += delta;
    this.cash -= delta * price;
    this.served++;
    this.volFilled += Math.abs(delta);
  }

  heardAgo(_now: number): number | null {
    return null;
  }

  netting(): NettingStats {
    return { reserved: 0, outUnits: 0, outCash: 0, inUnits: 0, inCash: 0 };
  }

  refusalReason(_dir: 1 | -1, _ctx: DeskCtx): RefusalReason {
    return 'limit';
  }

  abstract believedTotal(): { low: number; high: number } | null;

  /** Two-way price around `fair`, shifted against inventory so the desk attracts trades that flatten it. */
  protected makeQuote(fair: number, halfSpread: number, skewScale: number): Quote {
    const skew = this.cfg.skewK * clamp(this.pos / Math.max(skewScale, 1), -1, 1) * halfSpread;
    const mid = fair * (1 - skew);
    return { bid: mid * (1 - halfSpread), ask: mid * (1 + halfSpread) };
  }

  abstract mode(now: number): Mode;
  abstract quote(ctx: DeskCtx): Quote | null;
  abstract maxFill(dir: 1 | -1, size: number, ctx: DeskCtx): number;
  abstract onMessage(p: Payload, ctx: DeskCtx): void;
  abstract tick(ctx: DeskCtx): void;
  abstract budget(): number | null;
}

/**
 * OUR STRATEGY. Each desk owns a slice of the bank's limit and only ever spends its own slice,
 * so the bank-wide limit holds with no communication at all.
 *
 * Budget moves between desks as a state-based counter: each desk gossips the cumulative amount it
 * has granted to every peer, and receivers merge with max(). A desk's view of what it has been
 * granted can lag the truth but never exceed it, so the sum of budgets never exceeds the limit,
 * whatever is delayed, repeated or lost.
 *
 * Netting: a short desk offers to absorb long position from a long peer (offer, epoch-numbered),
 * and the long desk hands units over and replies once per epoch. The short desk reserves room for
 * the whole offer until it applies the reply, so units in flight are always covered by the
 * receiver's budget. Every desk keeps -B <= pos and pos + reserved <= B, where B = floor(budget).
 */
export class LeasedDesk extends BaseDesk {
  private readonly base: number;
  private readonly sent: PerBody<number> = perBody(() => 0);
  private readonly recv: PerBody<number> = perBody(() => 0);
  private readonly peerInfo: PerBody<{ seq: number; sentAt: number; free: number; pos: number }>;
  private readonly lastGrantAt: PerBody<number> = perBody(() => -Infinity);
  private seq = 0;
  private nextGossipAt = 0;

  // Netting, per peer. An offer to a peer is open while myOffer[peer].epoch > applied[peer].
  private readonly myOffer: PerBody<{ epoch: number; amount: number }> = perBody(() => ({ epoch: 0, amount: 0 }));
  private readonly applied: PerBody<number> = perBody(() => 0);
  private readonly myReply: PerBody<{ epoch: number; given: number; price: number }> = perBody(() => ({
    epoch: 0,
    given: 0,
    price: 0,
  }));
  /** Units handed to each peer and not yet labelled on an outgoing message. For drawing only: never read by the protocol. */
  private readonly handoverLabel: PerBody<number> = perBody(() => 0);
  private nettedOutUnits = 0;
  private nettedOutCash = 0;
  private nettedInUnits = 0;
  private nettedInCash = 0;

  constructor(id: BodyId, cfg: SimConfig) {
    super(id, cfg);
    this.base = cfg.alloc[id];
    this.peerInfo = perBody((b) => ({ seq: 0, sentAt: 0, free: cfg.alloc[b], pos: 0 }));
  }

  budget(): number {
    let b = this.base;
    for (const p of this.peers) b += this.recv[p] - this.sent[p];
    return b;
  }

  private isOpen(peer: BodyId): boolean {
    return this.myOffer[peer].epoch > this.applied[peer];
  }

  /** Units I have promised to absorb through open offers: my position may rise by this much with no action of mine. */
  private reserved(): number {
    let r = 0;
    for (const p of this.peers) if (this.isOpen(p)) r += this.myOffer[p].amount;
    return r;
  }

  /** Budget not needed by my position or by open offers. This is what I report, and all I may give away. */
  private free(): number {
    return this.budget() - Math.max(this.pos + this.reserved(), -this.pos, 0);
  }

  netting(): NettingStats {
    return {
      reserved: this.reserved(),
      outUnits: this.nettedOutUnits,
      outCash: this.nettedOutCash,
      inUnits: this.nettedInUnits,
      inCash: this.nettedInCash,
    };
  }

  heardAgo(now: number): number {
    return Math.min(...this.peers.map((p) => now - this.peerInfo[p].sentAt));
  }

  refusalReason(_dir: 1 | -1, ctx: DeskCtx): RefusalReason {
    return this.mode(ctx.now) === 'reduce-only' ? 'playing-safe' : 'allowance';
  }

  /** My position plus the last positions my peers reported. Kept for display: this desk never relies on it. */
  believedTotal(): { low: number; high: number } {
    let t = this.pos;
    for (const p of this.peers) t += this.peerInfo[p].pos;
    return { low: t, high: t };
  }

  mode(now: number): Mode {
    const stale = this.peers.filter((p) => now - this.peerInfo[p].sentAt > this.cfg.leaseDuration);
    if (stale.length === this.peers.length) return 'reduce-only';
    return stale.length > 0 ? 'degraded' : 'normal';
  }

  quote(ctx: DeskCtx): Quote {
    const cap = this.cfg.maxGapAge * (this.cfg.sigmaEarth ** 2 + this.cfg.sigmaMars ** 2);
    const gap = Math.sqrt(Math.min(ctx.gapVar, cap));
    return this.makeQuote(ctx.fair, this.cfg.baseHalfSpread + this.cfg.gapK * gap, this.budget());
  }

  maxFill(dir: 1 | -1, size: number, ctx: DeskCtx): number {
    const b = Math.floor(this.budget());
    // Buying is limited by the worst case including open offers; selling only by the floor at -budget.
    let room = dir > 0 ? b - (this.pos + this.reserved()) : b + this.pos;
    // Reduce-only: the desk may only trade towards flat.
    if (this.mode(ctx.now) === 'reduce-only') room = Math.min(room, Math.max(0, -dir * this.pos));
    return Math.max(0, Math.min(size, Math.floor(room)));
  }

  onMessage(p: Payload, ctx: DeskCtx): void {
    if (p.kind !== 'gossip') return;
    const info = this.peerInfo[p.from];
    if (p.seq > info.seq) {
      info.seq = p.seq;
      info.sentAt = p.sentAt;
      info.free = p.free;
      info.pos = p.pos;
    }
    this.recv[p.from] = Math.max(this.recv[p.from], p.sentRow[this.id]);
    // Netting is read from every message, not only newer ones: the epoch checks make old copies harmless.
    if (p.netting) {
      this.applyReply(p.from, p.netting.replies[this.id]);
      this.answerOffer(p.from, p.netting.offers[this.id], ctx);
    }
  }

  /** Long side: hand over up to `amount` units of long position, once per offer epoch. Allowed in every mode. */
  private answerOffer(peer: BodyId, offer: { epoch: number; amount: number }, ctx: DeskCtx): void {
    if (offer.epoch <= this.myReply[peer].epoch) return;
    const given = Math.min(offer.amount, Math.max(0, Math.floor(this.pos)));
    this.pos -= given;
    this.cash += given * ctx.fair;
    this.myReply[peer] = { epoch: offer.epoch, given, price: ctx.fair };
    this.handoverLabel[peer] += given;
    this.nettedOutUnits += given;
    this.nettedOutCash += given * ctx.fair;
  }

  /** Short side: take in the units handed over for my open offer, and close it. */
  private applyReply(peer: BodyId, reply: { epoch: number; given: number; price: number }): void {
    if (reply.epoch !== this.myOffer[peer].epoch || reply.epoch <= this.applied[peer]) return;
    this.pos += reply.given;
    this.cash -= reply.given * reply.price;
    this.applied[peer] = reply.epoch;
    this.nettedInUnits += reply.given;
    this.nettedInCash += reply.given * reply.price;
  }

  /** Short side: offer to absorb long position from peers that recently reported being long. */
  private openOffers(now: number): void {
    for (const p of this.peers) {
      if (this.pos >= 0) return;
      const info = this.peerInfo[p];
      if (now - info.sentAt > this.cfg.leaseDuration) continue;
      if (this.isOpen(p) || info.pos <= 0) continue;
      // reserved() is recomputed per peer, so two offers never promise the same units. pos + reserved stays <= 0.
      const open = -this.pos - this.reserved();
      const amount = Math.floor(Math.min(open, info.pos));
      // Small offers are not worth a round trip, unless this one would flatten me completely.
      const closesOut = amount >= 1 && amount === open;
      if (amount < this.cfg.nettingMin && !closesOut) continue;
      this.myOffer[p] = { epoch: this.myOffer[p].epoch + 1, amount };
    }
  }

  tick(ctx: DeskCtx): void {
    if (ctx.now < this.nextGossipAt) return;
    this.nextGossipAt = ctx.now + this.cfg.gossipEvery;
    if (this.mode(ctx.now) !== 'reduce-only') {
      this.rebalance(ctx.now);
      if (this.cfg.netting) this.openOffers(ctx.now);
    }
    this.seq++;
    for (const p of this.peers) {
      // Label the first update after a hand-over so the view can show it. The reply table carries the real state.
      const handover = this.handoverLabel[p] > 0 ? this.handoverLabel[p] : undefined;
      this.handoverLabel[p] = 0;
      ctx.send(p, {
        kind: 'gossip',
        handover,
        openOffer: this.isOpen(p) ? this.myOffer[p].amount : undefined,
        from: this.id,
        seq: this.seq,
        sentAt: ctx.now,
        pos: this.pos,
        free: this.free(),
        sentRow: { ...this.sent },
        // Snapshots, not live references: the message must not change after it is sent.
        netting: this.cfg.netting
          ? {
              offers: perBody((b) => ({ ...this.myOffer[b] })),
              replies: perBody((b) => ({ ...this.myReply[b] })),
            }
          : undefined,
      });
    }
  }

  /** Give spare budget to a peer that is running low. Only ever gives away budget that is not in use. */
  private rebalance(now: number): void {
    for (const p of this.peers) {
      const info = this.peerInfo[p];
      const age = now - info.sentAt;
      if (age > this.cfg.leaseDuration) continue;
      // Wait long enough to see the effect of the last grant before granting again.
      const cooldown = Math.max(this.cfg.grantCooldown, 2.5 * age + this.cfg.gossipEvery);
      if (now - this.lastGrantAt[p] < cooldown) continue;
      const diff = this.free() - info.free;
      if (diff <= this.cfg.grantThreshold) continue;
      const amount = Math.floor(diff / 4);
      if (amount < 1) continue;
      this.sent[p] += amount;
      this.lastGrantAt[p] = now;
    }
  }
}

/**
 * BASELINE: no central hub, but each desk checks the limit against the last positions it heard
 * from its peers. Fast and always available; breaches the limit when that information is stale.
 */
export class NaiveDesk extends BaseDesk {
  private readonly peerPos: PerBody<{ seq: number; pos: number }> = perBody(() => ({ seq: 0, pos: 0 }));
  private seq = 0;
  private nextGossipAt = 0;

  budget(): null {
    return null;
  }

  mode(): Mode {
    return 'normal';
  }

  /** My position plus the last positions I heard. This is the figure I trade against. */
  believedTotal(): { low: number; high: number } {
    let t = this.pos;
    for (const p of this.peers) t += this.peerPos[p].pos;
    return { low: t, high: t };
  }

  quote(ctx: DeskCtx): Quote {
    return this.makeQuote(ctx.fair, this.cfg.baseHalfSpread, this.cfg.limit / BODIES.length);
  }

  maxFill(dir: 1 | -1, size: number): number {
    let known = this.pos;
    for (const p of this.peers) known += this.peerPos[p].pos;
    const room = dir > 0 ? this.cfg.limit - known : this.cfg.limit + known;
    return Math.max(0, Math.min(size, Math.floor(room)));
  }

  onMessage(p: Payload): void {
    if (p.kind !== 'gossip') return;
    const info = this.peerPos[p.from];
    if (p.seq > info.seq) {
      info.seq = p.seq;
      info.pos = p.pos;
    }
  }

  tick(ctx: DeskCtx): void {
    if (ctx.now < this.nextGossipAt) return;
    this.nextGossipAt = ctx.now + this.cfg.gossipEvery;
    this.seq++;
    for (const p of this.peers) {
      ctx.send(p, {
        kind: 'gossip',
        from: this.id,
        seq: this.seq,
        sentAt: ctx.now,
        pos: this.pos,
        free: 0,
        sentRow: perBody(() => 0),
      });
    }
  }
}

/**
 * BASELINE: head office on Earth approves every trade. Never breaches, because Earth tracks
 * worst-case bounds on the bank's position, but remote customers wait a full round trip and
 * most give up. In a blackout the remote desks do no business at all.
 */
export class CentralDesk extends BaseDesk {
  private readonly isHq: boolean;
  // Head office: the bank's true position is always within [lower, upper].
  private upper = 0;
  private lower = 0;
  /** Approved and not yet confirmed: the amount, and the visitor trade it belongs to if any. */
  private readonly approved = new Map<string, { delta: number; trade?: number }>();
  // Remote desk: customers waiting on an approval.
  private readonly waiting = new Map<string, Customer>();
  /** Visitors who walked away, by request id: when they arrived. Only so the story can close; never decides anything. */
  private readonly walkedAway = new Map<string, Customer>();
  private lastRfqAt = 0;
  private lastApproveAt = 0;

  constructor(id: BodyId, cfg: SimConfig) {
    super(id, cfg);
    this.isHq = id === 'earth';
  }

  budget(): null {
    return null;
  }

  mode(): Mode {
    return !this.isHq && this.lastRfqAt - this.lastApproveAt > 30 ? 'halted' : 'normal';
  }

  /** Head office knows the bank's position lies within its bounds. Remote desks keep no figure. */
  believedTotal(): { low: number; high: number } | null {
    return this.isHq ? { low: this.lower, high: this.upper } : null;
  }

  quote(ctx: DeskCtx): Quote {
    return this.makeQuote(ctx.fair, this.cfg.baseHalfSpread, this.cfg.limit / BODIES.length);
  }

  maxFill(dir: 1 | -1, size: number): number {
    if (!this.isHq) return 0;
    const room = dir > 0 ? this.cfg.limit - this.upper : this.cfg.limit + this.lower;
    return Math.max(0, Math.min(size, Math.floor(room)));
  }

  applyFill(delta: number, price: number): void {
    super.applyFill(delta, price);
    if (this.isHq) {
      this.upper += delta;
      this.lower += delta;
    }
  }

  onCustomer(c: Customer, ctx: DeskCtx): boolean {
    if (this.isHq) return false;
    const id = `${this.id}-${c.id}`;
    this.waiting.set(id, c);
    this.lastRfqAt = ctx.now;
    // World fills in when the request lands; the desk does not know the delay.
    if (c.trade !== undefined) ctx.report?.(c.trade, { kind: 'asked-earth', landsAt: 0 });
    ctx.send('earth', { kind: 'rfq', from: this.id, id, delta: c.side === 'sell' ? c.size : -c.size, trade: c.trade });
    return true;
  }

  cancelVisitor(trade: number, ctx: DeskCtx): void {
    for (const [id, c] of this.waiting) {
      if (c.trade !== trade) continue;
      // Dropping the customer means a later approval is answered "not filled", which releases Earth's bound.
      this.waiting.delete(id);
      this.walkedAway.set(id, c);
      ctx.report?.(trade, { kind: 'gave-up', waited: ctx.now - c.arrivedAt });
    }
  }

  onMessage(p: Payload, ctx: DeskCtx): void {
    if (p.kind === 'rfq' && this.isHq) {
      const ok = p.delta > 0 ? this.upper + p.delta <= this.cfg.limit : this.lower + p.delta >= -this.cfg.limit;
      if (!ok) {
        // A refusal sends nothing: the remote desk simply never hears back.
        if (p.trade !== undefined) ctx.report?.(p.trade, { kind: 'earth-declined' });
        return;
      }
      if (p.delta > 0) this.upper += p.delta;
      else this.lower += p.delta;
      this.approved.set(p.id, { delta: p.delta, trade: p.trade });
      if (p.trade !== undefined) ctx.report?.(p.trade, { kind: 'earth-approved', landsAt: 0 });
      ctx.send(p.from, { kind: 'approve', id: p.id, trade: p.trade });
    } else if (p.kind === 'approve' && !this.isHq) {
      this.lastApproveAt = ctx.now;
      const c = this.waiting.get(p.id);
      this.waiting.delete(p.id);
      const q = this.quote(ctx);
      const price = c?.side === 'sell' ? q.bid : q.ask;
      const edge = c?.side === 'sell' ? (ctx.fair - price) / ctx.fair : (price - ctx.fair) / ctx.fair;
      const filled = !!c && ctx.now - c.arrivedAt <= c.patience && edge <= c.tol;
      if (c && filled) this.applyFill(c.side === 'sell' ? c.size : -c.size, price);
      const gone = this.walkedAway.get(p.id);
      if (gone?.trade !== undefined) {
        this.walkedAway.delete(p.id);
        ctx.report?.(gone.trade, { kind: 'too-late', waited: ctx.now - gone.arrivedAt });
      }
      if (c?.trade !== undefined) {
        const waited = ctx.now - c.arrivedAt;
        ctx.report?.(
          c.trade,
          filled ? { kind: 'filled', units: c.size, of: c.size, price, allowanceLeft: null, waited } : { kind: 'too-late', waited },
        );
      }
      ctx.send('earth', { kind: 'confirm', id: p.id, filled, trade: p.trade });
    } else if (p.kind === 'confirm' && this.isHq) {
      const entry = this.approved.get(p.id);
      if (entry === undefined) return;
      const delta = entry.delta;
      this.approved.delete(p.id);
      // Approval moved one bound. A fill moves the other to match; a miss moves the first one back.
      if (p.filled) {
        if (delta > 0) this.lower += delta;
        else this.upper += delta;
      } else {
        if (delta > 0) this.upper -= delta;
        else this.lower -= delta;
      }
    }
  }

  tick(ctx: DeskCtx): void {
    for (const [id, c] of this.waiting) {
      if (ctx.now - c.arrivedAt > c.patience + 2 * 60) this.waiting.delete(id);
    }
  }
}

export function makeDesk(strategy: StrategyId, id: BodyId, cfg: SimConfig): Desk {
  if (strategy === 'leased') return new LeasedDesk(id, cfg);
  if (strategy === 'naive') return new NaiveDesk(id, cfg);
  return new CentralDesk(id, cfg);
}
