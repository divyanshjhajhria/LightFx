// Pure helpers for the banks chart: scales, time windows, label placement and the breach shapes.

export interface Pt {
  t: number;
  v: number;
}

/** One vertical scale for all three banks: at least 1.2 times the limit each way, and room above the highest peak. */
export function yDomain(values: number[], limit: number): [number, number] {
  const lo = Math.min(-1.2 * limit, ...values);
  const hi = Math.max(1.2 * limit, ...values.map((v) => 1.08 * v));
  return [lo, hi];
}

export type TimeMode =
  | { kind: 'scenario'; durationMin: number }
  | { kind: 'guided'; startMin: number }
  | { kind: 'free' };

/** The free-play window: the last this many simulated minutes. */
export const FREE_WINDOW = 240;

/**
 * The time window the chart shows. A scenario runs 0 to its duration, so lines grow left to right and nothing
 * rescales. The guided demo starts where its warm-up ended and grows an hour at a time, half an hour ahead of now.
 * Free play shows the last four hours (the first four hours stay fixed while they fill).
 */
export function timeDomain(mode: TimeMode, now: number): [number, number] {
  if (mode.kind === 'scenario') return [0, mode.durationMin];
  if (mode.kind === 'guided') {
    const hours = Math.max(1, Math.ceil((now + 30 - mode.startMin) / 60));
    return [mode.startMin, mode.startMin + 60 * hours];
  }
  return now <= FREE_WINDOW ? [0, FREE_WINDOW] : [now - FREE_WINDOW, now];
}

/** A tick every simulated hour inside the window. */
export function hourTicks([from, to]: [number, number]): number[] {
  const out: number[] = [];
  for (let t = Math.ceil(from / 60) * 60; t <= to; t += 60) out.push(t);
  return out;
}

/**
 * Move labels apart so none are closer than `minGap`, keeping their order and staying inside [top, bottom].
 * `ys` are the wanted positions; the result is in the same order as `ys`.
 */
export function spreadLabels(ys: number[], minGap: number, top: number, bottom: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y || a.i - b.i);
  const pos = order.map((o) => Math.min(bottom, Math.max(top, o.y)));
  for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + minGap);
  if (pos.length) pos[pos.length - 1] = Math.min(pos[pos.length - 1], bottom);
  for (let k = pos.length - 2; k >= 0; k--) pos[k] = Math.min(pos[k], pos[k + 1] - minGap);
  if (pos.length && pos[0] < top) {
    pos[0] = top;
    for (let k = 1; k < pos.length; k++) pos[k] = Math.max(pos[k], pos[k - 1] + minGap);
  }
  const out = new Array<number>(ys.length);
  order.forEach((o, k) => (out[o.i] = pos[k]));
  return out;
}

/** Where the line from a to b crosses the level y = level (a and b on opposite sides). */
function cross(a: Pt, b: Pt, level: number): Pt {
  const f = (level - a.v) / (b.v - a.v);
  return { t: a.t + f * (b.t - a.t), v: level };
}

/**
 * The stretches of a series outside the limit, each as the trace between its two crossings (crossing points
 * interpolated). `side` is 'above' for over +limit and 'below' for under -limit. Filling between such a stretch and
 * the limit line gives the breach shape: its width is how long, its height how far.
 */
export function overLimitRegions(series: Pt[], limit: number): { side: 'above' | 'below'; points: Pt[] }[] {
  const out: { side: 'above' | 'below'; points: Pt[] }[] = [];
  for (const side of ['above', 'below'] as const) {
    const level = side === 'above' ? limit : -limit;
    const outside = (p: Pt) => (side === 'above' ? p.v > level : p.v < level);
    let cur: Pt[] | null = null;
    for (let i = 0; i < series.length; i++) {
      const p = series[i];
      const prev = series[i - 1];
      if (outside(p)) {
        if (!cur) {
          cur = prev ? [cross(prev, p, level)] : [{ t: p.t, v: level }];
        }
        cur.push(p);
      } else if (cur) {
        cur.push(cross(prev, p, level));
        out.push({ side, points: cur });
        cur = null;
      }
    }
    if (cur) {
      // Still outside at the latest point: close the shape straight down (or up) to the limit line.
      cur.push({ t: cur[cur.length - 1].t, v: level });
      out.push({ side, points: cur });
    }
  }
  return out;
}
