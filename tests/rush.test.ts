import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { startScenario } from '../src/sim/scenario';
import { SCENARIOS } from '../src/sim/scenarios';
import { ALONE, measurePairs, rushGrid, runOurs } from '../src/sim/together';
import type { TogetherFile } from '../src/sim/together';

describe('together against alone under a rush', () => {
  it('nobody goes over the limit on seeds 1 to 3, anywhere on the rush grid', () => {
    const over: string[] = [];
    for (const sq of rushGrid()) {
      for (const p of measurePairs(sq, [1, 2, 3])) {
        if (p.together.over || p.alone.over) over.push(`${sq.market} ${sq.separationDeg} ${sq.stormMinutes} seed ${p.seed}`);
      }
    }
    expect(rushGrid()).toHaveLength(12);
    expect(over).toEqual([]);
  });

  it('counts customers at the rushed desk only during the rush', () => {
    const r = runOurs({ market: 'rush-mars', separationDeg: 0, stormMinutes: 0 }, 1, DEFAULT_CONFIG);
    expect(r.rushServedPct).toBeGreaterThan(0);
    expect(r.rushServedPct).toBeLessThanOrEqual(100);
    // An ordinary market has no rush figure.
    expect(runOurs({ market: 'calm', separationDeg: 0, stormMinutes: 0 }, 1, ALONE).rushServedPct).toBeUndefined();
  });

  it('is in public/together.json per seed, for every rush square, with seeds 1 to 30', () => {
    const f = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'together.json'), 'utf8')) as TogetherFile;
    expect(f.rush!.squares).toHaveLength(12);
    for (const q of f.rush!.squares) expect(q.perSeed.map((p) => p.seed)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    // Recomputing one square gives the same numbers (the whole file is checked in together.test.ts).
    const q = f.rush!.squares[0];
    expect(measurePairs(q, [1, 2])).toEqual(q.perSeed.slice(0, 2));
  });

  it("'Rush on Mars': the others lend Mars room, the note lands when they do, and nobody passes the limit", () => {
    const s = SCENARIOS.find((x) => x.id === 'rush-on-mars')!;
    const { arena, director } = startScenario(s);
    const mars = arena.worlds.leased.desks.mars;
    let at120 = 0;
    let at240 = 0;
    let firstLanding: number | null = null;
    let last = mars.budget()!;
    while (arena.now < s.durationMin) {
      arena.step();
      director.advance();
      const b = mars.budget()!;
      if (firstLanding === null && arena.now >= 120 && b - last >= 5) firstLanding = arena.now;
      last = b;
      if (arena.now === 120) at120 = b;
      if (arena.now === 240) at240 = b;
      for (const w of [arena.worlds.leased, arena.worlds.central]) {
        expect(Math.abs(w.totalPosition())).toBeLessThanOrEqual(w.cfg.limit + 1e-9);
      }
    }
    expect(at240).toBeGreaterThan(at120);
    const note = s.events.find((e) => e.kind === 'note' && e.text.startsWith('Earth and the Moon lend'))!;
    expect(note.at).toBe(firstLanding);
    expect(arena.worlds.leased.metrics.breachTicks).toBe(0);
    expect(arena.worlds.central.metrics.breachTicks).toBe(0);
  });
});
