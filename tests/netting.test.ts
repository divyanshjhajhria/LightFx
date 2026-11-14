import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { SimConfig } from '../src/sim/config';
import { BODIES } from '../src/sim/types';
import type { BodyId } from '../src/sim/types';
import { World } from '../src/sim/world';

/** No customers, so only netting moves positions. Close approach unless a test says otherwise. */
const QUIET: SimConfig = { ...DEFAULT_CONFIG, customerRate: 0 };

function leasedWorld(pos: Partial<Record<BodyId, number>>, cfg: SimConfig = QUIET, separationDeg = 0): World {
  const w = new World({ strategy: 'leased', seed: 1, cfg, separationDeg });
  for (const b of BODIES) {
    const p = pos[b] ?? 0;
    // Set-ups must start inside each desk's own budget.
    expect(Math.abs(p)).toBeLessThanOrEqual(cfg.alloc[b]);
    w.desks[b].pos = p;
  }
  return w;
}

const ticks = (w: World, minutes: number) => Math.round(minutes / w.cfg.dt);

function sumCash(w: World): number {
  return BODIES.reduce((s, b) => s + w.desks[b].cash, 0);
}

describe('netting', () => {
  it('cancels opposite positions: Earth +20, Mars -15 ends Earth +5, Mars 0', () => {
    const w = leasedWorld({ earth: 20, mars: -15 });
    for (let i = 0; i < ticks(w, 60); i++) w.step();
    expect(w.desks.earth.pos).toBe(5);
    expect(w.desks.mars.pos).toBe(0);
    expect(w.desks.moon.pos).toBe(0);
    expect(w.inFlight().units).toBe(0);
    for (const b of BODIES) expect(w.desks[b].netting().reserved).toBe(0);
    expect(Math.abs(sumCash(w))).toBeLessThan(1e-9);
    expect(w.metrics.nettedUnits).toBe(15);
  });

  it('never swaps: the long desk never goes short and the short desk never goes long', () => {
    const w = leasedWorld({ earth: 10, mars: -10 });
    for (let i = 0; i < ticks(w, 200); i++) {
      w.step();
      expect(w.desks.earth.pos).toBeGreaterThanOrEqual(0);
      expect(w.desks.mars.pos).toBeLessThanOrEqual(0);
    }
    expect(w.desks.earth.pos).toBe(0);
    expect(w.desks.mars.pos).toBe(0);
  });

  it('keeps the true total and the profit constant through every hand-over', () => {
    const w = leasedWorld({ earth: 20, mars: -15 }, { ...QUIET, sigmaEarth: 0, sigmaMars: 0 });
    const pnl0 = w.pnl();
    let sawInFlight = false;
    for (let i = 0; i < ticks(w, 60); i++) {
      w.step();
      if (w.inFlight().units !== 0) sawInFlight = true;
      expect(w.totalPosition()).toBe(5);
      expect(Math.abs(w.pnl() - pnl0)).toBeLessThan(1e-9);
    }
    // The test only means something if a hand-over was actually in flight at some tick.
    expect(sawInFlight).toBe(true);
  });

  it('survives links failing in the middle of an exchange', () => {
    const LINKS: [BodyId, BodyId][] = [
      ['earth', 'moon'],
      ['earth', 'mars'],
      ['moon', 'mars'],
    ];
    const event = fc.record({
      atTick: fc.integer({ min: 0, max: 479 }),
      kind: fc.constantFrom('blackout', 'cut0', 'cut1', 'cut2'),
      on: fc.boolean(),
    });
    fc.assert(
      fc.property(fc.array(event, { maxLength: 16 }), (events) => {
        const w = leasedWorld({ earth: 20, mars: -15 });
        const byTick = new Map<number, typeof events>();
        for (const e of events) byTick.set(e.atTick, [...(byTick.get(e.atTick) ?? []), e]);
        // First 120 minutes: random storms and cuts.
        for (let i = 0; i < ticks(w, 120); i++) {
          for (const e of byTick.get(i) ?? []) {
            if (e.kind === 'blackout') w.blackout = e.on;
            else {
              const [a, b] = LINKS[Number(e.kind.slice(3))];
              w.setCut(a, b, e.on);
            }
          }
          w.step();
          if (w.totalPosition() !== 5) return false;
        }
        // Then everything open for another 120 minutes.
        w.blackout = false;
        for (const [a, b] of LINKS) w.setCut(a, b, false);
        for (let i = 0; i < ticks(w, 120); i++) {
          w.step();
          if (w.totalPosition() !== 5) return false;
        }
        return w.desks.earth.pos === 5 && w.desks.mars.pos === 0 && w.inFlight().units === 0;
      }),
      { numRuns: 100 },
    );
  });

  it('never promises the same units to two long peers', () => {
    const w = leasedWorld({ earth: 8, moon: 6, mars: -10 });
    for (let i = 0; i < ticks(w, 120); i++) {
      w.step();
      expect(w.desks.mars.netting().reserved).toBeLessThanOrEqual(10);
    }
    expect(w.desks.mars.pos).toBe(0);
    expect(w.desks.earth.pos + w.desks.moon.pos).toBe(4);
  });

  it('still applies the minimum when an offer would not flatten the desk', () => {
    const w = leasedWorld({ earth: 2, mars: -10 });
    for (let i = 0; i < ticks(w, 120); i++) {
      w.step();
      expect(w.desks.mars.netting().reserved).toBe(0);
    }
    expect(w.metrics.nettedUnits).toBe(0);
    expect(w.desks.mars.pos).toBe(-10);
    expect(w.desks.earth.pos).toBe(2);
  });

  it('under sustained opposite flow, netting fills more', () => {
    const sellProb = { earth: 0.65, moon: 0.5, mars: 0.35 };
    const vol = (netting: boolean) => {
      let total = 0;
      for (let seed = 1; seed <= 10; seed++) {
        const w = new World({ strategy: 'leased', seed, separationDeg: 60, cfg: { ...DEFAULT_CONFIG, netting, sellProb } });
        for (let i = 0; i < ticks(w, 600); i++) w.step();
        total += w.metrics.volFilled;
      }
      return total;
    };
    expect(vol(true)).toBeGreaterThan(vol(false));
  });

  it('does nothing when switched off', () => {
    const w = new World({ strategy: 'leased', seed: 7, cfg: { ...DEFAULT_CONFIG, netting: false }, separationDeg: 60 });
    for (let i = 0; i < ticks(w, 300); i++) {
      w.step();
      for (const b of BODIES) {
        expect(w.desks[b].netting()).toEqual({ reserved: 0, outUnits: 0, outCash: 0, inUnits: 0, inCash: 0 });
      }
    }
    // Customers did arrive and trade, so the run was not trivially empty.
    expect(w.metrics.volFilled).toBeGreaterThan(0);
  });
});
