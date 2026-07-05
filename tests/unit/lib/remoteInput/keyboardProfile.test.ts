/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { resolveKeyboardProfile } from "@/lib/remoteInput/keyboardProfile";

describe("resolveKeyboardProfile", () => {
  it("classifies a tiny portrait content box (Callback 8020-like) as compact", () => {
    expect(resolveKeyboardProfile(300, 480)).toBe("compact");
    expect(resolveKeyboardProfile(240, 320)).toBe("compact");
  });

  it("classifies a normal phone portrait content box as medium", () => {
    expect(resolveKeyboardProfile(390, 720)).toBe("medium");
    expect(resolveKeyboardProfile(412, 800)).toBe("medium");
  });

  it("classifies a tablet / desktop content box as expanded", () => {
    expect(resolveKeyboardProfile(768, 1024)).toBe("expanded");
    expect(resolveKeyboardProfile(1280, 800)).toBe("expanded");
  });

  it("keeps a wide-but-short landscape phone as medium (not expanded)", () => {
    // Height gates the physical-row layout, so width alone can't over-promote.
    expect(resolveKeyboardProfile(800, 360)).toBe("medium");
  });

  it("treats a spacious portrait tablet as expanded", () => {
    expect(resolveKeyboardProfile(834, 1112)).toBe("expanded");
  });

  it("falls back to medium for an unmeasured (zero / non-finite) content box", () => {
    expect(resolveKeyboardProfile(0, 0)).toBe("medium");
    expect(resolveKeyboardProfile(Number.NaN, Number.NaN)).toBe("medium");
    expect(resolveKeyboardProfile(-100, -100)).toBe("medium");
  });
});
