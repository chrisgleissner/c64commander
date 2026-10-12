/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  DARK_PANEL_STOPS,
  LIGHT_PANEL_STOPS,
  colorAtLevel,
  levelColorSteps,
  oklchToHex,
  tokenLightness,
} from "@/lib/audio/spectrum/spectrumColors";

const relativeLuminance = (hex: string) => {
  const channel = (offset: number) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
};

describe("spectrum colours", () => {
  it("converts OKLCH to sRGB hex", () => {
    expect(oklchToHex(1, 0, 0)).toBe("#ffffff");
    expect(oklchToHex(0, 0, 0)).toBe("#000000");
    expect(oklchToHex(0.628, 0.2577, 29.23)).toBe("#ff0000");
  });

  it("gets brighter with level on a dark panel and darker with level on a light one, at every step", () => {
    const dark = levelColorSteps(true).map((step) => relativeLuminance(step.color));
    const light = levelColorSteps(false).map((step) => relativeLuminance(step.color));
    for (let i = 1; i < dark.length; i++) {
      expect(dark[i]).toBeGreaterThan(dark[i - 1]);
      expect(light[i]).toBeLessThan(light[i - 1]);
    }
  });

  it("runs teal, green, yellow-green, amber, red by hue and keeps the levels ascending", () => {
    for (const stops of [DARK_PANEL_STOPS, LIGHT_PANEL_STOPS]) {
      const hues = stops.map((stop) => stop.hue);
      expect(hues).toEqual([...hues].sort((a, b) => b - a));
      expect(stops.map((stop) => stop.db)).toEqual([...stops.map((stop) => stop.db)].sort((a, b) => a - b));
      expect(hues[0]).toBeGreaterThan(190);
      expect(hues[hues.length - 1]).toBeLessThan(35);
    }
  });

  it("picks the step at or below a level", () => {
    const steps = levelColorSteps(true);
    expect(colorAtLevel(steps, -100)).toBe(steps[0].color);
    expect(colorAtLevel(steps, -40)).toBe(steps[1].color);
    expect(colorAtLevel(steps, 0)).toBe(steps[steps.length - 1].color);
  });

  it("reads the lightness of a theme token", () => {
    expect(tokenLightness("237 35% 10%")).toBeCloseTo(0.1, 9);
    expect(tokenLightness("rgb(1,2,3)")).toBeNull();
  });
});
