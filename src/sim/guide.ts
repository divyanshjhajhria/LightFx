// The guided demo: a script of beats a presenter steps through with the space bar. Pure TypeScript, no DOM, no clock:
// the app passes wall-clock time in, so the whole demo can be run and checked headlessly.
import { distanceAU } from './orbits';
import { applyEvent } from './scenario';
import type { ScenarioEvent } from './scenario';
import type { BodyId, Mode, StrategyId } from './types';
import type { Arena } from './world';

export type Condition =
  | { kind: 'trade-placed' }
  /** The visitor's news is half-way to a distant peer (see Guide.holds). */
  | { kind: 'trade-message-halfway' }
  | { kind: 'desk-mode'; strategy: StrategyId; body: BodyId; mode: Mode }
  /** |true total| > limit right now. */
  | { kind: 'breached'; strategy: StrategyId }
  /** The leased bank's story for the visitor's trade has 'heard' at this body. */
  | { kind: 'trade-heard'; body: BodyId }
  /** Simulated minutes since this beat started. */
  | { kind: 'elapsed'; minutes: number };

/** One thing to say: the caption on screen, and what the voice reads (may be longer). */
export interface Line {
  caption: string;
  voice: string;
  /** Recorded-audio name: the beat id, or "<beat id>-settle". */
  id: string;
}

export interface Beat {
  id: string;
  /** Shown in the presenter's "next" hint: 2 to 4 words. */
  label: string;
  /** Applied the moment the beat starts. */
  enter: ScenarioEvent[];
  /** Which bank the canvas shows from this beat on, if it changes. */
  view?: StrategyId;
  /** Simulated minutes per second while the beat is unsettled. */
  speed: number;
  /** Spoken when the beat starts. */
  say?: Omit<Line, 'id'>;
  /** Optional second phase: run at `speed` until `when` holds (or `capMinutes` pass), then slow to `settle.speed`. */
  settle?: {
    when: Condition;
    capMinutes: number;
    speed: number;
    /** Spoken ONLY if `when` became true. A capped beat says nothing, so no line claims what did not happen. */
    say?: Omit<Line, 'id'>;
  };
  /** What moves on to the next beat. */
  advance: 'space' | Condition;
  /** For a condition advance: move on anyway after this many real seconds. */
  fallbackSeconds?: number;
}

const both = (text: string) => ({ caption: text, voice: text });

/** The visitor's default trade when the presenter presses space instead of the button. */
export const DEFAULT_TRADE = { at: 'mars' as BodyId, side: 'sell' as const, size: 5 };

export const GUIDE_SEED = 42;
export const GUIDE_SEPARATION = 150;
/** Minutes the bank runs before the demo starts, so the desks are not all at zero. */
export const GUIDE_WARMUP = 60;

export const GUIDE_BEATS: Beat[] = [
  {
    id: 'ready',
    label: 'Place a trade',
    speed: 1,
    enter: [],
    advance: { kind: 'trade-placed' },
    say: both(
      'This is one bank with offices on Earth, the Moon and Mars. A message between Earth and Mars takes twenty ' +
        'minutes each way. Go ahead: sell five Mars credits to the Mars desk.',
    ),
  },
  {
    id: 'trade',
    label: 'Your trade',
    speed: 1,
    enter: [],
    advance: { kind: 'trade-message-halfway' },
    fallbackSeconds: 14,
    say: both(
      'Mars took your five credits on its own, straight away. Now it is telling Earth what it holds. Watch the message go.',
    ),
  },
  {
    id: 'storm',
    label: 'Solar storm',
    speed: 1,
    enter: [{ at: 0, kind: 'blackout', on: true }],
    advance: 'space',
    say: both(
      'A solar storm. Every link between the planets is gone, and your message was destroyed on the way. ' +
        'Earth has no idea your trade happened.',
    ),
  },
  {
    id: 'silence',
    label: 'An hour of silence',
    speed: 16,
    enter: [],
    advance: 'space',
    say: { caption: 'Time passes.', voice: 'An hour goes by.' },
    settle: {
      when: { kind: 'desk-mode', strategy: 'leased', body: 'mars', mode: 'reduce-only' },
      capMinutes: 90,
      speed: 1,
      say: both(
        'An hour with no word from anyone. Our Mars desk does not guess. It stops taking on new risk, by itself, and waits.',
      ),
    },
  },
  {
    id: 'panic',
    label: 'Market panic',
    speed: 16,
    enter: [{ at: 0, kind: 'panic', on: true }],
    view: 'naive',
    advance: 'space',
    say: both('Now the market panics. Everyone is selling at once, on every planet.'),
    settle: {
      when: { kind: 'breached', strategy: 'naive' },
      capMinutes: 120,
      speed: 1,
      say: both(
        'The bank that trusts old news has just gone through its limit. Look at what each desk thinks the bank holds. ' +
          'None of them is right. Ours is holding inside the line.',
      ),
    },
  },
  {
    id: 'alone',
    label: 'Total isolation',
    speed: 4,
    enter: [{ at: 0, kind: 'cut', a: 'earth', b: 'moon', on: true }],
    view: 'leased',
    advance: 'space',
    settle: { when: { kind: 'elapsed', minutes: 20 }, capMinutes: 20, speed: 1 },
    say: both(
      'Now Earth and the Moon lose each other too. Three desks, and no links at all. The bank that asks head office ' +
        'has not completed one trade on Mars since the storm began. Ours is still inside its limit, because no desk ' +
        'ever needed permission.',
    ),
  },
  {
    id: 'recovery',
    label: 'The storm passes',
    speed: 4,
    enter: [
      { at: 0, kind: 'blackout', on: false },
      { at: 0, kind: 'panic', on: false },
      { at: 0, kind: 'cut', a: 'earth', b: 'moon', on: false },
    ],
    advance: 'space',
    say: both('The storm passes. The links come back, and the desks catch up.'),
    settle: {
      when: { kind: 'trade-heard', body: 'earth' },
      capMinutes: 90,
      speed: 1,
      say: both(
        'Earth has finally heard about your trade. Through all of that, our bank never crossed its limit and never ' +
          'needed head office. That is Lightspeed FX.',
      ),
    },
  },
];

