// Where the solar system sits on the stage: fitted to the part of the stage that nothing covers.

/** Parts of the stage covered by overlays (the feed, the desk panel, the dock or the caption bar), in pixels. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** The Sun sits slightly above the centre of the free area. */
export const LIFT = 12;
/** The smallest scale the view ever fits to, in pixels per AU. */
export const MIN_FIT = 40;

/**
 * The fitted scale (pixels per AU) and the screen point the Sun sits at, for a stage of `stageW` by `stageH` with
 * `insets` covered. With no insets this is exactly the fit the stage always had.
 */
export function fitRect(stageW: number, stageH: number, insets: Insets, tilt: number): { fit: number; x: number; y: number } {
  const w = Math.max(0, stageW - insets.left - insets.right);
  const h = Math.max(0, stageH - insets.top - insets.bottom);
  const fit = Math.max(MIN_FIT, Math.min((w * 0.9) / 3.2, (h * 0.86) / (3.2 * tilt)));
  return { fit, x: insets.left + w / 2, y: insets.top + h / 2 - LIFT };
}
