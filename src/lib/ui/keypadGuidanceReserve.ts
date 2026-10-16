/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** Dispatched on `window` when the guidance bar or the toast strip changes the height reserved at the bottom. */
export const KEYPAD_GUIDANCE_RESERVE_EVENT = "c64u:keypad-guidance-reserve";

/**
 * The height, in CSS px, of the keypad guidance bar while it shows, else 0. Measured, because
 * `--keypad-guidance-reserved-height` holds an unresolved calc() expression.
 */
export const readKeypadGuidanceReservePx = (): number => {
  if (typeof document === "undefined") return 0;
  const reserved = document.documentElement.style.getPropertyValue("--keypad-guidance-reserved-height").trim();
  if (reserved === "" || reserved === "0px") return 0;
  const bar = document.querySelector<HTMLElement>('[data-testid="keypad-guidance-bar"][data-visible="true"]');
  return bar ? bar.getBoundingClientRect().height : 0;
};

/** What a dialog or menu stands on, in CSS px: the guidance bar while it shows and the toast strip above it. */
export const readBottomOverlayReservePx = (): number => {
  if (typeof document === "undefined") return readKeypadGuidanceReservePx();
  const toastStrip = Number.parseFloat(document.documentElement.style.getPropertyValue("--app-toast-reserved-height"));
  return readKeypadGuidanceReservePx() + (Number.isFinite(toastStrip) ? toastStrip : 0);
};
