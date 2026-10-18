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

const KEYPAD_DIGIT_INPUT_MODES = new Set(["numeric", "decimal", "tel"]);

/** A number field takes the keypad's digits as they are, so it needs no input method either. */
const isKeypadDigitField = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement &&
  !target.readOnly &&
  !target.disabled &&
  (target.type === "number" || target.type === "tel" || KEYPAD_DIGIT_INPUT_MODES.has(target.inputMode));

export const keepPlatformInputMethodAway = (target: EventTarget | null): void => {
  // A text-like inputmode a field set for itself still summons the platform's multi-tap, and a
  // numeric one summons its keyboard, which halved the screen in a dialog; both give way.
  if (!hardwareKeypadUsed) return;
  if (isKeypadDigitField(target)) {
    // With its numeric inputmode gone the field would read as a text field; the keypad's digits
    // must still type digits, not cycle letters.
    target.dataset.t9 = "off";
    target.setAttribute("inputmode", "none");
    return;
  }
  if (isT9Field(target)) target.setAttribute("inputmode", "none");
};

/**
 * Withholds the input method before ANY programmatic focus of a field, not only the ring's own.
 *
 * Radix focus scopes, field frames and dialog autofocus call `focus()` themselves, and the
 * `focusin` that follows is too late: the platform has already decided to open its keyboard.
 */
export const installInputMethodFocusGuard = (): (() => void) => {
  const original = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function guardedFocus(this: HTMLElement, options?: FocusOptions) {
    keepPlatformInputMethodAway(this);
    original.call(this, options);
  };
  return () => {
    HTMLElement.prototype.focus = original;
  };
};

export const resetHardwareKeypadUseForTests = (): void => {
  hardwareKeypadUsed = false;
};
