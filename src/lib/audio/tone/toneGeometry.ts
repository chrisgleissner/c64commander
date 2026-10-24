/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { TONE_MAX_DB, TONE_MIN_DB, frequencyToFraction } from "@/lib/audio/tone/toneCurve";

export interface TonePoint {
  hz: number;
  db: number;
}

export interface ToneTarget {
  band: number;
  freq: number;
  db: number;
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

/** The sampled response with the handle points merged in, so the drawn line passes through every handle. */
export const curvePixels = (
  freqs: readonly number[],
  responseDb: readonly number[],
  targets: readonly ToneTarget[],
  width: number,
  height: number,
): Pixel[] => {
  const points: TonePoint[] = freqs.map((hz, index) => ({ hz, db: responseDb[index] ?? 0 }));
  for (const target of targets) points.push({ hz: target.freq, db: target.db });
  return points
    .sort((a, b) => a.hz - b.hz)
    .map((point) => ({ x: xForHz(point.hz, width), y: yForDb(point.db, height) }));
};

/** A Catmull-Rom spline through the points as cubic Beziers. It only smooths between samples that already lie on the response. */
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

/** The y of the piecewise-linear curve through the points at an x, for checking a handle sits on the line. */
export const curveYAt = (points: readonly Pixel[], x: number): number => {
  for (let i = 0; i < points.length - 1; i += 1) {
    if (x >= points[i].x && x <= points[i + 1].x) {
      const span = points[i + 1].x - points[i].x;
      return span === 0 ? points[i].y : points[i].y + ((x - points[i].x) / span) * (points[i + 1].y - points[i].y);
    }
  }
  return NaN;
};
