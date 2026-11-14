// Upgrades a desk's templated sentence to model-written wording, when a model is configured and its answer passes the
// checker. The template is always shown first and stays whenever anything goes wrong.
import type { DeskBriefing } from '../sim/briefing';
import type { BodyId } from '../sim/types';
import type { LlmClient } from '../agents/llm';
import { acceptable } from './voiceCheck';

/** At most one model call per desk in this many real milliseconds. */
export const MODEL_EVERY_MS = 20_000;

const ROLE: Record<DeskBriefing['strategy'], string> = {
  leased:
    'You are one currency desk of a bank with offices on Earth, the Moon and Mars. You own a fixed allowance of the ' +
    "bank's limit and never go past it, so you can trade on your own even when the links to the others are down. If " +
    'you hear nothing from the others for an hour you play safe and only take trades that lower your risk.',
  naive:
    'You are one currency desk of a bank with offices on Earth, the Moon and Mars. You trade against your own count of ' +
    "what the bank holds, built from the last figures the other desks sent you, however old they are.",
  central:
    'You are one currency desk of a bank with offices on Earth, the Moon and Mars. Earth is head office and signs off ' +
    'every trade; the other desks cannot trade without its answer.',
};

/** The instructions every desk gets. The briefing goes in the user message as JSON. */
export function systemPrompt(b: DeskBriefing): string {
  return [
    ROLE[b.strategy],
    `You are the ${b.body === 'moon' ? 'Moon' : b.body === 'earth' ? 'Earth' : 'Mars'} desk.`,
    'Speak in one or two short sentences, in the first person, in plain words for someone who has never traded.',
    'Say what you are doing and why.',
    'Use only facts in the data. Do not make up numbers.',
    'You do not know what the other desks hold now, only what they last told you.',
    'Say "allowance", "the bank\'s limit", "holds" and "playing safe". Never say gossip, lease, epoch, RFQ, bp, invest,',
    'should buy, should sell or guarantee.',
  ].join(' ');
}

/** The briefing without the clock, so an unchanged situation hits the cache. */
export const situationKey = (b: DeskBriefing) => JSON.stringify({ ...b, now: undefined });

interface Answer {
  /** The template this answer replaced: a newer situation makes it stale. */
  template: string;
  text: string;
}

/**
 * Keeps one model-written line per desk. Call `want` whenever a desk's words are shown; it calls the model only when
 * the templated sentence has changed (the situation changed), at most once per 20 seconds per desk, and aborts a call
 * still pending when a newer one starts.
 */
export class ModelVoice {
  private readonly lastTemplate = new Map<BodyId, string>();
  private readonly lastCall = new Map<BodyId, number>();
  private readonly pending = new Map<BodyId, AbortController>();
  private readonly answers = new Map<BodyId, Answer>();
  private readonly cache = new Map<string, string>();
  calls = 0;
  rejected = 0;

  constructor(
    private readonly client: LlmClient | null,
    private readonly clock: () => number = () => performance.now(),
    private readonly onChange: () => void = () => {},
  ) {}

  /** The line to show for a desk: the model's if one passed the checks for this situation, else the template. */
  line(body: BodyId, template: string): { text: string; ai: boolean } {
    const a = this.answers.get(body);
    return a && a.template === template ? { text: a.text, ai: true } : { text: template, ai: false };
  }

  want(body: BodyId, b: DeskBriefing, template: string): void {
    if (!this.client || this.lastTemplate.get(body) === template) return;
    this.lastTemplate.set(body, template);
    const key = situationKey(b);
    const cached = this.cache.get(key);
    if (cached) {
      this.answers.set(body, { template, text: cached });
      this.onChange();
      return;
    }
    const now = this.clock();
    if (now - (this.lastCall.get(body) ?? -Infinity) < MODEL_EVERY_MS) return;
    this.lastCall.set(body, now);
    this.pending.get(body)?.abort();
    const ctl = new AbortController();
    this.pending.set(body, ctl);
    this.calls++;
    this.client
      .complete(systemPrompt(b), JSON.stringify(b), ctl.signal)
      .then((text) => {
        if (ctl.signal.aborted) return;
        if (!acceptable(text, b)) {
          this.rejected++;
          return;
        }
        this.cache.set(key, text);
        this.answers.set(body, { template, text });
        this.onChange();
      })
      .catch(() => undefined)
      .finally(() => {
        if (this.pending.get(body) === ctl) this.pending.delete(body);
      });
  }
}
