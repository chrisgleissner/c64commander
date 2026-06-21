/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  digitForAction,
  isDigitAction,
  normalizeKeyEvent,
  resolveSemanticAction,
  type KeyEventLike,
  type SemanticAction,
} from "@/lib/input/keyEvent";
import { defaultKeyboardProfile, keypadProfile } from "@/lib/input/profiles";

const ev = (partial: Partial<KeyEventLike> & { code?: string; key?: string }): KeyEventLike => ({
  key: partial.key ?? "",
  code: partial.code ?? "",
  keyCode: partial.keyCode,
  repeat: partial.repeat,
  altKey: partial.altKey,
  ctrlKey: partial.ctrlKey,
  metaKey: partial.metaKey,
  shiftKey: partial.shiftKey,
});

describe("digit helpers", () => {
  it("identifies digit actions and extracts their value", () => {
    expect(isDigitAction("digit7")).toBe(true);
    expect(isDigitAction("star")).toBe(false);
    expect(digitForAction("digit7")).toBe(7);
    expect(digitForAction("digit0")).toBe(0);
    expect(digitForAction("enter")).toBeNull();
  });
});

describe("defaultKeyboard profile", () => {
  const resolve = (partial: Parameters<typeof ev>[0]): SemanticAction | null =>
    resolveSemanticAction(defaultKeyboardProfile, ev(partial));

  it("maps arrow keys to the d-pad", () => {
    expect(resolve({ code: "ArrowUp" })).toBe("dpadUp");
    expect(resolve({ code: "ArrowDown" })).toBe("dpadDown");
    expect(resolve({ code: "ArrowLeft" })).toBe("dpadLeft");
    expect(resolve({ code: "ArrowRight" })).toBe("dpadRight");
  });

  it("maps Tab and Shift+Tab to next/previous field", () => {
    expect(resolve({ code: "Tab", shiftKey: false })).toBe("nextField");
    expect(resolve({ code: "Tab", shiftKey: true })).toBe("previousField");
  });

  it("maps digits from the main and numpad rows", () => {
    expect(resolve({ code: "Digit5", key: "5" })).toBe("digit5");
    expect(resolve({ code: "Numpad5", key: "5" })).toBe("digit5");
    expect(resolve({ code: "Digit0", key: "0" })).toBe("digit0");
  });

  it("maps digits by legacy keyCode when the Android WebView gives an empty code", () => {
    // A keypad device / Android WebView delivers number keys as { code: "", keyCode: 48–57 }.
    expect(resolve({ code: "", key: "5", keyCode: 53 })).toBe("digit5");
    expect(resolve({ code: "", key: "0", keyCode: 48 })).toBe("digit0");
    expect(resolve({ code: "", key: "9", keyCode: 57 })).toBe("digit9");
  });

  it("maps Backspace/Enter/Escape/Space", () => {
    expect(resolve({ code: "Backspace" })).toBe("delete");
    expect(resolve({ code: "Enter" })).toBe("enter");
    expect(resolve({ code: "NumpadEnter" })).toBe("enter");
    expect(resolve({ code: "Escape" })).toBe("escape");
    expect(resolve({ code: "Space" })).toBe("center");
  });

  it("maps star and hash by key, beating the digit binding for Shift+8", () => {
    expect(resolve({ code: "Digit8", key: "*", shiftKey: true })).toBe("star");
    expect(resolve({ code: "Digit8", key: "8" })).toBe("digit8");
    expect(resolve({ code: "NumpadMultiply", key: "*" })).toBe("star");
    expect(resolve({ code: "Digit3", key: "#", shiftKey: true })).toBe("hash");
  });

  it("maps soft keys and toggleInputMode", () => {
    expect(resolve({ code: "F1" })).toBe("softLeft");
    expect(resolve({ code: "F2" })).toBe("softRight");
    expect(resolve({ code: "F3" })).toBe("toggleInputMode");
    expect(resolve({ code: "ContextMenu" })).toBe("openMenu");
  });

  it("falls back to legacy keyCode when code is unavailable", () => {
    expect(resolve({ code: "", keyCode: 8 })).toBe("delete");
    expect(resolve({ code: "", keyCode: 38 })).toBe("dpadUp");
    expect(resolve({ code: "", key: "Enter", keyCode: 13 })).toBe("enter");
    expect(resolve({ code: "", key: " ", keyCode: 32 })).toBe("center");
    expect(resolve({ code: "", key: "Escape", keyCode: 27 })).toBe("escape");
    expect(resolve({ code: "", key: "Tab", keyCode: 9, shiftKey: false })).toBe("nextField");
    expect(resolve({ code: "", key: "Tab", keyCode: 9, shiftKey: true })).toBe("previousField");
  });

  it("returns null for unbound keys", () => {
    expect(resolve({ code: "KeyZ", key: "z" })).toBeNull();
  });
});

describe("keypad profile", () => {
  const resolve = (partial: Parameters<typeof ev>[0]): SemanticAction | null =>
    resolveSemanticAction(keypadProfile, ev(partial));

  it("maps the d-pad and center", () => {
    expect(resolve({ code: "DpadUp" })).toBe("dpadUp");
    expect(resolve({ code: "DpadCenter" })).toBe("center");
    expect(resolve({ keyCode: 23 })).toBe("center");
  });

  it("maps star/hash/soft keys/back/call/menu", () => {
    expect(resolve({ code: "Star" })).toBe("star");
    expect(resolve({ keyCode: 17 })).toBe("star");
    expect(resolve({ code: "Pound" })).toBe("hash");
    expect(resolve({ code: "SoftLeft" })).toBe("softLeft");
    expect(resolve({ code: "SoftRight" })).toBe("softRight");
    expect(resolve({ code: "GoBack" })).toBe("back");
    expect(resolve({ keyCode: 4 })).toBe("back");
    expect(resolve({ code: "Call" })).toBe("activate");
    expect(resolve({ keyCode: 82 })).toBe("openMenu");
  });

  it("inherits desktop bindings from the base profile", () => {
    expect(resolve({ code: "ArrowUp" })).toBe("dpadUp");
    expect(resolve({ code: "Digit3", key: "3" })).toBe("digit3");
    expect(resolve({ code: "Tab", shiftKey: true })).toBe("previousField");
  });
});

describe("normalizeKeyEvent", () => {
  it("returns the resolved action plus normalized modifiers", () => {
    const normalized = normalizeKeyEvent(
      ev({ code: "Tab", key: "Tab", shiftKey: true, repeat: true }),
      defaultKeyboardProfile,
    );
    expect(normalized.action).toBe("previousField");
    expect(normalized.code).toBe("Tab");
    expect(normalized.repeat).toBe(true);
    expect(normalized.modifiers).toEqual({ alt: false, ctrl: false, meta: false, shift: true });
  });

  it("yields a null action for unbound keys", () => {
    expect(normalizeKeyEvent(ev({ code: "KeyQ", key: "q" }), defaultKeyboardProfile).action).toBeNull();
  });
});
