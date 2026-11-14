import { DEFAULT_CONFIG } from './config';
import type { SimConfig } from './config';
import { makeDesk } from './desks';
import type { Desk, DeskCtx } from './desks';
import { SeriesFeed, SyntheticFeed } from './market';
import type { EarthFeed } from './market';
import { DelayNetwork } from './network';
import { advanceOrbit, distanceAU, lightDelayMin, makeOrbit, setSeparation, sunBlocked } from './orbits';
import type { OrbitState } from './orbits';
import { Rng } from './rng';
import type { TraceDetail, TraceEvent } from './trace';
import { BODIES, STRATEGIES, perBody } from './types';
import type { BodyId, Customer, DeskView, LinkView, Metrics, Payload, PerBody, StrategyId } from './types';

export interface WorldOptions {
  strategy: StrategyId;
  seed: number;
  cfg?: SimConfig;
  /** One mid price per minute. Omit to use the synthetic random walk. */
  earthSeries?: number[];
  separationDeg?: number;
}

export interface HistoryPoint {
  t: number;
  total: number;
  pnl: number;
}

/** Price components that originate somewhere. The Moon originates none. */
const SOURCES = ['earth', 'mars'] as const;
type Source = (typeof SOURCES)[number];

const linkKey = (a: BodyId, b: BodyId) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** How many visitor trades keep their story. */
const TRACE_KEEP = 10;
/** Visitor customers get ids from here, so they can never collide with the background stream. */
const FIRST_VISITOR_ID = 1_000_000_000;

/** A filled visitor trade whose news has not yet been sent successfully to every peer. */
interface Spreading {
  body: BodyId;
  /** Peers that have not yet been sent a desk update carrying the news. */
  waiting: Set<BodyId>;
  /** Peers for which a failed attempt has already been recorded. */
  failed: Set<BodyId>;
}

/** One bank running one strategy. Run several with the same seed to compare strategies on identical events. */
export class World {
  readonly cfg: SimConfig;
  readonly strategy: StrategyId;
  readonly orbit: OrbitState;
  readonly net: DelayNetwork;
  readonly desks: PerBody<Desk>;
  readonly history: HistoryPoint[] = [];
  readonly metrics: Metrics = {
    breachTicks: 0,
    maxAbsTotal: 0,
    arrived: 0,
    volRequested: 0,
    served: 0,
    volFilled: 0,
    dropped: 0,
    nettedUnits: 0,
  };

  now = 0;
  /** Solar storm: every interplanetary link is down. */
  blackout = false;
  /** Market panic: higher volatility, falling price, customers mostly selling. */
  panic = false;
  /** Links cut by hand, as keys from linkKey(). */
  readonly cuts = new Set<string>();
  /** Probability that a customer at each body sells Mars credits, outside a panic. Starts as a copy of cfg.sellProb. */
  readonly flow: PerBody<number>;

  private tickCount = 0;
  private readonly ticksPerMin: number;
  private readonly feed: EarthFeed;
  private stress = 0;
  private marsShock = 0;
  private readonly comp: Record<Source, number> = { earth: 0, mars: 0 };
  /** info[p][s]: the newest value of component s that has reached body p, and when it left. */
  private readonly info: PerBody<Record<Source, { at: number; value: number }>>;
  private readonly rngMarket: Rng;
  private readonly rngCust: Rng;
  private nextCustomerId = 1;
  private nextVisitorId = FIRST_VISITOR_ID;
  /** The story of each recent visitor trade, oldest trade first. */
  private readonly traces = new Map<number, TraceEvent[]>();
  private readonly spreading = new Map<number, Spreading>();

