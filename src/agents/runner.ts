// Runs our bank's three desks as agents: decides when each one thinks, asks the model (or the scripted stand-in, or a
// recorded session), checks the answer, and hands it to the desk's guard as a Directive. Nothing here touches the DOM,
// and nothing under src/sim imports this.
import { deskBriefing } from '../sim/briefing';
import type { DeskBriefing } from '../sim/briefing';
import { sanitise } from '../sim/directive';
import type { Directive } from '../sim/directive';
import { BODIES, perBody } from '../sim/types';
import type { BodyId, Mode, PerBody } from '../sim/types';
import type { Arena } from '../sim/world';
import { acceptable } from '../ui/voiceCheck';
import type { LlmClient } from './llm';
import { agentSystemPrompt, directiveSchema } from './prompt';
import { standIn } from './standIn';

export type AgentMode = 'off' | 'live' | 'replay' | 'stand-in';
export type AgentState = 'idle' | 'thinking' | 'decided' | 'silent' | 'rejected';

/** Real seconds between two calls for one desk, at least. */
export const MIN_REAL_SECONDS = 4;
/** Real seconds before a call is given up. */
export const CALL_TIMEOUT_SECONDS = 6;
/** Simulated minutes between decisions when nothing has happened. */
export const THINK_EVERY_MIN = 15;

export interface Checks {
  /** The answer parsed as JSON and survived sanitise(). */
  parsed: boolean;
  thought: 'ok' | 'blanked' | 'none';
  /** Notes that failed the checker and were dropped. */
  notesDropped: BodyId[];
  /** Units the guard actually handed to each peer. */
  given: Partial<PerBody<number>>;
  error?: string;
}

export interface SessionEntry {
  body: BodyId;
  /** When the directive was applied, in simulated minutes. */
  simTime: number;
  /** Real seconds since the runner started. */
  realSeconds: number;
  /** What the desk knew when it was asked. */
  briefing: DeskBriefing;
  /** The answer exactly as it came back. */
  raw: string;
  directive: Directive | null;
  checks: Checks;
}

/** A recorded session, as saved by "Save this session" and read back for replay. */
export interface SessionFile {
  version: 1;
  /** What made the decisions: a real model, or the scripted stand-in. Replay labels itself honestly from this. */
  recordedWith: 'live' | 'stand-in';
  model?: string;
  seed: number;
  separationDeg: number;
  /** The scenario played, if any, or the controls used in free play, as scenario events. */
  scenarioId: string | null;
  controls: { at: number; kind: string; [k: string]: unknown }[];
  entries: SessionEntry[];
}

interface Desk {
  out: { ctl: AbortController; startedReal: number; briefing: DeskBriefing } | null;
  lastCallReal: number;
  lastAttemptSim: number;
  firstAttemptSim: number | null;
  lastGoodSim: number | null;
  pending: boolean;
  lastMode: Mode | null;
  lastInboxAt: number;
  wasLow: boolean;
  lastVisitorT: number;
  outcome: 'idle' | 'decided' | 'rejected';
  shown: AgentState;
  shownSinceReal: number;
  calls: number;
  rejected: number;
  /** The latest thought that passed the checker, and whether a model (live or recorded) wrote it. */
  thought: string;
}

export interface RunnerOptions {
  mode: AgentMode;
  client?: LlmClient | null;
  session?: SessionEntry[];
  /** Real time in seconds. */
  clock: () => number;
  /** Called when anything shown may have changed (a decision, a rejection). */
  onChange?: () => void;
}

/** Strip a code fence. Anything other than one JSON object (prose around it, two objects) is refused. */
export function extractJson(raw: string): unknown {
  let t = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i.exec(t);
  if (fence) t = fence[1].trim();
  if (!t.startsWith('{') || !t.endsWith('}')) throw new Error('not a single JSON object');
  return JSON.parse(t);
}

export class AgentRunner {
  readonly mode: AgentMode;
  private readonly client: LlmClient | null;
  private readonly clock: () => number;
  private readonly onChange: () => void;
  private readonly startReal: number;
  private readonly desks: PerBody<Desk>;
  private readonly entries: SessionEntry[] = [];
  private readonly replay: SessionEntry[];
  private replayNext = 0;
  private stopped = false;

