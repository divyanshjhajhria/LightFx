// Every sentence a language model writes for a desk is checked against what that desk knows. Anything that fails is
// thrown away and the template is used instead.
import type { DeskBriefing } from '../sim/briefing';

const BANNED = /\b(bp|gossip|leases?|epochs?|rfq)\b|invest|should buy|should sell|guarantee/i;

/** Number words worth checking. "one" to "three" are ordinary speech ("one of the others") and are ignored. */
const WORDS: Record<string, number> = {
  zero: 0, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40,
  fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/** Every number anywhere in the briefing, as absolute values. */
function briefingNumbers(b: DeskBriefing): number[] {
  const out: number[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) out.push(Math.abs(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(b);
  return out;
}

/** A number in the text matches the briefing if it is a briefing value, or that value rounded as people round. */
function known(n: number, decimals: number, values: number[]): boolean {
  return values.some(
    (v) => v === n || Math.round(v) === n || Math.floor(v) === n || (decimals > 0 && Number(v.toFixed(decimals)) === n),
  );
}

export function sentences(text: string): number {
  return text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length;
}

/** Whether a model-written line may be shown for this desk. */
export function acceptable(text: string, b: DeskBriefing): boolean {
  const t = text.trim();
  if (!t || t.length > 280 || sentences(t) > 3) return false;
  if (BANNED.test(t)) return false;
  if (!/\bI\s|\bMy\s|\bI['’]m\b/.test(t)) return false;
  const values = briefingNumbers(b);
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) {
    const raw = m[0].replace(',', '.');
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0;
    if (!known(Math.abs(Number(raw)), decimals, values)) return false;
  }
  for (const m of t.toLowerCase().matchAll(/\b[a-z]+\b/g)) {
    const n = WORDS[m[0]];
    if (n !== undefined && !known(n, 0, values)) return false;
  }
  return true;
}
