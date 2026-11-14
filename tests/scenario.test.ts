import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { SimConfig } from '../src/sim/config';
import { Director, runScenario, startScenario } from '../src/sim/scenario';
import type { Scenario } from '../src/sim/scenario';
import { SCENARIOS } from '../src/sim/scenarios';
import { BODIES, STRATEGIES } from '../src/sim/types';
import { Arena, World } from '../src/sim/world';

const preset = (id: string): Scenario => SCENARIOS.find((s) => s.id === id)!;

const snapshot = (a: Arena) =>
  JSON.stringify(STRATEGIES.map((s) => [a.worlds[s].metrics, a.worlds[s].pnl()]));

/** Step a running scenario until simulated time reaches `t`. */
function playTo(run: { arena: Arena; director: Director }, t: number): void {
  while (run.arena.now < t) {
    run.arena.step();
    run.director.advance();
  }
}

const marsNetted = (w: World) => {
  const n = w.desks.mars.netting();
  return n.outUnits + n.inUnits;
};
const gross = (w: World) => BODIES.reduce((s, b) => s + Math.abs(w.desks[b].pos), 0);

const base: Omit<Scenario, 'events'> = { id: 't', name: 'T', summary: '', seed: 5, separationDeg: 60, durationMin: 30 };

describe('director', () => {
  it('applies an event at the first tick where now >= at, and not before', () => {
    const run = startScenario({ ...base, events: [{ at: 10, kind: 'blackout', on: true }] });
    const w = run.arena.worlds.leased;
    expect(w.blackout).toBe(false);
    while (run.arena.now < 30) {
      run.arena.step();
      run.director.advance();
      expect(w.blackout).toBe(run.arena.now >= 10);
    }
  });

  it('applies events with the same time in array order', () => {
    const { arena } = runScenario({
      ...base,
      events: [
        { at: 5, kind: 'flow', body: 'mars', sellProb: 0.2 },
        { at: 5, kind: 'flow', body: 'mars', sellProb: 0.8 },
      ],
    });
    for (const s of STRATEGIES) expect(arena.worlds[s].flow.mars).toBe(0.8);
  });

  it('applies events at time 0 before the first step, and notes become the caption', () => {
    const { arena, director } = startScenario({
      ...base,
      events: [
        { at: 0, kind: 'panic', on: true },
        { at: 0, kind: 'note', text: 'Hello.' },
      ],
    });
    expect(arena.now).toBe(0);
    expect(arena.worlds.naive.panic).toBe(true);
    expect(director.caption).toBe('Hello.');
  });

  for (const s of SCENARIOS) {
    it(`${s.id}: runScenario equals a manual step-and-advance loop, and is deterministic`, () => {
      const manual = startScenario(s);
      playTo(manual, s.durationMin);
      const once = runScenario(s);
      expect(snapshot(once.arena)).toBe(snapshot(manual.arena));
      expect(snapshot(runScenario(s).arena)).toBe(snapshot(once.arena));
      expect(once.director.done).toBe(true);
      expect(once.director.progress).toBe(1);
    });
  }

  it('jumping equals playing: solar-storm to 200 directly, or to 100 and on to 200', () => {
    const s = preset('solar-storm');
    const direct = runScenario(s, 200);
    const split = runScenario(s, 100);
    playTo(split, 200);
    expect(snapshot(split.arena)).toBe(snapshot(direct.arena));
    expect(split.director.caption).toBe(direct.director.caption);
  });
});