  constructor(
    readonly arena: Arena,
    opts: RunnerOptions,
  ) {
    this.mode = opts.mode;
    this.client = opts.client ?? null;
    this.clock = opts.clock;
    this.onChange = opts.onChange ?? (() => {});
    this.startReal = this.clock();
    this.replay = [...(opts.session ?? [])].map((e, i) => ({ e, i })).sort((x, y) => x.e.simTime - y.e.simTime || x.i - y.i).map((x) => x.e);
    if (this.mode === 'live' && !this.client) throw new Error('live mode needs a client');
    for (const b of BODIES) arena.setController(b, this.mode === 'off' ? 'rules' : 'agent');
    this.desks = perBody(() => ({
      out: null,
      lastCallReal: -Infinity,
      lastAttemptSim: -Infinity,
      firstAttemptSim: null,
      lastGoodSim: null,
      pending: false,
      lastMode: null,
      lastInboxAt: -Infinity,
      wasLow: false,
      lastVisitorT: -Infinity,
      outcome: 'idle',
      shown: 'idle',
      shownSinceReal: this.startReal,
      calls: 0,
      rejected: 0,
      thought: '',
    }));
  }

  /** Hand the desks back to their rules and abandon any call still out. */
  stop(): void {
    this.stopped = true;
    for (const b of BODIES) {
      this.desks[b].out?.ctl.abort();
      this.desks[b].out = null;
      this.arena.setController(b, 'rules');
    }
  }

  /** Call once per animation frame (or once per step, headless). */
  tick(): void {
    if (this.stopped || this.mode === 'off') return;
    if (this.mode === 'replay') {
      this.applyReplay();
      return;
    }
    const real = this.clock();
    const sim = this.arena.now;
    for (const body of BODIES) {
      const d = this.desks[body];
      const b = deskBriefing(this.arena.worlds.leased, body);

      if (d.out && real - d.out.startedReal > CALL_TIMEOUT_SECONDS) {
        d.out.ctl.abort();
        this.record(body, d.out.briefing, '', null, { parsed: false, thought: 'none', notesDropped: [], given: {}, error: 'timeout' });
        d.out = null;
      }

      // Triggers since the last decision.
      if (d.lastMode !== null && b.mode !== d.lastMode) d.pending = true;
      d.lastMode = b.mode;
      const newest = b.inbox?.[0];
      const inboxAt = newest ? sim - newest.receivedMinAgo : -Infinity;
      if (inboxAt > d.lastInboxAt) {
        if (d.lastInboxAt > -Infinity || newest) d.pending = true;
        d.lastInboxAt = inboxAt;
      }
      const low = b.allowance !== null && (b.allowanceSpare ?? 0) < b.allowance / 5;
      if (low && !d.wasLow) d.pending = true;
      d.wasLow = low;
      const visitor = [...b.recent].reverse().find((e) => e.kind === 'visitor-trade');
      if (visitor && visitor.t > d.lastVisitorT) {
        d.pending = true;
        d.lastVisitorT = visitor.t;
      }

      const due = d.pending || sim - d.lastAttemptSim >= THINK_EVERY_MIN;
      if (!due || d.out || real - d.lastCallReal < MIN_REAL_SECONDS) continue;
      this.think(body, b, real, sim);
    }
    for (const body of BODIES) this.refreshShown(body);
  }

  private think(body: BodyId, b: DeskBriefing, real: number, sim: number): void {
    const d = this.desks[body];
    d.pending = false;
    d.lastCallReal = real;
    d.lastAttemptSim = sim;
    d.firstAttemptSim ??= sim;
    d.calls++;
    if (this.mode === 'stand-in') {
      // The stand-in answers at once, through exactly the same parsing and checks as a model.
      this.handle(body, b, JSON.stringify(standIn(b)));
      return;
    }
    const ctl = new AbortController();
    const out = { ctl, startedReal: real, briefing: b };
    d.out = out;
    this.refreshShown(body);
    const system = agentSystemPrompt(body, b.limit);
    const user = JSON.stringify(b);
    const client = this.client!;
    const call = client.completeJson
      ? client.completeJson(system, user, directiveSchema(body), ctl.signal)
      : client.complete(system, user, ctl.signal);
    call.then(
      (raw) => {
        if (d.out !== out || this.stopped) return;
        d.out = null;
        this.handle(body, b, raw);
      },
      (err: unknown) => {
        if (d.out !== out || this.stopped) return;
        d.out = null;
        this.record(body, b, '', null, { parsed: false, thought: 'none', notesDropped: [], given: {}, error: String((err as Error)?.message ?? err) });
        this.refreshShown(body);
        this.onChange();
      },
    );
  }

