/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type OpenAutoFocusEvent = Event & {
  currentTarget: EventTarget | null;
};

type OpenAutoFocusHandler = (event: OpenAutoFocusEvent) => void;

const focusInterstitialSurface = (event: OpenAutoFocusEvent) => {
  const currentTarget = event.currentTarget;
  if (!(currentTarget instanceof HTMLElement)) return;

  currentTarget.focus({ preventScroll: true });
};

export const composeInterstitialOpenAutoFocus =
  (handler?: OpenAutoFocusHandler): OpenAutoFocusHandler =>
  (event: OpenAutoFocusEvent) => {
    handler?.(event);
    if (event.defaultPrevented) return;

    event.preventDefault();
    focusInterstitialSurface(event);
  };
