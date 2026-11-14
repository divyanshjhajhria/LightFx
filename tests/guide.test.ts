import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { SimConfig } from '../src/sim/config';
import { GUIDE_BEATS, GUIDE_SEED, GUIDE_SEPARATION, GUIDE_WARMUP, Guide } from '../src/sim/guide';
import type { Line } from '../src/sim/guide';
import type { TraceEvent } from '../src/sim/trace';
import { BODIES } from '../src/sim/types';
import { Arena } from '../src/sim/world';

interface Run {
  arena: Arena;
  guide: Guide;
  lines: Line[];
  /** Simulated time each beat started, and whether its settle was capped. */
  started: Record<string, number>;
  capped: Record<string, boolean>;
  /** At the moment the panic beat settled: the naive bank's true total and each desk's believed total. */
  panicSettle?: { truth: number; believed: number[] };
  centralMarsAt: Record<string, number>;
}

/** Drive the demo the way a presenter would: press space whenever it would do something. Fake clock throughout. */
function runGuide(cfg: SimConfig = DEFAULT_CONFIG): Run {
  const arena = new Arena(GUIDE_SEED, { separationDeg: GUIDE_SEPARATION, cfg });
  arena.run(GUIDE_WARMUP);
  const guide = new Guide(arena);
  const run: Run = { arena, guide, lines: [], started: {}, capped: {}, centralMarsAt: {} };
  let real = 0;
  const note = () => {
    const id = guide.beat.id;
    if (!(id in run.started)) {
      run.started[id] = arena.now;
      run.centralMarsAt[id] = arena.worlds.central.desks.mars.volFilled;
    }
    run.capped[id] = guide.capped;
  };
  const tick = () => {
    for (const l of guide.tick(real)) {
      run.lines.push(l);
      if (l.id === 'panic-settle') {
        const w = arena.worlds.naive;
        run.panicSettle = { truth: w.totalPosition(), believed: BODIES.map((b) => w.desks[b].believedTotal()!.low) };
      }
    }
    note();
  };
  tick();
  for (let steps = 0; !guide.finished && steps < 100_000; steps++) {
    if (guide.canAdvance && (guide.beat.advance === 'space' || guide.index === 0)) guide.space();
    tick();
    if (guide.finished) break;
    arena.step();
    real += arena.worlds.leased.cfg.dt / guide.speed;
    tick();
  }
  return run;
}

/** Every line the script can say, in the order a full run says them. */
const SCRIPT: Line[] = GUIDE_BEATS.flatMap((b) => [
  ...(b.say ? [{ ...b.say, id: b.id }] : []),
  ...(b.settle?.say ? [{ ...b.settle.say, id: `${b.id}-settle` }] : []),
]);

describe('the guided demo', () => {
  const full = runGuide();

  it('runs start to finish on seed 42, saying every line in order, with no settle cut short', () => {
    expect(full.guide.finished).toBe(true);
    expect(full.lines).toEqual(SCRIPT);
    for (const id of ['silence', 'panic', 'recovery']) expect(full.capped[id]).toBe(false);
    const { leased, naive, central } = full.arena.worlds;
    expect(leased.metrics.breachTicks).toBe(0);
    expect(central.metrics.breachTicks).toBe(0);
    expect(naive.metrics.breachTicks).toBeGreaterThan(0);
  });

  it('never claims a breach that did not happen', () => {
    const run = runGuide({ ...DEFAULT_CONFIG, limit: 100_000 });
    expect(run.capped.panic).toBe(true);
    expect(run.lines.map((l) => l.id)).not.toContain('panic-settle');
    expect(run.lines.map((l) => l.id)).toContain('panic');
  });

  it('ignores space while fast-forwarding, and acts once settled', () => {
    const arena = new Arena(GUIDE_SEED, { separationDeg: GUIDE_SEPARATION });
    arena.run(GUIDE_WARMUP);
    const g = new Guide(arena);
    g.space(); // place the trade
    let real = 0;
    while (g.beat.id !== 'storm') {
      arena.step();
      real += 0.25;
      g.tick(real);
    }
    expect(g.space()).toBe(true);
    expect(g.beat.id).toBe('silence');
    expect(g.canAdvance).toBe(false);
    expect(g.speed).toBe(16);
    expect(g.space()).toBe(false);
    expect(g.beat.id).toBe('silence');
    while (!g.settled) {
      arena.step();
      g.tick(real);
    }
    expect(g.speed).toBe(1);
    expect(g.canAdvance).toBe(true);
    expect(g.space()).toBe(true);
    expect(g.beat.id).toBe('panic');
  });

  it('space on the first beat sells 5 at Mars and moves on', () => {
    const arena = new Arena(GUIDE_SEED, { separationDeg: GUIDE_SEPARATION });
    const g = new Guide(arena);
    expect(g.beat.id).toBe('ready');
    expect(g.space()).toBe(true);
    expect(g.beat.id).toBe('trade');
    expect(g.trade).not.toBeNull();
    expect(arena.worlds.leased.trace(g.trade!)[0]).toMatchObject({ kind: 'placed', body: 'mars', side: 'sell', size: 5 });
  });

  it('is right that the bank that asks Earth completes nothing on Mars from the storm to the recovery', () => {
    expect(full.centralMarsAt.recovery).toBe(full.centralMarsAt.storm);
  });

  it("tells the visitor's story: the news is destroyed in the storm, then sent again and heard", () => {
    const tr = full.arena.worlds.leased.trace(full.guide.trade!);
    const want: ((e: TraceEvent) => boolean)[] = [
      (e) => e.kind === 'placed',
      (e) => e.kind === 'filled',
      (e) => e.kind === 'told' && e.to === 'earth',
      (e) => e.kind === 'destroyed' && e.to === 'earth',
      (e) => e.kind === 'told' && e.to === 'earth',
      (e) => e.kind === 'heard' && e.body === 'earth',
    ];
    let i = 0;
    for (const e of tr) if (i < want.length && want[i](e)) i++;
    expect(i).toBe(want.length);
  });

  it('when the panic line says no naive desk is right, at least two of them are wrong', () => {
    const p = full.panicSettle!;
    expect(p).toBeDefined();
    expect(p.believed.filter((b) => b !== p.truth).length).toBeGreaterThanOrEqual(2);
  });
});
