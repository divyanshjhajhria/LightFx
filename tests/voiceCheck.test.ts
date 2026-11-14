import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DeskBriefing } from '../src/sim/briefing';
import { acceptable } from '../src/ui/voiceCheck';

const brief: DeskBriefing = {
  body: 'mars', strategy: 'leased', now: 200, mode: 'normal', holds: -12, allowance: 35, allowanceSpare: 23, bid: 0.999,
  ask: 1.001, localPrice: 1, remoteNewsAgeMin: 20.3,
  peers: [{ body: 'earth', heardMinAgo: 22.25, lastKnownHolds: 5 }, { body: 'moon', heardMinAgo: 21, lastKnownHolds: -3 }],
  thinksBankHolds: { low: -10, high: -10 }, minutesUntilPlayingSafe: 37.75, waitingOnEarth: null, recent: [],
};

describe('checking a model-written line', () => {
  it('accepts a short first-person line whose numbers are all in the briefing (rounded as people round)', () => {
    expect(acceptable('I hold −12 and have 23 of my allowance spare. Earth last spoke 22 minutes ago.', brief)).toBe(true);
    expect(acceptable("I'm fine. One of the others is quiet.", brief)).toBe(true);
  });

  it('rejects a number that is not in the briefing, in digits or in words', () => {
    expect(acceptable('I hold 12 and the bank holds 87.', brief)).toBe(false);
    expect(acceptable('I have heard nothing for forty minutes.', brief)).toBe(false);
  });

  it('rejects anything too long, too many sentences, banned words, or not in the first person', () => {
    expect(acceptable(`I hold 12. ${'Quiet. '.repeat(50)}`, brief)).toBe(false);
    expect(acceptable('I hold 12. All quiet. Nothing new. Still here.', brief)).toBe(false);
    expect(acceptable('My lease runs out soon.', brief)).toBe(false);
    expect(acceptable('I think you should buy now.', brief)).toBe(false);
    expect(acceptable('I guarantee the bank is safe.', brief)).toBe(false);
    expect(acceptable('The desk holds 12.', brief)).toBe(false);
  });
});

describe('rule 11: the model explains, never decides', () => {
  it('nothing under src/sim imports anything from src/ui', () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f)) files.push(p);
      }
    };
    walk(join(__dirname, '..', 'src', 'sim'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      for (const line of readFileSync(f, 'utf8').split('\n')) {
        if (/^\s*(import|export)\b.*from\s+['"]/.test(line)) expect(line, f).not.toMatch(/['"][^'"]*\/ui(\/|['"])/);
      }
    }
  });
});