/** Steps through the beats. Call tick() after every simulation step and every animation frame; space() on a press. */
export class Guide {
  index = 0;
  settled = false;
  finished = false;
  trade: number | null = null;
  /** Whether the current beat's settle ran out of time instead of its condition coming true. */
  capped = false;
  private beatStartSim = 0;
  private beatStartReal: number | null = null;
  private lastReal = 0;
  private queue: Line[] = [];

  constructor(
    readonly arena: Arena,
    readonly beats: Beat[] = GUIDE_BEATS,
  ) {
    this.enter(0);
  }

  get beat(): Beat {
    return this.beats[this.index];
  }

  /** What the app should run at right now, in simulated minutes per second. */
  get speed(): number {
    const b = this.beat;
    if (b.settle && !this.settled) return b.speed;
    return b.settle ? b.settle.speed : b.speed;
  }

  /** False while fast-forwarding towards a settle: a press then does nothing. */
  get canAdvance(): boolean {
    return !this.finished && !(this.beat.settle && !this.settled);
  }

  /** Label of the beat a space press would start, or null on the last beat. */
  get nextLabel(): string | null {
    return this.beats[this.index + 1]?.label ?? null;
  }

  tradePlaced(trade: number): void {
    this.trade = trade;
  }

  tick(realSeconds: number): Line[] {
    this.lastReal = realSeconds;
    if (this.beatStartReal === null) this.beatStartReal = realSeconds;
    if (!this.finished) {
      const b = this.beat;
      if (b.settle && !this.settled) {
        if (this.holds(b.settle.when)) {
          this.settled = true;
          if (b.settle.say) this.queue.push({ ...b.settle.say, id: `${b.id}-settle` });
        } else if (this.arena.now - this.beatStartSim >= b.settle.capMinutes) {
          // Out of time: slow down, but say nothing that would claim the condition happened.
          this.settled = true;
          this.capped = true;
        }
      }
      if (this.settled && b.advance !== 'space') {
        const fallback = b.fallbackSeconds !== undefined && realSeconds - this.beatStartReal >= b.fallbackSeconds;
        if (this.holds(b.advance) || fallback) this.enter(this.index + 1);
      }
    }
    const out = this.queue;
    this.queue = [];
    return out;
  }

  space(): boolean {
    if (!this.canAdvance) return false;
    const b = this.beat;
    if (b.advance !== 'space') {
      // Only the first beat answers a press: it places the visitor's trade itself.
      if (b.advance.kind !== 'trade-placed' || this.trade !== null) return false;
      this.tradePlaced(this.arena.placeTrade(DEFAULT_TRADE.at, DEFAULT_TRADE.side, DEFAULT_TRADE.size));
      this.enter(this.index + 1);
      return true;
    }
    if (this.index === this.beats.length - 1) this.finished = true;
    else this.enter(this.index + 1);
    return true;
  }

  private enter(i: number): void {
    this.index = i;
    const b = this.beats[i];
    this.settled = !b.settle;
    this.capped = false;
    this.beatStartSim = this.arena.now;
    this.beatStartReal = this.beatStartReal === null ? null : this.lastReal;
    for (const e of b.enter) applyEvent(this.arena, e);
    if (b.say) this.queue.push({ ...b.say, id: b.id });
  }

  /** Whether a condition is true right now. Reads the simulation's god view; the desks never see any of this. */
  holds(c: Condition): boolean {
    const a = this.arena;
    const lead = a.worlds.leased;
    switch (c.kind) {
      case 'trade-placed':
        return this.trade !== null;
      case 'trade-message-halfway': {
        if (this.trade === null) return false;
        return lead
          .trace(this.trade)
          .some(
            (e) =>
              e.kind === 'told' &&
              distanceAU(lead.orbit, e.body, e.to) > 0.1 &&
              lead.now >= e.t + (e.landsAt - e.t) / 2,
          );
      }
      case 'desk-mode': {
        const w = a.worlds[c.strategy];
        return w.desks[c.body].mode(w.now) === c.mode;
      }
      case 'breached': {
        const w = a.worlds[c.strategy];
        return Math.abs(w.totalPosition()) > w.cfg.limit;
      }
      case 'trade-heard':
        return this.trade !== null && lead.trace(this.trade).some((e) => e.kind === 'heard' && e.body === c.body);
      case 'elapsed':
        return a.now - this.beatStartSim >= c.minutes;
    }
  }
}
