import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { percentile5, sweepCell } from '../src/sim/sweep';
import type { BankResult, CellResult, SweepFile } from '../src/sim/sweep';
import { STRATEGIES } from '../src/sim/types';
import { summarise } from '../src/ui/sweepSummary';

describe('profit in the sweep', () => {
  it('is reproducible, and each square keeps its mean, 5th percentile and worst run consistent with every seed', () => {
    const p = { market: 'panic' as const, separationDeg: 150, stormMinutes: 120 };
    const a = sweepCell(p, [1, 2, 3, 4, 5]);
    expect(sweepCell(p, [1, 2, 3, 4, 5])).toEqual(a);
    for (const b of STRATEGIES) {
      const r = a.banks[b];
      expect(r.profitRuns).toHaveLength(5);
      expect(r.profitWorst).toBe(Math.min(...r.profitRuns!));
      expect(r.profitP5).toBe(r.profitWorst); // 5 runs: the 5th percentile, nearest rank, is the worst
      expect(Math.abs(r.profitMean! - r.profitRuns!.reduce((s, x) => s + x, 0) / 5)).toBeLessThan(1e-3);
    }
  }, 60_000);

  it('the committed sweep.json is what the code gives, every figure, for a storm square', () => {
    const file = JSON.parse(readFileSync('public/sweep.json', 'utf8')) as SweepFile;
    const saved = file.cells.find((c) => c.market === 'calm' && c.separationDeg === 60 && c.stormMinutes === 90)!;
    const seeds = Array.from({ length: file.seedsPerCell }, (_, i) => i + 1);
    expect(sweepCell({ market: 'calm', separationDeg: 60, stormMinutes: 90 }, seeds)).toEqual(saved);
  }, 60_000);

  it('the 5th percentile is nearest rank', () => {
    expect(percentile5([3, 1, 2])).toBe(1);
    expect(percentile5(Array.from({ length: 40 }, (_, i) => 40 - i))).toBe(2);
  });
});

describe('profit in the summary, a hand-checkable case', () => {
  const bank = (runs: number[]): BankResult => ({
    breachedRuns: 0,
    minutesOverMean: 0,
    peakOverLimitMax: 0.5,
    servedPctMean: 50,
    marsServedInStormMean: 0,
    profitMean: runs.reduce((s, x) => s + x, 0) / runs.length,
    profitP5: percentile5(runs),
    profitWorst: Math.min(...runs),
    profitRuns: runs,
  });
  const cell = (stormMinutes: number, runs: number[]): CellResult => ({
    market: 'calm',
    separationDeg: 0,
    stormMinutes,
    runs: runs.length,
    delayMin: 4,
    ticks: 0,
    banks: { leased: bank(runs), naive: bank(runs), central: bank(runs) },
  });
  // Storm square A: 1 to 20 (mean 10.5). Storm square B: -9 to 10 (mean 0.5). No-storm square: -100, left out.
  const file: SweepFile = {
    limit: 100,
    seedsPerCell: 20,
    totalRuns: 41,
    totalTicks: 0,
    cells: [
      cell(60, Array.from({ length: 20 }, (_, i) => i + 1)),
      cell(120, Array.from({ length: 20 }, (_, i) => i - 9)),
      cell(0, [-100]),
    ],
  };

  it('mean over all 40 storm runs, 5th percentile of the 40 pooled (the 2nd lowest), worst run', () => {
    expect(summarise(file).overall.banks.leased.profit).toEqual({ mean: 5.5, p5: -8, worst: -9 });
    expect(summarise(file).byMarket.calm.banks.naive.profit).toEqual({ mean: 5.5, p5: -8, worst: -9 });
  });

  it('leaves profit out for a file written before it was recorded', () => {
    const old: SweepFile = {
      ...file,
      cells: file.cells.map((c) => ({
        ...c,
        banks: Object.fromEntries(
          STRATEGIES.map((b) => {
            const { profitMean: _m, profitP5: _p, profitWorst: _w, profitRuns: _r, ...rest } = c.banks[b];
            return [b, rest];
          }),
        ) as CellResult['banks'],
      })),
    };
    expect(summarise(old).overall.banks.leased.profit).toBeUndefined();
  });
});
