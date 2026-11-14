// The evidence card's figure for working together, from public/together.json.
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
