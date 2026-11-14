import { describe, expect, it } from 'vitest';
import type { DeskBriefing, DeskEvent } from '../src/sim/briefing';
import { deskSays } from '../src/ui/deskVoice';

const base: DeskBriefing = {
  body: 'mars',
  strategy: 'leased',
  now: 200,
  mode: 'normal',
  holds: 12,
  allowance: 35,
  allowanceSpare: 23,
  bid: 0.999,
  ask: 1.001,
  localPrice: 1,
  remoteNewsAgeMin: 20.3,
  peers: [
    { body: 'earth', heardMinAgo: 22, lastKnownHolds: 5 },
    { body: 'moon', heardMinAgo: 21, lastKnownHolds: -3 },
  ],
  thinksBankHolds: { low: 14, high: 14 },
  minutesUntilPlayingSafe: 39,
  waitingOnEarth: null,
  recent: [],
};
const brief = (over: Partial<DeskBriefing>): DeskBriefing => ({ ...base, ...over });
const ev = (e: DeskEvent): DeskEvent[] => [e];

describe('what a desk says (templated)', () => {
  const cases: [string, DeskBriefing, string][] = [
    ['leased 1: playing safe', brief({ mode: 'reduce-only', minutesUntilPlayingSafe: 0, peers: [{ body: 'earth', heardMinAgo: 75, lastKnownHolds: 5 }, { body: 'moon', heardMinAgo: 72, lastKnownHolds: 0 }] }),
      'I have heard nothing from the others for 72 minutes. I am only taking trades that lower my risk until someone gets through.'],
    ['leased 2: took on', brief({ recent: ev({ t: 190, kind: 'took-on', from: 'earth', units: 17 }) }),
      "I have just taken 17 off Earth's hands. We were holding opposite positions."],
    ['leased 2: handed over', brief({ body: 'earth', recent: ev({ t: 195, kind: 'handed-over', to: 'mars', units: 17 }) }),
      'I have just handed 17 to Mars. We were holding opposite positions.'],
    ['leased 3: degraded', brief({ mode: 'degraded', peers: [{ body: 'earth', heardMinAgo: 70, lastKnownHolds: 5 }, { body: 'moon', heardMinAgo: 4, lastKnownHolds: 0 }] }),
      'I have lost touch with Earth. I can still reach the Moon, so I am carrying on inside my own allowance.'],
    ['leased 4: an hour coming', brief({ minutesUntilPlayingSafe: 20, peers: [{ body: 'earth', heardMinAgo: 40, lastKnownHolds: 5 }, { body: 'moon', heardMinAgo: 40.4, lastKnownHolds: 0 }] }),
      'No word from the others for 40 minutes. If it reaches an hour I will start playing safe.'],
    ['leased 5: turning customers away', brief({ allowanceSpare: 0, holds: 35, recent: ev({ t: 195, kind: 'refused', reason: 'allowance' }) }),
      'I am turning customers away. My allowance of 35 is used up, and I will not go past it.'],
    ['leased 6: close to the allowance', brief({ holds: 30, allowanceSpare: 5 }),
      'I am close to my allowance: I hold +30 of 35. I have asked the others for more room.'],
    ['leased 7: stale price', brief({ remoteNewsAgeMin: 41 }),
      'My latest price from Earth is 41 minutes old, so I am quoting wider to be safe.'],
    ['leased 8: all quiet', base, 'All quiet. I hold +12 and have 23 of my allowance spare.'],
    ['naive 1: out of date', brief({ strategy: 'naive', allowance: null, allowanceSpare: null, minutesUntilPlayingSafe: null, thinksBankHolds: { low: 44, high: 44 }, peers: [{ body: 'earth', heardMinAgo: 95, lastKnownHolds: 30 }, { body: 'moon', heardMinAgo: 93, lastKnownHolds: 2 }] }),
      'As far as I know the bank holds +44. That includes what Earth told me 95 minutes ago, and nothing since.'],
    ['naive 2: room', brief({ strategy: 'naive', allowance: null, allowanceSpare: null, minutesUntilPlayingSafe: null, thinksBankHolds: { low: -7, high: -7 } }),
      'By my count the bank holds −7, so there is room to trade.'],
    ['central Earth, a range', brief({ strategy: 'central', body: 'earth', allowance: null, allowanceSpare: null, minutesUntilPlayingSafe: null, thinksBankHolds: { low: 18, high: 23 } }),
      'I sign off every trade for the whole bank. By my count we hold between +18 and +23.'],
    ['central Earth, exact', brief({ strategy: 'central', body: 'earth', allowance: null, allowanceSpare: null, minutesUntilPlayingSafe: null, thinksBankHolds: { low: 18, high: 18 } }),
      'I sign off every trade for the whole bank. By my count we hold +18.'],
    ['central remote, waiting', brief({ strategy: 'central', allowance: null, allowanceSpare: null, minutesUntilPlayingSafe: null, thinksBankHolds: null, waitingOnEarth: 3 }),
      "I cannot trade without Earth's say-so. 3 customers are waiting on an answer."],
    ['central remote, one waiting', brief({ strategy: 'central', allowance: null, allowanceSpare: null, minutesUntilPlayingSafe: null, thinksBankHolds: null, waitingOnEarth: 1 }),
      "I cannot trade without Earth's say-so. 1 customer is waiting on an answer."],
    ['central remote, nobody', brief({ strategy: 'central', allowance: null, allowanceSpare: null, minutesUntilPlayingSafe: null, thinksBankHolds: null, waitingOnEarth: 0 }),
      "I cannot trade without Earth's say-so. Nobody is waiting just now."],
  ];
  for (const [name, b, want] of cases) it(name, () => expect(deskSays(b)).toBe(want));

  it('takes the first rule that matches: playing safe beats turning customers away', () => {
    const b = brief({ mode: 'reduce-only', minutesUntilPlayingSafe: 0, allowanceSpare: 0, recent: ev({ t: 199, kind: 'refused', reason: 'allowance' }) });
    expect(deskSays(b)).toMatch(/^I have heard nothing from the others/);
  });

  it('says "under a minute" rather than "0 minutes"', () => {
    expect(deskSays(brief({ minutesUntilPlayingSafe: 29.6, peers: [{ body: 'earth', heardMinAgo: 0.4, lastKnownHolds: 1 }, { body: 'moon', heardMinAgo: 0.6, lastKnownHolds: 1 }] }))).toBe(
      'No word from the others for under a minute. If it reaches an hour I will start playing safe.',
    );
  });

  it('never says undefined, NaN or a banned word', () => {
    for (const [, b] of cases) {
      const s = deskSays(b);
      expect(s).not.toMatch(/undefined|NaN/);
      expect(s).not.toMatch(/\b(bp|gossip|lease|epoch|rfq)\b/i);
    }
  });
});
