import type { BodyId, Mode, StrategyId } from '../sim/types';

/** Warm white as an "r,g,b" triple, for building rgba() strings on the canvas. */
export const WARM = '243,239,230';

/** The only saturated colours in the product. Each one means a desk state, nothing else. */
export const STATE: Record<Mode, string> = {
  normal: '#45c48c',
  degraded: '#dba24a',
  'reduce-only': '#e8695d',
  halted: '#e8695d',
};
export const ALERT_RGB = '232,105,93';

export const MODE_LABEL: Record<Mode, string> = {
  normal: 'Normal',
  degraded: 'Degraded',
  'reduce-only': 'Reduce only',
  halted: 'Halted',
};

export const BODY_LABEL: Record<BodyId, string> = { earth: 'Earth', moon: 'Moon', mars: 'Mars' };
/** The body as a word in a sentence: "the Moon", not "Moon". */
export const BODY_NAME: Record<BodyId, string> = { earth: 'Earth', moon: 'the Moon', mars: 'Mars' };

/** What a visitor calls each bank. The identifiers in code (leased, naive, central) never reach the screen. */
export const STRATEGY: Record<StrategyId, { name: string; short: string; blurb: string }> = {
  leased: { name: 'Our bank', short: 'Ours', blurb: 'Every desk has its own allowance.' },
  naive: { name: 'The bank that trusts old news', short: 'Trusts old news', blurb: 'Desks go by old totals.' },
  central: { name: 'The bank that asks Earth', short: 'Asks Earth', blurb: 'Earth approves every trade.' },
};

/** The short names, for read-outs and cards. */
export const SHORT_NAME: Record<StrategyId, string> = { leased: 'Our bank', naive: 'Trusts old news', central: 'Asks Earth' };

export const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", Inter, "Helvetica Neue", Arial, sans-serif';

/** Simulated minutes as hours and minutes, "02:14". */
export const clock = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.floor(min % 60)).padStart(2, '0')}`;

/** Money in dollars to the cent, with a real minus sign: "$0.36", "−$4.35". */
export function dollars(n: number): string {
  const s = Math.abs(n).toFixed(2);
  return (n < 0 && Number(s) !== 0 ? '−' : '') + '$' + s;
}

/** Signed number with a real minus sign. */
export function signed(n: number, digits = 0): string {
  const s = Math.abs(n).toFixed(digits);
  if (Number(s) === 0) return s;
  return (n > 0 ? '+' : '−') + s;
}
