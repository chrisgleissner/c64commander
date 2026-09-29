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
 * A step may point at more than one element — step 4 spotlights both the Last tune and the Recent tile
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

export type CaptionPlacement = "top" | "bottom";

/** The part of the screen the caption and the system bars leave uncovered. */
export interface SpotlightFrame {
  /** Viewport height in CSS px. */
  readonly viewportHeight: number;
  /** The caption panel's height in CSS px, its own inset padding included. */
  readonly captionHeight: number;
  /** System bar insets in CSS px. The caption pads itself by the inset on the side it sits on. */
  readonly insetTop: number;
  readonly insetBottom: number;
  /**
   * The part of the viewport the anchor's scroll container shows, when that is less than the
   * viewport. A page scrolled inside a region between the app bar and the tab bar cannot show an
   * anchor above or below that region, however much of the screen the caption leaves free there.
   */
  readonly clip?: { readonly top: number; readonly bottom: number };
}

/** Breathing room between a spotlit anchor and the caption or the screen edge. */
export const SPOTLIGHT_MARGIN = 8;

/**
 * The band of the viewport the app still shows with the caption on `placement`'s side.
 *
 * The caption's measured height already contains the inset on its own side, so that inset is not
 * subtracted a second time. The opposite side still loses its system bar.
 */
export const freeBand = (placement: CaptionPlacement, frame: SpotlightFrame): { top: number; bottom: number } =>
  placement === "bottom"
    ? { top: frame.insetTop, bottom: frame.viewportHeight - frame.captionHeight }
    : { top: frame.captionHeight, bottom: frame.viewportHeight - frame.insetBottom };

/** The free band, narrowed to what the anchor's scroll container can show. */
const visibleBand = (placement: CaptionPlacement, frame: SpotlightFrame): { top: number; bottom: number } => {
  const band = freeBand(placement, frame);
  if (!frame.clip) return band;
  return { top: Math.max(band.top, frame.clip.top), bottom: Math.min(band.bottom, frame.clip.bottom) };
};

const visibleHeight = (hole: Rect, band: { top: number; bottom: number }): number =>
  Math.max(0, Math.min(hole.top + hole.height, band.bottom) - Math.max(hole.top, band.top));

/**
 * Which edge the caption sits on: the one that leaves more of the spotlit anchor in view.
 *
 * Deciding from the space around the hole alone, without the caption's height, put a 273 px caption
 * below a hole whose top was at 167 on a 427 px screen, and the Radio tile it was describing was
 * entirely underneath. A tie keeps the bottom, where the caption has no hole to cover.
 */
export const captionPlacement = (hole: Rect | null, frame: SpotlightFrame): CaptionPlacement => {
  if (hole === null) return "bottom";
  const below = visibleHeight(hole, visibleBand("bottom", frame));
  const above = visibleHeight(hole, visibleBand("top", frame));
  return above > below ? "top" : "bottom";
};

/**
 * How far to scroll so the spotlit anchor sits in the band the caption leaves free.
 *
 * Positive scrolls the page down (content moves up). Zero when the hole already fits, including the
 * margin. A hole taller than the band is aligned by its top, so the reader sees where the thing
 * starts rather than an arbitrary slice of its middle.
 */
export const spotlightScrollDelta = (hole: Rect | null, placement: CaptionPlacement, frame: SpotlightFrame): number => {
  if (hole === null) return 0;
  const band = visibleBand(placement, frame);
  const top = band.top + SPOTLIGHT_MARGIN;
  const bottom = band.bottom - SPOTLIGHT_MARGIN;
  if (hole.top >= top && hole.top + hole.height <= bottom) return 0;
  if (hole.height > bottom - top) return Math.round(hole.top - top);
  if (hole.top < top) return Math.round(hole.top - top);
  return Math.round(hole.top + hole.height - bottom);
};
