import { describe, expect, it } from 'vitest';
import { SeriesFeed } from '../src/sim/market';
import { Arena } from '../src/sim/world';

describe('SeriesFeed', () => {
  const feed = new SeriesFeed([1.0, 1.1, 1.21]);

  it('replays the series and interpolates between minutes', () => {
    feed.advance(1);
    expect(feed.p0 * Math.exp(feed.value)).toBeCloseTo(1.1, 10);
    feed.advance(0.5);
    expect(feed.value).toBeCloseTo(Math.log(1.1) / 2, 10);
  });

  it('loops without a jump at the seam', () => {
    feed.advance(1.999);
    const before = feed.value;
    feed.advance(2.001);
    expect(Math.abs(feed.value - before)).toBeLessThan(0.001);
  });

  it('drives a full run', () => {
    const mids = Array.from({ length: 300 }, (_, i) => 1.08 + 0.002 * Math.sin(i / 20));
    const a = new Arena(5, { earthSeries: mids });
    a.run(400);
    expect(a.worlds.leased.fullPrice()).toBeGreaterThan(1);
    expect(a.worlds.leased.metrics.breachTicks).toBe(0);
  });
});
