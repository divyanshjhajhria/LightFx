import { describe, expect, it } from 'vitest';
import { LIFT, MIN_FIT, NO_INSETS, fitRect } from '../src/ui/fit';

const TILT = 0.42;
/** The fit the stage always had, before insets existed. */
const before = (W: number, H: number) => ({
  fit: Math.max(40, Math.min((W * 0.9) / 3.2, (H * 0.86) / (3.2 * TILT))),
  x: W / 2,
  y: H / 2 - LIFT,
});

describe('fitting the solar system to the uncovered stage', () => {
  it('with no insets gives exactly what the stage always had', () => {
    for (const [W, H] of [[1440, 590], [1366, 458], [420, 700], [1920, 800], [80, 60]]) {
      expect(fitRect(W, H, NO_INSETS, TILT)).toEqual(before(W, H));
    }
  });

  it('moves the centre right by half a left inset, and never makes the fit larger', () => {
    for (const left of [0, 50, 300, 700]) {
      const r = fitRect(1440, 590, { ...NO_INSETS, left }, TILT);
      expect(r.x).toBe(720 + left / 2);
      expect(r.y).toBe(before(1440, 590).y);
      expect(r.fit).toBeLessThanOrEqual(before(1440, 590).fit);
    }
  });

  it('likewise for the other sides', () => {
    const r = fitRect(1440, 590, { top: 0, right: 340, bottom: 80, left: 0 }, TILT);
    expect(r.x).toBe(720 - 170);
    expect(r.y).toBe(295 - 40 - LIFT);
    expect(r.fit).toBeLessThanOrEqual(before(1440, 590).fit);
  });

  it('never fits below the existing minimum, even with everything covered', () => {
    expect(fitRect(1440, 590, { top: 400, right: 800, bottom: 400, left: 800 }, TILT).fit).toBe(MIN_FIT);
    expect(fitRect(0, 0, NO_INSETS, TILT).fit).toBe(MIN_FIT);
  });
});
