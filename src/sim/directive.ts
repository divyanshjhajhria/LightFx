// A Directive is the ONLY way a language model's output reaches the simulation. It carries a desk's judgment calls
// (how keenly to price, whether to play safe, allowance to hand over, notes to the others) and nothing else. The desk
// clamps every field again when it applies one (LeasedDesk.setDirective), so even a directive that skipped sanitise()
// cannot take a desk past its allowance or the bank past its limit.
import { BODIES } from './types';
import type { BodyId, PerBody } from './types';

export type Pricing = 'keen' | 'steady' | 'cautious';
export type Caution = 'normal' | 'play-safe';
/** Who wrote a directive. 'chaos' is the property test's random generator and never appears on screen. */
export type DirectiveSource = 'model' | 'replay' | 'stand-in' | 'chaos';

export interface Directive {
  pricing: Pricing;
  caution: Caution;
  /** Spare allowance to hand each peer, once. */
  give: Partial<PerBody<number>>;
  /** Allowance wanted from each peer. Advisory: it travels as a note and changes nothing by itself. */
  ask: Partial<PerBody<number>>;
  /** A short message for each peer's agent. */
  noteTo: Partial<PerBody<string>>;
  /** One or two sentences on why. */
  thought: string;
  source: DirectiveSource;
}

export const PRICINGS: readonly Pricing[] = ['keen', 'steady', 'cautious'];
export const CAUTIONS: readonly Caution[] = ['normal', 'play-safe'];
const SOURCES: readonly DirectiveSource[] = ['model', 'replay', 'stand-in', 'chaos'];

/** Multiplier on the half-spread a desk would otherwise quote. */
export const PRICING_MULT: Record<Pricing, number> = { keen: 0.7, steady: 1, cautious: 1.5 };

export const NOTE_MAX = 140;
export const THOUGHT_MAX = 220;
export const UNITS_MAX = 1000;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A whole number of units from 0 to 1000. Anything that is not a finite number (NaN, infinities, strings) is 0. */
export function units(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.min(UNITS_MAX, Math.floor(v));
}

/** Plain text on one line: control characters, line breaks and invisible direction marks removed, then cut. */
export function plain(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\r\n\t\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
}

/** Peers only: entries for the desk itself or for anything that is not a body are dropped. */
function perPeer<T>(raw: unknown, self: BodyId | undefined, f: (v: unknown) => T | null): Partial<PerBody<T>> {
  const out: Partial<PerBody<T>> = {};
  if (!isRecord(raw)) return out;
  for (const b of BODIES) {
    if (b === self || !Object.prototype.hasOwnProperty.call(raw, b)) continue;
    const v = f(raw[b]);
    if (v !== null) out[b] = v;
  }
  return out;
}

/**
 * Anything at all in, a safe Directive (or null) out. Missing fields take their defaults (steady, normal, nothing to
 * give, ask or say, no thought); an unknown pricing or caution rejects the whole thing; unknown fields are ignored.
 * `self` is the desk it is for, so entries addressed to itself are dropped.
 */
export function sanitise(raw: unknown, self?: BodyId): Directive | null {
  if (!isRecord(raw)) return null;
  const pricing = raw.pricing === undefined ? 'steady' : raw.pricing;
  const caution = raw.caution === undefined ? 'normal' : raw.caution;
  if (!PRICINGS.includes(pricing as Pricing) || !CAUTIONS.includes(caution as Caution)) return null;
  const pos = (v: unknown) => {
    const n = units(v);
    return n > 0 ? n : null;
  };
  const note = (v: unknown) => {
    const s = plain(v, NOTE_MAX);
    return s ? s : null;
  };
  return {
    pricing: pricing as Pricing,
    caution: caution as Caution,
    give: perPeer(raw.give, self, pos),
    ask: perPeer(raw.ask, self, pos),
    noteTo: perPeer(raw.noteTo, self, note),
    thought: plain(raw.thought, THOUGHT_MAX),
    source: SOURCES.includes(raw.source as DirectiveSource) ? (raw.source as DirectiveSource) : 'model',
  };
}
