import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { sanitise } from '../src/sim/directive';
import { ALONE, measureTogether, runOurs, togetherGrid } from '../src/sim/together';
import { BODIES } from '../src/sim/types';
import { World } from '../src/sim/world';

describe('our bank together against alone', () => {
  it('with sharing off, no allowance is ever handed over, not even when an agent asks to give it', () => {
    const w = new World({ strategy: 'leased', seed: 9, separationDeg: 60, cfg: { ...DEFAULT_CONFIG, sharing: false } });
    w.setFlow('earth', 0.8);
    w.setFlow('mars', 0.2);
    for (const b of BODIES) w.setController(b, 'agent');
    for (let i = 0; i < 600 * 4; i++) {
      w.step();
      if (i % 200 === 0) w.setDirective('earth', { ...sanitise({ give: { moon: 50, mars: 50 } }, 'earth')!, source: 'stand-in' });
      expect(w.allowanceShared()).toBe(0);
    }
    expect(BODIES.map((b) => w.desks[b].budget())).toEqual(BODIES.map((b) => DEFAULT_CONFIG.alloc[b]));
  });

  it('with the defaults, allowance is shared and positions are cancelled', () => {
    const r = runOurs({ market: 'imbalance', separationDeg: 0, stormMinutes: 120 }, 1, DEFAULT_CONFIG);
    expect(r.allowanceShared).toBeGreaterThan(0);
    expect(r.unitsCancelled).toBeGreaterThan(0);
  });

  it('alone never goes over the limit anywhere on the grid, seeds 1 to 3', () => {
    const over: string[] = [];
    for (const sq of togetherGrid()) {
      for (const seed of [1, 2, 3]) {
        const r = runOurs(sq, seed, ALONE);
        if (r.over) over.push(`${sq.market} ${sq.separationDeg} ${sq.stormMinutes} seed ${seed}`);
        expect(r.allowanceShared).toBe(0);
        expect(r.unitsCancelled).toBe(0);
      }
    }
    expect(over).toEqual([]);
  });

  it('public/together.json is exactly what the code computes today', () => {
    const file = readFileSync(join(__dirname, '..', 'public', 'together.json'), 'utf8');
    expect(`${JSON.stringify(measureTogether())}\n`).toBe(file);
  }, 120_000);
});
