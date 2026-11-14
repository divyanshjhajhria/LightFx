import { describe, expect, it } from 'vitest';
import { lightDelayMin, makeOrbit, sunBlocked } from '../src/sim/orbits';

describe('orbits', () => {
  it('gives about 4.4 minutes at closest approach', () => {
    expect(lightDelayMin(makeOrbit(0), 'earth', 'mars')).toBeCloseTo(4.36, 1);
  });

  it('gives about 20 minutes on the far side, with the link still open', () => {
    const o = makeOrbit(150);
    expect(lightDelayMin(o, 'earth', 'mars')).toBeCloseTo(20.3, 0);
    expect(sunBlocked(o, 'earth', 'mars')).toBe(false);
  });

  it('blocks Earth-Mars when Mars is behind the Sun, but never Earth-Moon', () => {
    const o = makeOrbit(180);
    expect(sunBlocked(o, 'earth', 'mars')).toBe(true);
    expect(sunBlocked(o, 'moon', 'mars')).toBe(true);
    expect(sunBlocked(o, 'earth', 'moon')).toBe(false);
  });

  it('puts the Moon about 1.3 light-seconds away', () => {
    expect(lightDelayMin(makeOrbit(60), 'earth', 'moon') * 60).toBeCloseTo(1.28, 1);
  });
});
