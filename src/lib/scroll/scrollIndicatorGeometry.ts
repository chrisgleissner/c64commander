/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** Shortest thumb drawn, so a very long page still shows a mark that can be seen and followed. */
export const SCROLL_INDICATOR_MIN_THUMB_PX = 24;

/** Content within this many pixels of the viewport height fits; sub-pixel rounding is not overflow. */
const FITS_TOLERANCE_PX = 1;

export type ScrollMetrics = {
  readonly scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
};

export type ScrollIndicatorThumb = {
  readonly visible: boolean;
  readonly thumbHeight: number;
  readonly thumbOffset: number;
};

const HIDDEN: ScrollIndicatorThumb = { visible: false, thumbHeight: 0, thumbOffset: 0 };

/**
 * A proportional thumb on a track of `trackHeight`: its height is the share of the content the
 * viewport shows, and its offset is how far through the scroll range the viewport is.
 */
export const computeScrollIndicatorThumb = (
  { scrollTop, scrollHeight, clientHeight }: ScrollMetrics,
  trackHeight: number,
  minThumbPx = SCROLL_INDICATOR_MIN_THUMB_PX,
): ScrollIndicatorThumb => {
  const scrollRange = scrollHeight - clientHeight;
  if (scrollRange <= FITS_TOLERANCE_PX || clientHeight <= 0 || trackHeight <= 0) return HIDDEN;
  const thumbHeight = Math.min(trackHeight, Math.max(minThumbPx, (trackHeight * clientHeight) / scrollHeight));
  const progress = Math.min(Math.max(scrollTop / scrollRange, 0), 1);
  return { visible: true, thumbHeight, thumbOffset: (trackHeight - thumbHeight) * progress };
};
