// The survival map's data: many storms across a grid of conditions, each run through exactly the code the app uses.
import type { SimConfig } from './config';
import { lightDelayMin, makeOrbit } from './orbits';
import { runScenario } from './scenario';
import type { Director, Scenario, ScenarioEvent } from './scenario';
import { STRATEGIES } from './types';
import type { StrategyId } from './types';
import type { Arena, World } from './world';

export type Market = 'calm' | 'panic' | 'imbalance';

export interface CellParams {
  market: Market;
  /** Where Mars is. */
  separationDeg: number;
  /** 0 means no storm at all. */
  stormMinutes: number;
}

export interface BankResult {
  /** Runs with any time over the limit. */
  breachedRuns: number;
  /** Mean over all runs, including zeros. */
  minutesOverMean: number;
  /** Worst (peak |total| / limit) seen. */
  peakOverLimitMax: number;
  /** Customers served / customers arrived, x100, averaged over runs. */
  servedPctMean: number;
  /** Customers the Mars desk served during the storm, averaged over runs. */
  marsServedInStormMean: number;
  /**
   * Customers who left with nothing, by reason, as a share of customers arrived, percent, averaged over runs (step 15).
   * Absent in files written before it. Served plus these four is 100.
   */
  missedPctMean?: MissedShares;
}

export interface MissedShares {
  /** The quote was outside what the customer would accept. */
  price: number;
  /** No allowance or limit left. */
  room: number;
  /** The desk was playing safe (our bank only). */
  safe: number;
  /** Left waiting on head office, or the request or answer was lost (the bank that asks Earth only). */
  noAnswer: number;
}

export interface CellResult extends CellParams {
  runs: number;
  /** One-way light delay Earth to Mars at the start, in minutes. */
  delayMin: number;
  /** Simulation steps across every run and every bank in this cell. */
  ticks: number;
  banks: Record<StrategyId, BankResult>;
}

export interface SweepFile {
  limit: number;
  seedsPerCell: number;
  totalRuns: number;
  totalTicks: number;
  cells: CellResult[];
}

export const MARKETS: Market[] = ['calm', 'panic', 'imbalance'];
export const SEPARATIONS = [0, 30, 60, 90, 120, 150];
export const STORM_MINUTES = [0, 30, 60, 90, 120, 180, 240, 360];
/** Calm minutes before the storm and after it. */
export const BEFORE = 120;
export const AFTER = 120;

export const MARKET_NAME: Record<Market, string> = { calm: 'Calm market', panic: 'Panic', imbalance: 'One-way customers' };

/** "No storm", "30 min", "1 h", "1.5 h"... */
export function stormLabel(minutes: number): string {
  if (minutes === 0) return 'No storm';
  if (minutes < 60) return `${minutes} min`;
  return `${Number((minutes / 60).toFixed(1))} h`;
}

export const delayFor = (separationDeg: number) => lightDelayMin(makeOrbit(separationDeg), 'earth', 'mars');

/** One cell's storm as a scenario: calm for two hours, the storm, then two hours to recover. */
export function cellScenario(p: CellParams, seed: number): Scenario {
  const end = BEFORE + p.stormMinutes;
  const events: ScenarioEvent[] = [];
  if (p.market === 'imbalance') {
    events.push({ at: 0, kind: 'flow', body: 'earth', sellProb: 0.65 }, { at: 0, kind: 'flow', body: 'mars', sellProb: 0.35 });
  }
  if (p.stormMinutes > 0) {
    events.push({ at: BEFORE, kind: 'blackout', on: true });
    if (p.market === 'panic') events.push({ at: BEFORE, kind: 'panic', on: true });
    events.push({ at: end, kind: 'blackout', on: false });
    if (p.market === 'panic') events.push({ at: end, kind: 'panic', on: false });
  }
  const storm = p.stormMinutes === 0 ? 'no storm' : `${stormLabel(p.stormMinutes)} storm`;
  return {
    id: `cell-${p.market}-${p.separationDeg}-${p.stormMinutes}`,
    name: `${MARKET_NAME[p.market]}, ${storm}, Mars ${Math.round(delayFor(p.separationDeg))} min away`,
    summary: 'One cell of the survival map.',
    seed,
    separationDeg: p.separationDeg,
    durationMin: end + AFTER,
    events,
  };
}

