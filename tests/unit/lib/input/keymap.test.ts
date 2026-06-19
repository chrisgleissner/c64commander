/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { DEFAULT_MULTITAP_TIMEOUT_MS, defineKeymap, mergeKeymaps } from "@/lib/input/keymap";
import { resolveSemanticAction } from "@/lib/input/keyEvent";
import { DEFAULT_INPUT_PROFILE_ID, INPUT_PROFILES, INPUT_PROFILE_IDS, resolveInputProfile } from "@/lib/input/profiles";

describe("defineKeymap", () => {
  it("applies the default multi-tap timeout when unspecified", () => {
    const keymap = defineKeymap({ id: "test", bindings: [{ code: "Enter", action: "enter" }] });
    expect(keymap.timing.multiTapTimeoutMs).toBe(DEFAULT_MULTITAP_TIMEOUT_MS);
    expect(keymap.id).toBe("test");
  });

  it("respects an explicit timeout", () => {
    const keymap = defineKeymap({ id: "test", bindings: [], timing: { multiTapTimeoutMs: 1234 } });
    expect(keymap.timing.multiTapTimeoutMs).toBe(1234);
  });
});

describe("mergeKeymaps", () => {
  const base = defineKeymap({
    id: "base",
    bindings: [
      { code: "Enter", action: "enter" },
      { code: "Escape", action: "escape" },
    ],
    timing: { multiTapTimeoutMs: 500 },
  });

  it("prepends override bindings so they win, and inherits timing", () => {
    const merged = mergeKeymaps(base, {
      id: "merged",
      bindings: [{ code: "Escape", action: "back" }],
    });
    expect(merged.id).toBe("merged");
    // Override of Escape -> back beats the base Escape -> escape.
    expect(resolveSemanticAction(merged, { key: "", code: "Escape" })).toBe("back");
    // Untouched base binding still resolves.
    expect(resolveSemanticAction(merged, { key: "", code: "Enter" })).toBe("enter");
    expect(merged.timing.multiTapTimeoutMs).toBe(500);
  });

  it("can override the timing", () => {
    const merged = mergeKeymaps(base, { timing: { multiTapTimeoutMs: 999 } });
    expect(merged.timing.multiTapTimeoutMs).toBe(999);
    expect(merged.id).toBe("base");
  });
});

describe("profile registry", () => {
  it("exposes both profiles by id", () => {
    expect(INPUT_PROFILE_IDS).toEqual(["defaultKeyboard", "keypad"]);
    expect(INPUT_PROFILES.defaultKeyboard.id).toBe("defaultKeyboard");
    expect(INPUT_PROFILES.keypad.id).toBe("keypad");
  });

  it("resolves a known id and falls back to the default for unknown/undefined", () => {
    expect(resolveInputProfile("keypad").id).toBe("keypad");
    expect(resolveInputProfile(undefined).id).toBe(DEFAULT_INPUT_PROFILE_ID);
    expect(resolveInputProfile("does-not-exist").id).toBe(DEFAULT_INPUT_PROFILE_ID);
    expect(resolveInputProfile(null).id).toBe(DEFAULT_INPUT_PROFILE_ID);
  });

  it("gives the device profile a longer multi-tap window", () => {
    expect(INPUT_PROFILES.keypad.timing.multiTapTimeoutMs).toBe(1000);
  });
});
