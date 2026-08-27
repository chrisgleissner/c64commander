/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { isLightLuminance, relativeLuminanceFromHsl } from "@/lib/appStyles/colorMath";

describe("relativeLuminanceFromHsl", () => {
  it("returns 0 for black", () => {
    expect(relativeLuminanceFromHsl("0 0% 0%")).toBeCloseTo(0, 5);
  });

  it("returns 1 for white", () => {
    expect(relativeLuminanceFromHsl("0 0% 100%")).toBeCloseTo(1, 5);
  });

  it("matches every generated palette's --background against its own light/dark classification", async () => {
    const { APP_STYLES } = await import("@/generated/appStyles");
    for (const style of APP_STYLES) {
      if (style.light) {
        expect(isLightLuminance(relativeLuminanceFromHsl(style.light.colors.background))).toBe(true);
      }
      if (style.dark) {
        expect(isLightLuminance(relativeLuminanceFromHsl(style.dark.colors.background))).toBe(false);
      }
    }
  });
});

describe("isLightLuminance", () => {
  it("is true above the WCAG midpoint", () => {
    expect(isLightLuminance(0.51)).toBe(true);
  });

  it("is false at and below the WCAG midpoint", () => {
    expect(isLightLuminance(0.5)).toBe(false);
    expect(isLightLuminance(0.1)).toBe(false);
  });
});
