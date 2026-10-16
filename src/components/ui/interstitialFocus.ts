/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { FIELD_FRAME_ATTR } from "@/lib/input/ringDom";

type OpenAutoFocusEvent = Event & {
  currentTarget: EventTarget | null;
};

type OpenAutoFocusHandler = (event: OpenAutoFocusEvent) => void;

/**
 * Marks the control a dialog opens on. A destructive confirmation marks its Cancel button, so a
 * keypad user who presses OK twice dismisses the dialog instead of running the action.
 */
export const OPEN_FOCUS_ATTR = "data-open-focus";

const focusInterstitialSurface = (event: OpenAutoFocusEvent) => {
  const currentTarget = event.currentTarget;
  if (!(currentTarget instanceof HTMLElement)) return;

  const marked = currentTarget.querySelector<HTMLElement>(`[${OPEN_FOCUS_ATTR}]`);
  (marked ?? currentTarget).focus({ preventScroll: true });
};

export const composeInterstitialOpenAutoFocus =
  (handler?: OpenAutoFocusHandler): OpenAutoFocusHandler =>
  (event: OpenAutoFocusEvent) => {
    handler?.(event);
    if (event.defaultPrevented) return;

    event.preventDefault();
    focusInterstitialSurface(event);
  };

/**
 * Escape, which is also the keypad's Back, while a field frame's input is being edited returns to the
 * frame and keeps the dialog open, as it does on a page; the next Escape closes the dialog. Radix
 * closes a dialog on Escape from the document, before the input's own handler sees the key, so the
 * New disk dialog closed and lost a half-typed Tracks value.
 */
export const composeFieldFrameEscape =
  (handler?: (event: KeyboardEvent) => void) =>
  (event: KeyboardEvent): void => {
    const field = event.target;
    const frame = field instanceof HTMLElement ? field.closest<HTMLElement>(`[${FIELD_FRAME_ATTR}]`) : null;
    if (frame && frame !== field) {
      event.preventDefault();
      (field as HTMLElement).blur();
      frame.focus();
      return;
    }
    handler?.(event);
  };
