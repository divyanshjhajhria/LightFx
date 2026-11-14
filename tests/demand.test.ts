import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { RUSH, applyEvent, rushEvents, runScenario } from '../src/sim/scenario';
import { Arena, World } from '../src/sim/world';

/** Customers that arrived at one desk over a run, counted from the arrivals each step adds. */
function arrivalsAt(body: 'earth' | 'moon' | 'mars', times: number, minutes = 600, seed = 7) {
  const w = new World({ strategy: 'leased', seed, separationDeg: 60 });
  w.setDemand(body, times);
  // Count by switching the other two desks off: every arrival is then at `body`.
  for (const b of ['earth', 'moon', 'mars'] as const) if (b !== body) w.setDemand(b, 0);
  while (w.now < minutes) w.step();
  return w.metrics.arrived;
}

describe('uneven demand', () => {
  it('starts at 1 everywhere, and is clamped to 0 to 10', () => {
    const w = new World({ strategy: 'leased', seed: 1 });
    expect(w.demand).toEqual({ earth: 1, moon: 1, mars: 1 });
    w.setDemand('mars', 40);
    w.setDemand('moon', -2);
    expect(w.demand).toEqual({ earth: 1, moon: 0, mars: 10 });
    expect(DEFAULT_CONFIG.demand).toEqual({ earth: 1, moon: 1, mars: 1 });
  });

  it('demand 0 means no customers at that desk', () => {
    const w = new World({ strategy: 'leased', seed: 3 });
    w.setDemand('mars', 0);
    while (w.now < 300) w.step();
    expect(w.desks.mars.served).toBe(0);
    expect(arrivalsAt('mars', 0)).toBe(0);
  });

  it('demand 3 roughly triples arrivals over 600 minutes', () => {
    const one = arrivalsAt('mars', 1);
    const three = arrivalsAt('mars', 3);
    expect(three / one).toBeGreaterThan(3 * 0.85);
    expect(three / one).toBeLessThan(3 * 1.15);
  });

  it('every bank still sees exactly the same customers', () => {
    const a = new Arena(12, { separationDeg: 90 });
    a.run(100);
    a.setDemand('mars', 3);
    a.setDemand('earth', 0.5);
    a.run(200);
    const { leased, naive, central } = a.worlds;
    expect(naive.metrics.arrived).toBe(leased.metrics.arrived);
    expect(central.metrics.arrived).toBe(leased.metrics.arrived);
    expect(naive.metrics.volRequested).toBe(leased.metrics.volRequested);
  });

  it('a rush is three times the customers at one desk, mostly selling, from minute 120 to 300', () => {
    expect(RUSH).toEqual({ from: 120, to: 300, times: 3, sellProb: 0.8 });
    const a = new Arena(2);
    const ev = rushEvents('mars');
    for (const e of ev.filter((x) => x.at === 120)) applyEvent(a, e);
    expect(a.worlds.leased.demand.mars).toBe(3);
    expect(a.worlds.central.flow.mars).toBe(0.8);
    for (const e of ev.filter((x) => x.at === 300)) applyEvent(a, e);
    expect(a.worlds.naive.demand.mars).toBe(1);
    expect(a.worlds.naive.flow.mars).toBe(0.5);
    // The Director plays demand events like any other.
    const run = runScenario({ id: 'r', name: 'r', summary: '', seed: 4, separationDeg: 60, durationMin: 200, events: rushEvents('earth') });
    expect(run.arena.worlds.leased.demand.earth).toBe(3);
  });
});
