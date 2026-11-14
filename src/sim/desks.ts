import type { SimConfig } from './config';
import type { DeskEventDetail, InboxItem, PeerView } from './deskEvents';
import { PRICING_MULT, plain, units } from './directive';
import type { Directive } from './directive';
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
  /** Note something this desk did, for its briefing. Returns nothing; a desk must never branch on it. */
  log?(e: DeskEventDetail): void;
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
  /** What this desk knows of each peer. Read-only, for its briefing. */
  peerView(now: number): PeerView[];
  /** Allowance not needed by what it holds or has promised, or null if it has no allowance. */
  spare(): number | null;
  /** Customers still waiting on head office at this desk (not yet out of patience), or null if it never makes them wait. */
  waitingCount(now: number): number | null;
  /** A visitor has walked away. Only a desk still holding that customer does anything. */
  cancelVisitor?(trade: number, ctx: DeskCtx, patienceRanOut?: boolean): void;
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

  peerView(_now: number): PeerView[] {
    return this.peers.map((body) => ({ body, heardMinAgo: null, lastKnownHolds: null }));
  }

  spare(): number | null {
    return null;
  }

  waitingCount(_now: number): number | null {
    return null;
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

  // ---- Agent control (our bank only). The guard below is the only code that applies a directive. ----
  /** Who makes this desk's judgment calls. 'rules' unless an agent runner takes over. */
  controller: 'rules' | 'agent' = 'rules';
  private directive: Directive | null = null;
  private directiveAt = -Infinity;
  /** A note and an ask for each peer, waiting for the next desk update to that peer. Sent once, never re-sent. */
  private readonly outNote: Partial<PerBody<string>> = {};
  private readonly outAsk: Partial<PerBody<number>> = {};
  /** The last notes and asks that reached this desk, oldest first. */
  private readonly inboxItems: InboxItem[] = [];

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

  peerView(now: number): PeerView[] {
    return this.peers.map((body) => {
      const i = this.peerInfo[body];
      return { body, heardMinAgo: i.seq > 0 ? now - i.sentAt : null, lastKnownHolds: i.seq > 0 ? i.pos : null };
    });
  }

  spare(): number {
    return this.free();
  }

  /** My position plus the last positions my peers reported. Kept for display: this desk never relies on it. */
  believedTotal(): { low: number; high: number } {
    let t = this.pos;
    for (const p of this.peers) t += this.peerInfo[p].pos;
    return { low: t, high: t };
  }

  /** The mode the rules give: out of touch with every peer for a lease means playing safe, whatever any agent says. */
  private ruleMode(now: number): Mode {
    const stale = this.peers.filter((p) => now - this.peerInfo[p].sentAt > this.cfg.leaseDuration);
    if (stale.length === this.peers.length) return 'reduce-only';
    return stale.length > 0 ? 'degraded' : 'normal';
  }

  mode(now: number): Mode {
    const m = this.ruleMode(now);
    if (m !== 'reduce-only' && this.agentInControl(now) && this.directive!.caution === 'play-safe') return 'reduce-only';
    return m;
  }

  /** Why this desk is playing safe: the rule (out of touch), its agent's choice, or not at all. */
  playingSafeBy(now: number): 'rule' | 'choice' | null {
    if (this.ruleMode(now) === 'reduce-only') return 'rule';
    return this.mode(now) === 'reduce-only' ? 'choice' : null;
  }

  /**
   * An agent decides for this desk only while it has heard from it recently. A desk handed to an agent that has not
   * spoken yet, or has gone silent for agentStaleMinutes, runs on its rules in full.
   */
  agentInControl(now: number): boolean {
    return this.controller === 'agent' && this.directive !== null && now - this.directiveAt < this.cfg.agentStaleMinutes;
  }

  /** Notes and asks received, oldest first (the last 5). */
  inbox(): readonly InboxItem[] {
    return this.inboxItems;
  }

  /** Each peer's spare allowance as it last reported it, and when it said so. Null for a peer never heard from. */
  peerSpare(now: number): { body: BodyId; spare: number | null; ageMin: number | null }[] {
    return this.peers.map((body) => {
      const i = this.peerInfo[body];
      return i.seq > 0 ? { body, spare: Math.max(0, Math.floor(i.free)), ageMin: now - i.sentAt } : { body, spare: null, ageMin: null };
    });
  }

  /** The directive in force and when it arrived, or null. Read-only, for views and briefings. */
  lastDirective(): { directive: Directive; at: number } | null {
    return this.directive ? { directive: this.directive, at: this.directiveAt } : null;
  }

  /**
   * THE GUARD. Apply an agent's directive, clamping every field. Gives come only out of spare allowance, peer by peer in
   * a fixed order, each through the same cumulative counter rebalance() uses, so the sum of allowances can never pass
   * the bank's limit and no desk is left holding more than its allowance. Returns the units actually given to each peer.
   * A desk run by rules ignores directives.
   */
  setDirective(d: Directive, now: number): PerBody<number> {
    const given = perBody(() => 0);
    if (this.controller !== 'agent' || typeof d !== 'object' || d === null) return given;
    for (const p of BODIES) {
      if (p === this.id) continue;
      const want = d.give?.[p];
      if (typeof want !== 'number' || !Number.isFinite(want) || want < 1) continue;
      const spare = Math.max(0, Math.floor(this.free()));
      const n = Math.min(Math.floor(want), spare);
      if (n < 1) continue;
      this.sent[p] += n;
      this.lastGrantAt[p] = now;
      given[p] = n;
    }
    const ask: Partial<PerBody<number>> = {};
    const noteTo: Partial<PerBody<string>> = {};
    for (const p of BODIES) {
      if (p === this.id) continue;
      const n = units(d.ask?.[p]);
      if (n > 0) this.outAsk[p] = ask[p] = n;
      const note = plain(d.noteTo?.[p], 140);
      if (note) this.outNote[p] = noteTo[p] = note;
    }
    this.directive = {
      pricing: Object.hasOwn(PRICING_MULT, d.pricing) ? d.pricing : 'steady',
      caution: d.caution === 'play-safe' ? 'play-safe' : 'normal',
      give: Object.fromEntries(Object.entries(given).filter(([, n]) => n > 0)),
      ask,
      noteTo,
      thought: plain(d.thought, 220),
      source: d.source,
    };
    this.directiveAt = now;
    return given;
  }

  quote(ctx: DeskCtx): Quote {
    const cap = this.cfg.maxGapAge * (this.cfg.sigmaEarth ** 2 + this.cfg.sigmaMars ** 2);
    const gap = Math.sqrt(Math.min(ctx.gapVar, cap));
    let half = this.cfg.baseHalfSpread + this.cfg.gapK * gap;
    if (this.agentInControl(ctx.now)) {
      half = Math.max(half * PRICING_MULT[this.directive!.pricing], this.cfg.baseHalfSpread / 2);
    }
    return this.makeQuote(ctx.fair, half, this.budget());
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
    if (p.note !== undefined || p.asks !== undefined) {
      this.inboxItems.push({ from: p.from, text: p.note ?? '', asks: p.asks ?? null, sentAt: p.sentAt, receivedAt: ctx.now });
      if (this.inboxItems.length > 5) this.inboxItems.shift();
    }
    const info = this.peerInfo[p.from];
    if (p.seq > info.seq) {
      info.seq = p.seq;
      info.sentAt = p.sentAt;
      info.free = p.free;
      info.pos = p.pos;
    }
    const before = this.recv[p.from];
    this.recv[p.from] = Math.max(this.recv[p.from], p.sentRow[this.id]);
    if (this.recv[p.from] > before) ctx.log?.({ kind: 'allowance-received', from: p.from, units: this.recv[p.from] - before });
    // Netting is read from every message, not only newer ones: the epoch checks make old copies harmless.
    if (p.netting) {
      this.applyReply(p.from, p.netting.replies[this.id], ctx);
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
    if (given > 0) ctx.log?.({ kind: 'handed-over', to: peer, units: given });
    this.nettedOutUnits += given;
    this.nettedOutCash += given * ctx.fair;
  }

  /** Short side: take in the units handed over for my open offer, and close it. */
  private applyReply(peer: BodyId, reply: { epoch: number; given: number; price: number }, ctx: DeskCtx): void {
    if (reply.epoch !== this.myOffer[peer].epoch || reply.epoch <= this.applied[peer]) return;
    if (reply.given > 0) ctx.log?.({ kind: 'took-on', from: peer, units: reply.given });
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
    // Out of touch by the rule: no grants and no netting. Netting is bookkeeping and stays automatic under an agent;
    // who gets allowance is the agent's call while it is in control.
    if (this.ruleMode(ctx.now) !== 'reduce-only') {
      if (!this.agentInControl(ctx.now)) this.rebalance(ctx);
      if (this.cfg.netting) this.openOffers(ctx.now);
    }
    this.seq++;
    for (const p of this.peers) {
      // Label the first update after a hand-over so the view can show it. The reply table carries the real state.
      const handover = this.handoverLabel[p] > 0 ? this.handoverLabel[p] : undefined;
      this.handoverLabel[p] = 0;
      // A waiting note or ask rides on this update, once. The desk never learns whether it arrived.
      const note = this.outNote[p];
      const asks = this.outAsk[p];
      delete this.outNote[p];
      delete this.outAsk[p];
      ctx.send(p, {
        ...(note !== undefined ? { note } : {}),
        ...(asks !== undefined ? { asks } : {}),
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
  private rebalance(ctx: DeskCtx): void {
    const now = ctx.now;
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
      ctx.log?.({ kind: 'allowance-given', to: p, units: amount });
    }
  }
}

/**
 * BASELINE: no central hub, but each desk checks the limit against the last positions it heard
 * from its peers. Fast and always available; breaches the limit when that information is stale.
 */
export class NaiveDesk extends BaseDesk {
  private readonly peerPos: PerBody<{ seq: number; pos: number; sentAt: number }> = perBody(() => ({ seq: 0, pos: 0, sentAt: 0 }));
  private seq = 0;
  private nextGossipAt = 0;

  budget(): null {
    return null;
  }

  mode(): Mode {
    return 'normal';
  }

  peerView(now: number): PeerView[] {
    return this.peers.map((body) => {
      const i = this.peerPos[body];
      return { body, heardMinAgo: i.seq > 0 ? now - i.sentAt : null, lastKnownHolds: i.seq > 0 ? i.pos : null };
    });
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
      info.sentAt = p.sentAt;
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

  waitingCount(now: number): number | null {
    if (this.isHq) return null;
    let n = 0;
    for (const c of this.waiting.values()) if (now - c.arrivedAt <= c.patience) n++;
    return n;
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

  cancelVisitor(trade: number, ctx: DeskCtx, patienceRanOut = false): void {
    for (const [id, c] of this.waiting) {
      if (c.trade !== trade) continue;
      // Dropping the customer means a later approval is answered "not filled", which releases Earth's bound.
      this.waiting.delete(id);
      this.walkedAway.set(id, c);
      ctx.report?.(trade, { kind: 'gave-up', waited: ctx.now - c.arrivedAt, ...(patienceRanOut ? { patience: true as const } : {}) });
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
