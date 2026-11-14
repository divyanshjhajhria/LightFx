// One sentence on where a bank stands against its limit, for the column under the chart. The first rule that
// applies wins.
import { BODIES } from '../sim/types';
import type { BodyId } from '../sim/types';
import type { World } from '../sim/world';

export interface Verdict {
  text: string;
  tone: 'ok' | 'alert';
}

const OFFICE: Record<BodyId, string> = { earth: 'Earth', moon: 'Moon', mars: 'Mars' };
const NAME: Record<BodyId, string> = { earth: 'Earth', moon: 'The Moon', mars: 'Mars' };

export function verdict(w: World): Verdict {
  const L = w.cfg.limit;
  const over = Math.abs(w.totalPosition()) > L;
  const minutes = w.metrics.breachTicks * w.cfg.dt;
  if (over && minutes < 1) return { text: 'Over its limit now.', tone: 'alert' };
  if (over) return { text: `Over its limit now. ${Math.round(minutes)} min so far.`, tone: 'alert' };
  if (minutes > 0) return { text: `Back inside its limit, after ${Math.max(1, Math.round(minutes))} min over.`, tone: 'alert' };

  if (w.strategy === 'central') {
    const halted = BODIES.filter((b) => b !== 'earth' && w.desks[b].mode(w.now) === 'halted');
    if (halted.length === 1) return { text: `Inside its limit. ${OFFICE[halted[0]]} office cannot trade.`, tone: 'alert' };
    if (halted.length > 1) return { text: 'Inside its limit. Two offices cannot trade.', tone: 'alert' };
  }
  if (w.strategy === 'leased') {
    const safe = BODIES.filter((b) => w.desks[b].mode(w.now) === 'reduce-only');
    if (safe.length === 1) return { text: `Inside its limit. ${NAME[safe[0]]} is playing safe.`, tone: 'ok' };
    if (safe.length === 2) return { text: 'Inside its limit. Two desks are playing safe.', tone: 'ok' };
    if (safe.length === 3) return { text: 'Inside its limit. Every desk is playing safe.', tone: 'ok' };
  }
  return { text: 'Inside its limit.', tone: 'ok' };
}

/**
 * The one or two words for a bank's status chip, with its tone. Kept beside verdict() rather than added to it, so the
 * verdict's existing shape (and its tests) stay as they are.
 */
export function verdictWord(w: World): { word: string; tone: 'ok' | 'alert' } {
  const over = Math.abs(w.totalPosition()) > w.cfg.limit;
  if (over) return { word: 'Over its limit', tone: 'alert' };
  if (w.metrics.breachTicks > 0) return { word: 'Was over its limit', tone: 'alert' };
  if (w.strategy === 'central' && BODIES.some((b) => b !== 'earth' && w.desks[b].mode(w.now) === 'halted')) {
    return { word: 'Offices frozen', tone: 'alert' };
  }
  return { word: 'Safe', tone: 'ok' };
}
