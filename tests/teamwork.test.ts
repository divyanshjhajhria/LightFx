import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TogetherFile } from '../src/sim/together';
import { Arena } from '../src/sim/world';
import { SHARE_MIN, activity } from '../src/ui/activity';
import { togetherFigure } from '../src/ui/togetherFigure';

describe('teamwork on screen', () => {
  it('the feed says when a desk shares 5 or more of its allowance, and never for less', () => {
    const a = new Arena(3, { separationDeg: 0 });
    a.setFlow('earth', 0.8);
    a.setFlow('mars', 0.2);
    a.run(300);
    const lines = activity(a, 'leased').filter((l) => / shares \d+ of its allowance with /.test(l.text));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.text).toMatch(/^(Earth|The Moon|Mars) shares \d+ of its allowance with (Earth|the Moon|Mars)\.$/);
      expect(Number(/shares (\d+)/.exec(l.text)![1])).toBeGreaterThanOrEqual(SHARE_MIN);
      expect(l.tone).toBe('plain');
    }
    // The same events, read from the desks' own records: every hand-over of 5 or more appears.
    const given = (['earth', 'moon', 'mars'] as const).flatMap((b) =>
      a.worlds.leased.feedLog(b).filter((e) => e.kind === 'allowance-given' && e.units >= SHARE_MIN),
    );
    expect(lines).toHaveLength(given.length);
  });

  it('writes the evidence figure to one decimal, with each market in the read-out', () => {
    const file: TogetherFile = {
      seeds: [1],
      squares: [],
      overall: { runs: 540, together: {} as never, alone: {} as never, gainPoints: 0.94, gainRelativePct: 1.64, togetherServedMore: 384 },
      byMarket: {
        calm: { runs: 180, together: {} as never, alone: {} as never, gainPoints: 0.19, gainRelativePct: 0.32, togetherServedMore: 96 },
        panic: { runs: 180, together: {} as never, alone: {} as never, gainPoints: 0.36, gainRelativePct: 0.65, togetherServedMore: 114 },
        imbalance: { runs: 180, together: {} as never, alone: {} as never, gainPoints: 2.28, gainRelativePct: 3.99, togetherServedMore: 174 },
      },
    };
    expect(togetherFigure(file)).toEqual({
      figure: '1.6%',
      label: 'more customers served by working together than alone',
      detail:
        'Our bank run both ways on the same 540 runs, with and without storms: 0.3% with calm market, 0.7% with panic, ' +
        '4.0% with one-way customers. Working together served more in 384 of the 540.',
    });
  });

  it('shows a small or negative gain as it is', () => {
    const real = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'together.json'), 'utf8')) as TogetherFile;
    expect(togetherFigure(real).figure).toBe(`${real.overall.gainRelativePct.toFixed(1)}%`);
    const worse = { ...real, overall: { ...real.overall, gainRelativePct: -0.42 } };
    expect(togetherFigure(worse).figure).toBe('-0.4%');
  });
});