  constructor(opts: WorldOptions) {
    this.cfg = opts.cfg ?? DEFAULT_CONFIG;
    this.strategy = opts.strategy;
    this.orbit = makeOrbit(opts.separationDeg ?? 60);
    this.ticksPerMin = Math.round(1 / this.cfg.dt);
    this.feed = opts.earthSeries ? new SeriesFeed(opts.earthSeries) : new SyntheticFeed(this.cfg.sigmaEarth);
    this.rngMarket = Rng.stream(opts.seed, 1);
    this.rngCust = Rng.stream(opts.seed, 2);
    this.info = perBody(() => ({ earth: { at: 0, value: 0 }, mars: { at: 0, value: 0 } }));
    this.flow = { ...this.cfg.sellProb };
    this.desks = perBody((b) => makeDesk(this.strategy, b, this.cfg));
    this.net = new DelayNetwork(
      (a, b) => this.linkOpen(a, b),
      (a, b) => lightDelayMin(this.orbit, a, b),
    );
  }

  // ---- Controls -----------------------------------------------------------

  setSeparation(deg: number): void {
    setSeparation(this.orbit, deg);
  }

  setCut(a: BodyId, b: BodyId, cut: boolean): void {
    if (cut) this.cuts.add(linkKey(a, b));
    else this.cuts.delete(linkKey(a, b));
  }

  /** True when the link between a and b has been cut by hand (it may also be closed for other reasons). */
  isCut(a: BodyId, b: BodyId): boolean {
    return this.cuts.has(linkKey(a, b));
  }

  /** Set the calm-market probability that a customer at `b` sells Mars credits. Clamped to [0, 1]. */
  setFlow(b: BodyId, sellProb: number): void {
    this.flow[b] = Math.max(0, Math.min(1, sellProb));
  }

  linkOpen(a: BodyId, b: BodyId): boolean {
    if (this.cuts.has(linkKey(a, b))) return false;
    if (this.blackout && distanceAU(this.orbit, a, b) > 0.1) return false;
    return !sunBlocked(this.orbit, a, b);
  }

  // ---- Prices -------------------------------------------------------------

  /** Price with every component fresh. Nobody in the simulation can see this; it is used to value positions. */
  fullPrice(): number {
    return this.feed.p0 * Math.exp(this.comp.earth + this.comp.mars);
  }

  /** What the market at `b` believes: local news fresh, remote news as old as light allows. */
  fair(b: BodyId): number {
    let log = 0;
    for (const s of SOURCES) log += s === b ? this.comp[s] : this.info[b][s].value;
    return this.feed.p0 * Math.exp(log);
  }

  /** Age in minutes of the stalest remote news at `b`. */
  newsAge(b: BodyId): number {
    let age = 0;
    for (const s of SOURCES) if (s !== b) age = Math.max(age, this.now - this.info[b][s].at);
    return age;
  }

  private gapVar(b: BodyId): number {
    const sigma: Record<Source, number> = { earth: this.cfg.sigmaEarth, mars: this.cfg.sigmaMars };
    let v = 0;
    for (const s of SOURCES) {
      if (s === b) continue;
      v += sigma[s] ** 2 * Math.min(this.now - this.info[b][s].at, this.cfg.maxGapAge);
    }
    return v;
  }

  private ctx(b: BodyId): DeskCtx {
    return {
      now: this.now,
      fair: this.fair(b),
      gapVar: this.gapVar(b),
      send: (to, p) => this.send(b, to, p),
      report: (trade, e) => this.report(b, trade, e),
    };
  }

  // ---- Visitor trades and their stories (god view: desks never see any of this) ----

  /** Every desk message goes through here, so the story can note which one carried a visitor trade's news. */
  private send(from: BodyId, to: BodyId, p: Payload): void {
    let tag: number | undefined;
    const carrying: number[] = [];
    if (p.kind === 'gossip') {
      for (const [trade, s] of this.spreading) {
        if (s.body === from && s.waiting.has(to)) carrying.push(trade);
      }
      if (carrying.length) tag = Math.max(...carrying);
    } else if ((p.kind === 'rfq' || p.kind === 'approve' || p.kind === 'confirm') && p.trade !== undefined) {
      tag = p.trade;
    }
    const landsAt = this.now + lightDelayMin(this.orbit, from, to);
    const ok = this.net.send(from, to, p, this.now, tag);
    for (const trade of carrying) {
      const s = this.spreading.get(trade)!;
      if (ok) {
        this.record(trade, from, { kind: 'told', to, landsAt });
        s.waiting.delete(to);
        if (!s.waiting.size) this.spreading.delete(trade);
      } else if (!s.failed.has(to)) {
        // Record a failure once per peer, not every time the desk tries again.
        this.record(trade, from, { kind: 'not-delivered', to });
        s.failed.add(to);
      }
    }
    if (!ok && tag !== undefined && (p.kind === 'rfq' || p.kind === 'approve')) {
      this.record(tag, from, { kind: 'not-delivered', to });
    }
  }

