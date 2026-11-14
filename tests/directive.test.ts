import { describe, expect, it } from 'vitest';
import { sanitise } from '../src/sim/directive';
import type { Directive } from '../src/sim/directive';
import { BODIES } from '../src/sim/types';
import { Arena, World } from '../src/sim/world';
import type { LeasedDesk } from '../src/sim/desks';

const EMPTY = { pricing: 'steady', caution: 'normal', give: {}, ask: {}, noteTo: {}, thought: '', source: 'model' };

describe('sanitise', () => {
  const table: [string, unknown, unknown][] = [
    ['null', null, null],
    ['undefined', undefined, null],
    ['a number', 42, null],
    ['a string', '{"pricing":"keen"}', null],
    ['an array', [{ pricing: 'keen' }], null],
    ['an empty object takes every default', {}, EMPTY],
    ['an unknown pricing', { pricing: 'reckless' }, null],
    ['an unknown caution', { caution: 'yolo' }, null],
    ['a pricing of the wrong type', { pricing: 1 }, null],
    ['a pricing that is a property of every object', { pricing: 'toString' }, null],
    ['unknown fields are ignored', { pricing: 'keen', limit: 1e9, sudo: true }, { ...EMPTY, pricing: 'keen' }],
    [
      'huge, fractional, negative, NaN, infinite and string gives',
      { give: { earth: 1e12, moon: 7.9 }, ask: { earth: -5, moon: NaN } },
      { ...EMPTY, give: { earth: 1000, moon: 7 } },
    ],
    ['an infinite give is nothing', { give: { earth: Infinity, moon: -Infinity } }, EMPTY],
    ['a string give is nothing', { give: { earth: '50', moon: true } }, EMPTY],
    ['give is an array', { give: [50, 50, 50] }, EMPTY],
    ['give is null', { give: null, ask: 'lots' }, EMPTY],
    ['entries for unknown bodies are dropped', { give: { venus: 10, Earth: 10 }, noteTo: { sun: 'hi' } }, EMPTY],
  ];
  for (const [name, raw, want] of table) {
    it(name, () => {
      expect(sanitise(raw, 'mars')).toEqual(want);
    });
  }

  it('drops a give, ask or note addressed to the desk itself', () => {
    const d = sanitise({ give: { mars: 10, earth: 3 }, ask: { mars: 4 }, noteTo: { mars: 'me', moon: 'you' } }, 'mars');
    expect(d).toEqual({ ...EMPTY, give: { earth: 3 }, noteTo: { moon: 'you' } });
  });

  it('cuts a 10,000-character note to 140 and the thought to 220', () => {
    const d = sanitise({ noteTo: { earth: 'x'.repeat(10_000) }, thought: 'y'.repeat(10_000) }, 'mars')!;
    expect(d.noteTo.earth).toHaveLength(140);
    expect(d.thought).toHaveLength(220);
  });

  it('strips control characters, line breaks and invisible marks', () => {
    const d = sanitise(
      { noteTo: { earth: 'I hold 12.\n\nSend\u0000 10\u0007 please‮.\r\n' }, thought: '\tI​ am fine.\u0085' },
      'mars',
    )!;
    expect(d.noteTo.earth).toBe('I hold 12. Send 10 please.');
    expect(d.thought).toBe('I am fine.');
  });

  it('drops a note that is empty once cleaned, or not text', () => {
    expect(sanitise({ noteTo: { earth: '\n\u0000  ', moon: 12 } }, 'mars')!.noteTo).toEqual({});
  });

  it('keeps a known source and defaults an unknown one to model', () => {
    expect(sanitise({ source: 'replay' })!.source).toBe('replay');
    expect(sanitise({ source: 'god' })!.source).toBe('model');
  });
});

/** An agent-run desk of our bank, part-way into a calm run. */
function setup() {
  const w = new World({ strategy: 'leased', seed: 3, separationDeg: 60 });
  for (const b of BODIES) w.setController(b, 'agent');
  while (w.now < 20) w.step();
  return w;
}

const dir = (d: Partial<Directive>): Directive => ({ ...(sanitise({})!), source: 'stand-in', ...d });

