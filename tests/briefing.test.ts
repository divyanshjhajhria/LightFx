import { describe, expect, it } from 'vitest';
import { deskBriefing } from '../src/sim/briefing';
import type { DeskEvent } from '../src/sim/briefing';
import { DEFAULT_CONFIG } from '../src/sim/config';
import { runScenario } from '../src/sim/scenario';
import { SCENARIOS } from '../src/sim/scenarios';
import type { BodyId } from '../src/sim/types';
import { World } from '../src/sim/world';

const runTo = (w: World, t: number) => {
  while (w.now < t - 1e-9) w.step();
};

/** Every event a desk logged over a run, even after it has scrolled out of the briefing's last six. */
function collect(w: World, body: BodyId, until: number, each?: () => void): DeskEvent[] {
  const seen = new Set<DeskEvent>();
  const all: DeskEvent[] = [];
  while (w.now < until - 1e-9) {
    w.step();
    each?.();
    for (const e of w.events(body)) {
      if (!seen.has(e)) {
        seen.add(e);
        all.push(e);
      }
    }
  }
  return all;
}

describe('a desk briefing', () => {
  it('holds only what the desk itself knows: a change on Earth during a blackout is invisible on Mars', () => {
    const a = new World({ strategy: 'leased', seed: 5, separationDeg: 60 });
    const b = new World({ strategy: 'leased', seed: 5, separationDeg: 60 });
    for (const w of [a, b]) {
      runTo(w, 60);
      w.blackout = true;
      runTo(w, 90);
    }
    b.desks.earth.pos = 30;
    runTo(a, 120);
    runTo(b, 120);
    expect(deskBriefing(b, 'mars')).toEqual(deskBriefing(a, 'mars'));
    expect(deskBriefing(b, 'earth')).not.toEqual(deskBriefing(a, 'earth'));
  });

  it("records Mars going safe once and recovering once", () => {
    const w = new World({ strategy: 'leased', seed: 3, separationDeg: 60 });
    runTo(w, 30);
    const events = collect(w, 'mars', 200, () => {
      w.blackout = w.now >= 40 && w.now < 140;
    });
    const modes = events.filter((e): e is Extract<DeskEvent, { kind: 'mode' }> => e.kind === 'mode');
    expect(modes.filter((e) => e.to === 'reduce-only')).toHaveLength(1);
    expect(modes.filter((e) => e.from === 'reduce-only')).toHaveLength(1);
  });

  it('shows a hand-over at both ends', () => {
    const w = new World({ strategy: 'leased', seed: 1, separationDeg: 0, cfg: { ...DEFAULT_CONFIG, customerRate: 0 } });
    w.desks.earth.pos = 20;
    w.desks.mars.pos = -15;
    runTo(w, 60);
    expect(w.events('earth')).toContainEqual(expect.objectContaining({ kind: 'handed-over', to: 'mars', units: 15 }));
    expect(w.events('mars')).toContainEqual(expect.objectContaining({ kind: 'took-on', from: 'earth', units: 15 }));
  });

  it('notes a full desk refusing at most once every 10 minutes', () => {
    const w = new World({ strategy: 'leased', seed: 2, separationDeg: 0, cfg: { ...DEFAULT_CONFIG, customerRate: 2 } });
    w.setFlow('mars', 1);
    runTo(w, 10);
    w.desks.mars.pos = w.desks.mars.budget()!;
    const refused = collect(w, 'mars', w.now + 30).filter((e) => e.kind === 'refused');
    expect(refused.length).toBeGreaterThanOrEqual(1);
    expect(refused.length).toBeLessThanOrEqual(3);
  });

  it('changes nothing: solar-storm on seed 42 ends exactly as it did before briefings existed', () => {
    const { arena } = runScenario(SCENARIOS.find((s) => s.id === 'solar-storm')!);
    const got = Object.fromEntries(
      (['leased', 'naive', 'central'] as const).map((s) => [
        s,
        { metrics: arena.worlds[s].metrics, pnl: arena.worlds[s].pnl(), pos: (['earth', 'moon', 'mars'] as const).map((b) => arena.worlds[s].desks[b].pos) },
      ]),
    );
    // Captured from the code before this step, on branch feature/guided-demo at 88a8fc4.
    expect(got).toEqual({
      leased: {
        metrics: { breachTicks: 0, maxAbsTotal: 92, arrived: 769, volRequested: 2324, served: 377, volFilled: 1111, dropped: 1003, nettedUnits: 38 },
        pnl: -1.1577730797918875,
        pos: [19, 26, 4],
      },
      naive: {
        metrics: { breachTicks: 759, maxAbsTotal: 192, arrived: 769, volRequested: 2324, served: 483, volFilled: 1451, dropped: 1003, nettedUnits: 0 },
        pnl: -5.069050956629994,
        pos: [18, 3, 54],
      },
      central: {
        metrics: { breachTicks: 0, maxAbsTotal: 40, arrived: 769, volRequested: 2324, served: 280, volFilled: 789, dropped: 765, nettedUnits: 0 },
        pnl: -0.9327611844961243,
        pos: [20, -9, 0],
      },
    });
  });
});