  /** A desk's own account of a step. World stamps it, and fills in landing times the desk cannot know. */
  private report(b: BodyId, trade: number, e: TraceDetail): void {
    if (e.kind === 'asked-earth') e = { ...e, landsAt: this.now + lightDelayMin(this.orbit, b, 'earth') };
    if (e.kind === 'earth-approved') {
      const at = this.traces.get(trade)?.[0]?.body ?? b;
      e = { ...e, landsAt: this.now + lightDelayMin(this.orbit, b, at) };
    }
    this.record(trade, b, e);
  }

  private record(trade: number, body: BodyId, e: TraceDetail): void {
    this.traces.get(trade)?.push({ t: this.now, body, ...e });
  }

  /** The story of a visitor trade so far, oldest first; empty if the trade is unknown or too old. */
  trace(trade: number): readonly TraceEvent[] {
    return this.traces.get(trade) ?? [];
  }

  /**
   * A visitor trades at `at`, now. The customer takes whatever price is quoted and goes through exactly the same path
   * as any other customer. No random numbers are drawn, so the background stream is untouched.
   */
  placeTrade(at: BodyId, side: 'buy' | 'sell', size: number, trade: number): void {
    this.traces.set(trade, []);
    while (this.traces.size > TRACE_KEEP) {
      const oldest = this.traces.keys().next().value!;
      this.traces.delete(oldest);
      this.spreading.delete(oldest);
    }
    this.record(trade, at, { kind: 'placed', side, size });
    this.handleCustomer({
      id: this.nextVisitorId++,
      at,
      side,
      size,
      tol: Infinity,
      patience: this.cfg.visitorPatience,
      arrivedAt: this.now,
      visitor: true,
      trade,
    });
  }

  /** The visitor has walked away. Only a desk still holding the customer (central, remote) does anything. */
  cancelTrade(trade: number): void {
    for (const b of BODIES) this.desks[b].cancelVisitor?.(trade, this.ctx(b));
  }

  // ---- Main loop ----------------------------------------------------------

