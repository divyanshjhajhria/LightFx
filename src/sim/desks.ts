import type { SimConfig } from './config';
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
 */
export class LeasedDesk extends BaseDesk {
  private readonly base: number;
  private readonly sent: PerBody<number> = perBody(() => 0);
  private readonly recv: PerBody<number> = perBody(() => 0);
  private readonly peerInfo: PerBody<{ seq: number; sentAt: number; free: number }>;
  private readonly lastGrantAt: PerBody<number> = perBody(() => -Infinity);
  private seq = 0;
  private nextGossipAt = 0;

  constructor(id: BodyId, cfg: SimConfig) {
    super(id, cfg);
    this.base = cfg.alloc[id];
    this.peerInfo = perBody((b) => ({ seq: 0, sentAt: 0, free: cfg.alloc[b] }));
  }

  budget(): number {
    let b = this.base;
    for (const p of this.peers) b += this.recv[p] - this.sent[p];
    return b;
  }

  private free(): number {
    return this.budget() - Math.abs(this.pos);
  }

  heardAgo(now: number): number {
    return Math.min(...this.peers.map((p) => now - this.peerInfo[p].sentAt));
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
    const b = this.mode(ctx.now) === 'reduce-only' ? 0 : Math.floor(this.budget());
    const a = Math.abs(this.pos);
    // Trading against the current position may pass through zero and out to the budget on the other side.
    const room = this.pos * dir < 0 ? a + b : Math.max(0, b - a);
    return Math.min(size, Math.floor(room));
  }

  onMessage(p: Payload): void {
    if (p.kind !== 'gossip') return;
    const info = this.peerInfo[p.from];
    if (p.seq > info.seq) {
      info.seq = p.seq;
      info.sentAt = p.sentAt;
      info.free = p.free;
    }
    this.recv[p.from] = Math.max(this.recv[p.from], p.sentRow[this.id]);
  }

  tick(ctx: DeskCtx): void {
    if (ctx.now < this.nextGossipAt) return;
    this.nextGossipAt = ctx.now + this.cfg.gossipEvery;
    if (this.mode(ctx.now) !== 'reduce-only') this.rebalance(ctx.now);
    this.seq++;
    for (const p of this.peers) {
      ctx.send(p, {
        kind: 'gossip',
        from: this.id,
        seq: this.seq,
        sentAt: ctx.now,
        pos: this.pos,
        free: this.free(),
        sentRow: { ...this.sent },
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
  private readonly approved = new Map<string, number>();
  // Remote desk: customers waiting on an approval.
  private readonly waiting = new Map<string, Customer>();
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
    ctx.send('earth', { kind: 'rfq', from: this.id, id, delta: c.side === 'sell' ? c.size : -c.size });
    return true;
  }

  onMessage(p: Payload, ctx: DeskCtx): void {
    if (p.kind === 'rfq' && this.isHq) {
      const ok = p.delta > 0 ? this.upper + p.delta <= this.cfg.limit : this.lower + p.delta >= -this.cfg.limit;
      if (!ok) return;
      if (p.delta > 0) this.upper += p.delta;
      else this.lower += p.delta;
      this.approved.set(p.id, p.delta);
      ctx.send(p.from, { kind: 'approve', id: p.id });
    } else if (p.kind === 'approve' && !this.isHq) {
      this.lastApproveAt = ctx.now;
      const c = this.waiting.get(p.id);
      this.waiting.delete(p.id);
      const q = this.quote(ctx);
      const price = c?.side === 'sell' ? q.bid : q.ask;
      const edge = c?.side === 'sell' ? (ctx.fair - price) / ctx.fair : (price - ctx.fair) / ctx.fair;
      const filled = !!c && ctx.now - c.arrivedAt <= c.patience && edge <= c.tol;
      if (c && filled) this.applyFill(c.side === 'sell' ? c.size : -c.size, price);
      ctx.send('earth', { kind: 'confirm', id: p.id, filled });
    } else if (p.kind === 'confirm' && this.isHq) {
      const delta = this.approved.get(p.id);
      if (delta === undefined) return;
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
