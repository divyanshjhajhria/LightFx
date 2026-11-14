// Do our bank's desks do better together than alone? The same storms, the same seeds, our bank run twice: together
// (the defaults: sharing spare allowance, cancelling opposite positions) and alone (neither: each desk keeps to its own
// starting allowance). Both are safe by construction; the question is how many customers each serves.
import { DEFAULT_CONFIG } from './config';
import type { SimConfig } from './config';
import { cellScenario, delayFor } from './sweep';
import type { Market } from './sweep';
import { World } from './world';

export const TOGETHER_MARKETS: Market[] = ['calm', 'panic', 'imbalance'];
export const TOGETHER_SEPARATIONS = [0, 150];
export const TOGETHER_STORMS = [0, 120, 360];
export const TOGETHER_SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

export const ALONE: SimConfig = { ...DEFAULT_CONFIG, sharing: false, netting: false };

export interface Square {
  market: Market;
  separationDeg: number;
  stormMinutes: number;
}

export interface RunResult {
  servedPct: number;
  unitsFilled: number;
  over: boolean;
  allowanceShared: number;
  unitsCancelled: number;
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

export interface TogetherFile {
  seeds: number[];
  squares: SquareResult[];
  overall: Summary;
  byMarket: Record<Market, Summary>;
}

/** One run of our bank on one square's storm: exactly the events the survival map uses, on our bank's world alone. */
export function runOurs(sq: Square, seed: number, cfg: SimConfig): RunResult {
  const s = cellScenario(sq, seed);
  const w = new World({ strategy: 'leased', seed, separationDeg: s.separationDeg, cfg });
  const events = [...s.events];
  let next = 0;
  const apply = () => {
    while (next < events.length && w.now >= events[next].at) {
      const e = events[next++];
      if (e.kind === 'blackout') w.blackout = e.on;
      else if (e.kind === 'panic') w.panic = e.on;
      else if (e.kind === 'flow') w.setFlow(e.body, e.sellProb);
    }
  };
  apply();
  while (w.now < s.durationMin) {
    w.step();
    apply();
  }
  return {
    servedPct: (100 * w.metrics.served) / Math.max(1, w.metrics.arrived),
    unitsFilled: w.metrics.volFilled,
    over: w.metrics.breachTicks > 0,
    allowanceShared: w.allowanceShared(),
    unitsCancelled: w.metrics.nettedUnits,
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
  };
}
