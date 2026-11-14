import { describe, expect, it } from 'vitest';
import { FREE_WINDOW, hourTicks, overLimitRegions, spreadLabels, timeDomain, yDomain } from '../src/ui/chartMath';

describe('the banks chart', () => {
  it('uses ±1.2 times the limit while every bank is inside it, and makes room above a peak', () => {
    expect(yDomain([-40, 0, 95, 100], 100)).toEqual([-120, 120]);
    const [lo, hi] = yDomain([-40, 50, 192], 100);
    expect(lo).toBe(-120);
    expect(hi).toBeCloseTo(1.08 * 192, 9);
    expect(yDomain([-150, 0], 100)[0]).toBe(-150);
  });

  it('spreads labels apart, keeping their order and staying inside the chart', () => {
    const out = spreadLabels([50, 52, 51], 17, 0, 140);
    // Same order as wanted: the label that wanted 50 stays above the one that wanted 51, then 52.
    expect(out[0]).toBeLessThan(out[2]);
    expect(out[2]).toBeLessThan(out[1]);
    const sorted = [...out].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(17 - 1e-9);
    const bottom = spreadLabels([138, 139, 140], 17, 0, 140);
    expect(Math.max(...bottom)).toBeLessThanOrEqual(140);
    expect(Math.min(...bottom)).toBeGreaterThanOrEqual(0);
    expect(spreadLabels([5, 120], 17, 0, 140)).toEqual([5, 120]);
  });

  it('cuts the breach shape at the interpolated crossing times', () => {
    const series = [
      { t: 0, v: 80 },
      { t: 10, v: 120 },
      { t: 20, v: 140 },
      { t: 30, v: 60 },
    ];
    const [region] = overLimitRegions(series, 100);
    expect(region.side).toBe('above');
    expect(region.points[0]).toEqual({ t: 5, v: 100 });
    // 140 to 60 over ten minutes crosses 100 half-way.
    expect(region.points.at(-1)).toEqual({ t: 25, v: 100 });
    expect(overLimitRegions(series.map((p) => ({ ...p, v: -p.v })), 100)[0].side).toBe('below');
    expect(overLimitRegions([{ t: 0, v: 10 }, { t: 1, v: 20 }], 100)).toEqual([]);
  });

  it('closes a breach that is still going on down to the limit line at the latest point', () => {
    const [region] = overLimitRegions([{ t: 0, v: 90 }, { t: 10, v: 110 }, { t: 20, v: 130 }], 100);
    expect(region.points[0]).toEqual({ t: 5, v: 100 });
    expect(region.points.at(-1)).toEqual({ t: 20, v: 100 });
  });

  it('picks the time window for a scenario, the guided demo and free play', () => {
    expect(timeDomain({ kind: 'scenario', durationMin: 420 }, 37)).toEqual([0, 420]);
    expect(timeDomain({ kind: 'guided', startMin: 60 }, 60)).toEqual([60, 120]);
    expect(timeDomain({ kind: 'guided', startMin: 60 }, 95)).toEqual([60, 180]);
    expect(timeDomain({ kind: 'guided', startMin: 60 }, 150)).toEqual([60, 180]);
    expect(timeDomain({ kind: 'guided', startMin: 60 }, 151)).toEqual([60, 240]);
    expect(timeDomain({ kind: 'free' }, 100)).toEqual([0, FREE_WINDOW]);
    expect(timeDomain({ kind: 'free' }, 500)).toEqual([500 - FREE_WINDOW, 500]);
    expect(hourTicks([30, 250])).toEqual([60, 120, 180, 240]);
  });
});
