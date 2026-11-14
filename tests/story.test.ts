import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '../src/sim/trace';
import { STRATEGIES } from '../src/sim/types';
import { minutes, tell } from '../src/ui/story';

const at = { t: 120, body: 'mars' as const };
const EVENTS: TraceEvent[] = [
  { ...at, kind: 'placed', side: 'sell', size: 5 },
  { ...at, kind: 'filled', units: 5, of: 5, price: 1, allowanceLeft: 30, waited: 0 },
  { ...at, kind: 'filled', units: 3, of: 5, price: 1, allowanceLeft: 0, waited: 0 },
  { ...at, kind: 'filled', units: 5, of: 5, price: 1, allowanceLeft: null, waited: 40.6 },
  { ...at, kind: 'refused', reason: 'allowance' },
  { ...at, kind: 'refused', reason: 'playing-safe' },
  { ...at, kind: 'refused', reason: 'limit' },
  { ...at, kind: 'asked-earth', landsAt: 140.3 },
  { ...at, body: 'earth', kind: 'earth-approved', landsAt: 140.3 },
  { ...at, body: 'earth', kind: 'earth-declined' },
  { ...at, kind: 'too-late', waited: 61 },
  { ...at, kind: 'gave-up', waited: 10.2 },
  { ...at, kind: 'told', to: 'moon', landsAt: 131.2 },
  { ...at, kind: 'not-delivered', to: 'earth' },
  { ...at, kind: 'not-delivered', to: 'moon' },
  { ...at, body: 'moon', kind: 'heard', from: 'mars' },
];

describe('tell', () => {
  for (const s of STRATEGIES) {
    for (const e of EVENTS) {
      it(`${s}: ${e.kind}${'reason' in e ? ` (${e.reason})` : ''} reads as a sentence`, () => {
        const text = tell(e, s, 130, 'mars');
        expect(text.length).toBeGreaterThan(10);
        expect(text).not.toMatch(/undefined|NaN|\{|\}/);
        expect(text).toMatch(/[.:]$/);
        expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
      });
    }
  }

  it('leased: a filled trade, word for word', () => {
    expect(tell(EVENTS[1], 'leased', 130)).toBe(
      'Mars said yes on its own, straight away. It used 5 of its allowance and has 30 left.',
    );
  });

  it('naive: a filled trade, word for word', () => {
    expect(tell(EVENTS[1], 'naive', 130)).toBe('Mars said yes straight away. As far as it knows, the bank has room.');
  });

  it('central: a filled trade after waiting, word for word', () => {
    expect(tell(EVENTS[3], 'central', 130)).toBe('The answer arrived after 41 minutes. Trade done.');
  });

  it('names the Moon properly at the start of a sentence and in the middle', () => {
    expect(tell(EVENTS[15], 'leased', 130)).toBe('The Moon now knows.');
    expect(tell(EVENTS[12], 'leased', 130)).toBe('Mars told the Moon. The message lands in 11 minutes.');
  });

  it('counts whole minutes', () => {
    expect(minutes(1.2)).toBe('1 minute');
    expect(minutes(20.3)).toBe('20 minutes');
  });

  it('reads naturally when the time is under a minute', () => {
    const moon = { t: 120, body: 'moon' as const };
    expect(tell({ ...moon, kind: 'told', to: 'earth', landsAt: 120.02 }, 'leased', 130)).toBe(
      'The Moon told Earth. The message lands in under a minute.',
    );
    expect(tell({ ...moon, body: 'earth', kind: 'earth-approved', landsAt: 120.02 }, 'central', 130)).toBe(
      'Earth said yes. The answer is on its way back and lands in under a minute.',
    );
    expect(tell({ ...moon, kind: 'filled', units: 5, of: 5, price: 1, allowanceLeft: null, waited: 0.04 }, 'central', 130)).toBe(
      'The answer arrived within a minute. Trade done.',
    );
    expect(tell({ ...moon, kind: 'asked-earth', landsAt: 120.02 }, 'central', 130)).toBe(
      'The Moon cannot decide alone. It has asked Earth, under a minute away.',
    );
    for (const s of ['leased', 'naive', 'central'] as const) {
      for (const e of EVENTS) {
        const quick = { ...e, ...('landsAt' in e ? { landsAt: e.t + 0.3 } : {}), ...('waited' in e && e.waited ? { waited: 0.3 } : {}) } as TraceEvent;
        expect(tell(quick, s, 130, 'mars')).not.toMatch(/moments|0 minutes/);
      }
    }
  });

  it('says who sells to whom', () => {
    expect(tell(EVENTS[0], 'leased', 130)).toBe('You offered to sell 5 Mars credits to Mars.');
    expect(tell({ ...EVENTS[0], body: 'moon', side: 'buy', size: 10 } as TraceEvent, 'central', 130)).toBe(
      'You asked to buy 10 Mars credits from the Moon.',
    );
  });

  it('tells leaving apart from giving up', () => {
    expect(tell({ t: 160, body: 'mars', kind: 'gave-up', waited: 60, patience: true }, 'central', 160)).toBe(
      'After an hour with no answer, you left.',
    );
    expect(tell({ t: 160, body: 'mars', kind: 'gave-up', waited: 10 }, 'central', 160)).toBe('You gave up after 10 minutes.');
  });
});
