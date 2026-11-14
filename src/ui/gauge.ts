// The gauge on each bank card: one scale for all three banks, from 1.5 times the limit short to 1.5 times long.

/** How far the scale reaches either side of zero, in multiples of the limit. */
export const GAUGE_REACH = 1.5;

/**
 * Where the marker for `holds` sits along the gauge, from 0 (left end) to 1 (right end), and whether the true figure is
 * beyond the ends (the marker then sits at the end).
 */
export function gaugeMarker(holds: number, limit: number): { at: number; beyond: boolean } {
  const reach = GAUGE_REACH * limit;
  const at = (holds + reach) / (2 * reach);
  return { at: Math.max(0, Math.min(1, at)), beyond: at < 0 || at > 1 };
}

/** The tick marks at minus the limit, zero and the limit, as positions along the gauge. */
export function gaugeTicks(): number[] {
  return [-1, 0, 1].map((k) => (k + GAUGE_REACH) / (2 * GAUGE_REACH));
}
