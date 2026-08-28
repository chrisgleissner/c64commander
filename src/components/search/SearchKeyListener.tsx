/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect } from "react";
import { isAnyOverlayOpen, isEditableTarget } from "@/lib/input/eventTargets";
import { isCapturingKeyBinding } from "@/lib/input/keyCaptureState";
import { keypadProfile } from "@/lib/input/profiles/keypad";
import { findBinding } from "@/lib/input/keyEvent";
import { requestSearchOpen } from "@/lib/search/overlayState";

/**
 * The search key, on its own listener (spec.md D11 and section 9.1).
 *
 * NOT part of the keypad shortcut handler. That handler lives inside FocusNavigationProvider, which
 * App mounts with `enabled={flags.keypad_input_enabled}`, so putting the search key there would make
 * it vanish for anyone who turns keypad navigation off — and search is the way around the app for
 * exactly the people most likely to have done so.
 *
 * `7` is free only while there are six tabs. `SearchKeyListener.test.tsx` asserts TAB_ROUTES.length
 * < 7, so adding a seventh tab fails the tests rather than silently stealing the search key.
 */

/** Digits 1-6 jump to a tab; 7 is the first one that means nothing else. */
export const SEARCH_DIGIT_ACTION = "digit7";

export const SearchKeyListener = () => {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      /*
       * The same two exclusions the digit shortcuts apply: a text field owns its digits for T9, and
       * an open overlay owns the keyboard. Plus one more.
       *
       * Something is waiting for a key so it can record which one. Game Mode's joystick binder is
       * an inline settings block rather than a Radix overlay, so `isAnyOverlayOpen` does not see
       * it, and `event.defaultPrevented` cannot help either: both listen on the capture phase of
       * window and this one is registered at the app root, so it runs first. Pressing 7 while
       * capturing a slot bound the slot AND dropped the search overlay over Settings.
       */
      if (isEditableTarget(event.target)) return;
      if (isAnyOverlayOpen()) return;
      if (isCapturingKeyBinding()) return;

      const binding = findBinding(keypadProfile, event);
      // `openSearch` is what the Commodore key will resolve to once its emitted code is known; it
      // is unbound today, and binding it is then a single row in profiles/keypad.ts.
      if (binding?.action !== SEARCH_DIGIT_ACTION && binding?.action !== "openSearch") return;

      event.preventDefault();
      requestSearchOpen({ source: "key" });
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return null;
};
