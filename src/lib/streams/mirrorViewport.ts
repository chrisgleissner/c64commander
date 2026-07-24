/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer — video-mirror zoom/pan viewport math.
 *
 * A {@link Viewport} describes which portion of the full C64 frame is shown when
 * zoomed in. Everything here is pure, side-effect-free float math — no React, no
 * DOM. `scale` is the zoom factor (1 = fit the whole frame, {@link MAX_SCALE} =
 * maximum magnification); `cx`/`cy` are the CENTER of the visible region in
 * normalized frame coords `[0,1]` (0,0 = top-left, 1,1 = bottom-right).
 */

export interface Viewport {
  scale: number;
  cx: number;
  cy: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;

/** The default viewport: whole frame, centered. */
export const FIT_VIEWPORT: Viewport = { scale: 1, cx: 0.5, cy: 0.5 };

const isFiniteNumber = (value: number): boolean => typeof value === "number" && Number.isFinite(value);

const clampScale = (scale: number): number => (scale < MIN_SCALE ? MIN_SCALE : scale > MAX_SCALE ? MAX_SCALE : scale);

/**
 * Clamp `scale` into `[MIN_SCALE, MAX_SCALE]` and the center into the range that
 * keeps the visible region wholly inside the frame. The visible half-extent per
 * axis is `0.5/scale`, so cx,cy are clamped into `[0.5/scale, 1 - 0.5/scale]`
 * (at scale 1 that collapses to exactly 0.5). Floats are preserved. Any NaN or
 * Infinity component yields {@link FIT_VIEWPORT}.
 */
export const clampViewport = (v: Viewport): Viewport => {
  if (!v || !isFiniteNumber(v.scale) || !isFiniteNumber(v.cx) || !isFiniteNumber(v.cy)) {
    return { ...FIT_VIEWPORT };
  }
  const scale = clampScale(v.scale);
  const half = 0.5 / scale;
  const lo = half;
  const hi = 1 - half;
  const clampAxis = (c: number): number => (c < lo ? lo : c > hi ? hi : c);
  return { scale, cx: clampAxis(v.cx), cy: clampAxis(v.cy) };
};

/**
 * Zoom by `factor` (multiplicative) while keeping the focal point `focus`
 * (normalized `[0,1]`, default = current center) stationary on screen. When the
 * focus is the current center this leaves cx,cy unchanged.
 */
export const zoomViewport = (v: Viewport, factor: number, focus?: { x: number; y: number }): Viewport => {
  const base = clampViewport(v);
  if (!isFiniteNumber(factor)) {
    return base;
  }
  const newScale = clampScale(base.scale * factor);
  const fx = focus && isFiniteNumber(focus.x) ? focus.x : base.cx;
  const fy = focus && isFiniteNumber(focus.y) ? focus.y : base.cy;
  const ratio = base.scale / newScale;
  return clampViewport({
    scale: newScale,
    cx: fx + (base.cx - fx) * ratio,
    cy: fy + (base.cy - fy) * ratio,
  });
};

/** Pan the center by normalized frame-coord deltas, re-clamped to stay in-frame. */
export const panViewport = (v: Viewport, dx: number, dy: number): Viewport =>
  clampViewport({ ...v, cx: v.cx + dx, cy: v.cy + dy });

/** Move the center to `(cx, cy)`, re-clamped to stay in-frame. */
export const setCenter = (v: Viewport, cx: number, cy: number): Viewport => clampViewport({ ...v, cx, cy });

/**
 * The visible rectangle in normalized `[0,1]` frame coords. `w`/`h` are `1/scale`
 * and `x`/`y` are the top-left corner. Uses the clamped viewport.
 */
export const viewportRect = (v: Viewport): { x: number; y: number; w: number; h: number } => {
  const c = clampViewport(v);
  const half = 0.5 / c.scale;
  return { x: c.cx - half, y: c.cy - half, w: 1 / c.scale, h: 1 / c.scale };
};

/**
 * CSS transform (pixels) for a full-frame element sized `containerW×containerH`
 * at scale 1, applied as `transform: translate(translateXpx, translateYpx)
 * scale(scale)` with `transform-origin: 0 0`, so the viewport center lands at the
 * container center.
 */
export const viewportTransform = (
  v: Viewport,
  containerW: number,
  containerH: number,
): { scale: number; translateX: number; translateY: number } => {
  const c = clampViewport(v);
  return {
    scale: c.scale,
    translateX: containerW * (0.5 - c.scale * c.cx),
    translateY: containerH * (0.5 - c.scale * c.cy),
  };
};
