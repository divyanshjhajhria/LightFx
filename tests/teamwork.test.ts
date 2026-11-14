import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TogetherFile } from '../src/sim/together';
import { Arena } from '../src/sim/world';
import { SHARE_MIN, activity } from '../src/ui/activity';
import { down1, rushFigure, togetherFigure } from '../src/ui/togetherFigure';

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

  it('never rounds the rush figure up', () => {
    expect(down1(5.93)).toBe('5.9');
    expect(down1(5.99)).toBe('5.9');
    expect(down1(5)).toBe('5.0');
    expect(down1(1.38)).toBe('1.3');
  });

  it('shows the rush figure from the file, measured with links up on seeds 11 to 30', () => {
    const real = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'together.json'), 'utf8')) as TogetherFile;
    const r = rushFigure(real)!;
    expect(r.label).toBe('points more customers served at a swamped desk when the others lend it room');
    expect(Number(r.figure)).toBeGreaterThanOrEqual(5);
    expect(r.detail).toMatch(/^A rush at Mars or Earth \(3 times the customers, 80% selling, for 3 hours\) with the links up: 80 runs, seeds 11 to 30/);
    expect(r.detail).toMatch(/With the links down during the rush there is little to lend: -?\d+\.\d points \(160 runs\)\./);
    expect(r.detail).toMatch(/working together served -?\d+\.\d points more of all customers \(900 runs\)\.$/);
  });

  it('leaves the figure off the card when there are no rush results, or the gain is under 5 points', () => {
    const real = JSON.parse(readFileSync(join(__dirname, '..', 'public', 'together.json'), 'utf8')) as TogetherFile;
    expect(rushFigure({ ...real, rush: undefined })).toBe(null);
    // Make every rushed desk do the same together as alone: the gain is 0, so no figure.
    const flat = {
      ...real,
      rush: {
        ...real.rush!,
        squares: real.rush!.squares.map((q) => ({ ...q, perSeed: q.perSeed.map((p) => ({ ...p, together: { ...p.together, rush: p.alone.rush } })) })),
      },
    };
    expect(rushFigure(flat)).toBe(null);
  });
});
