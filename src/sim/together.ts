// Do our bank's desks do better together than alone? The same storms, the same seeds, our bank run twice: together
// (the defaults: sharing spare allowance, cancelling opposite positions) and alone (neither: each desk keeps to its own
// starting allowance). Both are safe by construction; the question is how many customers each serves.
import { DEFAULT_CONFIG } from './config';
import type { SimConfig } from './config';
import { RUSH, rushEvents } from './scenario';
import type { ScenarioEvent } from './scenario';
import { cellScenario, delayFor } from './sweep';
import type { Market } from './sweep';
import type { BodyId } from './types';
import { World } from './world';

export const TOGETHER_MARKETS: Market[] = ['calm', 'panic', 'imbalance'];
export const TOGETHER_SEPARATIONS = [0, 150];
export const TOGETHER_STORMS = [0, 120, 360];
export const TOGETHER_SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

export const ALONE: SimConfig = { ...DEFAULT_CONFIG, sharing: false, netting: false };

/** A rush at one desk (scenario.ts: RUSH), layered on a calm market. */
export const RUSH_MARKETS = ['rush-mars', 'rush-earth'] as const;
export type RushMarket = (typeof RUSH_MARKETS)[number];
export type TogetherMarket = Market | RushMarket;
export const rushedDesk = (m: TogetherMarket): BodyId | null => (m === 'rush-mars' ? 'mars' : m === 'rush-earth' ? 'earth' : null);

export interface Square {
  market: TogetherMarket;
  separationDeg: number;
  stormMinutes: number;
}

export interface RunResult {
  servedPct: number;
  /** Rush markets only: customers served at the rushed desk during the rush, as a share of those who arrived there. */
  rushServedPct?: number;
  unitsFilled: number;
  over: boolean;
  allowanceShared: number;
  unitsCancelled: number;
  /** Mark-to-market value at the end of the run. */
  profit: number;
}

export interface Side {
  servedPct: number;
  unitsFilled: number;
  runsOver: number;
  allowanceShared: number;
  unitsCancelled: number;
}

export interface SquareResult extends Square {
  delayMin: number;
  seeds: number;
  together: Side;
  alone: Side;
  /** Seeds in which together served a larger share of customers than alone. */
  togetherServedMore: number;
}

export interface Summary {
  runs: number;
  together: Side;
  alone: Side;
  /** Together's served share minus alone's, in percentage points. */
  gainPoints: number;
  /** The same gain relative to alone, in percent. */
  gainRelativePct: number;
  togetherServedMore: number;
}

/** One seed of one square, both ways. Kept per seed so any set of seeds can be judged on its own. */
export interface SeedPair {
  seed: number;
  together: RushRun;
  alone: RushRun;
}

export interface RushRun {
  /** Customers served overall, percent. */
  served: number;
  /** Customers served at the rushed desk during the rush, percent. */
  rush: number;
  shared: number;
  cancelled: number;
  over: boolean;
}

export interface RushSquare extends Square {
  market: RushMarket;
  delayMin: number;
  perSeed: SeedPair[];
}

export interface TogetherFile {
  seeds: number[];
  squares: SquareResult[];
  overall: Summary;
  byMarket: Record<Market, Summary>;
  /** A rush at one desk, both ways, per seed (step 13). Absent in files written before it. */
  rush?: { window: { from: number; to: number; times: number; sellProb: number }; squares: RushSquare[] };
}

/** One run of our bank on one square's storm: exactly the events the survival map uses, on our bank's world alone. */
export function runOurs(sq: Square, seed: number, cfg: SimConfig): RunResult {
  const desk = rushedDesk(sq.market);
  const s = cellScenario({ ...sq, market: desk ? 'calm' : (sq.market as Market) }, seed);
  const w = new World({ strategy: 'leased', seed, separationDeg: s.separationDeg, cfg });
  const events: ScenarioEvent[] = desk
    ? [...s.events, ...rushEvents(desk, cfg.sellProb[desk])].map((e, i) => ({ e, i })).sort((x, y) => x.e.at - y.e.at || x.i - y.i).map((x) => x.e)
    : [...s.events];
  let rushStart: { served: number; arrived: number } | null = null;
  let rushEnd: { served: number; arrived: number } | null = null;
  let next = 0;
  const apply = () => {
    while (next < events.length && w.now >= events[next].at) {
      const e = events[next++];
      if (e.kind === 'blackout') w.blackout = e.on;
      else if (e.kind === 'panic') w.panic = e.on;
      else if (e.kind === 'flow') w.setFlow(e.body, e.sellProb);
      else if (e.kind === 'demand') w.setDemand(e.body, e.times);
    }
  };
  const mark = () => (desk ? { served: w.desks[desk].served, arrived: w.arrivedAt[desk] } : null);
  apply();
  while (w.now < s.durationMin) {
    // Snapshots at the edges of the rush window, before that step's customers arrive.
    if (desk && rushStart === null && w.now >= RUSH.from) rushStart = mark();
    if (desk && rushEnd === null && w.now >= RUSH.to) rushEnd = mark();
    w.step();
    apply();
  }
  if (desk && rushEnd === null) rushEnd = mark();
  const rush =
    rushStart && rushEnd
      ? { rushServedPct: (100 * (rushEnd.served - rushStart.served)) / Math.max(1, rushEnd.arrived - rushStart.arrived) }
      : {};
  return {
    ...rush,
    servedPct: (100 * w.metrics.served) / Math.max(1, w.metrics.arrived),
    unitsFilled: w.metrics.volFilled,
    over: w.metrics.breachTicks > 0,
    allowanceShared: w.allowanceShared(),
    unitsCancelled: w.metrics.nettedUnits,
    profit: w.pnl(),
  };
}

