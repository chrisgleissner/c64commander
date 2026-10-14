/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { isEditableTarget } from "@/lib/input/eventTargets";
import { isNativePlatform } from "@/lib/native/platform";
import { isT9Field } from "@/lib/input/t9FieldComposer";

/**
 * Keeps the platform input method out of text fields once a hardware keypad has been used.
 *
 * On one keypad handset the platform's own multi-tap ended its composition after every press, so
 * a repeated key typed a new letter each time ("hubbard" became "Httaabapqd"). A field that asks
 * for no input method receives the raw digits instead, and the app's own T9 composes them.
 *
 * Only a navigation key pressed outside a text field counts as the keypad: a touch phone sends none,
 * and the arrow keys some soft keyboards show only ever arrive inside a field. On a native build the
 * shell must also have reported a built-in keypad, so a Bluetooth gamepad or keyboard, which is
 * external, never takes the soft keyboard away from a touch phone.
 */
export const BUILT_IN_KEYPAD_SESSION_KEY = "c64.builtInKeypad";
const NAVIGATION_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
const IME_COMPOSITION_KEY_CODE = 229;

let hardwareKeypadUsed = false;

export const noteHardwareKeypadKey = (event: KeyboardEvent): void => {
  if (!NAVIGATION_KEYS.has(event.key)) return;
  if (event.keyCode === IME_COMPOSITION_KEY_CODE || isEditableTarget(event.target)) return;
  if (isNativePlatform() && sessionStorage.getItem(BUILT_IN_KEYPAD_SESSION_KEY) !== "1") return;
  hardwareKeypadUsed = true;
};

export const keepPlatformInputMethodAway = (target: EventTarget | null): void => {
  if (!hardwareKeypadUsed || !isT9Field(target) || target.hasAttribute("inputmode")) return;
  target.setAttribute("inputmode", "none");
};

export const resetHardwareKeypadUseForTests = (): void => {
  hardwareKeypadUsed = false;
};
