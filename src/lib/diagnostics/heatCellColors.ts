/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { relativeLuminanceFromHsl } from "@/lib/appStyles/colorMath";

const BLACK_LUMINANCE = 0;
const WHITE_LUMINANCE = 1;

export const contrastRatio = (backgroundLuminance: number, textLuminance: number): number => {
  const lighter = Math.max(backgroundLuminance, textLuminance);
  const darker = Math.min(backgroundLuminance, textLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

// Black or white, whichever contrasts more: even the worse background still gives about 4.58:1.
export const readableTextColor = (backgroundHslTriple: string): "#000000" | "#ffffff" => {
  const luminance = relativeLuminanceFromHsl(backgroundHslTriple);
  return contrastRatio(luminance, WHITE_LUMINANCE) >= contrastRatio(luminance, BLACK_LUMINANCE) ? "#ffffff" : "#000000";
};

const interpolate = (from: number, to: number, intensity: number) => from + (to - from) * intensity;

export const heatCellHsl = (intensity: number): { hue: number; saturation: number; lightness: number } => ({
  hue: interpolate(196, 12, intensity),
  saturation: interpolate(82, 88, intensity),
  lightness: interpolate(96, 38, intensity),
});

export const heatCellTextColor = (intensity: number): "#000000" | "#ffffff" => {
  const { hue, saturation, lightness } = heatCellHsl(intensity);
  return readableTextColor(`${hue} ${saturation}% ${lightness}%`);
};
