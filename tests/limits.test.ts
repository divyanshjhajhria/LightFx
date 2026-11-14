import { describe, expect, it } from 'vitest';
import { AgentRunner, LOG_KEEP } from '../src/agents/runner';
import { WALKED_AWAY_KEEP } from '../src/sim/desks';
import { BODIES } from '../src/sim/types';
import { Arena, World } from '../src/sim/world';

describe('nothing grows without limit in a long run', () => {
  it('the agent session log keeps only its newest entries', () => {
    const a = new Arena(1);
    const r = new AgentRunner(a, { mode: 'stand-in', clock: () => a.now });
    const log = r.log();
    const first = { ...log[0] };
    for (let i = 0; i < LOG_KEEP + 25; i++) (r as unknown as { record: (...x: unknown[]) => void }).record('earth', {}, '', null, first);
    expect(r.log()).toHaveLength(LOG_KEEP);
  });

  it('a remote desk remembers at most 50 visitors who walked away', () => {
    const w = new World({ strategy: 'central', seed: 4, separationDeg: 150 });
    w.blackout = true;
    for (let i = 0; i < WALKED_AWAY_KEEP + 30; i++) {
      w.placeTrade('mars', 'sell', 1, i + 1);
      w.cancelTrade(i + 1);
      w.step();
    }
    const desk = w.desks.mars as unknown as { walkedAway: Map<string, unknown> };
    expect(desk.walkedAway.size).toBe(WALKED_AWAY_KEEP);
  });

  it("the simulation's own lists stay bounded over 30 simulated hours", () => {
    const a = new Arena(42, { separationDeg: 150 });
    for (let h = 0; h < 30; h++) {
      if (h % 5 === 1) a.setBlackout(true);
      if (h % 5 === 3) a.setBlackout(false);
      if (h % 3 === 0) a.placeTrade('mars', 'sell', 5);
      a.run(60);
    }
    for (const w of Object.values(a.worlds)) {
      expect(w.history.length).toBeLessThanOrEqual(1500);
      expect(w.spans.length).toBeLessThanOrEqual(40);
      expect(w.net.drops.length).toBeLessThanOrEqual(64);
      expect(w.noteLog().length).toBeLessThanOrEqual(40);
      for (const b of BODIES) {
        expect(w.events(b).length).toBeLessThanOrEqual(6);
        expect(w.feedLog(b).length).toBeLessThanOrEqual(60);
      }
    }
  });
});
