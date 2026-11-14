// The activity feed: what has happened, in one plain sentence each, built only from records the simulation already
// keeps (storm and panic spans, changes of state, visitor trades, hand-overs, and each bank's history).
import { BODIES, STRATEGIES } from '../sim/types';
import type { BodyId, StrategyId } from '../sim/types';
import type { Arena } from '../sim/world';
import { STRATEGY } from './theme';

export interface ActivityLine {
  t: number;
  text: string;
  tone: 'plain' | 'alert';
}

/** A body at the start of a sentence, and inside one. */
const START: Record<BodyId, string> = { earth: 'Earth', moon: 'The Moon', mars: 'Mars' };
const INSIDE: Record<BodyId, string> = { earth: 'Earth', moon: 'the Moon', mars: 'Mars' };

/** Hand-overs smaller than this are bookkeeping, not news. */
const HANDOVER_MIN = 10;
/** Allowance shared in one go: from this many units it is worth a line. */
export const SHARE_MIN = 5;

/**
 * A line about desks sharing allowance. The desks share from the first minute on their own, so these alone do not
 * mean anything has happened yet: the hint stays until something else does.
 */
export const isSharingLine = (text: string) => / shares \d+ of its allowance with /.test(text);

/**
 * Everything worth saying so far, oldest first. Desk events are for the bank on the canvas (`view`); going over the
 * limit and coming back inside are for all three banks.
 */
export function activity(arena: Arena, view: StrategyId): ActivityLine[] {
  const w = arena.worlds[view];
  const out: (ActivityLine & { order: number })[] = [];
  const add = (t: number, text: string, tone: ActivityLine['tone'], order: number) => out.push({ t, text, tone, order });

  for (const s of w.spans) {
    if (s.kind === 'storm') {
      add(s.from, 'Solar storm. Every link between the planets is down.', 'alert', 0);
      if (s.to !== null) add(s.to, 'The storm passes. Links are back.', 'plain', 0);
    } else {
      add(s.from, 'Market panic. Customers everywhere are selling.', 'alert', 1);
      if (s.to !== null) add(s.to, 'The panic ends.', 'plain', 1);
    }
  }

  for (const b of BODIES) {
    for (const e of w.feedLog(b)) {
      if (e.kind === 'mode') {
        if (e.to === 'reduce-only' && e.from !== 'reduce-only') add(e.t, `${START[b]} starts playing safe.`, 'plain', 3);
        else if (e.from === 'reduce-only' && e.to !== 'reduce-only') add(e.t, `${START[b]} is back in touch.`, 'plain', 3);
      } else if (e.kind === 'handed-over' && e.units >= HANDOVER_MIN) {
        add(e.t, `${START[b]} hands ${e.units} to ${INSIDE[e.to]}.`, 'plain', 4);
      } else if (e.kind === 'allowance-given' && e.units >= SHARE_MIN) {
        add(e.t, `${START[b]} shares ${e.units} of its allowance with ${INSIDE[e.to]}.`, 'plain', 4);
      }
    }
  }

  for (const id of arena.recentTrades()) {
    const placed = w.trace(id)[0];
    if (placed?.kind !== 'placed') continue;
    add(
      placed.t,
      placed.side === 'sell'
        ? `You offered to sell ${placed.size} to ${INSIDE[placed.body]}.`
        : `You asked to buy ${placed.size} from ${INSIDE[placed.body]}.`,
      'plain',
      2,
    );
  }

  for (const s of STRATEGIES) {
    const bank = arena.worlds[s];
    const limit = bank.cfg.limit;
    let over = false;
    for (const h of bank.history) {
      const now = Math.abs(h.total) > limit + 1e-9;
      if (now !== over) add(h.t, now ? `${STRATEGY[s].name} goes over its limit.` : `${STRATEGY[s].name} is back inside its limit.`, now ? 'alert' : 'plain', 5);
      over = now;
    }
  }

  return out.sort((x, y) => x.t - y.t || x.order - y.order).map(({ t, text, tone }) => ({ t, text, tone }));
}
