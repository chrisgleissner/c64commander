/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { SEMANTIC_ACTIONS, findBinding } from "@/lib/input/keyEvent";
import { defaultKeyboardProfile } from "@/lib/input/profiles/defaultKeyboard";
import { keypadProfile } from "@/lib/input/profiles/keypad";

const press = (code: string) => ({ key: code, code, keyCode: 0, shiftKey: false, altKey: false, ctrlKey: false });

describe("function-key bindings", () => {
  it("declares neutral function actions without inheriting transport semantics", () => {
    expect(SEMANTIC_ACTIONS).toContain("openSearch");
    expect(SEMANTIC_ACTIONS).toContain("mediaPlayPause");
    expect(SEMANTIC_ACTIONS).toContain("mediaNext");
    expect(SEMANTIC_ACTIONS).toContain("function1");
    expect(SEMANTIC_ACTIONS).toContain("function3");
  });

  it("resolves F1 and F3 to neutral function actions in the keypad profile", () => {
    expect(findBinding(keypadProfile, press("F1"))?.action).toBe("function1");
    expect(findBinding(keypadProfile, press("F3"))?.action).toBe("function3");
  });

  /*
   * How the handset actually sends these. Measured on the rig: F1, F2 and F3 reach the WebView as
   * `{key:"F1", code:"", keyCode:112}` and so on. The helper above sets `key` and `code` to the
   * same string, so it matched a `code` binding and a `key` binding alike and could not tell that
   * neither transport shortcut fired on the device.
   */
  it("resolves function keys as the handset sends them, with no code", () => {
    const fromHandset = (key: string, keyCode: number) => ({
      key,
      code: "",
      keyCode,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
    });

    expect(findBinding(keypadProfile, fromHandset("F1", 112))?.action).toBe("function1");
    expect(findBinding(keypadProfile, fromHandset("F3", 114))?.action).toBe("function3");
  });

  /*
   * The desktop profile still declares its own F1 and F3, but nothing selects it: the app mounts
   * FocusNavigationProvider once with profileId="keypad" and has no runtime selector, so the
   * keypad profile shadows both everywhere. This asserted the declaration and was read as proving
   * a desktop keyboard keeps them, which it does not — the comment above it said exactly that.
   * It is worth keeping only as a record of what the base profile holds for when a selector exists.
   */
  it("keeps F1 and F3 in the desktop profile, which nothing selects yet", () => {
    expect(findBinding(defaultKeyboardProfile, press("F1"))?.action).toBe("softLeft");
    expect(findBinding(defaultKeyboardProfile, press("F3"))?.action).toBe("toggleInputMode");
    // What actually resolves today, on every platform.
    expect(findBinding(keypadProfile, press("F1"))?.action).toBe("function1");
    expect(findBinding(keypadProfile, press("F3"))?.action).toBe("function3");
  });

  it("leaves the Commodore key unbound rather than guessing at a code", () => {
    // Section 9.3: a guessed real code would shadow a key that already works. No binding in either
    // profile names openSearch, so nothing has been guessed at.
    for (const profile of [keypadProfile, defaultKeyboardProfile]) {
      expect(profile.bindings.some((binding) => binding.action === "openSearch")).toBe(false);
    }
  });

  /*
   * useFocusNavigation recognises the Android hardware Back button as
   * { key: "Escape", code: "", keyCode: 0 }. A binding declared with keyCode 0 would match it and
   * silently steal Back on every keypad handset.
   */
  it("binds nothing to keyCode 0", () => {
    for (const profile of [keypadProfile, defaultKeyboardProfile]) {
      expect(profile.bindings.filter((binding) => binding.keyCode === 0)).toEqual([]);
    }
  });
});
