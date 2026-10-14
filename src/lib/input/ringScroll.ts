/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type RingScrollGeometry = {
  readonly top: number;
  readonly bottom: number;
  readonly height: number;
  /** The visible edges of the element's scroll container, in the same coordinates as `top` and `bottom`. */
  readonly scrollportTop: number;
  readonly scrollportBottom: number;
  /** The scroll margins the keypad scroll anchor reserves inside that container for the bars over it. */
  readonly marginTop: number;
  readonly marginBottom: number;
};

/**
 * Where to align a ring stop the app has just moved to.
 *
 * `nearest` does nothing once the element's top is on screen, so a card whose bottom sat below the
 * area the app reserves stayed half shown: Home's Streams card is 262 px inside a 289 px area and
 * was selected with 31 px of it under the tab bar. A card that does not fit that area cannot be
 * shown whole, so its top is aligned and the user descends into it to see the rest.
 *
 * The area is measured inside the scroll container, because `scrollIntoView` applies the margins
 * there. Measured against the window, a page scrolled by a container that starts below the app bar
 * looked one app bar taller than it is: a 314 px card was judged to fit, aligned by its end, and
 * left with its top edge under the app bar.
 */
export const resolveRingScrollAlignment = (geometry: RingScrollGeometry): ScrollLogicalPosition => {
  const areaTop = geometry.scrollportTop + geometry.marginTop;
  const areaBottom = geometry.scrollportBottom - geometry.marginBottom;
  if (geometry.height > areaBottom - areaTop) return "start";
  return geometry.bottom > areaBottom ? "end" : "nearest";
};
