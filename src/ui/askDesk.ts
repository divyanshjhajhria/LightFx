// "Ask this desk": three ready questions with answers built from the desk's briefing, used whenever no model is
// configured or the model's answer fails the checks.
import type { DeskBriefing, DeskEvent } from '../sim/briefing';
import type { BodyId } from '../sim/types';
import { minutes } from './story';
import { BODY_NAME, signed } from './theme';

export const READY_QUESTIONS = [
  'Why did you refuse my trade?',
  'What do you know about the others right now?',
  'What happens if you hear nothing for an hour?',
] as const;

export const NO_MODEL_ANSWER = 'I can only answer the three questions above until my language model is connected.';

const Name = (b: BodyId) => (b === 'moon' ? 'The Moon' : BODY_NAME[b]);
const ago = (m: number) => (m < 1 ? 'under a minute ago' : `${minutes(m)} ago`);

function whyRefused(b: DeskBriefing): string {
  const r = [...b.recent].reverse().find((e): e is Extract<DeskEvent, { kind: 'refused' }> => e.kind === 'refused');
  if (b.strategy === 'central' && b.body !== 'earth') {
    return "I never refuse a trade myself. I ask Earth, and if Earth says no, I simply never hear back.";
  }
  if (!r) return 'No trade has been refused here recently.';
  if (r.reason === 'playing-safe') {
    return 'I said no because I had heard nothing from the others for an hour, so I was only taking trades that lower my risk.';
  }
  if (r.reason === 'allowance') {
    return `I said no because my allowance of ${b.allowance ?? 0} was used up. Taking more would have gone past what I am allowed to hold.`;
  }
  return b.strategy === 'central'
    ? "I said no because the bank was at its limit by my count."
    : "I said no because, by my count, the bank was at its limit.";
}

function aboutOthers(b: DeskBriefing): string {
  if (b.strategy === 'central') {
    if (b.body !== 'earth') return 'I do not keep track of the others. Earth keeps the books for the whole bank.';
    const r = b.thinksBankHolds ?? { low: 0, high: 0 };
    const range = r.low === r.high ? signed(r.low) : `between ${signed(r.low)} and ${signed(r.high)}`;
    return `I do not know what Mars and the Moon hold, only what the whole bank holds by my count: ${range}.`;
  }
  return b.peers
    .map((p) =>
      p.heardMinAgo === null || p.lastKnownHolds === null
        ? `I have never heard from ${BODY_NAME[p.body]}.`
        : `${Name(p.body)} last told me it held ${signed(p.lastKnownHolds)}, ${ago(p.heardMinAgo)}.`,
    )
    .join(' ');
}

function hourOfSilence(b: DeskBriefing): string {
  if (b.strategy === 'leased') {
    const when = b.mode === 'reduce-only'
      ? ' That is what I am doing now.'
      : b.minutesUntilPlayingSafe !== null
        ? ` If I hear nothing more, that starts in ${b.minutesUntilPlayingSafe < 1 ? 'under a minute' : minutes(b.minutesUntilPlayingSafe)}.`
        : '';
    return `I start playing safe: I only take trades that lower my risk until someone gets through.${when}`;
  }
  if (b.strategy === 'naive') return 'Nothing changes for me. I keep trading on the last figures I heard, however old they are.';
  return b.body === 'earth'
    ? 'I keep signing off trades here, but nothing from Mars or the Moon reaches me, so their customers wait.'
    : 'I cannot trade at all without Earth, so after an hour of silence my customers have simply gone.';
}

/** The templated answer to one of the ready questions. */
export function readyAnswer(question: (typeof READY_QUESTIONS)[number], b: DeskBriefing): string {
  if (question === READY_QUESTIONS[0]) return whyRefused(b);
  if (question === READY_QUESTIONS[1]) return aboutOthers(b);
  return hourOfSilence(b);
}