function playTo(run: { arena: Arena; director: Director }, t: number): void {
  while (run.arena.now < t) {
    run.arena.step();
    run.director.advance();
  }
}

/** What one seed of one cell gives each bank, plus the steps it took. */
export function runCell(p: CellParams, seed: number, cfg?: SimConfig) {
  const s = cellScenario(p, seed);
  // Up to the storm with runScenario, then on with the same step-and-advance loop, so it is runScenario by construction.
  const run = runScenario(s, BEFORE, cfg);
  const marsAtStart = Object.fromEntries(STRATEGIES.map((b) => [b, run.arena.worlds[b].desks.mars.served]));
  playTo(run, BEFORE + p.stormMinutes);
  const marsAtEnd = Object.fromEntries(STRATEGIES.map((b) => [b, run.arena.worlds[b].desks.mars.served]));
  playTo(run, s.durationMin);
  const banks = Object.fromEntries(
    STRATEGIES.map((b) => {
      const w = run.arena.worlds[b];
      const m = w.metrics;
      return [
        b,
        {
          breached: m.breachTicks > 0,
          minutesOver: m.breachTicks * w.cfg.dt,
          peak: m.maxAbsTotal / w.cfg.limit,
          servedPct: (100 * m.served) / Math.max(1, m.arrived),
          marsServedInStorm: p.stormMinutes > 0 ? marsAtEnd[b] - marsAtStart[b] : 0,
          missedPct: missedShares(w),
        },
      ];
    }),
  ) as Record<
    StrategyId,
    { breached: boolean; minutesOver: number; peak: number; servedPct: number; marsServedInStorm: number; missedPct: MissedShares }
  >;
  const steps = Math.round(s.durationMin / run.arena.worlds.leased.cfg.dt);
  return { banks, ticks: steps * STRATEGIES.length, arena: run.arena };
}

const round = (x: number, d = 4) => Number(x.toFixed(d));

/** Why customers left with nothing, as shares of those who arrived, percent, counting anyone still waiting at the end. */
export function missedShares(w: World): MissedShares {
  const t = w.missedTotal();
  const still = w.countStillWaiting();
  const n = Math.max(1, w.metrics.arrived);
  return {
    price: (100 * (t.price + still.price)) / n,
    room: (100 * (t.room + still.room)) / n,
    safe: (100 * (t.safe + still.safe)) / n,
    noAnswer: (100 * (t.noAnswer + still.noAnswer)) / n,
  };
}

export function sweepCell(p: CellParams, seeds: number[], cfg?: SimConfig): CellResult {
  const runs = seeds.map((seed) => runCell(p, seed, cfg));
  const n = runs.length;
  const mean = (f: (r: (typeof runs)[number]) => number) => runs.reduce((s, r) => s + f(r), 0) / n;
  const banks = Object.fromEntries(
    STRATEGIES.map((b) => [
      b,
      {
        breachedRuns: runs.filter((r) => r.banks[b].breached).length,
        minutesOverMean: round(mean((r) => r.banks[b].minutesOver)),
        peakOverLimitMax: round(Math.max(...runs.map((r) => r.banks[b].peak))),
        servedPctMean: round(mean((r) => r.banks[b].servedPct)),
        marsServedInStormMean: round(mean((r) => r.banks[b].marsServedInStorm)),
        missedPctMean: {
          price: round(mean((r) => r.banks[b].missedPct.price)),
          room: round(mean((r) => r.banks[b].missedPct.room)),
          safe: round(mean((r) => r.banks[b].missedPct.safe)),
          noAnswer: round(mean((r) => r.banks[b].missedPct.noAnswer)),
        },
      },
    ]),
  ) as Record<StrategyId, BankResult>;
  return {
    ...p,
    runs: n,
    delayMin: round(delayFor(p.separationDeg), 3),
    ticks: runs.reduce((s, r) => s + r.ticks, 0),
    banks,
  };
}

/** Every cell of the grid, in a fixed order: market, then distance, then storm length. */
export function grid(): CellParams[] {
  return MARKETS.flatMap((market) =>
    SEPARATIONS.flatMap((separationDeg) => STORM_MINUTES.map((stormMinutes) => ({ market, separationDeg, stormMinutes }))),
  );
}
