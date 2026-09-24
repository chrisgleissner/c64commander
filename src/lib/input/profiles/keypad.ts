/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Keypad profile for a D-pad + numeric keypad device, bound by DOM codes, never Android key codes
 * (17, 18, 20 and 82 are Ctrl, Alt, Caps Lock and R as DOM codes). An Android WebView delivers the
 * D-pad as Arrow keys, OK as Enter, and digits, ✱ and # by `key`; the native shell forwards the soft
 * keys and Menu as SoftLeft / SoftRight / ContextMenu. See docs/cta-inventory.md §1.
 */

import { mergeKeymaps, type KeyBinding } from "../keymap";
import { defaultKeyboardProfile } from "./defaultKeyboard";

const keypadBindings: KeyBinding[] = [
  // D-pad (named codes some hosts emit).
  { code: "DpadUp", action: "dpadUp" },
  { code: "DpadDown", action: "dpadDown" },
  { code: "DpadLeft", action: "dpadLeft" },
  { code: "DpadRight", action: "dpadRight" },
  { code: "DpadCenter", action: "center" },

  // Star / pound (named codes).
  { code: "Star", action: "star" },
  { code: "Pound", action: "hash" },

  // Soft keys.
  { code: "SoftLeft", action: "softLeft" },
  { code: "SoftRight", action: "softRight" },

  // Back / clear.
  { code: "GoBack", action: "back" },
  { code: "BrowserBack", action: "back" },

  // Call / send → primary activate.
  { code: "Call", action: "activate" },

  // Menu.
  { code: "ContextMenu", action: "openMenu" },

  // Function keys are deliberately neutral here. Their meaning belongs to the
  // owning context: normal navigation may run a persisted app assignment, while
  // C64 input surfaces relay literal F1/F3. Never make a raw mapping a transport
  // command, Back, or a soft key.
  { key: "F1", action: "function1" },
  { key: "F3", action: "function3" },
];

export const keypadProfile = mergeKeymaps(defaultKeyboardProfile, {
  id: "keypad",
  bindings: keypadBindings,
  timing: { multiTapTimeoutMs: 1000 },
});
