// The evidence card's figure for working together, from public/together.json.
import { pairsFor, rushMeans } from '../sim/together';
import type { TogetherFile } from '../sim/together';

const MARKET_WORDS = { calm: 'calm market', panic: 'panic', imbalance: 'one-way customers' } as const;

/** One decimal: the gain is small, and a whole number would round 1.6 up to 2. */
const pct = (x: number) => `${x.toFixed(1)}%`;

export function togetherFigure(f: TogetherFile): { figure: string; label: string; detail: string } {
  const per = (Object.keys(MARKET_WORDS) as (keyof typeof MARKET_WORDS)[]).map(
    (m) => `${pct(f.byMarket[m].gainRelativePct)} with ${MARKET_WORDS[m]}`,
  );
  return {
    figure: pct(f.overall.gainRelativePct),
    label: 'more customers served by working together than alone',
    detail:
      `Our bank run both ways on the same ${f.overall.runs} runs, with and without storms: ${per.join(', ')}. ` +
      `Working together served more in ${f.overall.togetherServedMore} of the ${f.overall.runs}.`,
  };
}

/** To one decimal, never rounded up (5.93 is 5.9; 5.99 is 5.9). */
export const down1 = (x: number) => (Math.floor(x * 10 + 1e-9) / 10).toFixed(1);

/** The held-out seeds the rush figure is judged on. */
const HELD_OUT = Array.from({ length: 20 }, (_, i) => i + 11);

/**
 * The evidence card's figure for working together: how many more of a swamped desk's customers our bank serves when
 * the other desks lend it room, with links up, on the held-out seeds. Null (no figure on the card) when the file has
 * no rush results, or when the gain is under 5 points.
 */
export function rushFigure(f: TogetherFile): { figure: string; label: string; detail: string } | null {
  const rush = f.rush?.squares;
  if (!rush) return null;
  const up = rushMeans(pairsFor(rush.filter((q) => q.stormMinutes === 0), HELD_OUT));
  const down = rushMeans(pairsFor(rush.filter((q) => q.stormMinutes > 0), HELD_OUT));
  const g = up.rushTogether - up.rushAlone;
  if (g < 5) return null;
  // Every market we measured, every storm length, seeds 1 to 30: the even-demand squares and the rush squares together.
  const rushAll = rushMeans(pairsFor(rush, f.seeds));
  const n = f.overall.runs + rushAll.runs;
  const together = (f.overall.together.servedPct * f.overall.runs + rushAll.servedTogether * rushAll.runs) / n;
  const alone = (f.overall.alone.servedPct * f.overall.runs + rushAll.servedAlone * rushAll.runs) / n;
  return {
    figure: down1(g),
    label: 'points more customers served at a swamped desk when the others lend it room',
    detail:
      `A rush at Mars or Earth (3 times the customers, 80% selling, for 3 hours) with the links up: ${up.runs} runs, ` +
      `seeds 11 to 30, our bank against the same desks each on its own. With the links down during the rush there is ` +
      `little to lend: ${down1(down.rushTogether - down.rushAlone)} points (${down.runs} runs). Over every market and ` +
      `storm we tried, working together served ${down1(together - alone)} points more of all customers (${n} runs).`,
  };
}