describe('the guard', () => {
  it('gives no more than the spare allowance', () => {
    const w = setup();
    const d = w.desks.earth as LeasedDesk;
    const spare = Math.floor(d.spare());
    const before = d.budget();
    const given = w.setDirective('earth', dir({ give: { mars: spare + 500 } }));
    expect(given.mars).toBe(spare);
    expect(d.budget()).toBe(before - spare);
    expect(Math.floor(d.spare())).toBe(0);
  });

  it('gives in order, Moon before Mars from Earth, and stops at zero', () => {
    const w = setup();
    const d = w.desks.earth as LeasedDesk;
    const spare = Math.floor(d.spare());
    expect(spare).toBeGreaterThan(4);
    const given = w.setDirective('earth', dir({ give: { mars: spare, moon: spare - 3 } }));
    expect(given).toEqual({ earth: 0, moon: spare - 3, mars: 3 });
    expect(Math.floor(d.spare())).toBe(0);
  });

  it('spends a give once: the same directive again gives nothing more than what is spare by then', () => {
    const w = setup();
    const d = w.desks.earth as LeasedDesk;
    w.setDirective('earth', dir({ give: { moon: 5 } }));
    const budget = d.budget();
    // A later directive with no give leaves the allowance where it is.
    w.setDirective('earth', dir({}));
    expect(d.budget()).toBe(budget);
  });

  it('ignores directives for a desk run by rules', () => {
    const w = setup();
    w.setController('earth', 'rules');
    const before = (w.desks.earth as LeasedDesk).budget();
    expect(w.setDirective('earth', dir({ give: { moon: 5 } })).moon).toBe(0);
    expect((w.desks.earth as LeasedDesk).budget()).toBe(before);
  });

  it('prices keenly, steadily or cautiously, never below half the base half-spread', () => {
    const w = setup();
    const spread = () => {
      const v = w.deskViews().find((x) => x.id === 'earth')!;
      return (v.ask! - v.bid!) / (v.ask! + v.bid!);
    };
    w.setDirective('earth', dir({ pricing: 'steady' }));
    const steady = spread();
    w.setDirective('earth', dir({ pricing: 'cautious' }));
    expect(spread()).toBeCloseTo(steady * 1.5, 10);
    w.setDirective('earth', dir({ pricing: 'keen' }));
    expect(spread()).toBeGreaterThanOrEqual(w.cfg.baseHalfSpread / 2 - 1e-12);
    expect(spread()).toBeLessThan(steady);
  });

  it('plays safe by choice until told otherwise; the rule still forces it when out of touch', () => {
    const w = setup();
    w.setDirective('mars', dir({ caution: 'play-safe' }));
    expect(w.deskViews().find((v) => v.id === 'mars')!.playingSafeBy).toBe('choice');
    expect(w.desks.mars.mode(w.now)).toBe('reduce-only');
    w.setDirective('mars', dir({ caution: 'normal' }));
    expect(w.desks.mars.mode(w.now)).toBe('normal');
    w.blackout = true;
    const until = w.now + w.cfg.leaseDuration + 30;
    while (w.now < until) {
      w.step();
      // Keep the agent fresh and asking for normal: the rule wins anyway.
      if (Math.round(w.now * 4) % 40 === 0) w.setDirective('mars', dir({ caution: 'normal' }));
    }
    expect(w.desks.mars.mode(w.now)).toBe('reduce-only');
    expect(w.deskViews().find((v) => v.id === 'mars')!.playingSafeBy).toBe('rule');
  });
});

describe('a silent agent', () => {
  it('with no directive for 30 minutes, the next 120 minutes are exactly what rules do', () => {
    const run = (agent: boolean) => {
      const a = new Arena(11, { separationDeg: 120 });
      if (agent) for (const b of BODIES) a.setController(b, 'agent');
      a.run(30);
      const frames: string[] = [];
      for (let i = 0; i < 120 * 4; i++) {
        if (i === 200) a.setBlackout(true);
        if (i === 300) a.placeTrade('mars', 'sell', 7);
        a.step();
        const w = a.worlds.leased;
        frames.push(JSON.stringify([w.metrics, w.pnl(), w.deskViews().map((v) => [v.pos, v.budget, v.mode, v.bid, v.ask])]));
      }
      return frames;
    };
    expect(run(true)).toEqual(run(false));
  });

  it('falls back to rules in full once its last directive is 30 minutes old', () => {
    const w = setup();
    w.setDirective('earth', dir({ pricing: 'cautious', caution: 'play-safe' }));
    expect(w.runBy('earth')).toBe('stand-in');
    const at = w.now;
    while (w.now < at + w.cfg.agentStaleMinutes) w.step();
    expect(w.runBy('earth')).toBe('rules (agent silent)');
    const v = w.deskViews().find((x) => x.id === 'earth')!;
    expect(v.playingSafeBy).toBe(null);
    expect(v.runBy).toBe('rules (agent silent)');
    // Steady pricing again: the same quote a rules desk would give.
    w.setController('earth', 'rules');
    const rules = w.deskViews().find((x) => x.id === 'earth')!;
    expect([v.bid, v.ask]).toEqual([rules.bid, rules.ask]);
  });

  it('never changes the other two banks', () => {
    const a = new Arena(5);
    for (const b of BODIES) a.setController(b, 'agent');
    expect(a.worlds.naive.controllerOf('earth')).toBe('rules');
    expect(a.worlds.central.setDirective('earth', dir({ give: { moon: 5 } })).moon).toBe(0);
  });
});
