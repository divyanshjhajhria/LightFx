import type { BodyId } from './types';

/** Light takes this many minutes to cross one astronomical unit. */
export const AU_LIGHT_MIN = 8.316746;

const EARTH = { r: 1, periodDays: 365.256 };
const MARS = { r: 1.5237, periodDays: 686.98 };
const MOON = { r: 0.00257, periodDays: 27.32 };

/** A link is blocked when it passes this close to the Sun (about 4.7 degrees either side of conjunction). */
export const SUN_BLOCK_AU = 0.05;

export interface Vec {
  x: number;
  y: number;
}

/** Circular, coplanar orbits. Angles in radians. */
export interface OrbitState {
  earth: number;
  mars: number;
  moon: number;
}

/** `separationDeg` is the Sun-centred angle between Earth and Mars: 0 = closest approach, 180 = Mars behind the Sun. */
export function makeOrbit(separationDeg: number): OrbitState {
  return { earth: 0, mars: (separationDeg * Math.PI) / 180, moon: 0 };
}

export function setSeparation(o: OrbitState, separationDeg: number): void {
  o.mars = o.earth + (separationDeg * Math.PI) / 180;
}

export function separationDeg(o: OrbitState): number {
  const d = (((o.mars - o.earth) * 180) / Math.PI) % 360;
  const pos = d < 0 ? d + 360 : d;
  return pos > 180 ? 360 - pos : pos;
}

/** Planets barely move during a trading session, but this keeps the model honest. */
export function advanceOrbit(o: OrbitState, dtMin: number): void {
  const days = dtMin / 1440;
  o.earth += (2 * Math.PI * days) / EARTH.periodDays;
  o.mars += (2 * Math.PI * days) / MARS.periodDays;
  o.moon += (2 * Math.PI * days) / MOON.periodDays;
}

export function position(o: OrbitState, b: BodyId): Vec {
  const e = { x: EARTH.r * Math.cos(o.earth), y: EARTH.r * Math.sin(o.earth) };
  if (b === 'earth') return e;
  if (b === 'moon') return { x: e.x + MOON.r * Math.cos(o.moon), y: e.y + MOON.r * Math.sin(o.moon) };
  return { x: MARS.r * Math.cos(o.mars), y: MARS.r * Math.sin(o.mars) };
}

export function distanceAU(o: OrbitState, a: BodyId, b: BodyId): number {
  const p = position(o, a);
  const q = position(o, b);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

export function lightDelayMin(o: OrbitState, a: BodyId, b: BodyId): number {
  return distanceAU(o, a, b) * AU_LIGHT_MIN;
}

/** True when the straight line between the two bodies passes too close to the Sun at the origin. */
export function sunBlocked(o: OrbitState, a: BodyId, b: BodyId): boolean {
  const p = position(o, a);
  const q = position(o, b);
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return false;
  const t = Math.max(0, Math.min(1, -(p.x * dx + p.y * dy) / len2));
  return Math.hypot(p.x + t * dx, p.y + t * dy) < SUN_BLOCK_AU;
}
