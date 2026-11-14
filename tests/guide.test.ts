import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import type { SimConfig } from '../src/sim/config';
import { GUIDE_SEED, GUIDE_SEPARATION, GUIDE_WARMUP, Guide } from '../src/sim/guide';
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

/** Every line a full run with the default trade says, in order, word for word as the script gives it. */
const SCRIPT: Line[] = [
  ['ready', 'This is one bank with desks on Earth, the Moon and Mars. They share one goal: serve every customer they safely can, without the bank as a whole ever holding more than its limit. A message between Earth and Mars takes twenty minutes each way. Go ahead: sell five Mars credits to the Mars desk.'],
  ['trade', 'Mars took your five credits on its own, straight away. Now it is telling Earth what it holds. Watch the message go.'],
  ['storm', 'A solar storm. Every link between the planets is gone, and your message was destroyed on the way. Earth has no idea your trade happened.'],
  ['silence', 'Time passes.', 'An hour goes by.'],
  ['silence-settle', 'An hour with no word from anyone. Our Mars desk does not guess. It stops taking on new risk, by itself, and waits.'],
  ['panic', 'Now the market panics. Everyone is selling at once, on every planet.'],
  ['panic-settle', 'The bank that trusts old news has just gone through its limit. Look at what each desk thinks the bank holds. None of them is right. Ours is holding inside the line.'],
  ['alone', 'Now Earth and the Moon lose each other too. Three desks, and no links at all. The bank that asks head office has not completed one trade on Mars since the storm began. Ours is still inside its limit, because no desk ever needed permission.'],
  ['recovery', 'The storm passes. The links come back, and the desks catch up.'],
  ['recovery-settle', 'Earth has finally heard about your trade. Three desks, cut off from each other, kept one promise between them: the bank never crossed its limit. That is Lightspeed FX.'],
].map(([id, caption, voice]) => ({ id, caption, voice: voice ?? caption }));

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

  it('words the lines for the trade the visitor actually placed: buy 10 at Earth', () => {
    const arena = new Arena(GUIDE_SEED, { separationDeg: GUIDE_SEPARATION });
    arena.run(GUIDE_WARMUP);
    const g = new Guide(arena);
    const lines: Line[] = [...g.tick(0)];
    g.tradePlaced(arena.placeTrade('earth', 'buy', 10));
    let real = 0;
    for (let steps = 0; !g.finished && steps < 100_000; steps++) {
      if (g.canAdvance && g.beat.advance === 'space') g.space();
      lines.push(...g.tick(real));
      if (g.finished) break;
      arena.step();
      real += 0.25 / g.speed;
      lines.push(...g.tick(real));
    }
    const said = Object.fromEntries(lines.map((l) => [l.id, l.caption]));
    expect(said.trade).toBe('Earth sold you ten credits on its own, straight away. Now it is telling Mars what it holds. Watch the message go.');
    expect(said.storm).toBe('A solar storm. Every link between the planets is gone, and your message was destroyed on the way. Mars has no idea your trade happened.');
    expect(said['recovery-settle']).toMatch(/^Mars has finally heard about your trade\./);
    expect(lines.map((l) => l.id)).toEqual(SCRIPT.map((l) => l.id));
  });

  it('starts the storm when the message is half-way, even if ticked only twice a simulated minute', () => {
    const arena = new Arena(GUIDE_SEED, { separationDeg: GUIDE_SEPARATION });
    arena.run(GUIDE_WARMUP);
    const g = new Guide(arena);
    g.space(); // sell 5 at Mars
    const lead = arena.worlds.leased;
    let steps = 0;
    while (g.beat.id === 'trade' && steps < 400) {
      arena.step();
      steps++;
      // No wall clock at all: real time stands still, so only simulated time can move the demo on.
      if (steps % 2 === 0) g.tick(0);
    }
    expect(g.beat.id).toBe('storm');
    const told = lead.trace(g.trade!).find((e) => e.kind === 'told' && e.to === 'earth')!;
    expect(told.kind).toBe('told');
    const half = told.t + ((told as Extract<TraceEvent, { kind: 'told' }>).landsAt - told.t) / 2;
    expect(arena.now).toBeGreaterThanOrEqual(half);
    expect(arena.now).toBeLessThan(half + 0.5 + 1e-9);
  });

  it('moves on after 3 simulated minutes if the trade sends no news (refused at a full desk)', () => {
    const arena = new Arena(GUIDE_SEED, { separationDeg: GUIDE_SEPARATION });
    arena.run(GUIDE_WARMUP);
    const g = new Guide(arena);
    const mars = arena.worlds.leased.desks.mars;
    mars.pos = mars.budget()!;
    g.tradePlaced(arena.placeTrade('mars', 'sell', 5));
    const t0 = arena.now;
    while (g.beat.id !== 'storm' && arena.now < t0 + 10) {
      arena.step();
      g.tick(0);
    }
    expect(g.beat.id).toBe('storm');
    expect(arena.now - t0).toBeGreaterThanOrEqual(3);
    expect(arena.now - t0).toBeLessThan(3.5);
  });
});
