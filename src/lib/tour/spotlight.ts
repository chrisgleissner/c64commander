/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The union of every anchor's rect, padded.
 *
 * A step may point at more than one element — step 4 spotlights both the Resume and the Recent tile
 * — so the spotlight is what encloses them all rather than one of them.
 */
export const unionRect = (rects: readonly Rect[], padding = 6): Rect | null => {
  if (rects.length === 0) return null;
  let top = Number.POSITIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.left + rect.width);
    bottom = Math.max(bottom, rect.top + rect.height);
  }
  return {
    top: top - padding,
    left: left - padding,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2,
  };
};

/**
 * The scrim, as FOUR rectangles around the hole rather than an SVG mask: sharper at DPR 1.5, and no
 * compositing layer. Returned in order above, below, left, right; a zero-area piece is dropped so
 * nothing paints an empty box.
 */
export const scrimRects = (hole: Rect | null, viewport: { width: number; height: number }): Rect[] => {
  if (hole === null) return [{ top: 0, left: 0, width: viewport.width, height: viewport.height }];

  const top = Math.max(0, Math.min(hole.top, viewport.height));
  const bottom = Math.max(0, Math.min(hole.top + hole.height, viewport.height));
  const left = Math.max(0, Math.min(hole.left, viewport.width));
  const right = Math.max(0, Math.min(hole.left + hole.width, viewport.width));

  return [
    { top: 0, left: 0, width: viewport.width, height: top },
    { top: bottom, left: 0, width: viewport.width, height: viewport.height - bottom },
    { top, left: 0, width: left, height: bottom - top },
    { top, left: right, width: viewport.width - right, height: bottom - top },
  ].filter((rect) => rect.width > 0 && rect.height > 0);
};

/** Whether the caption bar goes above or below the hole, so it never covers what it describes. */
export const captionPlacement = (hole: Rect | null, viewportHeight: number): "top" | "bottom" => {
  if (hole === null) return "bottom";
  const spaceBelow = viewportHeight - (hole.top + hole.height);
  return spaceBelow >= hole.top ? "bottom" : "top";
};
