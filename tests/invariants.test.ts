import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BODIES } from '../src/sim/types';
import type { BodyId } from '../src/sim/types';
import { Arena } from '../src/sim/world';

/** Something the operator (or a judge) does to the system part-way through a run. */
const event = fc.record({
  afterTicks: fc.integer({ min: 1, max: 400 }),
  kind: fc.constantFrom('blackout', 'panic', 'separation', 'cutEarthMoon', 'cutEarthMars', 'cutMoonMars', 'flow'),
  on: fc.boolean(),
  deg: fc.integer({ min: 0, max: 180 }),
  body: fc.constantFrom(...BODIES),
  sellProb: fc.constantFrom(0.2, 0.5, 0.8),
});

function apply(arena: Arena, e: { kind: string; on: boolean; deg: number; body?: BodyId; sellProb?: number }): void {
  if (e.kind === 'flow') arena.setFlow(e.body!, e.sellProb!);
  else if (e.kind === 'blackout') arena.setBlackout(e.on);
  else if (e.kind === 'panic') arena.setPanic(e.on);
  else if (e.kind === 'separation') arena.setSeparation(e.deg);
  else if (e.kind === 'cutEarthMoon') arena.setCut('earth', 'moon', e.on);
  else if (e.kind === 'cutEarthMars') arena.setCut('earth', 'mars', e.on);
  else arena.setCut('moon', 'mars', e.on);
}

describe('safety', () => {
  it('leased and central never exceed the limit, whatever fails and whenever', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), fc.array(event, { maxLength: 12 }), (seed, events) => {
        const arena = new Arena(seed);
        const { leased, central } = arena.worlds;
        const limit = leased.cfg.limit;
        for (const e of [...events, { afterTicks: 400, kind: 'none', on: false, deg: 0 }]) {
          for (let i = 0; i < e.afterTicks; i++) {
            arena.step();
            let budgets = 0;
            for (const b of BODIES) {
              const d = leased.desks[b];
              const budget = d.budget() ?? 0;
              budgets += budget;
              if (Math.abs(d.pos) > budget + 1e-9) return false;
              // Netting: reserved room is never negative, and position plus reserved room stays within budget.
              const { reserved } = d.netting();
              if (reserved < 0) return false;
              if (d.pos < -budget - 1e-9) return false;
              if (d.pos + reserved > budget + 1e-9) return false;
            }
            if (budgets > limit + 1e-9) return false;
            if (Math.abs(leased.totalPosition()) > limit + 1e-9) return false;
            if (Math.abs(central.totalPosition()) > limit + 1e-9) return false;
          }
          apply(arena, e);
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });
});

describe('fair comparison', () => {
  it('is deterministic for a given seed', () => {
    const run = () => {
      const a = new Arena(123, { separationDeg: 150 });
      a.run(60);
      a.setBlackout(true);
      a.run(60);
      return JSON.stringify([a.worlds.leased.metrics, a.worlds.leased.pnl(), a.worlds.naive.pnl()]);
    };
    expect(run()).toBe(run());
  });

  it('gives every strategy the same customers', () => {
    const a = new Arena(99);
    a.setPanic(true);
    a.run(200);
    const { leased, naive, central } = a.worlds;
    expect(naive.metrics.arrived).toBe(leased.metrics.arrived);
    expect(central.metrics.arrived).toBe(leased.metrics.arrived);
    expect(naive.metrics.volRequested).toBe(leased.metrics.volRequested);
    expect(naive.fullPrice()).toBe(leased.fullPrice());
  });
});

describe('the demo scenario', () => {
  for (const seed of [1, 7, 42, 2026]) {
    it(`seed ${seed}: naive breaches in the storm, leased holds and out-serves central`, () => {
      const a = new Arena(seed, { separationDeg: 150 });
      a.run(120);
      a.setBlackout(true);
      a.setPanic(true);
      a.run(180);
      const { leased, naive, central } = a.worlds;
      expect(naive.metrics.maxAbsTotal).toBeGreaterThan(naive.cfg.limit);
      expect(leased.metrics.breachTicks).toBe(0);
      expect(central.metrics.breachTicks).toBe(0);
      expect(leased.metrics.volFilled).toBeGreaterThan(central.metrics.volFilled);
      expect(leased.desks.mars.mode(a.now)).toBe('reduce-only');
    });
  }
});
