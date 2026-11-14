// The guided demo: a script of beats a presenter steps through with the space bar. Pure TypeScript, no DOM, no clock:
// the app passes wall-clock time in, so the whole demo can be run and checked headlessly.
import { distanceAU } from './orbits';
import { applyEvent } from './scenario';
import type { ScenarioEvent } from './scenario';
import type { BodyId, Mode, StrategyId } from './types';
import type { Arena } from './world';

export type Condition =
  | { kind: 'trade-placed' }
  /**
   * The visitor's news is half-way to a distant peer. With `noNewsAfter`, also true once that many simulated minutes
   * have passed since the trade with no news sent to a distant peer at all (so the demo never waits for ever).
   */
  | { kind: 'trade-message-halfway'; noNewsAfter?: number }
  | { kind: 'desk-mode'; strategy: StrategyId; body: BodyId; mode: Mode }
  /** |true total| > limit right now. */
  | { kind: 'breached'; strategy: StrategyId }
  /** The leased bank's story for the visitor's trade has 'heard' at this body ('far': the trade's farthest peer). */
  | { kind: 'trade-heard'; body: BodyId | 'far' }
  /** Simulated minutes since this beat started. */
  | { kind: 'elapsed'; minutes: number };

/** One thing to say: the caption on screen, and what the voice reads (may be longer). */
export interface Line {
  caption: string;
  voice: string;
  /** Recorded-audio name: the beat id, or "<beat id>-settle". */
  id: string;
}

/** What a line may depend on: the visitor's trade as it actually happened, read from the leased bank's story. */
export interface GuideContext {
  trade: {
    at: BodyId;
    side: 'buy' | 'sell';
    size: number;
    /** Units the leased desk took: 0 if it said no. */
    filled: number;
    /** The peer the story is about: Earth for a trade on Mars, Mars for a trade on Earth or the Moon. */
    far: BodyId;
  } | null;
  /** A message carrying the trade's news is travelling right now. */
  newsInFlight: boolean;
  /** The far peer has already heard about the trade. */
  heardFar: boolean;
}

type Words = Omit<Line, 'id'>;
/** A line, or a line that depends on what actually happened, so it never says something untrue. */
type Say = Words | ((c: GuideContext) => Words);

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
  say?: Say;
  /** Optional second phase: run at `speed` until `when` holds (or `capMinutes` pass), then slow to `settle.speed`. */
  settle?: {
    when: Condition;
    capMinutes: number;
    speed: number;
    /** Spoken ONLY if `when` became true. A capped beat says nothing, so no line claims what did not happen. */
    say?: Say;
  };
  /** What moves on to the next beat. */
  advance: 'space' | Condition;
  /** For a condition advance: move on anyway after this many real seconds. */
  fallbackSeconds?: number;
}

const both = (text: string) => ({ caption: text, voice: text });

const NUMBER = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
  'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const spell = (n: number) => NUMBER[n] ?? String(n);
const NAME: Record<BodyId, string> = { earth: 'Earth', moon: 'the Moon', mars: 'Mars' };
const Name = (b: BodyId) => (b === 'moon' ? 'The Moon' : NAME[b]);

/** Beat 2: what the desk did with the visitor's trade. The default trade gives the scripted wording exactly. */
function tradeLine(c: GuideContext): Words {
  const t = c.trade;
  if (!t) return both('Watch the message go.');
  const desk = Name(t.at);
  const credits = (n: number) => `${spell(n)} ${n === 1 ? 'credit' : 'credits'}`;
  let did: string;
  if (t.filled === 0) {
    return both(`${desk} said no on its own, straight away: its allowance has no room for that. Nothing to tell anyone.`);
  } else if (t.side === 'sell') {
    did = t.filled < t.size ? `${desk} took ${spell(t.filled)} of your ${credits(t.size)}` : `${desk} took your ${credits(t.size)}`;
  } else {
    did = t.filled < t.size ? `${desk} sold you ${spell(t.filled)} of the ${credits(t.size)} you asked for` : `${desk} sold you ${credits(t.size)}`;
  }
  return both(`${did} on its own, straight away. Now it is telling ${NAME[t.far]} what it holds. Watch the message go.`);
}