  step(): void {
    const c = this.cfg;
    this.tickCount++;
    this.now = this.tickCount * c.dt;
    advanceOrbit(this.orbit, c.dt);

    // 1. Market moves. Always draw the same number of randoms so runs stay comparable.
    const z1 = this.rngMarket.normal();
    const z2 = this.rngMarket.normal();
    const z3 = this.rngMarket.normal();
    const sq = Math.sqrt(c.dt);
    this.feed.advance(this.now, c.dt, z1);
    if (this.panic) {
      this.stress += c.panicDrift * c.dt + c.sigmaEarth * sq * Math.sqrt(c.panicVolMult ** 2 - 1) * z2;
    }
    this.marsShock += -c.marsRevert * this.marsShock * c.dt + c.sigmaMars * sq * (this.panic ? c.panicVolMult : 1) * z3;
    this.comp.earth = this.feed.value + this.stress;
    this.comp.mars = this.marsShock;

    // 2. Each source broadcasts its news once a minute, at light speed like everything else.
    if (this.tickCount % this.ticksPerMin === 0) {
      for (const s of SOURCES) {
        for (const to of BODIES) {
          if (to !== s) this.net.send(s, to, { kind: 'news', origin: s, at: this.now, value: this.comp[s] }, this.now);
        }
      }
    }

    // 3. Deliver whatever has arrived.
    for (const env of this.net.deliver(this.now)) {
      const p = env.payload;
      if (p.kind === 'news') {
        const slot = this.info[env.to][p.origin as Source];
        if (p.at > slot.at) {
          slot.at = p.at;
          slot.value = p.value;
        }
      } else {
        this.desks[env.to].onMessage(p, this.ctx(env.to));
        if (env.trade !== undefined && p.kind === 'gossip') this.record(env.trade, env.to, { kind: 'heard', from: env.from });
      }
    }

    // 4. Customers. Every customer is fully drawn before any desk sees it, so all strategies face the same stream.
    for (const b of BODIES) {
      const sellProb = this.panic ? c.panicSellProb : this.flow[b];
      const n = this.rngCust.poisson(c.customerRate * c.dt);
      for (let i = 0; i < n; i++) {
        this.handleCustomer({
          id: this.nextCustomerId++,
          at: b,
          side: this.rngCust.next() < sellProb ? 'sell' : 'buy',
          size: this.rngCust.int(c.sizeMin, c.sizeMax),
          tol: this.rngCust.exp(c.tolMean),
          patience: this.rngCust.exp(c.patienceMean),
          arrivedAt: this.now,
        });
      }
    }

    // 5. Desks do their own housekeeping (gossip, budget grants).
    for (const b of BODIES) this.desks[b].tick(this.ctx(b));

    // 6. Score.
    const total = this.totalPosition();
    const m = this.metrics;
    m.maxAbsTotal = Math.max(m.maxAbsTotal, Math.abs(total));
    if (Math.abs(total) > c.limit + 1e-9) m.breachTicks++;
    m.served = 0;
    m.volFilled = 0;
    m.nettedUnits = 0;
    for (const b of BODIES) {
      m.served += this.desks[b].served;
      m.volFilled += this.desks[b].volFilled;
      m.nettedUnits += this.desks[b].netting().inUnits;
    }
    m.dropped = this.net.dropped;
    if (this.tickCount % this.ticksPerMin === 0) {
      this.history.push({ t: this.now, total, pnl: this.pnl() });
      if (this.history.length > 1500) this.history.shift();
    }
  }

  private handleCustomer(cust: Customer): void {
    this.metrics.arrived++;
    this.metrics.volRequested += cust.size;
    const desk = this.desks[cust.at];
    const ctx = this.ctx(cust.at);
    if (desk.onCustomer?.(cust, ctx)) return;
    const q = desk.quote(ctx);
    if (!q) return;
    const selling = cust.side === 'sell';
    const price = selling ? q.bid : q.ask;
    const edge = selling ? (ctx.fair - price) / ctx.fair : (price - ctx.fair) / ctx.fair;
    if (edge > cust.tol) return;
    const dir = selling ? 1 : -1;
    const n = desk.maxFill(dir, cust.size, ctx);
    if (n > 0) desk.applyFill(dir * n, price);
    if (cust.trade === undefined) return;
    if (n === 0) {
      this.record(cust.trade, cust.at, { kind: 'refused', reason: desk.refusalReason(dir, ctx) });
      return;
    }
    const budget = desk.budget();
    const allowanceLeft =
      budget === null ? null : Math.floor(budget - Math.max(desk.pos + desk.netting().reserved, -desk.pos, 0));
    this.record(cust.trade, cust.at, { kind: 'filled', units: n, of: cust.size, price, allowanceLeft, waited: 0 });
    // Leased and naive desks tell their peers through their regular updates; central's Earth has no one to tell.
    if (this.strategy !== 'central') {
      this.spreading.set(cust.trade, { body: cust.at, waiting: new Set(BODIES.filter((p) => p !== cust.at)), failed: new Set() });
    }
  }

  // ---- Read-outs ----------------------------------------------------------

  /**
   * Position and cash handed over by a long desk but not yet applied by the short desk that asked for it.
   * God view: no desk can know this.
   */
  inFlight(): { units: number; cash: number } {
    let units = 0;
    let cash = 0;
    for (const b of BODIES) {
      const n = this.desks[b].netting();
      units += n.outUnits - n.inUnits;
      cash += n.outCash - n.inCash;
    }
    return { units, cash };
  }

