import { describe, expect, it } from 'vitest';
import { runScenario } from '../src/sim/scenario';
import { MARKETS, cellScenario, grid, runCell, sweepCell } from '../src/sim/sweep';
import { STRATEGIES } from '../src/sim/types';

describe('the survival map sweep', () => {
  it('is deterministic', () => {
    const p = { market: 'panic' as const, separationDeg: 90, stormMinutes: 60 };
    expect(sweepCell(p, [1, 2])).toEqual(sweepCell(p, [1, 2]));
  });

  it('has no storm and no panic at all in the no-storm column, for every market', () => {
    for (const market of MARKETS) {
      const s = cellScenario({ market, separationDeg: 60, stormMinutes: 0 }, 1);
      expect(s.events.filter((e) => e.kind === 'blackout' || e.kind === 'panic')).toEqual([]);
      expect(s.durationMin).toBe(240);
      expect(s.events.some((e) => e.kind === 'note' || e.kind === 'speed')).toBe(false);
    }
  });

  it('builds each storm exactly as specified', () => {
    const s = cellScenario({ market: 'imbalance', separationDeg: 150, stormMinutes: 180 }, 7);
    expect(s.durationMin).toBe(420);
    expect(s.seed).toBe(7);
    expect(s.events).toEqual([
      { at: 0, kind: 'flow', body: 'earth', sellProb: 0.65 },
      { at: 0, kind: 'flow', body: 'mars', sellProb: 0.35 },
      { at: 120, kind: 'blackout', on: true },
      { at: 300, kind: 'blackout', on: false },
    ]);
    expect(cellScenario({ market: 'panic', separationDeg: 150, stormMinutes: 180 }, 1).name).toBe('Panic, 3 h storm, Mars 20 min away');
  });

  it('THE SAFETY CLAIM: our bank and the bank that asks Earth are never over the limit, anywhere on the grid', () => {
    const failures: string[] = [];
    for (const p of grid()) {
      for (const seed of [1, 2, 3]) {
        const r = runCell(p, seed);
        for (const b of ['leased', 'central'] as const) {
          if (r.banks[b].breached) failures.push(`${b} ${p.market} ${p.separationDeg} ${p.stormMinutes} seed ${seed}`);
        }
      }
    }
    expect(grid()).toHaveLength(144);
    expect(failures).toEqual([]);
  }, 120_000);

  it('the bank that trusts old news does break in a long panic storm with Mars far away', () => {
    const c = sweepCell({ market: 'panic', separationDeg: 150, stormMinutes: 180 }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(c.banks.naive.breachedRuns).toBeGreaterThan(0);
  });

  it('in a long calm storm the Mars office of the bank that asks Earth serves nobody, and ours keeps serving', () => {
    const c = sweepCell({ market: 'calm', separationDeg: 150, stormMinutes: 180 }, [1, 2, 3]);
    expect(c.banks.central.marsServedInStormMean).toBe(0);
    expect(c.banks.leased.marsServedInStormMean).toBeGreaterThan(0);
  });

  it("is exactly what runScenario gives for that cell's scenario and seed", () => {
    const p = { market: 'panic' as const, separationDeg: 120, stormMinutes: 90 };
    const fromSweep = runCell(p, 5).arena;
    const direct = runScenario(cellScenario(p, 5)).arena;
    for (const s of STRATEGIES) {
      expect(fromSweep.worlds[s].metrics).toEqual(direct.worlds[s].metrics);
      expect(fromSweep.worlds[s].pnl()).toBe(direct.worlds[s].pnl());
    }
    const one = sweepCell(p, [5]);
    const w = direct.worlds.naive;
    expect(one.banks.naive.breachedRuns).toBe(w.metrics.breachTicks > 0 ? 1 : 0);
    expect(one.banks.naive.minutesOverMean).toBe(Number((w.metrics.breachTicks * w.cfg.dt).toFixed(4)));
    expect(one.banks.naive.peakOverLimitMax).toBe(Number((w.metrics.maxAbsTotal / w.cfg.limit).toFixed(4)));
  });
});