/** Beat 3: says the visitor's message was destroyed only if one really was in flight when the storm hit. */
function stormLine(c: GuideContext): Words {
  const far = c.trade ? NAME[c.trade.far] : 'Earth';
  const Far = c.trade ? Name(c.trade.far) : 'Earth';
  if (c.newsInFlight) {
    return both(
      `A solar storm. Every link between the planets is gone, and your message was destroyed on the way. ${Far} has no idea your trade happened.`,
    );
  }
  if (c.heardFar) return both(`A solar storm. Every link between the planets is gone. ${Far} heard about your trade just in time.`);
  return both(`A solar storm. Every link between the planets is gone, and ${far} has not heard about your trade.`);
}

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
    // Simulated time only: a slow machine slows the whole simulation, so the storm still lands mid-flight.
    advance: { kind: 'trade-message-halfway', noNewsAfter: 3 },
    // For the default trade (sell 5 at Mars): "Mars took your five credits on its own, straight away. Now it is
    // telling Earth what it holds. Watch the message go."
    say: tradeLine,
  },
  {
    id: 'storm',
    label: 'Solar storm',
    speed: 1,
    enter: [{ at: 0, kind: 'blackout', on: true }],
    advance: 'space',
    // For the default trade: "A solar storm. Every link between the planets is gone, and your message was destroyed on
    // the way. Earth has no idea your trade happened."
    say: stormLine,
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
      when: { kind: 'trade-heard', body: 'far' },
      capMinutes: 90,
      speed: 1,
      say: (c) =>
        both(
          `${c.trade ? Name(c.trade.far) : 'Earth'} has finally heard about your trade. Through all of that, our bank ` +
            'never crossed its limit and never needed head office. That is Lightspeed FX.',
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
          if (b.settle.say) this.queue.push({ ...this.words(b.settle.say), id: `${b.id}-settle` });
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
    // Work out what can truthfully be said before the beat's events change anything.
    const words = b.say ? this.words(b.say) : null;
    for (const e of b.enter) applyEvent(this.arena, e);
    if (words) this.queue.push({ ...words, id: b.id });
  }

  private words(s: Say): Words {
    return typeof s === 'function' ? s(this.context()) : s;
  }

  /** The visitor's trade as it actually happened, from the leased bank's story. */
  context(): GuideContext {
    const lead = this.arena.worlds.leased;
    const tr = this.trade === null ? [] : lead.trace(this.trade);
    const placed = tr.find((e) => e.kind === 'placed');
    if (!placed || placed.kind !== 'placed') return { trade: null, newsInFlight: false, heardFar: false };
    const filled = tr.find((e) => e.kind === 'filled');
    // The peer across the gulf: Earth for a trade on Mars, Mars for a trade on Earth or the Moon.
    const far: BodyId = placed.body === 'mars' ? 'earth' : 'mars';
    return {
      trade: {
        at: placed.body,
        side: placed.side,
        size: placed.size,
        filled: filled?.kind === 'filled' ? filled.units : 0,
        far,
      },
      newsInFlight: lead.net.inFlight.some((e) => e.trade === this.trade && e.to !== placed.body),
      heardFar: tr.some((e) => e.kind === 'heard' && e.body === far),
    };
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
        const tr = lead.trace(this.trade);
        const far = tr.filter((e) => e.kind === 'told' && distanceAU(lead.orbit, e.body, e.to) > 0.1);
        if (far.some((e) => e.kind === 'told' && lead.now >= e.t + (e.landsAt - e.t) / 2)) return true;
        const placed = tr[0];
        return c.noNewsAfter !== undefined && far.length === 0 && !!placed && lead.now - placed.t >= c.noNewsAfter;
      }
      case 'desk-mode': {
        const w = a.worlds[c.strategy];
        return w.desks[c.body].mode(w.now) === c.mode;
      }
      case 'breached': {
        const w = a.worlds[c.strategy];
        return Math.abs(w.totalPosition()) > w.cfg.limit;
      }
      case 'trade-heard': {
        if (this.trade === null) return false;
        const body = c.body === 'far' ? this.context().trade?.far : c.body;
        return lead.trace(this.trade).some((e) => e.kind === 'heard' && e.body === body);
      }
      case 'elapsed':
        return a.now - this.beatStartSim >= c.minutes;
    }
  }
}