const round = (x: number, d = 4) => Number(x.toFixed(d));
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

function side(rs: RunResult[]): Side {
  return {
    servedPct: round(mean(rs.map((r) => r.servedPct))),
    unitsFilled: round(mean(rs.map((r) => r.unitsFilled))),
    runsOver: rs.filter((r) => r.over).length,
    allowanceShared: round(mean(rs.map((r) => r.allowanceShared))),
    unitsCancelled: round(mean(rs.map((r) => r.unitsCancelled))),
  };
}

export function measureSquare(sq: Square, seeds: number[] = TOGETHER_SEEDS): { result: SquareResult; pairs: [RunResult, RunResult][] } {
  const pairs = seeds.map((seed) => [runOurs(sq, seed, DEFAULT_CONFIG), runOurs(sq, seed, ALONE)] as [RunResult, RunResult]);
  return {
    pairs,
    result: {
      ...sq,
      delayMin: round(delayFor(sq.separationDeg), 3),
      seeds: seeds.length,
      together: side(pairs.map((p) => p[0])),
      alone: side(pairs.map((p) => p[1])),
      togetherServedMore: pairs.filter(([t, a]) => t.servedPct > a.servedPct).length,
    },
  };
}

function summary(pairs: [RunResult, RunResult][]): Summary {
  const together = side(pairs.map((p) => p[0]));
  const alone = side(pairs.map((p) => p[1]));
  return {
    runs: pairs.length,
    together,
    alone,
    gainPoints: round(together.servedPct - alone.servedPct),
    gainRelativePct: round((100 * (together.servedPct - alone.servedPct)) / alone.servedPct),
    togetherServedMore: pairs.filter(([t, a]) => t.servedPct > a.servedPct).length,
  };
}

export function togetherGrid(): Square[] {
  return TOGETHER_MARKETS.flatMap((market) =>
    TOGETHER_SEPARATIONS.flatMap((separationDeg) => TOGETHER_STORMS.map((stormMinutes) => ({ market, separationDeg, stormMinutes }))),
  );
}

export function measureTogether(seeds: number[] = TOGETHER_SEEDS): TogetherFile {
  const all = togetherGrid().map((sq) => measureSquare(sq, seeds));
  const pairsOf = (f: (r: SquareResult) => boolean) => all.filter((x) => f(x.result)).flatMap((x) => x.pairs);
  return {
    seeds,
    squares: all.map((x) => x.result),
    overall: summary(pairsOf(() => true)),
    byMarket: Object.fromEntries(TOGETHER_MARKETS.map((m) => [m, summary(pairsOf((r) => r.market === m))])) as Record<Market, Summary>,
    rush: { window: { ...RUSH }, squares: measureRush(seeds) },
  };
}

// ---- A rush at one desk ------------------------------------------------------------------------------------------

export function rushGrid(): Square[] {
  return RUSH_MARKETS.flatMap((market) =>
    TOGETHER_SEPARATIONS.flatMap((separationDeg) => TOGETHER_STORMS.map((stormMinutes) => ({ market, separationDeg, stormMinutes }))),
  );
}

const rushRun = (r: RunResult): RushRun => ({
  served: round(r.servedPct),
  rush: round(r.rushServedPct ?? 0),
  shared: r.allowanceShared,
  cancelled: r.unitsCancelled,
  over: r.over,
});

/** One square both ways, per seed; `together` is our bank with the given settings (the defaults unless studying them). */
export function measurePairs(sq: Square, seeds: number[], together: SimConfig = DEFAULT_CONFIG): SeedPair[] {
  return seeds.map((seed) => ({ seed, together: rushRun(runOurs(sq, seed, together)), alone: rushRun(runOurs(sq, seed, ALONE)) }));
}

export function measureRush(seeds: number[] = TOGETHER_SEEDS, together: SimConfig = DEFAULT_CONFIG): RushSquare[] {
  return rushGrid().map((sq) => ({
    ...(sq as Square & { market: RushMarket }),
    delayMin: round(delayFor(sq.separationDeg), 3),
    perSeed: measurePairs(sq, seeds, together),
  }));
}

/** Pairs of the given squares, keeping only the given seeds. */
export const pairsFor = (squares: { perSeed: SeedPair[] }[], seeds: number[]) =>
  squares.flatMap((q) => q.perSeed.filter((p) => seeds.includes(p.seed)));

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

/**
 * G: points more customers served at the rushed desk during the rush, together minus alone, over the no-storm squares
 * of both rush markets, on the given seeds.
 */
export function rushG(squares: RushSquare[], seeds: number[]): number {
  const pairs = pairsFor(squares.filter((q) => q.stormMinutes === 0), seeds);
  return avg(pairs.map((p) => p.together.rush - p.alone.rush));
}

/** Means over pairs: served overall and at the rushed desk, both ways, and what was shared and cancelled. */
export function rushMeans(pairs: SeedPair[]) {
  return {
    runs: pairs.length,
    servedTogether: avg(pairs.map((p) => p.together.served)),
    servedAlone: avg(pairs.map((p) => p.alone.served)),
    rushTogether: avg(pairs.map((p) => p.together.rush)),
    rushAlone: avg(pairs.map((p) => p.alone.rush)),
    shared: avg(pairs.map((p) => p.together.shared)),
    cancelled: avg(pairs.map((p) => p.together.cancelled)),
    over: pairs.filter((p) => p.together.over || p.alone.over).length,
    rushWins: pairs.filter((p) => p.together.rush > p.alone.rush).length,
  };
}
