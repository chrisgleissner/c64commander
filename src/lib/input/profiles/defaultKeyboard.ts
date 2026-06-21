/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Default desktop / developer keyboard profile.
 *
 * Lets the whole keypad-first UX be exercised on a normal keyboard:
 *   Arrows        → dpadUp/Down/Left/Right        Enter        → enter
 *   Space         → center (primary activate)     Tab          → nextField
 *   Shift+Tab     → previousField                 Backspace    → delete
 *   Escape        → escape                        Digit/Numpad → digit0–9
 *   * (or Numpad*)→ star                          # (key)      → hash
 *   F1 / F2       → softLeft / softRight          F3           → toggleInputMode
 *   ContextMenu   → openMenu
 *
 * Ordering matters: symbol bindings keyed by `key` ("*"/"#") are declared
 * before the `code`-based digit bindings so that Shift+8 (key "*") resolves to
 * `star` rather than `digit8`.
 */

import { defineKeymap, type KeyBinding } from "../keymap";

const symbolBindings: KeyBinding[] = [
  { key: "*", action: "star" },
  { code: "NumpadMultiply", action: "star" },
  { key: "#", action: "hash" },
];

const navigationBindings: KeyBinding[] = [
  { code: "ArrowUp", action: "dpadUp" },
  { code: "ArrowDown", action: "dpadDown" },
  { code: "ArrowLeft", action: "dpadLeft" },
  { code: "ArrowRight", action: "dpadRight" },
  { keyCode: 38, action: "dpadUp" },
  { keyCode: 40, action: "dpadDown" },
  { keyCode: 37, action: "dpadLeft" },
  { keyCode: 39, action: "dpadRight" },
  { code: "Space", action: "center" },
  { keyCode: 32, action: "center" },
  { code: "Enter", action: "enter" },
  { code: "NumpadEnter", action: "enter" },
  { keyCode: 13, action: "enter" },
  { code: "Tab", shift: false, action: "nextField" },
  { code: "Tab", shift: true, action: "previousField" },
  { keyCode: 9, shift: false, action: "nextField" },
  { keyCode: 9, shift: true, action: "previousField" },
  { code: "Backspace", action: "delete" },
  { keyCode: 8, action: "delete" },
  { code: "Delete", action: "delete" },
  { code: "Escape", action: "escape" },
  { keyCode: 27, action: "escape" },
  { code: "F1", action: "softLeft" },
  { code: "F2", action: "softRight" },
  { code: "F3", action: "toggleInputMode" },
  { code: "ContextMenu", action: "openMenu" },
];

const digitBindings: KeyBinding[] = Array.from({ length: 10 }, (_unused, digit) => [
  { code: `Digit${digit}`, action: `digit${digit}` as KeyBinding["action"] },
  { code: `Numpad${digit}`, action: `digit${digit}` as KeyBinding["action"] },
]).flat();

export const defaultKeyboardProfile = defineKeymap({
  id: "defaultKeyboard",
  bindings: [...symbolBindings, ...navigationBindings, ...digitBindings],
});
