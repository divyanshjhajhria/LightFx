import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { runScenario } from '../src/sim/scenario';
import { SCENARIOS } from '../src/sim/scenarios';
import { World } from '../src/sim/world';
import { GAUGE_REACH, gaugeMarker, gaugeTicks } from '../src/ui/gauge';
import { verdictWord } from '../src/ui/verdict';

const storm = SCENARIOS.find((s) => s.id === 'solar-storm')!;
const at = (t: number) => runScenario(storm, t).arena.worlds;
const quiet = { ...DEFAULT_CONFIG, customerRate: 0 };

describe("each bank card's status chip", () => {
  it('over its limit now', () => {
    const w = new World({ strategy: 'naive', seed: 1, cfg: quiet });
    w.desks.mars.pos = 150;
    expect(verdictWord(w)).toEqual({ word: 'Over its limit', tone: 'alert' });
  });

  it('was over, now inside: the old-news bank at the end of the storm', () => {
    const w = at(420).naive;
    expect(Math.abs(w.totalPosition())).toBeLessThanOrEqual(w.cfg.limit);
    expect(verdictWord(w)).toEqual({ word: 'Was over its limit', tone: 'alert' });
  });

  it('inside, but a remote office cannot trade: the bank that asks Earth in the storm', () => {
    expect(verdictWord(at(240).central)).toEqual({ word: 'Offices frozen', tone: 'alert' });
  });

  it('otherwise safe, even with a desk playing safe: our bank in the storm', () => {
    const w = at(240).leased;
    expect(w.desks.mars.mode(w.now)).toBe('reduce-only');
    expect(verdictWord(w)).toEqual({ word: 'Safe', tone: 'ok' });
  });
});

describe('the gauge', () => {
  const L = 100;
  it('runs from 1.5 times the limit short to 1.5 times long, the same scale for every bank', () => {
    expect(GAUGE_REACH).toBe(1.5);
    expect(gaugeMarker(0, L)).toEqual({ at: 0.5, beyond: false });
    expect(gaugeMarker(-150, L)).toEqual({ at: 0, beyond: false });
    expect(gaugeMarker(150, L)).toEqual({ at: 1, beyond: false });
  });

  it('places a marker inside the scale in proportion', () => {
    expect(gaugeMarker(30, L).at).toBeCloseTo(0.6, 12);
    expect(gaugeMarker(-75, L).at).toBeCloseTo(0.25, 12);
  });

  it('puts the limit exactly on its tick marks', () => {
    const [low, zero, high] = gaugeTicks();
    expect(gaugeMarker(-L, L).at).toBeCloseTo(low, 12);
    expect(gaugeMarker(0, L).at).toBe(zero);
    expect(gaugeMarker(L, L).at).toBeCloseTo(high, 12);
    expect(low).toBeCloseTo(1 / 6, 12);
    expect(high).toBeCloseTo(5 / 6, 12);
  });

  it('holds a marker beyond the scale at the end, and says so', () => {
    expect(gaugeMarker(192, L)).toEqual({ at: 1, beyond: true });
    expect(gaugeMarker(-400, L)).toEqual({ at: 0, beyond: true });
  });
});
