/**
 * The Earth-sourced part of the log price. Two implementations:
 * a seeded random walk, and a replay of real one-minute mid prices (the SGX FX data).
 */
export interface EarthFeed {
  /** Starting price in dollars per Mars credit. */
  readonly p0: number;
  /** Log return since the start, at the current time. */
  value: number;
  advance(now: number, dt: number, z: number): void;
}

export class SyntheticFeed implements EarthFeed {
  readonly p0 = 1;
  value = 0;

  constructor(private readonly sigma: number) {}

  advance(_now: number, dt: number, z: number): void {
    this.value += this.sigma * Math.sqrt(dt) * z;
  }
}

/** Replays one mid price per minute, interpolating between minutes and looping without a jump at the seam. */
export class SeriesFeed implements EarthFeed {
  readonly p0: number;
  value = 0;
  private readonly logs: number[];

  constructor(mids: number[]) {
    if (mids.length < 2) throw new Error('SeriesFeed needs at least two prices');
    this.p0 = mids[0];
    this.logs = mids.map((m) => Math.log(m / mids[0]));
  }

  advance(now: number): void {
    const n = this.logs.length - 1;
    const loops = Math.floor(now / n);
    const t = now - loops * n;
    const i = Math.min(Math.floor(t), n - 1);
    const frac = t - i;
    this.value = loops * this.logs[n] + this.logs[i] * (1 - frac) + this.logs[i + 1] * frac;
  }
}
