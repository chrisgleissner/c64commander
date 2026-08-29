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

describe("transport bindings", () => {
  it("declares the three new semantic actions", () => {
    expect(SEMANTIC_ACTIONS).toContain("openSearch");
    expect(SEMANTIC_ACTIONS).toContain("mediaPlayPause");
    expect(SEMANTIC_ACTIONS).toContain("mediaNext");
  });

  it("resolves F1 and F3 to the transport in the keypad profile", () => {
    expect(findBinding(keypadProfile, press("F1"))?.action).toBe("mediaPlayPause");
    expect(findBinding(keypadProfile, press("F3"))?.action).toBe("mediaNext");
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
    expect(findBinding(keypadProfile, press("F1"))?.action).toBe("mediaPlayPause");
    expect(findBinding(keypadProfile, press("F3"))?.action).toBe("mediaNext");
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
