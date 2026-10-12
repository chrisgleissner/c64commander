/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { SPECTRUM_DISPLAY_MAX_DB, SPECTRUM_DISPLAY_MIN_DB, levelToUnit } from "@/lib/audio/spectrum/spectrumBands";

export interface LevelColorStop {
  /** Level the colour belongs to, in dBFS. */
  db: number;
  /** Perceptual lightness (OKLCH), 0 to 1. */
  lightness: number;
  chroma: number;
  hue: number;
}

/*
 * Louder is warmer and, on a dark panel, lighter: teal, green, yellow-green, amber, red. Lightness
 * rises with level at every step, so the ramp still orders correctly when hue cannot be told apart.
 * On a light panel the same order is kept by making louder darker.
 */
export const DARK_PANEL_STOPS: readonly LevelColorStop[] = [
  { db: SPECTRUM_DISPLAY_MIN_DB, lightness: 0.4, chroma: 0.07, hue: 205 },
  { db: -52, lightness: 0.5, chroma: 0.11, hue: 160 },
  { db: -36, lightness: 0.62, chroma: 0.16, hue: 135 },
  { db: -18, lightness: 0.78, chroma: 0.16, hue: 85 },
  { db: -4, lightness: 0.86, chroma: 0.17, hue: 35 },
  { db: SPECTRUM_DISPLAY_MAX_DB, lightness: 0.9, chroma: 0.15, hue: 25 },
];

export const LIGHT_PANEL_STOPS: readonly LevelColorStop[] = [
  { db: SPECTRUM_DISPLAY_MIN_DB, lightness: 0.84, chroma: 0.06, hue: 205 },
  { db: -52, lightness: 0.77, chroma: 0.1, hue: 165 },
  { db: -36, lightness: 0.71, chroma: 0.15, hue: 135 },
  { db: -18, lightness: 0.67, chroma: 0.16, hue: 80 },
  { db: -4, lightness: 0.6, chroma: 0.19, hue: 40 },
  { db: SPECTRUM_DISPLAY_MAX_DB, lightness: 0.54, chroma: 0.2, hue: 27 },
];

const toSrgbChannel = (linear: number): number => {
  const clamped = Math.min(1, Math.max(0, linear));
  return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
};

/** Converts an OKLCH colour to a `#rrggbb` string, so no canvas needs to understand `oklch()`. */
export const oklchToHex = (lightness: number, chroma: number, hueDegrees: number): string => {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const red = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const green = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const blue = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  const hex = (channel: number) =>
    Math.round(toSrgbChannel(channel) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(red)}${hex(green)}${hex(blue)}`;
};

export interface LevelColorStep {
  db: number;
  color: string;
}

export const levelColorSteps = (darkPanel: boolean): LevelColorStep[] =>
  (darkPanel ? DARK_PANEL_STOPS : LIGHT_PANEL_STOPS).map((stop) => ({
    db: stop.db,
    color: oklchToHex(stop.lightness, stop.chroma, stop.hue),
  }));

/** The colour of a level, interpolated between the two surrounding steps. Used for flat bars and the readout. */
export const colorAtLevel = (steps: readonly LevelColorStep[], db: number): string => {
  const unit = levelToUnit(db);
  let chosen = steps[0];
  for (const step of steps) {
    if (levelToUnit(step.db) <= unit) chosen = step;
  }
  return chosen.color;
};

export interface SpectrumPalette {
  dark: boolean;
  steps: LevelColorStep[];
  panel: string;
  border: string;
  grid: string;
  gridZero: string;
  label: string;
  cap: string;
  fontFamily: string;
  fontPx: number;
}

const readToken = (style: CSSStyleDeclaration, name: string): string => style.getPropertyValue(name).trim();

const hslFromToken = (token: string, alpha = 1): string => {
  if (!/^[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%$/.test(token)) return token;
  return alpha >= 1 ? `hsl(${token})` : `hsl(${token} / ${alpha})`;
};

/** Lightness (0 to 1) of an `H S% L%` token, or null for a value written some other way. */
export const tokenLightness = (token: string): number | null => {
  const match = /^[\d.]+(?:deg)?\s+[\d.]+%\s+([\d.]+)%$/.exec(token);
  return match ? Number(match[1]) / 100 : null;
};

export const FALLBACK_LABEL_PX = 14;

/**
 * Reads the active theme from the element's computed style, so the picture follows the colour
 * scheme and style the user chose rather than a hard-coded pair.
 */
export const readSpectrumPalette = (element: Element): SpectrumPalette => {
  const style = getComputedStyle(element);
  const background = readToken(style, "--background");
  const foreground = readToken(style, "--foreground");
  const muted = readToken(style, "--muted-foreground");
  const border = readToken(style, "--border");
  const dark = (tokenLightness(background) ?? 1) < 0.5;
  const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
  const fontPx = Math.max(FALLBACK_LABEL_PX, Math.round(Number.isFinite(rootPx) ? rootPx * 0.875 : FALLBACK_LABEL_PX));
  return {
    dark,
    steps: levelColorSteps(dark),
    panel: hslFromToken(background) || (dark ? "#101322" : "#f4f5f8"),
    border: hslFromToken(border) || (dark ? "#2a2f45" : "#d7dae3"),
    grid: hslFromToken(foreground, 0.12) || (dark ? "rgba(230,232,240,.12)" : "rgba(30,34,52,.12)"),
    gridZero: hslFromToken(foreground, 0.32) || (dark ? "rgba(230,232,240,.32)" : "rgba(30,34,52,.32)"),
    label: hslFromToken(muted) || (dark ? "#a7adc0" : "#667085"),
    cap: hslFromToken(foreground) || (dark ? "#e6e8f0" : "#1e2234"),
    fontFamily: style.fontFamily || "sans-serif",
    fontPx,
  };
};
