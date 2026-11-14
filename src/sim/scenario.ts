// Scripted timelines of events that play themselves on an Arena. No DOM, no React.
import type { SimConfig } from './config';
import type { BodyId } from './types';
import { Arena } from './world';

export type ScenarioEvent =
  | { at: number; kind: 'separation'; deg: number }
  | { at: number; kind: 'blackout'; on: boolean }
  | { at: number; kind: 'panic'; on: boolean }
  | { at: number; kind: 'cut'; a: BodyId; b: BodyId; on: boolean }
  | { at: number; kind: 'flow'; body: BodyId; sellProb: number }
  /** The presenter's caption. Changes nothing in the simulation. */
  | { at: number; kind: 'note'; text: string };

export interface Scenario {
  /** Lower-case, hyphenated, unique. */
  id: string;
  /** Shown in the menu. */
  name: string;
  /** One sentence, shown under the name. */
  summary: string;
  seed: number;
  /** Starting position of Mars. */
  separationDeg: number;
  durationMin: number;
  /** Sorted by `at`, all within [0, durationMin]. */
  events: ScenarioEvent[];
}

/**
 * Plays a scenario's events onto an Arena as simulated time reaches them. An event applies at the first tick
 * where arena.now >= event.at; events with the same time apply in array order; each applies once.
 * The Director never undoes anything, so manual changes stand until a later event overrides them.
 */
export class Director {
  private next = 0;
  private note = '';

  constructor(
    readonly arena: Arena,
    readonly scenario: Scenario,
  ) {}

  /** Apply every event whose time has come. Call once after each arena.step(). */
  advance(): void {
    const events = this.scenario.events;
    while (this.next < events.length && this.arena.now >= events[this.next].at) {
      this.apply(events[this.next]);
      this.next++;
    }
  }

  get done(): boolean {
    return this.arena.now >= this.scenario.durationMin;
  }

  /** Text of the latest note applied, or ''. */
  get caption(): string {
    return this.note;
  }

  get progress(): number {
    return Math.max(0, Math.min(1, this.arena.now / this.scenario.durationMin));
  }

  private apply(e: ScenarioEvent): void {
    if (e.kind === 'note') this.note = e.text;
    else applyEvent(this.arena, e);
  }
}

/** Apply one event to every bank in the arena. Notes change nothing in the simulation. */
export function applyEvent(a: Arena, e: ScenarioEvent): void {
  switch (e.kind) {
    case 'separation':
      a.setSeparation(e.deg);
      break;
    case 'blackout':
      a.setBlackout(e.on);
      break;
    case 'panic':
      a.setPanic(e.on);
      break;
    case 'cut':
      a.setCut(e.a, e.b, e.on);
      break;
    case 'flow':
      a.setFlow(e.body, e.sellProb);
      break;
    case 'note':
      break;
  }
}

/** Build an Arena for the scenario and apply the events due at time 0. */
export function startScenario(
  s: Scenario,
  cfg?: SimConfig,
  earthSeries?: number[],
): { arena: Arena; director: Director } {
  const arena = new Arena(s.seed, { separationDeg: s.separationDeg, cfg, earthSeries });
  const director = new Director(arena, s);
  director.advance();
  return { arena, director };
}

/**
 * Headless: run a scenario from the start to `untilMin` (default: its duration).
 * Uses the same step-then-advance loop as live play, so the result is identical by construction.
 */
export function runScenario(
  s: Scenario,
  untilMin: number = s.durationMin,
  cfg?: SimConfig,
  earthSeries?: number[],
): { arena: Arena; director: Director } {
  const run = startScenario(s, cfg, earthSeries);
  while (run.arena.now < untilMin) {
    run.arena.step();
    run.director.advance();
  }
  return run;
}
