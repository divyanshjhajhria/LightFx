import { describe, expect, it } from 'vitest';
import { deskBriefing } from '../src/sim/briefing';
import { sanitise } from '../src/sim/directive';
import type { Directive } from '../src/sim/directive';
import { lightDelayMin } from '../src/sim/orbits';
import { BODIES } from '../src/sim/types';
import type { GossipMsg } from '../src/sim/types';
import type { LeasedDesk } from '../src/sim/desks';
import { World } from '../src/sim/world';
import { describeEnvelope } from '../src/ui/describe';

const dir = (d: Partial<Directive>): Directive => ({ ...sanitise({})!, source: 'stand-in', ...d });

function world(seed = 4) {
  const w = new World({ strategy: 'leased', seed, separationDeg: 90 });
  for (const b of BODIES) w.setController(b, 'agent');
  while (w.now < 20) w.step();
  return w;
}

/** Messages in flight that carry a note or an ask. */
const noted = (w: World) =>
  w.net.inFlight.filter((e) => e.payload.kind === 'gossip' && ((e.payload as GossipMsg).note || (e.payload as GossipMsg).asks));

describe('notes and asks between desks', () => {
  it('a note set at Mars reaches Earth after the light delay, with the right ages', () => {
    const w = world();
    w.setDirective('mars', dir({ noteTo: { earth: 'I hold 6 and could use 10 more.' }, ask: { earth: 10 } }));
    const setAt = w.now;
    const delay = lightDelayMin(w.orbit, 'mars', 'earth');
    while (!(w.desks.earth as LeasedDesk).inbox().length && w.now < setAt + 60) w.step();
    const b = deskBriefing(w, 'earth');
    expect(b.inbox).toHaveLength(1);
    const n = b.inbox![0];
    expect(n).toMatchObject({ from: 'mars', text: 'I hold 6 and could use 10 more.', asks: 10, receivedMinAgo: 0 });
    // Sent on Mars's next desk update (every 2 minutes), and as old on arrival as the light delay.
    expect(w.now - setAt).toBeGreaterThanOrEqual(delay - 0.25);
    expect(w.now - setAt).toBeLessThanOrEqual(delay + w.cfg.gossipEvery + 0.25);
    expect(n.oldOnArrivalMin).toBeCloseTo(delay, 0);
    w.step();
    w.step();
    expect(deskBriefing(w, 'earth').inbox![0].receivedMinAgo).toBeCloseTo(0.5, 9);
    // Sent once: nothing more carries it.
    expect(noted(w)).toEqual([]);
  });

  it('describes a message that carries a note or an ask', () => {
    const w = world();
    w.setDirective('mars', dir({ noteTo: { earth: 'Need room.' }, ask: { earth: 12 } }));
    while (!noted(w).length) w.step();
    const env = noted(w).find((e) => e.to === 'earth')!;
    const lines = describeEnvelope(env, w.now, 'leased').lines;
    expect(lines).toContain('Note for Earth: "Need room."');
    expect(lines).toContain('Asks Earth for 12 of its allowance');
  });

  it('a note sent into a blackout never arrives and is never sent again', () => {
    const w = world();
    w.blackout = true;
    w.step();
    w.setDirective('mars', dir({ noteTo: { earth: 'Anyone there?' } }));
    const until = w.now + 30;
    while (w.now < until) w.step();
    w.blackout = false;
    const end = w.now + 120;
    while (w.now < end) {
      w.step();
      expect(noted(w)).toEqual([]);
    }
    expect(deskBriefing(w, 'earth').inbox).toEqual([]);
  });

  it('a note in flight when the link closes is destroyed with its message', () => {
    const w = world();
    w.setDirective('mars', dir({ noteTo: { earth: 'On my way.' } }));
    while (!noted(w).some((e) => e.to === 'earth')) w.step();
    const dropsBefore = w.net.dropped;
    w.blackout = true;
    w.step();
    expect(noted(w)).toEqual([]);
    expect(w.net.dropped).toBeGreaterThan(dropsBefore);
    expect(w.net.drops.some((d) => d.inFlight && d.from === 'mars' && d.to === 'earth')).toBe(true);
    const end = w.now + 60;
    while (w.now < end) w.step();
    expect(deskBriefing(w, 'earth').inbox).toEqual([]);
  });

  it("stays blind: whatever Earth's agent does in a blackout, Mars's briefing is the same", () => {
    const run = (earthActs: boolean) => {
      const w = new World({ strategy: 'leased', seed: 5, separationDeg: 60 });
      for (const b of BODIES) w.setController(b, 'agent');
      while (w.now < 60) w.step();
      w.blackout = true;
      while (w.now < 90) w.step();
      if (earthActs) {
        w.setDirective('earth', dir({ noteTo: { mars: 'Taking 30 on.' }, give: { mars: 5 }, ask: { mars: 9 }, pricing: 'keen' }));
        w.desks.earth.pos = 30;
      }
      while (w.now < 120) w.step();
      return w;
    };
    const quiet = run(false);
    const busy = run(true);
    expect(deskBriefing(busy, 'mars')).toEqual(deskBriefing(quiet, 'mars'));
    expect(deskBriefing(busy, 'earth')).not.toEqual(deskBriefing(quiet, 'earth'));
  });

  it('keeps the last five notes, newest first in the briefing, and the spare each peer last reported', () => {
    const w = world();
    for (let i = 1; i <= 7; i++) {
      w.setDirective('moon', dir({ noteTo: { earth: `Note ${i}.` } }));
      const until = w.now + 3;
      while (w.now < until) w.step();
    }
    const until = w.now + 5;
    while (w.now < until) w.step();
    const b = deskBriefing(w, 'earth');
    expect(b.inbox!.map((n) => n.text)).toEqual(['Note 7.', 'Note 6.', 'Note 5.', 'Note 4.', 'Note 3.']);
    expect(b.spareByLastWord!.map((s) => s.body)).toEqual(['moon', 'mars']);
    expect(b.spareByLastWord!.every((s) => s.spare !== null && s.ageMin !== null && s.ageMin >= 0)).toBe(true);
  });
});
