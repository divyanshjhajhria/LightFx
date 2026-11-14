import type { PerBody } from './types';

/** All times are simulated minutes. Prices are dollars per Mars credit. Positions are in units of Mars credits. */
export interface SimConfig {
  /** Minutes per tick. */
  dt: number;
  /** Bank-wide limit on |total position|. */
  limit: number;
  /** Starting split of the limit between desks. Must sum to `limit`. */
  alloc: PerBody<number>;

  gossipEvery: number;
  /** A desk that has heard nothing newer than this from any peer goes reduce-only. Must exceed the worst round trip (about 42). */
  leaseDuration: number;
  /** Grant budget to a peer when my free budget exceeds theirs by more than this. */
  grantThreshold: number;
  grantCooldown: number;
  /** Let a short desk absorb long position from a long peer, cancelling opposite positions to free budget. */
  netting: boolean;
  /** Smallest netting offer worth sending, in units. */
  nettingMin: number;

  /** Half-spread with perfect information, as a fraction of price. */
  baseHalfSpread: number;
  /** Multiplier on the gap-risk term sqrt(sum of sigma^2 * info age). */
  gapK: number;
  /** Info age (minutes) beyond which the spread stops widening. */
  maxGapAge: number;
  /** How far inventory shifts the mid, as a fraction of the half-spread. */
  skewK: number;

  /** Customer arrivals per minute at each desk. */
  customerRate: number;
  sizeMin: number;
  sizeMax: number;
  /** Mean of the customers' price tolerance (exponential). */
  tolMean: number;
  /** Mean customer patience in minutes (exponential). Only matters for the central strategy. */
  patienceMean: number;
  /** Probability that a customer at this desk sells Mars credits, outside a panic. */
  sellProb: PerBody<number>;
  /** Minutes a visitor (a person using the app) will wait for an answer before walking away. */
  visitorPatience: number;
  /** When a link closes (storm, hand cut, the Sun), destroy the messages already travelling on it. */
  closedLinkDestroysInFlight: boolean;

  /** Volatility of the Earth-sourced component, per sqrt(minute), when using the synthetic feed. */
  sigmaEarth: number;
  /** Volatility and mean reversion of the Mars-sourced component. */
  sigmaMars: number;
  marsRevert: number;

  /** During a panic: volatility multiplier, drift per minute, and probability a customer is a seller. */
  panicVolMult: number;
  panicDrift: number;
  panicSellProb: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  dt: 0.25,
  limit: 100,
  alloc: { earth: 40, moon: 20, mars: 40 },

  gossipEvery: 2,
  leaseDuration: 60,
  grantThreshold: 10,
  grantCooldown: 10,
  netting: true,
  nettingMin: 3,

  baseHalfSpread: 0.0003,
  gapK: 0.3,
  maxGapAge: 120,
  skewK: 0.5,

  customerRate: 0.6,
  sizeMin: 1,
  sizeMax: 5,
  tolMean: 0.0012,
  patienceMean: 3,
  sellProb: { earth: 0.5, moon: 0.5, mars: 0.5 },
  visitorPatience: 60,
  closedLinkDestroysInFlight: true,

  sigmaEarth: 0.00012,
  sigmaMars: 0.00015,
  marsRevert: 1 / 300,

  panicVolMult: 4,
  panicDrift: -0.0001,
  panicSellProb: 0.8,
};
