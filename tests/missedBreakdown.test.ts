import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { SweepFile } from '../src/sim/sweep';
import { MARKETS } from '../src/sim/sweep';
import { STRATEGIES } from '../src/sim/types';
import { missedParts } from '../src/ui/missedBreakdown';
import { summarise } from '../src/ui/sweepSummary';

const summary = summarise(JSON.parse(readFileSync('public/sweep.json', 'utf8')) as SweepFile);

describe('where the missed customers went (survival map bars)', () => {
  it('each bank shows only the parts that can happen to it, and they fill the bar', () => {
    for (const f of [summary.overall, ...MARKETS.map((m) => summary.byMarket[m])]) {
      expect(missedParts('leased', f.banks.leased)!.map((p) => p.label)).toEqual(['Served', 'Price', 'No room', 'Playing safe']);
      expect(missedParts('naive', f.banks.naive)!.map((p) => p.label)).toEqual(['Served', 'Price', 'No room']);
      expect(missedParts('central', f.banks.central)!.map((p) => p.label)).toEqual(['Served', 'Price', 'No room', 'No answer']);
      for (const b of STRATEGIES) {
        const total = missedParts(b, f.banks[b])!.reduce((s, p) => s + p.pct, 0);
        expect(Math.abs(total - 100)).toBeLessThan(0.01);
      }
    }
  });

  it('shows nothing for a sweep file written before the breakdown existed', () => {
    const { missed: _, ...old } = summary.overall.banks.leased;
    expect(missedParts('leased', old)).toBeNull();
  });
});
