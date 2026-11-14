import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { runScenario } from '../src/sim/scenario';
import { SCENARIOS } from '../src/sim/scenarios';
import { World } from '../src/sim/world';
import { verdict } from '../src/ui/verdict';

const storm = SCENARIOS.find((s) => s.id === 'solar-storm')!;
const at = (t: number) => runScenario(storm, t).arena.worlds;
const quiet = { ...DEFAULT_CONFIG, customerRate: 0 };

describe('the verdict under each bank', () => {
  it('over the limit, with under a minute counted', () => {
    const w = new World({ strategy: 'naive', seed: 1, cfg: quiet });
    w.desks.mars.pos = 150;
    expect(verdict(w)).toEqual({ text: 'Over its limit now.', tone: 'alert' });
  });

  it('over the limit for a while: the naive bank in the storm', () => {
    const v = verdict(at(240).naive);
    expect(v.tone).toBe('alert');
    expect(v.text).toMatch(/^Over its limit now\. \d+ min so far\.$/);
  });

  it('back inside after a breach: the naive bank at the end of the storm scenario', () => {
    const w = at(420).naive;
    expect(Math.abs(w.totalPosition())).toBeLessThanOrEqual(w.cfg.limit);
    const minutes = Math.round(w.metrics.breachTicks * w.cfg.dt);
    expect(verdict(w)).toEqual({ text: `Back inside its limit, after ${minutes} min over.`, tone: 'alert' });
  });

  it('a remote office that cannot trade: the bank that asks Earth in the storm', () => {
    const w = at(240).central;
    expect(w.desks.mars.mode(w.now)).toBe('halted');
    const halted = (['moon', 'mars'] as const).filter((b) => w.desks[b].mode(w.now) === 'halted');
    expect(verdict(w)).toEqual({
      text: halted.length === 2 ? 'Inside its limit. Two offices cannot trade.' : 'Inside its limit. Mars office cannot trade.',
      tone: 'alert',
    });
  });

  it('a desk playing safe: our bank in the storm', () => {
    const w = at(240).leased;
    expect(w.desks.mars.mode(w.now)).toBe('reduce-only');
    const safe = (['earth', 'moon', 'mars'] as const).filter((b) => w.desks[b].mode(w.now) === 'reduce-only');
    expect(safe).toEqual(['mars']);
    expect(verdict(w)).toEqual({ text: 'Inside its limit. Mars is playing safe.', tone: 'ok' });
  });

  it('all well: our bank before the storm', () => {
    expect(verdict(at(60).leased)).toEqual({ text: 'Inside its limit.', tone: 'ok' });
  });

  it('puts a breach before anything else', () => {
    const w = at(240).central;
    w.desks.earth.pos = 500;
    expect(verdict(w).text).toBe('Over its limit now.');
  });

  it('never uses a banned word', () => {
    for (const t of [60, 150, 240, 330, 420]) {
      const ws = at(t);
      for (const w of [ws.leased, ws.naive, ws.central]) {
        expect(verdict(w).text).not.toMatch(/\b(bp|gossip|lease|epoch|rfq|leased|naive|central)\b/i);
      }
    }
  });
});
