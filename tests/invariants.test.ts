import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BODIES } from '../src/sim/types';
import type { BodyId } from '../src/sim/types';
import { Arena } from '../src/sim/world';
import { sanitise } from '../src/sim/directive';
import type { Directive } from '../src/sim/directive';

/** Something the operator (or a judge) does to the system part-way through a run. */
const event = fc.record({
  afterTicks: fc.integer({ min: 1, max: 400 }),
  kind: fc.constantFrom('blackout', 'panic', 'separation', 'cutEarthMoon', 'cutEarthMars', 'cutMoonMars', 'flow', 'trade'),
  on: fc.boolean(),
  deg: fc.integer({ min: 0, max: 180 }),
  body: fc.constantFrom(...BODIES),
  sellProb: fc.constantFrom(0.2, 0.5, 0.8),
  side: fc.constantFrom('buy' as const, 'sell' as const),
  size: fc.integer({ min: 1, max: 20 }),
});

function apply(
  arena: Arena,
  e: { kind: string; on: boolean; deg: number; body?: BodyId; sellProb?: number; side?: 'buy' | 'sell'; size?: number },
): void {
  if (e.kind === 'trade') arena.placeTrade(e.body!, e.side!, e.size!);
  else if (e.kind === 'flow') arena.setFlow(e.body!, e.sellProb!);
  else if (e.kind === 'blackout') arena.setBlackout(e.on);
  else if (e.kind === 'panic') arena.setPanic(e.on);
  else if (e.kind === 'separation') arena.setSeparation(e.deg);
  else if (e.kind === 'cutEarthMoon') arena.setCut('earth', 'moon', e.on);
  else if (e.kind === 'cutEarthMars') arena.setCut('earth', 'mars', e.on);
  else arena.setCut('moon', 'mars', e.on);
}

describe('safety', () => {
  it('leased and central never exceed the limit, whatever fails and whenever', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1e9 }), fc.array(event, { maxLength: 12 }), (seed, events) => {
        const arena = new Arena(seed);
        const { leased, central } = arena.worlds;
        const limit = leased.cfg.limit;
        for (const e of [...events, { afterTicks: 400, kind: 'none', on: false, deg: 0 }]) {
          for (let i = 0; i < e.afterTicks; i++) {
            arena.step();
            let budgets = 0;
            for (const b of BODIES) {
              const d = leased.desks[b];
              const budget = d.budget() ?? 0;
              budgets += budget;
              if (Math.abs(d.pos) > budget + 1e-9) return false;
              // Netting: reserved room is never negative, and position plus reserved room stays within budget.
              const { reserved } = d.netting();
              if (reserved < 0) return false;
              if (d.pos < -budget - 1e-9) return false;
              if (d.pos + reserved > budget + 1e-9) return false;
            }
            if (budgets > limit + 1e-9) return false;
            if (Math.abs(leased.totalPosition()) > limit + 1e-9) return false;
            if (Math.abs(central.totalPosition()) > limit + 1e-9) return false;
            // Head office's bounds always contain the central bank's true position.
            const bounds = central.desks.earth.believedTotal()!;
            const truth = central.totalPosition();
            if (bounds.low > truth + 1e-9 || truth > bounds.high + 1e-9) return false;
          }
          apply(arena, e);
        }
        return true;
      }),
      { numRuns: 60 },
    );
  });
});

/** Values a model might send, or an attacker might: nonsense types, huge and negative numbers, NaN, infinities. */
const hostileNumber = fc.oneof(
  fc.constantFrom(0, 1, 3.7, 20, 50, 99, 100, 1000, 1e12, -5, -1e9, NaN, Infinity, -Infinity, '20', null, true),
  fc.double(),
  fc.integer({ min: -1000, max: 1000 }),
);
const hostileText = fc.oneof(fc.string({ maxLength: 50 }), fc.constant('x'.repeat(10_000)), fc.constant('\u0000\n‮\t'));
const perAnyBody = <T>(v: fc.Arbitrary<T>) =>
  fc.record({ earth: v, moon: v, mars: v, venus: v }, { requiredKeys: [] });
