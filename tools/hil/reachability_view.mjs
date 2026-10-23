/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The height the app leaves for content around a selected card: the scroll box that holds it when a page has
 * sticky chrome, else the window less the scroll margins the keypad anchor class reserves for the bars.
 * Written without outside references so it can be embedded in the page expression with `toString()`.
 */
export const usableViewHeight = (innerHeight, scrollBoxHeight, marginTop, marginBottom) =>
  scrollBoxHeight === null ? innerHeight - marginTop - marginBottom : Math.min(innerHeight, scrollBoxHeight);

/**
 * A selected card counts as on screen when it is fully inside the scroll box that holds it (the window when the
 * window scrolls) or, for a card taller than the usable height, when its start is inside that box: the user then
 * descends into it. A start behind the bars below the box does not count. Also embedded in the page.
 */
export const stopIsInView = (rect, innerWidth, innerHeight, usableHeight, scrollBox) => {
  const boxTop = scrollBox === null ? 0 : scrollBox.top;
  const boxBottom = scrollBox === null ? innerHeight : scrollBox.bottom;
  return (
    rect.top >= boxTop - 1 &&
    rect.top < boxBottom &&
    rect.left >= -1 &&
    rect.right <= innerWidth + 1 &&
    (rect.bottom <= boxBottom + 1 || rect.bottom - rect.top > usableHeight - 1)
  );
};
