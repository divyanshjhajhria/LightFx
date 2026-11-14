// The headline figures from the survival map, computed from sweep.json, never typed in.
import type { CellResult, Market, SweepFile } from '../sim/sweep';
import { STRATEGIES } from '../sim/types';
import type { StrategyId } from '../sim/types';

export interface BankFigures {
  /** Storms in which this bank was over its limit at any moment. */
  breachedRuns: number;
  breachedPct: number;
  /** Worst peak seen, as a multiple of the limit, to one decimal. */
  worstPeak: number;
  /** Mean share of customers served, in percent. */
  servedPct: number;
}

export interface Figures {
  /** Storms run (cells with a storm, times seeds). */
  runs: number;
  /** Simulation steps in those storms, in millions, to one decimal. */
  ticksMillions: number;
  banks: Record<StrategyId, BankFigures>;
  /** Customers the Mars desk served during the storm, on average per storm. */
  marsServedInStorm: { leased: number; central: number };
}

export interface SweepSummary {
  seedsPerCell: number;
  overall: Figures;
  byMarket: Record<Market, Figures>;
}

function figures(cells: CellResult[]): Figures {
  const runs = cells.reduce((s, c) => s + c.runs, 0);
  const weighted = (f: (c: CellResult) => number) => (runs ? cells.reduce((s, c) => s + f(c) * c.runs, 0) / runs : 0);
  const banks = Object.fromEntries(
    STRATEGIES.map((b) => {
      const breachedRuns = cells.reduce((s, c) => s + c.banks[b].breachedRuns, 0);
      return [
        b,
        {
          breachedRuns,
          breachedPct: runs ? (100 * breachedRuns) / runs : 0,
          worstPeak: Number(Math.max(0, ...cells.map((c) => c.banks[b].peakOverLimitMax)).toFixed(1)),
          servedPct: weighted((c) => c.banks[b].servedPctMean),
        },
      ];
    }),
  ) as Record<StrategyId, BankFigures>;
  return {
    runs,
    ticksMillions: Number((cells.reduce((s, c) => s + c.ticks, 0) / 1e6).toFixed(1)),
    banks,
    marsServedInStorm: {
      leased: weighted((c) => c.banks.leased.marsServedInStormMean),
      central: weighted((c) => c.banks.central.marsServedInStormMean),
    },
  };
}

/** Figures across every cell with a storm, and per market. The no-storm column is left out: it is the baseline. */
export function summarise(data: SweepFile): SweepSummary {
  const storms = data.cells.filter((c) => c.stormMinutes > 0);
  return {
    seedsPerCell: data.seedsPerCell,
    overall: figures(storms),
    byMarket: {
      calm: figures(storms.filter((c) => c.market === 'calm')),
      panic: figures(storms.filter((c) => c.market === 'panic')),
      imbalance: figures(storms.filter((c) => c.market === 'imbalance')),
    },
  };
}

const int = (n: number) => n.toLocaleString('en-GB');

/**
 * The map's headline, from the figures. If our bank was ever over its limit, it says so with the real number
 * (`alert` is then true, for the alert colour); nothing is hidden.
 */
export function headline(f: Figures): { text: string; alert: boolean } {
  const ours = f.banks.leased;
  const old = f.banks.naive;
  const first =
    ours.breachedRuns === 0
      ? `Across ${int(f.runs)} simulated storms, our bank was never over its limit.`
      : `Across ${int(f.runs)} simulated storms, our bank was over its limit in ${int(ours.breachedRuns)} of them (${Math.round(ours.breachedPct)}%).`;
  const second =
    old.breachedRuns === 0
      ? 'Neither was the bank that trusts old news.'
      : `The bank that trusts old news was, in ${Math.round(old.breachedPct)}% of them.`;
  return { text: `${first} ${second}`, alert: ours.breachedRuns > 0 };
}
