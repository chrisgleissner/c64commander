/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DARK_PANEL_STOPS,
  LIGHT_PANEL_STOPS,
  colorAtLevel,
  levelColorSteps,
  oklchToHex,
  readSpectrumPalette,
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

  it("gets brighter with level on a dark panel and darker with level on a light one, up to the warm stops", () => {
    const warmFromDb = -9;
    const dark = levelColorSteps(true).filter((step) => step.db <= warmFromDb);
    const light = levelColorSteps(false).filter((step) => step.db <= warmFromDb);
    for (let i = 1; i < dark.length; i++) {
      expect(relativeLuminance(dark[i].color)).toBeGreaterThan(relativeLuminance(dark[i - 1].color));
      expect(relativeLuminance(light[i].color)).toBeLessThan(relativeLuminance(light[i - 1].color));
    }
  });

  it("turns clearly red at full scale on both panels", () => {
    for (const dark of [true, false]) {
      const steps = levelColorSteps(dark);
      const [red, green, blue] = [1, 3, 5].map((i) => parseInt(steps[steps.length - 1].color.slice(i, i + 2), 16));
      expect(red).toBeGreaterThan(green + 60);
      expect(red).toBeGreaterThan(blue + 40);
    }
  });

  it("runs green, yellow, orange, red by hue and keeps the levels ascending", () => {
    for (const stops of [DARK_PANEL_STOPS, LIGHT_PANEL_STOPS]) {
      const hues = stops.map((stop) => stop.hue);
      expect(hues).toEqual([...hues].sort((a, b) => b - a));
      expect(stops.map((stop) => stop.db)).toEqual([...stops.map((stop) => stop.db)].sort((a, b) => a - b));
      expect(hues[0]).toBeGreaterThan(160);
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

  describe("reading the palette from the theme", () => {
    const setTokens = (element: HTMLElement, tokens: Record<string, string>) => {
      for (const [name, value] of Object.entries(tokens)) element.style.setProperty(name, value);
    };

    afterEach(() => {
      document.body.innerHTML = "";
    });

    it("turns HSL theme tokens into colours and detects a dark theme from the background lightness", () => {
      const element = document.createElement("div");
      document.body.append(element);
      setTokens(element, {
        "--background": "237 35% 10%",
        "--foreground": "210 20% 90%",
        "--muted-foreground": "215 15% 60%",
        "--border": "230 20% 20%",
      });
      const palette = readSpectrumPalette(element);
      expect(palette.dark).toBe(true);
      expect(palette.panel).toBe("hsl(237 35% 10%)");
      expect(palette.border).toBe("hsl(230 20% 20%)");
      expect(palette.grid).toBe("hsl(210 20% 90% / 0.12)");
      expect(palette.gridZero).toBe("hsl(210 20% 90% / 0.32)");
      expect(palette.label).toBe("hsl(215 15% 60%)");
      expect(palette.cap).toBe("hsl(210 20% 90%)");
      expect(palette.steps).toEqual(levelColorSteps(true));
    });

    it("passes through a token that is not written as HSL components", () => {
      const element = document.createElement("div");
      document.body.append(element);
      setTokens(element, { "--background": "#fafafa", "--foreground": "rgb(10, 20, 30)" });
      const palette = readSpectrumPalette(element);
      expect(palette.dark).toBe(false);
      expect(palette.panel).toBe("#fafafa");
      expect(palette.cap).toBe("rgb(10, 20, 30)");
    });

    it("falls back to light colours when the theme defines nothing", () => {
      const element = document.createElement("div");
      document.body.append(element);
      const palette = readSpectrumPalette(element);
      expect(palette.dark).toBe(false);
      expect(palette.panel).toBe("#f4f5f8");
      expect(palette.border).toBe("#d7dae3");
      expect(palette.grid).toBe("rgba(30,34,52,.12)");
      expect(palette.gridZero).toBe("rgba(30,34,52,.32)");
      expect(palette.label).toBe("#667085");
      expect(palette.cap).toBe("#1e2234");
      expect(palette.steps).toEqual(levelColorSteps(false));
      expect(palette.fontPx).toBeGreaterThanOrEqual(14);
    });

    it("falls back to dark colours for the tokens a dark theme leaves out", () => {
      const element = document.createElement("div");
      document.body.append(element);
      setTokens(element, { "--background": "237 35% 10%" });
      const palette = readSpectrumPalette(element);
      expect(palette.dark).toBe(true);
      expect(palette.border).toBe("#2a2f45");
      expect(palette.grid).toBe("rgba(230,232,240,.12)");
      expect(palette.gridZero).toBe("rgba(230,232,240,.32)");
      expect(palette.label).toBe("#a7adc0");
      expect(palette.cap).toBe("#e6e8f0");
    });

    it("scales the label size with the root font size and keeps the element font family", () => {
      const element = document.createElement("div");
      element.style.fontFamily = "Inter, sans-serif";
      document.body.append(element);
      document.documentElement.style.fontSize = "24px";
      try {
        const palette = readSpectrumPalette(element);
        expect(palette.fontPx).toBe(21);
        expect(palette.fontFamily).toContain("Inter");
      } finally {
        document.documentElement.style.fontSize = "";
      }
    });

    it("uses the 14 px floor and sans-serif when the root font size cannot be read", () => {
      const element = document.createElement("div");
      document.body.append(element);
      const original = window.getComputedStyle;
      const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((target: Element) => {
        const style = original(target);
        return target === document.documentElement
          ? ({ fontSize: "", getPropertyValue: () => "" } as unknown as CSSStyleDeclaration)
          : style;
      });
      try {
        const palette = readSpectrumPalette(element);
        expect(palette.fontPx).toBe(14);
        expect(palette.fontFamily).toBeTruthy();
      } finally {
        spy.mockRestore();
      }
    });
  });
});
