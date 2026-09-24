/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Keypad profile for a D-pad + numeric keypad device.
 *
 * Bindings are DOM key codes, never Android key codes. Measured in an Android WebView:
 *   D-pad up/down/left/right → ArrowUp/Down/Left/Right (inherited from the desktop base)
 *   D-pad center / OK        → Enter, keyCode 13 (inherited)
 *   Numeric keypad 0–9       → key "0"–"9", code "" (inherited digit fallbacks)
 *   ✱ / #                    → key "*" / "#", keyCode 0 (inherited)
 *   Soft keys, Menu          → forwarded by the native shell as SoftLeft / SoftRight /
 *                              ContextMenu, because the WebView reports the soft keys as
 *                              "Unidentified" and drops Menu
 *   Back                     → reaches Capacitor, not the page; see `deviceBackButton`
 *
 * The named codes below cover hosts that report them. Android key codes (17 = ✱, 82 = Menu, ...)
 * are not bound: as DOM key codes they mean Ctrl, Alt, Caps Lock, R and so on, so on a hardware
 * keyboard Ctrl opened Diagnostics and R opened the quick menu.
 *
 * A slightly longer multi-tap window suits a physical keypad.
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