const hostileDirective = fc.oneof(
  fc.record(
    {
      pricing: fc.constantFrom('keen', 'steady', 'cautious', 'reckless', 'toString', undefined, 7),
      caution: fc.constantFrom('normal', 'play-safe', 'yolo', undefined, null),
      give: fc.oneof(perAnyBody(hostileNumber), fc.constantFrom(null, [], 'all', 5)),
      ask: fc.oneof(perAnyBody(hostileNumber), fc.constant(null)),
      noteTo: fc.oneof(perAnyBody(hostileText), fc.constant(42)),
      thought: fc.oneof(hostileText, fc.constant(undefined)),
      source: fc.constant('chaos'),
    },
    { requiredKeys: [] },
  ),
  fc.anything(),
);
const directiveEvent = fc.record({
  afterTicks: fc.integer({ min: 1, max: 200 }),
  kind: fc.constant('directive'),
  on: fc.boolean(),
  deg: fc.constant(0),
  body: fc.constantFrom(...BODIES),
  raw: hostileDirective,
  /** Straight to the guard, skipping sanitise(): the guard alone must hold. */
  unsanitised: fc.boolean(),
});

describe('THE CHAOS PROPERTY: no model output can break the bank', () => {
  it('agent-run desks fed random and hostile directives never take our bank past its limit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1e9 }),
        fc.array(fc.oneof({ arbitrary: event, weight: 1 }, { arbitrary: directiveEvent, weight: 2 }), { maxLength: 30 }),
        (seed, events) => {
          const arena = new Arena(seed);
          for (const b of BODIES) arena.setController(b, 'agent');
          const leased = arena.worlds.leased;
          const limit = leased.cfg.limit;
          for (const e of [...events, { afterTicks: 400, kind: 'none', on: false, deg: 0 }]) {
            for (let i = 0; i < e.afterTicks; i++) {
              arena.step();
              let budgets = 0;
              for (const b of BODIES) {
                const d = leased.desks[b];
                const budget = d.budget()!;
                budgets += budget;
                const { reserved } = d.netting();
                if (!Number.isFinite(budget) || !Number.isFinite(d.pos)) return false;
                if (reserved < 0) return false;
                if (Math.abs(d.pos) > budget + 1e-9) return false;
                if (d.pos + reserved > budget + 1e-9) return false;
              }
              if (budgets > limit + 1e-9) return false;
              if (Math.abs(leased.totalPosition()) > limit + 1e-9) return false;
            }
            if (e.kind === 'directive') {
              const de = e as { body: BodyId; raw: unknown; unsanitised: boolean };
              if (de.unsanitised) {
                arena.setDirective(de.body, de.raw as Directive);
              } else {
                const d = sanitise(de.raw, de.body);
                if (d) arena.setDirective(de.body, { ...d, source: 'chaos' });
              }
            } else {
              apply(arena, e as Parameters<typeof apply>[1]);
            }
          }
          return true;
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe('fair comparison', () => {
  it('is deterministic for a given seed', () => {
    const run = () => {
      const a = new Arena(123, { separationDeg: 150 });
      a.run(60);
      a.setBlackout(true);
      a.run(60);
      return JSON.stringify([a.worlds.leased.metrics, a.worlds.leased.pnl(), a.worlds.naive.pnl()]);
    };
    expect(run()).toBe(run());
  });

  it('gives every strategy the same customers', () => {
    const a = new Arena(99);
    a.setPanic(true);
    a.run(200);
    const { leased, naive, central } = a.worlds;
    expect(naive.metrics.arrived).toBe(leased.metrics.arrived);
    expect(central.metrics.arrived).toBe(leased.metrics.arrived);
    expect(naive.metrics.volRequested).toBe(leased.metrics.volRequested);
    expect(naive.fullPrice()).toBe(leased.fullPrice());
  });
});

describe('the demo scenario', () => {
  for (const seed of [1, 7, 42, 2026]) {
    it(`seed ${seed}: naive breaches in the storm, leased holds and out-serves central`, () => {
      const a = new Arena(seed, { separationDeg: 150 });
      a.run(120);
      a.setBlackout(true);
      a.setPanic(true);
      a.run(180);
      const { leased, naive, central } = a.worlds;
      expect(naive.metrics.maxAbsTotal).toBeGreaterThan(naive.cfg.limit);
      expect(leased.metrics.breachTicks).toBe(0);
      expect(central.metrics.breachTicks).toBe(0);
      expect(leased.metrics.volFilled).toBeGreaterThan(central.metrics.volFilled);
      expect(leased.desks.mars.mode(a.now)).toBe('reduce-only');
    });
  }
});
