import { describe, expect, it } from 'vitest';
import type { TraceDetail, TraceEvent } from '../src/sim/trace';
import { centralOutcome } from '../src/ui/Presenter';

let t = 100;
const ev = (body: TraceEvent['body'], d: TraceDetail): TraceEvent => ({ t: t++, body, ...d });
const placed = ev('mars', { kind: 'placed', side: 'sell', size: 5 });
const asked = ev('mars', { kind: 'asked-earth', landsAt: 120 });
const approved = ev('earth', { kind: 'earth-approved', landsAt: 140 });

describe('the results card: how the order ended at the bank that asks Earth', () => {
  const cases: [string, TraceEvent[], string][] = [
    ['filled after a wait', [placed, asked, approved, ev('mars', { kind: 'filled', units: 5, of: 5, price: 1, allowanceLeft: null, waited: 40.6 })], 'filled after 41 minutes'],
    ['filled at once at Earth', [ev('earth', { kind: 'placed', side: 'buy', size: 10 }), ev('earth', { kind: 'filled', units: 10, of: 10, price: 1, allowanceLeft: null, waited: 0 })], 'filled straight away'],
    ['part-filled at Earth', [ev('earth', { kind: 'placed', side: 'buy', size: 10 }), ev('earth', { kind: 'filled', units: 4, of: 10, price: 1, allowanceLeft: null, waited: 0 })], '4 of 10 filled straight away'],
    ['refused at Earth', [ev('earth', { kind: 'placed', side: 'buy', size: 10 }), ev('earth', { kind: 'refused', reason: 'limit' })], 'refused, the bank was at its limit'],
    ['request destroyed, then walked away', [placed, asked, ev('mars', { kind: 'destroyed', to: 'earth' }), ev('mars', { kind: 'gave-up', waited: 60 })], 'never reached head office, and you walked away after 60 minutes'],
    ['request never sent', [placed, asked, ev('mars', { kind: 'not-delivered', to: 'earth' })], 'never reached head office, still waiting'],
    ['declined by Earth', [placed, asked, ev('earth', { kind: 'earth-declined' })], 'declined by head office, and Mars never heard, still waiting'],
    ['answer destroyed on the way back', [placed, asked, approved, ev('earth', { kind: 'destroyed', to: 'mars' }), ev('mars', { kind: 'gave-up', waited: 60 })], "approved, but head office's answer was lost on the way back, and you walked away after 60 minutes"],
    ['answer came too late', [placed, asked, approved, ev('mars', { kind: 'too-late', waited: 70 })], 'approved by head office, but the answer came after 70 minutes, after you had left'],
    ['gave up, then the answer came', [placed, asked, ev('mars', { kind: 'gave-up', waited: 6 }), approved, ev('mars', { kind: 'too-late', waited: 41 })], 'approved by head office; you walked away after 6 minutes, and the answer came after you had gone'],
    ['still on its way', [placed, asked], 'on its way to head office, still waiting'],
  ];
  for (const [name, tr, want] of cases) {
    it(name, () => expect(centralOutcome(tr, 'mars')).toBe(want));
  }
});
