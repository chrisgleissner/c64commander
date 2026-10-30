/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { TONE_MAX_DB, TONE_MIN_DB, frequencyToFraction } from "@/lib/audio/tone/toneCurve";

export interface ToneTarget {
  band: number;
  freq: number;
  /** Where the filters reach at this band: the handle and the curve sit here. */
  db: number;
  /** The gain the person set, which can be further out than the filters reach. */
  setDb?: number;
}

export interface Pixel {
  x: number;
  y: number;
}

export const xForHz = (hz: number, width: number): number => frequencyToFraction(hz) * width;

export const yForDb = (db: number, height: number): number => {
  const clamped = Math.min(TONE_MAX_DB, Math.max(TONE_MIN_DB, db));
  return ((TONE_MAX_DB - clamped) / (TONE_MAX_DB - TONE_MIN_DB)) * height;
};

export const handlePosition = (target: ToneTarget, width: number, height: number): Pixel => ({
  x: xForHz(target.freq, width),
  y: yForDb(target.db, height),
});

/** The handle points left to right, with a flat run out to each edge so the curve spans the whole plot. */
export const handlePixels = (targets: readonly ToneTarget[], width: number, height: number): Pixel[] => {
  const points = targets.map((target) => handlePosition(target, width, height)).sort((a, b) => a.x - b.x);
  if (points.length === 0) return [];
  return [{ x: 0, y: points[0].y }, ...points, { x: width, y: points[points.length - 1].y }];
};

/**
 * Slopes for a monotone cubic Hermite curve through the points (Fritsch-Butland, as in PCHIP). Where the
 * neighbouring secants differ in sign the slope is 0, and otherwise it is their weighted harmonic mean, so
 * the curve never rises above or falls below the points either side of it.
 */
export const monotoneSlopes = (points: readonly Pixel[]): number[] => {
  const widths = points.slice(1).map((point, i) => point.x - points[i].x);
  const secants = widths.map((dx, i) => (dx === 0 ? 0 : (points[i + 1].y - points[i].y) / dx));
  return points.map((_, i) => {
    if (i === 0) return secants[0] ?? 0;
    if (i === points.length - 1) return secants[i - 1];
    const before = secants[i - 1];
    const after = secants[i];
    if (before * after <= 0) return 0;
    const w1 = 2 * widths[i] + widths[i - 1];
    const w2 = widths[i] + 2 * widths[i - 1];
    return (w1 + w2) / (w1 / before + w2 / after);
  });
};

/** The monotone curve through every point, as cubic Beziers whose ends are exactly the points. */
export const monotonePath = (points: readonly Pixel[]): string => {
  if (points.length === 0) return "";
  const f = (n: number) => n.toFixed(3);
  const slopes = monotoneSlopes(points);
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const third = (b.x - a.x) / 3;
    d += ` C${f(a.x + third)} ${f(a.y + slopes[i] * third)} ${f(b.x - third)} ${f(b.y - slopes[i + 1] * third)} ${f(b.x)} ${f(b.y)}`;
  }
  return d;
};

/** A Catmull-Rom spline through the points as cubic Beziers, for the spectrum backdrop. */
export const smoothPath = (points: readonly Pixel[]): string => {
  if (points.length === 0) return "";
  const f = (n: number) => n.toFixed(3);
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    d += ` C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
};

/**
 * A hairline at CSS position `at` placed on whole device pixels: its width is the nearest whole number of
 * device pixels to one CSS pixel, and its edges fall on device pixel boundaries.
 */
export const crispLine = (at: number, devicePixelRatio: number): { at: number; width: number } => {
  const ratio = devicePixelRatio > 0 ? devicePixelRatio : 1;
  const devicePixels = Math.max(1, Math.round(ratio));
  const start = Math.round(at * ratio - devicePixels / 2);
  return { at: (start + devicePixels / 2) / ratio, width: devicePixels / ratio };
};

export const FREQUENCY_LABEL_SPACING_PX = 36;

/** Which bands get a frequency label: all ten when an octave is wide enough for one, otherwise every second one. */
export const labelledBands = (plotWidthPx: number, bandCount: number): number[] => {
  const octavePx = xForHz(2, plotWidthPx) - xForHz(1, plotWidthPx);
  const all = Array.from({ length: bandCount }, (_, band) => band);
  return octavePx >= FREQUENCY_LABEL_SPACING_PX ? all : all.filter((band) => band % 2 === 1);
};
