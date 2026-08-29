/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Whether something is currently waiting for the user to press a key so it can record which one.
 *
 * Global shortcuts must stand aside while that is true. Game Mode's joystick binder is an inline
 * settings block rather than a Radix overlay, so `isAnyOverlayOpen` does not see it, and it cannot
 * rely on `event.defaultPrevented` either: both it and the search key listen on the capture phase
 * of `window`, and the search listener is registered at the app root and therefore runs first.
 * Pressing 7 while capturing a slot bound the slot AND dropped the search overlay over Settings.
 */
let capturing = 0;

export const beginKeyCapture = (): (() => void) => {
  capturing += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    capturing = Math.max(0, capturing - 1);
  };
};

export const isCapturingKeyBinding = (): boolean => capturing > 0;