  /** Parse, sanitise, check and apply one answer. */
  private handle(body: BodyId, b: DeskBriefing, raw: string): void {
    const d = this.desks[body];
    let dir: Directive | null = null;
    let error: string | undefined;
    try {
      dir = sanitise(extractJson(raw), body);
      if (!dir) error = 'not a valid directive';
    } catch (e) {
      error = (e as Error).message;
    }
    if (!dir) {
      d.rejected++;
      d.outcome = 'rejected';
      this.record(body, b, raw, null, { parsed: false, thought: 'none', notesDropped: [], given: {}, error });
      this.refreshShown(body);
      this.onChange();
      return;
    }
    dir = { ...dir, source: this.mode === 'stand-in' ? 'stand-in' : 'model' };
    const { directive, checks } = this.check(dir, b);
    if (checks.thought === 'blanked' || checks.notesDropped.length) d.rejected++;
    checks.given = this.apply(body, directive);
    d.lastGoodSim = this.arena.now;
    d.outcome = 'decided';
    d.thought = directive.thought;
    this.record(body, b, raw, directive, checks);
    this.refreshShown(body);
    this.onChange();
  }

  /** The Step 5 checker on the thought and on each note: a failure is dropped, the rest of the directive stands. */
  private check(dir: Directive, b: DeskBriefing): { directive: Directive; checks: Checks } {
    const extra = { give: dir.give, ask: dir.ask };
    let thought: Checks['thought'] = 'none';
    let text = dir.thought;
    if (text) {
      thought = acceptable(text, b, { extra, strict: true, maxLength: 220 }) ? 'ok' : 'blanked';
      if (thought === 'blanked') text = '';
    }
    const noteTo: Directive['noteTo'] = {};
    const notesDropped: BodyId[] = [];
    for (const [p, note] of Object.entries(dir.noteTo) as [BodyId, string][]) {
      if (acceptable(note, b, { extra, strict: true, maxLength: 140, firstPerson: false })) noteTo[p] = note;
      else notesDropped.push(p);
    }
    return { directive: { ...dir, thought: text, noteTo }, checks: { parsed: true, thought, notesDropped, given: {} } };
  }

  private apply(body: BodyId, dir: Directive): Partial<PerBody<number>> {
    const given = this.arena.setDirective(body, dir);
    return Object.fromEntries(Object.entries(given).filter(([, n]) => n > 0));
  }

  /** Replay: each recorded directive when the clock reaches its time, through the same sanitise() and guard. */
  private applyReplay(): void {
    let changed = false;
    while (this.replayNext < this.replay.length && this.replay[this.replayNext].simTime <= this.arena.now + 1e-9) {
      const e = this.replay[this.replayNext++];
      const d = this.desks[e.body];
      const dir = e.directive ? sanitise(e.directive, e.body) : null;
      d.calls++;
      if (!dir) continue;
      // A recorded thought is shown only if it is still true of the desk as it stands now.
      const now = deskBriefing(this.arena.worlds.leased, e.body);
      const { directive, checks } = this.check({ ...dir, source: 'replay' }, now);
      checks.given = this.apply(e.body, directive);
      d.lastGoodSim = this.arena.now;
      d.firstAttemptSim ??= this.arena.now;
      d.outcome = 'decided';
      d.thought = directive.thought;
      this.record(e.body, now, e.raw, directive, checks);
      changed = true;
    }
    for (const body of BODIES) this.refreshShown(body);
    if (changed) this.onChange();
  }

  private record(body: BodyId, briefing: DeskBriefing, raw: string, directive: Directive | null, checks: Checks): void {
    this.entries.push({ body, simTime: this.arena.now, realSeconds: this.clock() - this.startReal, briefing, raw, directive, checks });
  }

  private refreshShown(body: BodyId): void {
    const d = this.desks[body];
    const state = this.stateOf(body);
    if (state !== d.shown) {
      d.shown = state;
      d.shownSinceReal = this.clock();
    }
  }

  private stateOf(body: BodyId): AgentState {
    const d = this.desks[body];
    const w = this.arena.worlds.leased;
    // Silent: the agent has been asked but nothing it said is in force any more, for agentStaleMinutes or more.
    const since = d.lastGoodSim ?? d.firstAttemptSim;
    if (since !== null && w.runBy(body) === 'rules (agent silent)' && this.arena.now - since >= w.cfg.agentStaleMinutes) return 'silent';
    if (d.out) return 'thinking';
    return d.outcome;
  }

  status(body: BodyId): { state: AgentState; sinceRealSeconds: number; calls: number; rejected: number } {
    this.refreshShown(body);
    const d = this.desks[body];
    return { state: d.shown, sinceRealSeconds: this.clock() - d.shownSinceReal, calls: d.calls, rejected: d.rejected };
  }

  /** The latest thought that passed the checker, or ''. */
  thought(body: BodyId): string {
    return this.desks[body].thought;
  }

  /** Everything decided (or refused) this session, oldest first. */
  log(): SessionEntry[] {
    return this.entries;
  }
}
