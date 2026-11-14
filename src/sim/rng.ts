/** Seeded random numbers (mulberry32). Never use Math.random in the simulation: the three strategies must see identical events. */
export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Standard normal (Box-Muller). Always consumes two uniforms. */
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Integer in [lo, hi]. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  exp(mean: number): number {
    return -mean * Math.log(Math.max(1 - this.next(), 1e-12));
  }

  /** Poisson (Knuth). Fine for the small rates used here. */
  poisson(lambda: number): number {
    const l = Math.exp(-lambda);
    let k = 0;
    let p = this.next();
    while (p > l) {
      k++;
      p *= this.next();
    }
    return k;
  }

  /** Independent stream derived from this seed. */
  static stream(seed: number, label: number): Rng {
    return new Rng(Math.imul(seed ^ 0x9e3779b9, label * 2654435761 + 1) >>> 0);
  }
}
