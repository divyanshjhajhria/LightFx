import { describe, expect, it } from 'vitest';
import { perBody } from '../src/sim/types';
import type { Envelope, Payload } from '../src/sim/types';
import { describeEnvelope } from '../src/ui/describe';
import { clock } from '../src/ui/theme';

const env = (payload: Payload, from: Envelope['from'] = 'mars', to: Envelope['to'] = 'earth'): Envelope => ({
  id: 1,
  from,
  to,
  sentAt: 124,
  deliverAt: 135.2,
  payload,
});

const gossip = {
  kind: 'gossip' as const,
  from: 'mars' as const,
  seq: 3,
  sentAt: 124,
  pos: -5,
  free: 30,
  sentRow: perBody(() => 0),
};

const PAYLOADS: Record<string, Payload> = {
  news: { kind: 'news', origin: 'earth', at: 124, value: 0.001 },
  'leased update': {
    ...gossip,
    openOffer: 8,
    handover: 6,
    netting: { offers: perBody(() => ({ epoch: 0, amount: 0 })), replies: perBody(() => ({ epoch: 0, given: 0, price: 0 })) },
  },
  'naive update': { ...gossip, free: 0 },
  request: { kind: 'rfq', from: 'mars', id: 'mars-1', delta: 5 },
  approval: { kind: 'approve', id: 'mars-1' },
  'confirmation, filled': { kind: 'confirm', id: 'mars-1', filled: true },
  'confirmation, missed': { kind: 'confirm', id: 'mars-1', filled: false },
};

describe('describeEnvelope', () => {
  for (const [name, p] of Object.entries(PAYLOADS)) {
    it(`describes a ${name} with a title, at least one line, and the landing time last`, () => {
      const d = describeEnvelope(env(p), 130);
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.lines.length).toBeGreaterThan(0);
      for (const l of d.lines) expect(l).not.toMatch(/undefined|NaN/);
      expect(d.lines[d.lines.length - 1]).toContain(`lands ${clock(135.2)}`);
    });
  }

  it('uses plain words for a leased desk update', () => {
    const d = describeEnvelope(env(PAYLOADS['leased update']), 130);
    expect(d.title).toBe('Mars to Earth: desk update');
    expect(d.lines).toEqual([
      'Mars holds −5',
      'Spare allowance: 30',
      "Offers to take up to 8 off Earth's hands",
      'Hands 6 to Earth',
      'Sent 02:04, lands 02:15, in 5.2 min',
    ]);
  });

  it('asks permission in plain words for the central strategy', () => {
    const d = describeEnvelope(env(PAYLOADS.request), 130);
    expect(d.title).toBe('Mars to Earth: asking permission');
    expect(d.lines[0]).toBe('A customer wants to sell 5. May I?');
  });
});
