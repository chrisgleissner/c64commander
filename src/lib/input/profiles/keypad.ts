/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Generic keypad profile for a D-pad + numeric keypad device (NOT validated on
 * specific hardware; the exact KeyboardEvent codes a given Android WebView host
 * surfaces for these keys vary, so each key is bound by several plausible
 * aliases).
 *
 * Physical key → semantic action:
 *   D-pad up/down/left/right → dpadUp/Down/Left/Right
 *     (codes: Dpad*, Arrow* inherited from the desktop base, legacy keyCodes)
 *   D-pad center / OK        → center        (Android KEYCODE_DPAD_CENTER = 23)
 *   Numeric keypad 0–9       → digit0–9      (T9 source; inherited + Numpad)
 *   ✱ (star)                 → star          (KEYCODE_STAR = 17 / key "*")
 *   # (pound)                → hash          (KEYCODE_POUND = 18 / key "#")
 *   Left/right soft keys     → softLeft / softRight (SoftLeft/SoftRight, F1/F2)
 *   Back / Clear             → back          (KEYCODE_BACK = 4 / GoBack / Escape)
 *   Call / Send              → activate      (KEYCODE_CALL = 5)
 *   Menu                     → openMenu      (KEYCODE_MENU / ContextMenu)
 *
 * A slightly longer multi-tap window suits a physical keypad.
 */

import { mergeKeymaps, type KeyBinding } from "../keymap";
import { defaultKeyboardProfile } from "./defaultKeyboard";

const keypadBindings: KeyBinding[] = [
  // D-pad (named codes some WebViews emit, plus Android KEYCODE_DPAD_* legacy codes).
  { code: "DpadUp", action: "dpadUp" },
  { code: "DpadDown", action: "dpadDown" },
  { code: "DpadLeft", action: "dpadLeft" },
  { code: "DpadRight", action: "dpadRight" },
  { code: "DpadCenter", action: "center" },
  { keyCode: 19, action: "dpadUp" },
  { keyCode: 20, action: "dpadDown" },
  { keyCode: 21, action: "dpadLeft" },
  { keyCode: 22, action: "dpadRight" },
  { keyCode: 23, action: "center" },

  // Star / pound (named codes + Android legacy keyCodes).
  { code: "Star", action: "star" },
  { keyCode: 17, action: "star" },
  { code: "Pound", action: "hash" },
  { keyCode: 18, action: "hash" },

  // Soft keys.
  { code: "SoftLeft", action: "softLeft" },
  { code: "SoftRight", action: "softRight" },
  { keyCode: 1, action: "softLeft" },
  { keyCode: 2, action: "softRight" },

  // Back / clear.
  { code: "GoBack", action: "back" },
  { code: "BrowserBack", action: "back" },
  { keyCode: 4, action: "back" },

  // Call / send → primary activate.
  { code: "Call", action: "activate" },
  { keyCode: 5, action: "activate" },

  // Menu.
  { code: "ContextMenu", action: "openMenu" },
  { keyCode: 82, action: "openMenu" },
];

export const keypadProfile = mergeKeymaps(defaultKeyboardProfile, {
  id: "keypad",
  bindings: keypadBindings,
  timing: { multiTapTimeoutMs: 1000 },
});
