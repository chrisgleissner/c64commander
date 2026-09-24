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
  readonly viewportHeight: number;
  /** The space the keypad scroll anchor reserves for the app bar above and the bars below. */
  readonly marginTop: number;
  readonly marginBottom: number;
};

/**
 * Where to align a ring stop the app has just moved to.
 *
 * `nearest` does nothing once the element's top is on screen, so a card whose bottom sat below the
 * area the app reserves stayed half shown: Home's Streams card is 262 px inside a 289 px area and
 * was selected with 31 px of it under the tab bar. A card that does not fit that area cannot be
 * shown whole, and there `nearest` is right — the user descends into it to see the rest.
 */
export const resolveRingScrollAlignment = (geometry: RingScrollGeometry): ScrollLogicalPosition => {
  const reserved = geometry.marginTop + geometry.marginBottom;
  const fitsInReservedArea = geometry.height <= geometry.viewportHeight - reserved;
  const belowReservedArea = geometry.bottom > geometry.viewportHeight - geometry.marginBottom;
  if (fitsInReservedArea) return belowReservedArea ? "end" : "nearest";
  // A tall card reached from below, or by Back from a control inside it, has its heading above the
  // app bar, and `nearest` leaves it there because part of the card is already on screen.
  return geometry.top < geometry.marginTop ? "start" : "nearest";
};
