import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { SimConfig } from '../src/sim/config';
import { lightDelayMin } from '../src/sim/orbits';
import type { TraceEvent } from '../src/sim/trace';
import { STRATEGIES } from '../src/sim/types';
import type { StrategyId } from '../src/sim/types';
import { Arena, World } from '../src/sim/world';

/** No background customers, so only the visitor moves positions. */
const QUIET: SimConfig = { ...DEFAULT_CONFIG, customerRate: 0 };

function world(strategy: StrategyId, separationDeg = 0, cfg: SimConfig = QUIET): World {
  return new World({ strategy, seed: 1, cfg, separationDeg });
}

function runFor(w: World, minutes: number): void {
  const end = w.now + minutes;
  while (w.now < end - 1e-9) w.step();
}

const kinds = (tr: readonly TraceEvent[]) => tr.map((e) => e.kind);
const near = (a: number, b: number, tol = 0.5) => Math.abs(a - b) <= tol;

describe('visitor trades', () => {
  it('consume no random numbers and count as one more arrival everywhere', () => {
    const a = new Arena(77, { separationDeg: 60 });
    const b = new Arena(77, { separationDeg: 60 });
    a.run(30);
    b.run(30);
    a.placeTrade('mars', 'sell', 5);
    a.run(170);
    b.run(170);
    for (const s of STRATEGIES) {
      expect(a.worlds[s].fullPrice()).toBe(b.worlds[s].fullPrice());
      expect(a.worlds[s].metrics.arrived - b.worlds[s].metrics.arrived).toBe(1);
    }
  });

  it('leased, calm: filled on the spot, then each peer is told and hears at the landing time', () => {
    const w = world('leased');
    runFor(w, 10);
    const before = w.desks.mars.budget()!;
    w.placeTrade('mars', 'sell', 5, 1);
    runFor(w, 30);
    const tr = w.trace(1);
    expect(kinds(tr)).toEqual(['placed', 'filled', 'told', 'told', 'heard', 'heard']);
    const filled = tr[1] as Extract<TraceEvent, { kind: 'filled' }>;
    expect(filled.units).toBe(5);
    expect(filled.waited).toBe(0);
    expect(filled.allowanceLeft).toBe(before - 5);
    const told = tr.filter((e) => e.kind === 'told') as Extract<TraceEvent, { kind: 'told' }>[];
    expect(told.map((e) => e.to)).toEqual(['earth', 'moon']);
    for (const t of told) {
      const heard = tr.find((e) => e.kind === 'heard' && e.body === t.to)!;
      expect(heard.kind === 'heard' && heard.from).toBe('mars');
      // Heard at the first tick on or after the landing time.
      expect(heard.t).toBeGreaterThanOrEqual(t.landsAt - 1e-9);
      expect(heard.t).toBeLessThan(t.landsAt + w.cfg.dt + 1e-9);
    }
  });

  it('leased, blackout: one "not delivered" per peer however long it lasts, then told and heard once it ends', () => {
    const w = world('leased');
    runFor(w, 10);
    w.blackout = true;
    w.placeTrade('mars', 'sell', 5, 1);
    runFor(w, 90);
    let tr = w.trace(1);
    expect(kinds(tr)).toEqual(['placed', 'filled', 'not-delivered', 'not-delivered']);
    expect(tr.filter((e) => e.kind === 'told')).toHaveLength(0);
    w.blackout = false;
    runFor(w, 30);
    tr = w.trace(1);
    for (const peer of ['earth', 'moon'] as const) {
      const told = tr.findIndex((e) => e.kind === 'told' && e.to === peer);
      const heard = tr.findIndex((e) => e.kind === 'heard' && e.body === peer);
      expect(told).toBeGreaterThan(0);
      expect(heard).toBeGreaterThan(told);
    }
  });

  it('leased refusals say why: allowance used up, or playing safe', () => {
    const w = world('leased');
    runFor(w, 10);
    w.desks.mars.pos = w.desks.mars.budget()!;
    w.placeTrade('mars', 'sell', 5, 1);
    expect(w.trace(1)[1]).toMatchObject({ kind: 'refused', reason: 'allowance' });

    const v = world('leased');
    v.blackout = true;
    runFor(v, v.cfg.leaseDuration + 10);
    expect(v.desks.mars.mode(v.now)).toBe('reduce-only');
    v.desks.mars.pos = 0;
    v.placeTrade('mars', 'sell', 5, 2);
    expect(v.trace(2)[1]).toMatchObject({ kind: 'refused', reason: 'playing-safe' });
  });

  it('central, calm, far side: Mars asks Earth, Earth approves, the answer lands and the trade fills', () => {
    const w = world('central', 150);
    runFor(w, 5);
    const t0 = w.now;
    const delay = lightDelayMin(w.orbit, 'mars', 'earth');
    w.placeTrade('mars', 'sell', 5, 1);
    runFor(w, 60);
    const tr = w.trace(1);
    expect(kinds(tr)).toEqual(['placed', 'asked-earth', 'earth-approved', 'filled']);
    expect(near(tr[2].t - t0, 20.3)).toBe(true);
    expect(near(tr[2].t - t0, delay, w.cfg.dt + 1e-9)).toBe(true);
    const filled = tr[3] as Extract<TraceEvent, { kind: 'filled' }>;
    expect(near(filled.t - t0, 40.6)).toBe(true);
    expect(near(filled.waited, 40.6)).toBe(true);
    expect(w.totalPosition()).toBe(5);
  });

  it('central, blackout: the request is lost and nothing else happens', () => {
    const w = world('central', 150);
    runFor(w, 5);
    w.blackout = true;
    w.placeTrade('mars', 'sell', 5, 1);
    runFor(w, 55);
    expect(kinds(w.trace(1))).toEqual(['placed', 'asked-earth', 'not-delivered']);
    expect(w.trace(1)[2]).toMatchObject({ body: 'mars', to: 'earth' });
    expect(w.totalPosition()).toBe(0);
    // Once the visitor's patience runs out they walk away, and the story ends there.
    runFor(w, 60);
    const tr = w.trace(1);
    expect(kinds(tr)).toEqual(['placed', 'asked-earth', 'not-delivered', 'gave-up']);
    expect(tr[3].kind === 'gave-up' && near(tr[3].waited, w.cfg.visitorPatience, w.cfg.dt + 1e-9)).toBe(true);
    expect(w.totalPosition()).toBe(0);
  });

  it('central, giving up: the late approval changes nothing and Earth releases its bound', () => {
    const w = world('central', 150);
    runFor(w, 5);
    const t0 = w.now;
    w.placeTrade('mars', 'sell', 5, 1);
    runFor(w, 10);
    w.cancelTrade(1);
    const gave = w.trace(1).find((e) => e.kind === 'gave-up');
    expect(gave && gave.kind === 'gave-up' && near(gave.waited, 10, w.cfg.dt + 1e-9)).toBe(true);
    runFor(w, 80);
    // The late answer closes the story without changing anything.
    expect(kinds(w.trace(1))).toEqual(['placed', 'asked-earth', 'gave-up', 'earth-approved', 'too-late']);
    expect(w.totalPosition()).toBe(0);
    expect(w.desks.mars.pos).toBe(0);
    expect(w.desks.earth.believedTotal()).toEqual({ low: 0, high: 0 });
    expect(w.now - t0).toBeGreaterThan(3 * lightDelayMin(w.orbit, 'mars', 'earth'));
  });

  it('central, at Earth: head office fills on the spot', () => {
    const w = world('central', 150);
    w.placeTrade('earth', 'buy', 5, 1);
    expect(w.trace(1)[1]).toMatchObject({ kind: 'filled', units: 5, waited: 0, allowanceLeft: null });
    expect(w.desks.earth.pos).toBe(-5);
  });

  it('naive: Earth believes the old total until the news lands', () => {
    const w = world('naive');
    runFor(w, 10);
    w.blackout = true;
    w.placeTrade('mars', 'sell', 5, 1);
    runFor(w, 60);
    expect(w.totalPosition()).toBe(5);
    expect(w.desks.earth.believedTotal()).toEqual({ low: 0, high: 0 });
    w.blackout = false;
    while (!w.trace(1).some((e) => e.kind === 'heard' && e.body === 'earth')) w.step();
    expect(w.desks.earth.believedTotal()).toEqual({ low: 5, high: 5 });
  });

  it('keeps the story of the last 10 trades only', () => {
    const w = world('leased');
    for (let t = 1; t <= 12; t++) w.placeTrade('moon', t % 2 ? 'buy' : 'sell', 1, t);
    expect(w.trace(1)).toEqual([]);
    expect(w.trace(2)).toEqual([]);
    expect(w.trace(3).length).toBeGreaterThan(0);
    expect(w.trace(12).length).toBeGreaterThan(0);
  });
});
