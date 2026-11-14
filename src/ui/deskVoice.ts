// What a desk says about itself, in the first person, from its briefing alone. The first rule that matches wins.
import type { DeskBriefing, DeskEvent } from '../sim/briefing';
import { minutes } from './story';
import { BODY_NAME, signed } from './theme';

/** Whole minutes, or "under a minute". */
const mins = (m: number) => (m < 1 ? 'under a minute' : minutes(m));

/** Age of the newest word from any peer, if it has ever heard from one. */
function newestWord(b: DeskBriefing): number | null {
  const ages = b.peers.map((p) => p.heardMinAgo).filter((a): a is number => a !== null);
  return ages.length ? Math.min(...ages) : null;
}

function latest<K extends DeskEvent['kind']>(b: DeskBriefing, kinds: K[], within: number): Extract<DeskEvent, { kind: K }> | null {
  for (let i = b.recent.length - 1; i >= 0; i--) {
    const e = b.recent[i];
    if (kinds.includes(e.kind as K) && b.now - e.t <= within) return e as Extract<DeskEvent, { kind: K }>;
  }
  return null;
}

function leased(b: DeskBriefing): string {
  const word = newestWord(b);
  if (b.mode === 'reduce-only') {
    return `I have heard nothing from the others for ${mins(word ?? 60)}. I am only taking trades that lower my risk until someone gets through.`;
  }
  const hand = latest(b, ['took-on', 'handed-over'], 15);
  if (hand?.kind === 'took-on') return `I have just taken ${hand.units} off ${BODY_NAME[hand.from]}'s hands. We were holding opposite positions.`;
  if (hand?.kind === 'handed-over') return `I have just handed ${hand.units} to ${BODY_NAME[hand.to]}. We were holding opposite positions.`;
  if (b.mode === 'degraded') {
    // The peer silent longest is the one it has lost; it can still reach the other.
    const [lost, other] = [...b.peers].sort((x, y) => (y.heardMinAgo ?? Infinity) - (x.heardMinAgo ?? Infinity));
    return `I have lost touch with ${BODY_NAME[lost.body]}. I can still reach ${BODY_NAME[other.body]}, so I am carrying on inside my own allowance.`;
  }
  if (b.minutesUntilPlayingSafe !== null && b.minutesUntilPlayingSafe < 30) {
    return `No word from the others for ${mins(word ?? 0)}. If it reaches an hour I will start playing safe.`;
  }
  const a = b.allowance ?? 0;
  const refused = latest(b, ['refused'], 10);
  if (refused?.kind === 'refused' && refused.reason === 'allowance') {
    return `I am turning customers away. My allowance of ${a} is used up, and I will not go past it.`;
  }
  if (b.allowanceSpare !== null && b.allowanceSpare <= a / 5) {
    return `I am close to my allowance: I hold ${signed(b.holds)} of ${a}. I have asked the others for more room.`;
  }
  if (b.remoteNewsAgeMin > 30) {
    const from = b.body === 'mars' ? 'earth' : 'mars';
    return `My latest price from ${BODY_NAME[from]} is ${mins(b.remoteNewsAgeMin)} old, so I am quoting wider to be safe.`;
  }
  return `All quiet. I hold ${signed(b.holds)} and have ${Math.max(0, Math.floor(b.allowanceSpare ?? 0))} of my allowance spare.`;
}

function naive(b: DeskBriefing): string {
  const t = signed(b.thinksBankHolds?.low ?? b.holds);
  const stale = [...b.peers].filter((p) => p.heardMinAgo !== null && p.heardMinAgo > 30).sort((x, y) => y.heardMinAgo! - x.heardMinAgo!)[0];
  if (stale) {
    return `As far as I know the bank holds ${t}. That includes what ${BODY_NAME[stale.body]} told me ${mins(stale.heardMinAgo!)} ago, and nothing since.`;
  }
  return `By my count the bank holds ${t}, so there is room to trade.`;
}

function central(b: DeskBriefing): string {
  if (b.body === 'earth') {
    const r = b.thinksBankHolds ?? { low: 0, high: 0 };
    const holds = r.low === r.high ? `we hold ${signed(r.low)}` : `we hold between ${signed(r.low)} and ${signed(r.high)}`;
    return `I sign off every trade for the whole bank. By my count ${holds}.`;
  }
  const n = b.waitingOnEarth ?? 0;
  if (n > 0) {
    return `I cannot trade without Earth's say-so. ${n} ${n === 1 ? 'customer is' : 'customers are'} waiting on an answer.`;
  }
  return "I cannot trade without Earth's say-so. Nobody is waiting just now.";
}

/** One or two first-person sentences about where this desk stands, from what it knows. */
export function deskSays(b: DeskBriefing): string {
  if (b.strategy === 'leased') return leased(b);
  if (b.strategy === 'naive') return naive(b);
  return central(b);
}