describe('presets', () => {
  it('are well formed', () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SCENARIOS) {
      expect(s.id).toMatch(/^[a-z]+(-[a-z]+)*$/);
      for (let i = 0; i < s.events.length; i++) {
        const e = s.events[i];
        if (i > 0) expect(e.at).toBeGreaterThanOrEqual(s.events[i - 1].at);
        expect(e.at).toBeGreaterThanOrEqual(0);
        expect(e.at).toBeLessThanOrEqual(s.durationMin);
        if (e.kind === 'separation') {
          expect(e.deg).toBeGreaterThanOrEqual(0);
          expect(e.deg).toBeLessThanOrEqual(180);
        }
        if (e.kind === 'flow') {
          expect(e.sellProb).toBeGreaterThanOrEqual(0);
          expect(e.sellProb).toBeLessThanOrEqual(1);
        }
      }
      expect(s.separationDeg).toBeGreaterThanOrEqual(0);
      expect(s.separationDeg).toBeLessThanOrEqual(180);
    }
  });

  for (const s of SCENARIOS) {
    it(`${s.id}: leased and central never exceed the limit at any tick`, () => {
      const run = startScenario(s);
      const { leased, central } = run.arena.worlds;
      while (run.arena.now < s.durationMin) {
        run.arena.step();
        run.director.advance();
        expect(Math.abs(leased.totalPosition())).toBeLessThanOrEqual(leased.cfg.limit + 1e-9);
        expect(Math.abs(central.totalPosition())).toBeLessThanOrEqual(central.cfg.limit + 1e-9);
      }
    });
  }

  it('solar-storm reproduces the demo claims', () => {
    const s = preset('solar-storm');
    const run = startScenario(s);
    // Just before the storm ends.
    playTo(run, 300 - DEFAULT_CONFIG.dt);
    expect(run.arena.worlds.leased.desks.mars.mode(run.arena.now)).toBe('reduce-only');
    playTo(run, s.durationMin);
    const { leased, naive, central } = run.arena.worlds;
    expect(naive.metrics.maxAbsTotal).toBeGreaterThan(naive.cfg.limit);
    expect(leased.metrics.breachTicks).toBe(0);
    expect(leased.metrics.volFilled).toBeGreaterThan(central.metrics.volFilled);
  });

  it('reconnect shows the merge: Mars nets nothing while cut off, then nets after the links return', () => {
    const s = preset('reconnect');
    const run = startScenario(s);
    const w = run.arena.worlds.leased;
    playTo(run, 125);
    const at125 = marsNetted(w);
    playTo(run, 300);
    const at300 = marsNetted(w);
    playTo(run, 420);
    const at420 = marsNetted(w);
    expect(at300).toBe(at125);
    expect(at420).toBeGreaterThan(at300);

    const off = runScenario(s, 420, { ...DEFAULT_CONFIG, netting: false } as SimConfig).arena.worlds.leased;
    expect(gross(w)).toBeLessThan(gross(off));
  });

  it('behind-the-sun: the Earth to Mars link is blocked while Mars is at 180 degrees, with no storm', () => {
    const run = startScenario(preset('behind-the-sun'));
    const w = run.arena.worlds.leased;
    let checked = 0;
    while (run.arena.now < 240) {
      run.arena.step();
      run.director.advance();
      if (run.arena.now >= 60 && run.arena.now < 240) {
        expect(w.blackout).toBe(false);
        expect(w.linkOpen('earth', 'mars')).toBe(false);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('flapping-link: the leased Mars desk never goes reduce-only', () => {
    const s = preset('flapping-link');
    const run = startScenario(s);
    const mars = run.arena.worlds.leased.desks.mars;
    while (run.arena.now < s.durationMin) {
      run.arena.step();
      run.director.advance();
      expect(mars.mode(run.arena.now)).not.toBe('reduce-only');
    }
  });
});

describe('flow', () => {
  it('a desk whose customers all sell ends up long', () => {
    const a = new Arena(9, { cfg: { ...DEFAULT_CONFIG, netting: false } });
    a.setFlow('earth', 1);
    a.run(200);
    expect(a.worlds.leased.desks.earth.pos).toBeGreaterThan(0);
  });

  it('setFlow clamps to [0, 1]', () => {
    const w = new World({ strategy: 'leased', seed: 1 });
    w.setFlow('moon', 3);
    expect(w.flow.moon).toBe(1);
    w.setFlow('moon', -1);
    expect(w.flow.moon).toBe(0);
  });
});
