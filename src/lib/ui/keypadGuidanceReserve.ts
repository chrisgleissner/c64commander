/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The height, in CSS px, of the keypad guidance bar while it is showing, else 0.
 *
 * The bar sits over everything at the bottom of the screen, dialogs included, so a surface placed
 * against the bottom edge has to leave this much free. Measured rather than read from
 * `--keypad-guidance-reserved-height`: that property holds an unresolved calc() expression.
 */
export const readKeypadGuidanceReservePx = (): number => {
  if (typeof document === "undefined") return 0;
  const reserved = document.documentElement.style.getPropertyValue("--keypad-guidance-reserved-height").trim();
  if (reserved === "" || reserved === "0px") return 0;
  const bar = document.querySelector<HTMLElement>('[data-testid="keypad-guidance-bar"][data-visible="true"]');
  return bar ? bar.getBoundingClientRect().height : 0;
};
