// "Where the missed customers went": each bank's customers as one 100% bar, from the survival map's figures.
import type { StrategyId } from '../sim/types';
import type { BankFigures } from './sweepSummary';

export type PartKey = 'served' | 'price' | 'room' | 'safe' | 'noAnswer';

export const PART_LABEL: Record<PartKey, string> = {
  served: 'Served',
  price: 'Price',
  room: 'No room',
  safe: 'Playing safe',
  noAnswer: 'No answer',
};

/** What can happen to a customer at each bank: only our bank plays safe, only the bank that asks Earth waits for it. */
const APPLIES: Record<StrategyId, PartKey[]> = {
  leased: ['served', 'price', 'room', 'safe'],
  naive: ['served', 'price', 'room'],
  central: ['served', 'price', 'room', 'noAnswer'],
};

/** The parts of one bank's bar, in order, as percentages of customers arrived. Null if the figures have no breakdown. */
export function missedParts(bank: StrategyId, f: BankFigures): { key: PartKey; label: string; pct: number }[] | null {
  if (!f.missed) return null;
  const value: Record<PartKey, number> = { served: f.servedPct, ...f.missed };
  return APPLIES[bank].map((key) => ({ key, label: PART_LABEL[key], pct: value[key] }));
}
