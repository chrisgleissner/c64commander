/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Each function here is written without outside references so the page expression can embed it with `toString()`.
 */

/** The part of a card that must be visible for the ring to count it as on screen, unless the card is shorter. */
export const MIN_VISIBLE_PX = 24;

/**
 * The visible area of every scrolling box that holds an element, clipped to the window: the page's scroll box on
 * a page with sticky chrome, and any list that scrolls inside it. Null when only the window scrolls.
 */
export const intersectScrollBoxes = (boxes, innerHeight) =>
  boxes.length === 0
    ? null
    : {
        top: Math.max(0, ...boxes.map((box) => box.top)),
        bottom: Math.min(innerHeight, ...boxes.map((box) => box.bottom)),
      };

/**
 * The height the app leaves for content around a selected card: the scroll box that holds it, or the window,
 * less the scroll margins the keypad anchor class reserves for the bars.
 */
export const usableViewHeight = (innerHeight, scrollBoxHeight, marginTop, marginBottom) =>
  (scrollBoxHeight === null ? innerHeight : Math.min(innerHeight, scrollBoxHeight)) - marginTop - marginBottom;

/**
 * A selected card counts as on screen when it is fully inside the scroll box that holds it (the window when the
 * window scrolls) or, for a card taller than the usable height, when its start is inside that box with enough of
 * it showing: the user then descends into it. The guidance bar lies over the bottom of a sticky page's box, so
 * `overlayBottom` is not part of what shows.
 */
export const stopIsInView = (rect, innerWidth, innerHeight, usableHeight, scrollBox, overlayBottom) => {
  const boxTop = scrollBox === null ? 0 : scrollBox.top;
  const boxBottom = scrollBox === null ? innerHeight : scrollBox.bottom - overlayBottom;
  const height = rect.bottom - rect.top;
  const visible = Math.min(rect.bottom, boxBottom) - Math.max(rect.top, boxTop);
  return (
    rect.top >= boxTop - 1 &&
    rect.left >= -1 &&
    rect.right <= innerWidth + 1 &&
    (rect.bottom <= boxBottom + 1 || (height > usableHeight - 1 && visible >= Math.min(MIN_VISIBLE_PX, height)))
  );
};
