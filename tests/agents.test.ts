import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../src/agents/llm';
import { AgentRunner, LIVE_CALL_BUDGET, extractJson, resetLiveBudget } from '../src/agents/runner';
import type { LeasedDesk } from '../src/sim/desks';
import { startScenario } from '../src/sim/scenario';
import { SCENARIOS } from '../src/sim/scenarios';
import { BODIES } from '../src/sim/types';
import { Arena } from '../src/sim/world';

/** A model that answers when told to. Each call waits on its own promise. */
function fakeClient() {
  const calls: { user: string; resolve: (s: string) => void; reject: (e: Error) => void; signal: AbortSignal }[] = [];
  const client: LlmClient = {
    complete: (_system, user, signal) =>
      new Promise<string>((resolve, reject) => {
        calls.push({ user, resolve, reject, signal });
      }),
  };
  return { client, calls };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup(seed = 8) {
  const arena = new Arena(seed, { separationDeg: 90 });
  arena.run(20);
  let real = 100;
  const clock = () => real;
  const advance = (s: number) => {
    real += s;
  };
  return { arena, clock, advance };
}

const GOOD = JSON.stringify({
  pricing: 'cautious',
  caution: 'normal',
  give: { moon: 2, mars: 0 },
  ask: {},
  noteTo: { moon: 'I hold a little and can spare 2.' },
  thought: 'I am pricing cautiously and gave 2 to the Moon.',
});

describe('the agent runner', () => {
  it('applies a good answer; the desk goes from thinking to decided', async () => {
    const { arena, clock } = setup();
    const { client, calls } = fakeClient();
    const r = new AgentRunner(arena, { mode: 'live', client, clock });
    const before = (arena.worlds.leased.desks.earth as LeasedDesk).budget();
    r.tick();
    expect(r.status('earth').state).toBe('thinking');
    expect(calls).toHaveLength(3);
    calls[0].resolve(GOOD);
    await flush();
    expect(r.status('earth').state).toBe('decided');
    const desk = arena.worlds.leased.desks.earth as LeasedDesk;
    expect(desk.lastDirective()!.directive.pricing).toBe('cautious');
    expect(desk.budget()).toBe(before - 2);
    expect(r.thought('earth')).toBe('I am pricing cautiously and gave 2 to the Moon.');
    expect(arena.worlds.leased.runBy('earth')).toBe('model');
    expect(r.log().at(-1)!.checks).toMatchObject({ parsed: true, thought: 'ok', given: { moon: 2 } });
  });

  it('counts "decided N s ago" from the newest decision', async () => {
    const { arena, clock, advance } = setup();
    const { client, calls } = fakeClient();
    const r = new AgentRunner(arena, { mode: 'live', client, clock });
    r.tick();
    calls[0].resolve(GOOD);
    await flush();
    advance(30);
    expect(r.status('earth').sinceRealSeconds).toBe(30);
    arena.placeTrade('earth', 'sell', 1);
    arena.step();
    r.tick();
    const next = calls.filter((c) => JSON.parse(c.user).body === 'earth')[1];
    next.resolve(GOOD);
    await flush();
    advance(2);
    expect(r.status('earth')).toMatchObject({ state: 'decided', sinceRealSeconds: 2 });
  });

  it('accepts fenced JSON; refuses prose around JSON or garbage, and the stand-in decides instead', async () => {
    expect(extractJson('```json\n{"pricing":"keen"}\n```')).toEqual({ pricing: 'keen' });
    expect(extractJson('```\n{"pricing":"keen"}\n```')).toEqual({ pricing: 'keen' });
    expect(() => extractJson('Sure! {"pricing":"keen"}')).toThrow();
    expect(() => extractJson('{"pricing":"keen"} Hope that helps.')).toThrow();
    expect(() => extractJson('{not json}')).toThrow();

    const { arena, clock } = setup();
    const { client, calls } = fakeClient();
    const r = new AgentRunner(arena, { mode: 'live', client, clock });
    r.tick();
    calls[0].resolve('```json\n' + GOOD + '\n```');
    calls[1].resolve('Here is my decision: ' + GOOD);
    calls[2].resolve('@@@ garbage @@@');
    await flush();
    expect(r.status('earth').state).toBe('decided');
    for (const b of ['moon', 'mars'] as const) {
      expect(r.status(b)).toMatchObject({ state: 'decided', calls: 1, rejected: 1 });
      // The refused answer is logged as refused; nothing of it is applied. The stand-in's decision is applied instead.
      const mine = r.log().filter((e) => e.body === b);
      expect(mine.map((e) => e.directive?.source ?? null)).toEqual([null, 'stand-in']);
      expect((arena.worlds.leased.desks[b] as LeasedDesk).lastDirective()!.directive.source).toBe('stand-in');
      expect(arena.worlds.leased.runBy(b)).toBe('stand-in');
    }
    expect(r.fallbacks).toBe(2);
  });

  it('after the live call budget, asks no model and lets the stand-in decide', async () => {
    resetLiveBudget(LIVE_CALL_BUDGET);
    try {
      const { arena, clock } = setup();
      const { client, calls } = fakeClient();
      const r = new AgentRunner(arena, { mode: 'live', client, clock });
      r.tick();
      expect(calls.length).toBe(0);
      expect(r.budgetSpent).toBe(true);
      for (const b of BODIES) expect(arena.worlds.leased.runBy(b)).toBe('stand-in');
    } finally {
      resetLiveBudget();
    }
  });

  it('blanks a thought with an invented number, and still applies the gives', async () => {
    const { arena, clock } = setup();
    const { client, calls } = fakeClient();
    const r = new AgentRunner(arena, { mode: 'live', client, clock });
    const before = (arena.worlds.leased.desks.earth as LeasedDesk).budget();
    r.tick();
    calls[0].resolve(
      JSON.stringify({ pricing: 'steady', caution: 'normal', give: { moon: 3 }, thought: 'I gave 3 to the Moon, as 4817 customers want.' }),
    );
    await flush();
    expect((arena.worlds.leased.desks.earth as LeasedDesk).budget()).toBe(before - 3);
    expect(r.thought('earth')).toBe('');
    expect(r.log().at(-1)!.checks).toMatchObject({ thought: 'blanked', given: { moon: 3 } });
    expect(r.status('earth').rejected).toBe(1);
  });

  it('drops a note that fails the checker and keeps the rest', async () => {
    const { arena, clock } = setup();
    const { client, calls } = fakeClient();
    const r = new AgentRunner(arena, { mode: 'live', client, clock });
    r.tick();
    calls[0].resolve(
      JSON.stringify({ noteTo: { moon: 'The naive bank is in trouble.', mars: 'All fine here.' }, thought: 'I am steady.' }),
    );
    await flush();
    expect(r.log().at(-1)!.directive!.noteTo).toEqual({ mars: 'All fine here.' });
    expect(r.log().at(-1)!.checks.notesDropped).toEqual(['moon']);
  });

  it('calls once for ten triggers in two real seconds, and never twice at once for one desk', async () => {
    const { arena, clock, advance } = setup();
    const { client, calls } = fakeClient();
    const r = new AgentRunner(arena, { mode: 'live', client, clock });
    r.tick();
    const earthCalls = () => calls.filter((c) => JSON.parse(c.user).body === 'earth').length;
    expect(earthCalls()).toBe(1);
    calls[0].resolve(GOOD);
    await flush();
    for (let i = 0; i < 10; i++) {
      arena.placeTrade('earth', i % 2 ? 'buy' : 'sell', 1);
      arena.step();
      advance(0.2);
      r.tick();
    }
    expect(earthCalls()).toBe(1);
    // The remembered trigger is acted on once four real seconds have passed.
    advance(2.1);
    r.tick();
    expect(earthCalls()).toBe(2);
    // That call hangs. More triggers, and much more time (but under the timeout): still no second call at once.
    for (let i = 0; i < 5; i++) {
      arena.placeTrade('earth', 'sell', 1);
      arena.step();
      advance(1);
      r.tick();
    }
    expect(earthCalls()).toBe(2);
    expect(r.status('earth').state).toBe('thinking');
  });

  it('on timeout the answer is abandoned and the stand-in decides that one instead', async () => {
    const { arena, clock, advance } = setup(21);
    const { client, calls } = fakeClient(); // never answers
    const r = new AgentRunner(arena, { mode: 'live', client, clock });
    r.tick();
    expect(calls.length).toBe(3);
    for (let i = 0; i < 17; i++) {
      arena.step();
      advance(0.5);
      r.tick();
    }
    // Over eight real seconds have passed: every desk's call is given up and the stand-in has decided.
    for (const b of BODIES) {
      expect(arena.worlds.leased.runBy(b)).toBe('stand-in');
      expect(r.log().filter((e) => e.body === b).slice(0, 2).map((e) => e.checks.error ?? e.directive?.source)).toEqual(['timeout', 'stand-in']);
    }
    expect(r.fallbacks).toBe(3);
    // A late answer to an abandoned call is ignored.
    const logged = r.log().length;
    calls[0].resolve(GOOD);
    await flush();
    expect(r.log().length).toBe(logged);
  });

  it('replays a recorded stand-in session to the same result on the same seed', () => {
    const play = (session?: ReturnType<AgentRunner['log']>) => {
      const arena = new Arena(33, { separationDeg: 150 });
      const r = new AgentRunner(arena, { mode: session ? 'replay' : 'stand-in', session, clock: () => arena.now * 2 });
      for (let i = 0; i < 240 * 4; i++) {
        if (i === 60 * 4) arena.setBlackout(true);
        if (i === 150 * 4) arena.setBlackout(false);
        arena.step();
        r.tick();
      }
      return { arena, r };
    };
    const rec = play();
    expect(rec.r.log().length).toBeGreaterThan(20);
    const session = JSON.parse(JSON.stringify(rec.r.log()));
    const rep = play(session);
    const w1 = rec.arena.worlds.leased;
    const w2 = rep.arena.worlds.leased;
    expect(w2.metrics).toEqual(w1.metrics);
    expect(w2.pnl()).toBe(w1.pnl());
    expect(BODIES.map((b) => w2.desks[b].budget())).toEqual(BODIES.map((b) => w1.desks[b].budget()));
    // A recorded stand-in decision replays as the stand-in's, never as a model's.
    expect(rep.r.log().every((e) => e.directive === null || e.directive.source === 'stand-in')).toBe(true);
  });

  it("three stand-ins through 'solar-storm': no breach; notes delivered before, lost during, gives after", () => {
    const s = SCENARIOS.find((x) => x.id === 'solar-storm')!;
    const { arena, director } = startScenario(s);
    const r = new AgentRunner(arena, { mode: 'stand-in', clock: () => arena.now * 2 });
    // The god-view log keeps only the latest notes, so follow each note's fate as the run goes.
    const fate = new Map<number, { sentAt: number; landsAt: number; status: string }>();
    while (arena.now < s.durationMin) {
      arena.step();
      director.advance();
      r.tick();
      for (const n of arena.worlds.leased.noteLog()) fate.set(n.id, { sentAt: n.sentAt, landsAt: n.landsAt, status: n.status });
    }
    const w = arena.worlds.leased;
    expect(w.metrics.breachTicks).toBe(0);
    const notes = [...fate.values()];
    expect(notes.some((n) => n.status === 'delivered' && n.landsAt < 120)).toBe(true);
    expect(notes.some((n) => (n.status === 'lost' || n.status === 'destroyed') && n.sentAt >= 120 && n.sentAt < 300)).toBe(true);
    expect(r.log().some((e) => e.simTime > 300 && Object.keys(e.checks.given).length > 0)).toBe(true);
    // Every thought shown passed the checker.
    expect(r.log().every((e) => e.checks.thought !== 'blanked')).toBe(true);
  });
});

describe('the simulation stays sealed', () => {
  it('no file under src/sim imports from src/agents or src/ui, or does any I/O', () => {
    const dir = join(__dirname, '..', 'src', 'sim');
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8');
      for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        expect(`${f}: ${m[1]}`).toMatch(/: \.\/[\w.]+$/);
      }
      expect(text, f).not.toMatch(/\bfetch\(|import\.meta|XMLHttpRequest|localStorage|document\.|window\./);
    }
  });
});
