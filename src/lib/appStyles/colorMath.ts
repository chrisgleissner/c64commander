/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * WCAG relative-luminance math for "H S% L%" HSL triples, the format every appearance-style
 * colour token uses (spec.md section 5). This is the runtime (browser-safe) counterpart to the
 * identical math in scripts/compile-styles.mjs: that script runs at build time under Node and
 * pulls in js-yaml/prettier, neither of which belongs in the shipped app bundle, so the two
 * implementations are kept separate rather than sharing one module across the Node/browser split.
 */

const parseHsl = (triple: string): [number, number, number] => {
  const [h, s, l] = triple.split(/\s+/).map((part) => Number.parseFloat(part));
  return [h, s / 100, l / 100];
};

const hslToRgb = ([h, s, l]: [number, number, number]): [number, number, number] => {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const hNorm = h / 360;
  return [hueToRgb(hNorm + 1 / 3), hueToRgb(hNorm), hueToRgb(hNorm - 1 / 3)];
};

/** WCAG relative luminance (0 = black, 1 = white) from an "H S% L%" HSL triple. */
export const relativeLuminanceFromHsl = (triple: string): number => {
  const [r, g, b] = hslToRgb(parseHsl(triple));
  const linearize = (channel: number) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
};

/**
 * True when a background of this luminance reads as "light" — the same WCAG midpoint used to
 * decide whether black or white text keeps better contrast on it. Used to pick native system-bar
 * icon polarity from the resolved --background, not from the light/dark theme setting (spec.md
 * section 7.3): a dark-only style like amber-glow or vault-black stays dark under the light theme
 * too, and the system bar has to follow what is actually on screen, not the setting that produced it.
 */
export const isLightLuminance = (luminance: number): boolean => luminance > 0.5;
