/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { oklchToLinearRgb } from "@/lib/audio/spectrum/spectrumColors";

/**
 * The Sound card's colors. Each carries meaning: pitch (hue along the tone curve), ambiance (accent and
 * wash of the card) and gain polarity (boost or cut fill). Light colors are darker and more saturated so
 * strokes keep 3:1 and text 4.5:1 against the card; dark colors are lighter so they glow.
 */

export type ThemeMode = "light" | "dark";
export type ThemePair = Record<ThemeMode, string>;

const MODES: readonly ThemeMode[] = ["light", "dark"];

/** The card surface of each theme (`--card` in src/index.css), for contrast checks. */
export const SOUND_SURFACES: ThemePair = { light: "#ffffff", dark: "#191a2e" };
const INK: ThemePair = { light: "#ffffff", dark: "#11121f" };

const PITCH_TONE: Record<ThemeMode, { lightness: number; chroma: number }> = {
  light: { lightness: 0.54, chroma: 0.16 },
  dark: { lightness: 0.8, chroma: 0.14 },
};

/** Bass to treble: coral, amber, yellow-green, teal, azure, violet. */
export const PITCH_STOPS: readonly { hz: number; hue: number }[] = [
  { hz: 31, hue: 35 },
  { hz: 125, hue: 70 },
  { hz: 500, hue: 125 },
  { hz: 2000, hue: 185 },
  { hz: 8000, hue: 245 },
  { hz: 16000, hue: 300 },
];

const inGamut = (rgb: readonly number[]) => rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005);

const toByte = (linear: number) => {
  const clamped = Math.min(1, Math.max(0, linear));
  const encoded = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
};

/** The sRGB bytes of an OKLCH color, keeping its lightness and hue and giving up chroma until it fits. */
export const oklchToRgb = (lightness: number, chroma: number, hue: number): [number, number, number] => {
  let c = chroma;
  let rgb = oklchToLinearRgb(lightness, c, hue);
  while (!inGamut(rgb) && c > 0) {
    c = Math.max(0, c - 0.004);
    rgb = oklchToLinearRgb(lightness, c, hue);
  }
  return [toByte(rgb[0]), toByte(rgb[1]), toByte(rgb[2])];
};

const hex = (rgb: readonly number[]) => `#${rgb.map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;

export const oklchColor = (lightness: number, chroma: number, hue: number): string =>
  hex(oklchToRgb(lightness, chroma, hue));

const translucent = (lightness: number, chroma: number, hue: number, alpha: number): string =>
  `rgb(${oklchToRgb(lightness, chroma, hue).join(" ")} / ${alpha})`;

const parseHex = (value: string): [number, number, number] => {
  const digits = value.replace("#", "");
  return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)) as [number, number, number];
};

const luminance = (value: string): number => {
  const [r, g, b] = parseHex(value).map((byte) => {
    const channel = byte / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2 contrast ratio of two `#rrggbb` colors. */
export const contrastRatio = (a: string, b: string): number => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

/** `source` drawn at `alpha` over `base`, both `#rrggbb`. */
export const blend = (base: string, source: string, alpha: number): string => {
  const under = parseHex(base);
  const over = parseHex(source);
  return hex(under.map((channel, index) => Math.round(channel + (over[index] - channel) * alpha)));
};

/** Black-ish or white text, whichever reads better on `fill`. */
export const inkOn = (fill: string): string =>
  contrastRatio(fill, INK.light) >= contrastRatio(fill, INK.dark) ? INK.light : INK.dark;

const pitchHue = (hz: number): number => {
  const first = PITCH_STOPS[0];
  const last = PITCH_STOPS[PITCH_STOPS.length - 1];
  if (hz <= first.hz) return first.hue;
  if (hz >= last.hz) return last.hue;
  const upper = PITCH_STOPS.findIndex((stop) => stop.hz >= hz);
  const low = PITCH_STOPS[upper - 1];
  const high = PITCH_STOPS[upper];
  const t = Math.log(hz / low.hz) / Math.log(high.hz / low.hz);
  return low.hue + (high.hue - low.hue) * t;
};

/** The color of a frequency on the tone curve. */
export const pitchColor = (hz: number, mode: ThemeMode): string => {
  const tone = PITCH_TONE[mode];
  return oklchColor(tone.lightness, tone.chroma, pitchHue(hz));
};

export const pitchPair = (hz: number): ThemePair => ({ light: pitchColor(hz, "light"), dark: pitchColor(hz, "dark") });

