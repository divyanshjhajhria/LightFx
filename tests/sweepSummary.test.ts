import { describe, expect, it } from 'vitest';
import type { BankResult, CellResult, SweepFile } from '../src/sim/sweep';
import { headline, summarise } from '../src/ui/sweepSummary';

const bank = (breachedRuns: number, peak: number, served: number, mars: number): BankResult => ({
  breachedRuns,
  minutesOverMean: breachedRuns * 10,
  peakOverLimitMax: peak,
  servedPctMean: served,
  marsServedInStormMean: mars,
});

const cell = (
  market: CellResult['market'],
  stormMinutes: number,
  runs: number,
  ticks: number,
  b: [BankResult, BankResult, BankResult],
): CellResult => ({ market, separationDeg: 150, stormMinutes, runs, delayMin: 20.3, ticks, banks: { leased: b[0], naive: b[1], central: b[2] } });

// Three storm cells and one no-storm cell (which must be left out).
const file: SweepFile = {
  limit: 100,
  seedsPerCell: 4,
  totalRuns: 16,
  totalTicks: 0,
  cells: [
    cell('calm', 0, 4, 999_000_000, [bank(0, 0.5, 90, 0), bank(4, 9.9, 99, 0), bank(0, 0.4, 10, 0)]),
    cell('calm', 60, 4, 1_000_000, [bank(0, 0.9, 60, 20), bank(1, 1.3, 80, 30), bank(0, 0.6, 40, 0)]),
    cell('panic', 60, 4, 2_000_000, [bank(0, 1.0, 50, 10), bank(3, 2.04, 70, 25), bank(0, 0.8, 30, 0)]),
    cell('panic', 120, 2, 1_250_000, [bank(0, 0.95, 20, 4), bank(2, 1.66, 40, 12), bank(0, 0.7, 10, 0)]),
  ],
};

describe('the sweep summary', () => {
  const s = summarise(file);

  it('counts only storms, and the steps in millions to one decimal', () => {
    expect(s.overall.runs).toBe(10);
    expect(s.overall.ticksMillions).toBe(4.3);
    expect(s.seedsPerCell).toBe(4);
  });

  it('adds up breaches, takes the worst peak and weights served by runs', () => {
    expect(s.overall.banks.naive).toEqual({ breachedRuns: 6, breachedPct: 60, worstPeak: 2, servedPct: (80 * 4 + 70 * 4 + 40 * 2) / 10 });
    expect(s.overall.banks.leased.breachedRuns).toBe(0);
    expect(s.overall.banks.leased.worstPeak).toBe(1);
    expect(s.overall.banks.central.servedPct).toBe((40 * 4 + 30 * 4 + 10 * 2) / 10);
    expect(s.overall.marsServedInStorm).toEqual({ leased: (20 * 4 + 10 * 4 + 4 * 2) / 10, central: 0 });
  });

  it('gives the same figures per market', () => {
    expect(s.byMarket.calm.runs).toBe(4);
    expect(s.byMarket.calm.banks.naive.breachedPct).toBe(25);
    expect(s.byMarket.panic.runs).toBe(6);
    expect(s.byMarket.panic.banks.naive.breachedRuns).toBe(5);
    expect(s.byMarket.panic.banks.naive.worstPeak).toBe(2);
    expect(s.byMarket.imbalance.runs).toBe(0);
  });

  it('writes the headline from the figures, and never hides a breach of ours', () => {
    expect(headline(s.overall)).toEqual({
      text: 'Across 10 simulated storms, our bank was never over its limit. The bank that trusts old news was, in 60% of them.',
      alert: false,
    });
    const bad = summarise({ ...file, cells: file.cells.map((c) => ({ ...c, banks: { ...c.banks, leased: { ...c.banks.leased, breachedRuns: 1 } } })) });
    expect(headline(bad.overall)).toEqual({
      text: 'Across 10 simulated storms, our bank was over its limit in 3 of them (30%). The bank that trusts old news was, in 60% of them.',
      alert: true,
    });
  });
});
