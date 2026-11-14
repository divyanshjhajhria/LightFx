// The scripted stand-in: a small fixed function from a desk's briefing to a Directive, for building and testing without a
// model. It is NOT a language model and must never be called AI anywhere on screen ("Scripted stand-in").
import type { DeskBriefing } from '../sim/briefing';
import type { Directive } from '../sim/directive';
import { BODIES } from '../sim/types';
import type { BodyId } from '../sim/types';

const NAME: Record<BodyId, string> = { earth: 'Earth', moon: 'the Moon', mars: 'Mars' };
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** Minutes since this desk last decided; everything newer than that is news to it. */
const sinceLast = (b: DeskBriefing) => b.lastDirective?.minAgo ?? Infinity;

export function standIn(b: DeskBriefing): Directive {
  const allowance = Math.floor(b.allowance ?? 0);
  const spare = Math.max(0, Math.floor(b.allowanceSpare ?? 0));
  const since = sinceLast(b);
  const peers = BODIES.filter((p) => p !== b.body);

  // Half of what is spare to each peer that asked since last time, newest ask first.
  const give: Partial<Record<BodyId, number>> = {};
  let left = spare;
  for (const n of b.inbox ?? []) {
    if (!n.asks || n.receivedMinAgo >= since || give[n.from] !== undefined) continue;
    const units = Math.min(n.asks, Math.floor(left / 2));
    if (units < 1) continue;
    give[n.from] = units;
    left -= units;
  }

  // Under a fifth spare: ask the peer that last reported the most spare (and was heard from lately), at most once
  // every 15 minutes.
  const ask: Partial<Record<BodyId, number>> = {};
  const askedLately = (b.lastDirective?.asked ?? false) && since < 15;
  if (spare < allowance / 5 && !askedLately) {
    const best = [...(b.spareByLastWord ?? [])]
      // Only a peer heard from within the hour: one silent longer is probably out of reach.
      .filter((s) => s.spare !== null && s.spare > 0 && s.ageMin !== null && s.ageMin <= 60)
      .sort((x, y) => y.spare! - x.spare!)[0];
    if (best) ask[best.body] = Math.max(1, Math.min(best.spare!, Math.round(allowance / 4)));
  }

  const cautious = b.remoteNewsAgeMin > 30;
  const noteTo: Partial<Record<BodyId, string>> = {};
  for (const p of peers) {
    let note = `I hold ${signed(b.holds)} with ${spare} of my ${allowance} allowance spare.`;
    if (ask[p]) note += ` Could you spare ${ask[p]}?`;
    if (give[p]) note += ` Sending you ${give[p]}.`;
    noteTo[p] = note;
  }

  const said: string[] = [];
  const gaveTo = Object.keys(give) as BodyId[];
  if (gaveTo.length) said.push(`I gave ${gaveTo.map((p) => `${give[p]} to ${NAME[p]}`).join(' and ')}, who asked.`);
  const askedOf = Object.keys(ask) as BodyId[];
  if (askedOf.length) {
    said.push(`Only ${spare} of my ${allowance} allowance is spare, so I asked ${NAME[askedOf[0]]} for ${ask[askedOf[0]]}.`);
  }
  if (said.length < 2) {
    said.push(
      cautious
        ? `My news from elsewhere is ${Math.round(b.remoteNewsAgeMin)} minutes old, so I am pricing cautiously.`
        : `I hold ${signed(b.holds)} and I am pricing steadily.`,
    );
  }

  return {
    pricing: cautious ? 'cautious' : 'steady',
    caution: 'normal',
    give,
    ask,
    noteTo,
    thought: said.join(' '),
    source: 'stand-in',
  };
}