  /** The bank's true position: every desk's position plus units in flight between desks. */
  totalPosition(): number {
    let t = this.inFlight().units;
    for (const b of BODIES) t += this.desks[b].pos;
    return t;
  }

  /** Mark-to-market value. Units in flight are still the bank's, and the cash for them is not yet paid. */
  pnl(): number {
    const px = this.fullPrice();
    const fl = this.inFlight();
    let cash = -fl.cash;
    let pos = fl.units;
    for (const b of BODIES) {
      cash += this.desks[b].cash;
      pos += this.desks[b].pos;
    }
    return cash + pos * px;
  }

  deskViews(): DeskView[] {
    const px = this.fullPrice();
    return BODIES.map((b) => {
      const d = this.desks[b];
      const q = d.quote(this.ctx(b));
      const heard = d.heardAgo(this.now);
      return {
        id: b,
        pos: d.pos,
        budget: d.budget(),
        mode: d.mode(this.now),
        bid: q ? q.bid : null,
        ask: q ? q.ask : null,
        leaseLeft: heard === null ? null : Math.max(0, this.cfg.leaseDuration - heard),
        halfSpreadBps: q ? ((q.ask - q.bid) / (q.ask + q.bid)) * 1e4 : null,
        pnl: d.cash + d.pos * px,
        volFilled: d.volFilled,
        netted: d.netting().outUnits + d.netting().inUnits,
        believed: d.believedTotal(),
      };
    });
  }

  links(): LinkView[] {
    const pairs: [BodyId, BodyId][] = [
      ['earth', 'moon'],
      ['earth', 'mars'],
      ['moon', 'mars'],
    ];
    return pairs.map(([a, b]) => ({
      a,
      b,
      delayMin: lightDelayMin(this.orbit, a, b),
      open: this.linkOpen(a, b),
      cut: this.isCut(a, b),
    }));
  }
}

/** The three strategies side by side on the same seed, with shared controls. */
export class Arena {
  readonly worlds: Record<StrategyId, World>;
  private nextTrade = 1;

  constructor(seed: number, opts: Omit<WorldOptions, 'strategy' | 'seed'> = {}) {
    const make = (strategy: StrategyId) => new World({ ...opts, strategy, seed });
    this.worlds = { leased: make('leased'), naive: make('naive'), central: make('central') };
  }

  get now(): number {
    return this.worlds.leased.now;
  }

  step(): void {
    for (const s of STRATEGIES) this.worlds[s].step();
  }

  run(minutes: number): void {
    const ticks = Math.round(minutes / this.worlds.leased.cfg.dt);
    for (let i = 0; i < ticks; i++) this.step();
  }

  setBlackout(on: boolean): void {
    for (const s of STRATEGIES) this.worlds[s].blackout = on;
  }

  setPanic(on: boolean): void {
    for (const s of STRATEGIES) this.worlds[s].panic = on;
  }

  setSeparation(deg: number): void {
    for (const s of STRATEGIES) this.worlds[s].setSeparation(deg);
  }

  setCut(a: BodyId, b: BodyId, cut: boolean): void {
    for (const s of STRATEGIES) this.worlds[s].setCut(a, b, cut);
  }

  setFlow(b: BodyId, sellProb: number): void {
    for (const s of STRATEGIES) this.worlds[s].setFlow(b, sellProb);
  }

  /** A visitor trade, placed at all three banks at once. Returns its id, the same in every bank. */
  placeTrade(at: BodyId, side: 'buy' | 'sell', size: number): number {
    const trade = this.nextTrade++;
    for (const s of STRATEGIES) this.worlds[s].placeTrade(at, side, size, trade);
    return trade;
  }

  /** The visitor has stopped waiting for this trade. */
  cancelTrade(trade: number): void {
    for (const s of STRATEGIES) this.worlds[s].cancelTrade(trade);
  }

  /** Flip a hand cut on every world, based on the leased world's current value. */
  toggleCut(a: BodyId, b: BodyId): void {
    this.setCut(a, b, !this.worlds.leased.isCut(a, b));
  }
}
