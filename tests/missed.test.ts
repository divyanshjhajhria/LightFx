import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { grid, sweepCell } from '../src/sim/sweep';
import { STRATEGIES } from '../src/sim/types';
import type { Customer } from '../src/sim/types';
import { World } from '../src/sim/world';

/** A world with no background customers, so each test's customer is the only one. */
const quiet = (strategy: 'leased' | 'naive' | 'central', separationDeg = 60) =>
  new World({ strategy, seed: 1, separationDeg, cfg: { ...DEFAULT_CONFIG, customerRate: 0 } });

/** Hand one customer to the world, through exactly the path every customer takes. */
const arrive = (w: World, c: Partial<Customer>) =>
  (w as unknown as { handleCustomer(c: Customer): void }).handleCustomer({
    id: 1,
    at: 'mars',
    side: 'sell',
    size: 3,
    tol: 1,
    patience: 5,
    arrivedAt: w.now,
    ...c,
  });

describe('why customers are missed', () => {
  it('price: the quote was further from fair than the customer would accept', () => {
    const w = quiet('leased');
    arrive(w, { tol: 0 });
    expect(w.missed.mars).toEqual({ price: 1, room: 0, safe: 0, noAnswer: 0 });
    expect(w.metrics.served).toBe(0);
  });

  it('room: the desk had no allowance left', () => {
    const w = quiet('leased');
    w.desks.mars.pos = w.desks.mars.budget()!;
    arrive(w, { side: 'sell' }); // the desk would have to buy
    expect(w.missed.mars).toEqual({ price: 0, room: 1, safe: 0, noAnswer: 0 });
  });

  it('room, part-filled: the customer counts as served, and as cut short', () => {
    const w = quiet('leased');
    w.desks.mars.pos = w.desks.mars.budget()! - 1;
    arrive(w, { side: 'sell', size: 3 });
    // metrics.served is totalled from the desks at the end of each step; the desk's own count is immediate.
    expect(w.desks.mars.served).toBe(1);
    expect(w.partFilled.mars).toBe(1);
    expect(w.missedTotal()).toEqual({ price: 0, room: 0, safe: 0, noAnswer: 0 });
  });

  it('playing safe: our desk, out of touch for an hour, takes only trades that lower its risk', () => {
    const w = quiet('leased');
    w.blackout = true;
    while (w.now < w.cfg.leaseDuration + 30) w.step();
    expect(w.desks.mars.mode(w.now)).toBe('reduce-only');
    arrive(w, { side: 'sell' });
    expect(w.missed.mars).toEqual({ price: 0, room: 0, safe: 1, noAnswer: 0 });
  });

  it('no answer: the request to Earth was lost in a storm, and the customer gave up', () => {
    const w = quiet('central', 150);
    w.blackout = true;
    arrive(w, { at: 'mars', patience: 5 });
    expect(w.missedTotal().noAnswer).toBe(0);
    while (w.now < 5 + 2 * 60 + 1) w.step();
    expect(w.missed.mars).toEqual({ price: 0, room: 0, safe: 0, noAnswer: 1 });
  });

  it('room, at the bank that asks Earth: head office declined, so the silence was for lack of room', () => {
    const w = quiet('central', 0);
    // Head office believes the bank is at its limit, so it declines anything that adds to it.
    (w.desks.earth as unknown as { upper: number }).upper = w.cfg.limit;
    arrive(w, { at: 'mars', side: 'sell', patience: 5 });
    while (w.now < 5 + 2 * 60 + 1) w.step();
    expect(w.missed.mars).toEqual({ price: 0, room: 1, safe: 0, noAnswer: 0 });
  });

  it('counts customers still waiting on Earth at the end of a run as having had no answer', () => {
    const w = quiet('central', 150);
    w.blackout = true;
    arrive(w, { at: 'mars' });
    w.step();
    expect(w.countStillWaiting()).toEqual({ price: 0, room: 0, safe: 0, noAnswer: 1 });
  });

  it('served plus the four reasons is 100% for every bank, across a spread of squares', () => {
    const cells = grid().filter((_, i) => i % 13 === 0);
    expect(cells.length).toBeGreaterThan(8);
    for (const p of cells) {
      const c = sweepCell(p, [1, 2]);
      for (const b of STRATEGIES) {
        const m = c.banks[b].missedPctMean!;
        const sum = c.banks[b].servedPctMean + m.price + m.room + m.safe + m.noAnswer;
        expect(Math.abs(sum - 100)).toBeLessThan(0.001);
        if (b !== 'leased') expect(m.safe).toBe(0);
        if (b !== 'central') expect(m.noAnswer).toBe(0);
      }
    }
  }, 120_000);
});