/** Cuts are drawn cooler and greyer than boosts. */
export const CUT_FILL: ThemePair = { light: oklchColor(0.6, 0.05, 250), dark: oklchColor(0.72, 0.06, 250) };

interface AccentHues {
  hue: number;
  chroma: number;
  /** A second hue for the far corner of the wash; the accent hue when absent. */
  hue2?: number;
}

/** Accent hue per ambiance id. User sounds and "Custom" share the app's own indigo. */
export const AMBIANCE_HUES: Readonly<Record<string, AccentHues>> = {
  original: { hue: 240, chroma: 0.05 },
  "late-night": { hue: 282, chroma: 0.15, hue2: 305 },
  headphones: { hue: 192, chroma: 0.11, hue2: 205 },
  "phone-speaker": { hue: 150, chroma: 0.14, hue2: 135 },
  warm: { hue: 62, chroma: 0.14, hue2: 40 },
  "bright-arcade": { hue: 345, chroma: 0.2, hue2: 205 },
  hall: { hue: 300, chroma: 0.15, hue2: 10 },
  studio: { hue: 240, chroma: 0.02, hue2: 230 },
  custom: { hue: 268, chroma: 0.12, hue2: 250 },
  off: { hue: 250, chroma: 0.01 },
};

export interface SoundAccent {
  /** Text, dot, edge and the filled chip. */
  accent: ThemePair;
  /** Text on a filled accent chip. */
  onAccent: ThemePair;
  /** The two corners of the card's background wash, translucent. */
  wash: ThemePair;
  wash2: ThemePair;
}

const ACCENT_TONE: Record<ThemeMode, { lightness: number; wash: number; washChroma: number; alpha: number }> = {
  light: { lightness: 0.52, wash: 0.74, washChroma: 0.12, alpha: 0.1 },
  dark: { lightness: 0.8, wash: 0.6, washChroma: 0.13, alpha: 0.17 },
};

const byMode = (make: (mode: ThemeMode) => string): ThemePair =>
  Object.fromEntries(MODES.map((mode) => [mode, make(mode)])) as ThemePair;

export const soundAccent = (id: string): SoundAccent => {
  const hues = AMBIANCE_HUES[id] ?? AMBIANCE_HUES.custom;
  const accent = byMode((mode) => oklchColor(ACCENT_TONE[mode].lightness, hues.chroma, hues.hue));
  const wash = (hue: number) =>
    byMode((mode) => {
      const tone = ACCENT_TONE[mode];
      return translucent(tone.wash, Math.min(hues.chroma, tone.washChroma), hue, tone.alpha);
    });
  return {
    accent,
    onAccent: byMode((mode) => inkOn(accent[mode])),
    wash: wash(hues.hue),
    wash2: wash(hues.hue2 ?? hues.hue),
  };
};

/** The pitch a tone preset leans toward: the gain-weighted centre of its bands on the log axis, or null when flat. */
export const toneLeaning = (bandsHz: readonly number[], bandsDb: readonly number[]): number | null => {
  const weight = bandsDb.reduce((sum, db) => sum + Math.abs(db), 0);
  if (weight === 0) return null;
  const logCentre = bandsDb.reduce((sum, db, index) => sum + Math.abs(db) * Math.log2(bandsHz[index]), 0) / weight;
  return 2 ** logCentre;
};

/** CSS custom properties `--{name}-l` and `--{name}-d`, which src/index.css maps to `--{name}` per theme. */
export const pairVars = (name: string, pair: ThemePair): Record<string, string> => ({
  [`--${name}-l`]: pair.light,
  [`--${name}-d`]: pair.dark,
});

export const accentVars = (accent: SoundAccent): Record<string, string> => ({
  ...pairVars("snd-accent", accent.accent),
  ...pairVars("snd-on-accent", accent.onAccent),
  ...pairVars("snd-wash", accent.wash),
  ...pairVars("snd-wash-2", accent.wash2),
});

/** The color of an effect's slider: azure for stereo width, violet-rose for reverb. */
export const EFFECT_ACCENTS: Readonly<Record<"stereoWidth" | "reverb", ThemePair>> = {
  stereoWidth: byMode((mode) => oklchColor(ACCENT_TONE[mode].lightness, 0.13, 225)),
  reverb: byMode((mode) => oklchColor(ACCENT_TONE[mode].lightness, 0.14, 320)),
};
