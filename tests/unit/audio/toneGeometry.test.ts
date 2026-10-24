/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { describe, expect, it } from "vitest";

import { TONE_BAND_COUNT } from "@/lib/audio/tone/toneCurve";
import {
  FREQUENCY_LABEL_SPACING_PX,
  crispLine,
  handlePixels,
  labelledBands,
  monotonePath,
  monotoneSlopes,
  xForHz,
} from "@/lib/audio/tone/toneGeometry";
import { settle } from "@/lib/audio/tone/useMorphedBands";

describe("monotoneSlopes", () => {
  it("is 0 at a peak, a dip and a plateau, so the curve turns at the handle and not past it", () => {
    const slopes = monotoneSlopes([
      { x: 0, y: 50 },
      { x: 10, y: 20 },
      { x: 20, y: 50 },
      { x: 30, y: 80 },
      { x: 40, y: 80 },
      { x: 50, y: 60 },
    ]);
    expect(slopes[1]).toBe(0);
    expect(slopes[3]).toBe(0);
    expect(slopes[4]).toBe(0);
  });

  it("stays within three times the smaller neighbouring secant on a monotone run", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 1 },
      { x: 20, y: 40 },
      { x: 30, y: 41 },
    ];
    const slopes = monotoneSlopes(points);
    for (const i of [1, 2]) {
      const before = (points[i].y - points[i - 1].y) / 10;
      const after = (points[i + 1].y - points[i].y) / 10;
      expect(slopes[i]).toBeGreaterThan(0);
      expect(slopes[i]).toBeLessThanOrEqual(3 * Math.min(before, after) + 1e-9);
    }
  });
});

describe("monotonePath", () => {
  it("starts at the first point and ends each segment exactly on the next point", () => {
    const points = [
      { x: 0, y: 30 },
      { x: 25, y: 10 },
      { x: 60, y: 70 },
      { x: 100, y: 70 },
    ];
    const numbers = monotonePath(points).replace(/[MC]/g, " ").trim().split(/\s+/).map(Number);
    expect(numbers.slice(0, 2)).toEqual([0, 30]);
    for (let segment = 0; segment < 3; segment += 1) {
      const end = numbers.slice(2 + segment * 6 + 4, 2 + segment * 6 + 6);
      expect(end).toEqual([points[segment + 1].x, points[segment + 1].y]);
    }
  });

  it("is empty for no points", () => {
    expect(monotonePath([])).toBe("");
  });
});

describe("handlePixels", () => {
  it("adds a flat run to each edge and orders the handles left to right", () => {
    const pixels = handlePixels(
      [
        { band: 1, freq: 1000, db: -6 },
        { band: 0, freq: 100, db: 6 },
      ],
      200,
      100,
    );
    expect(pixels.map((p) => p.x)).toEqual([0, xForHz(100, 200), xForHz(1000, 200), 200]);
    expect(pixels.map((p) => p.y)).toEqual([25, 25, 75, 75]);
    expect(handlePixels([], 200, 100)).toEqual([]);
  });
});

describe("labelledBands", () => {
  const widthForOctave = (px: number) => px / (xForHz(2, 1) - xForHz(1, 1));

  it("labels every band once an octave is wide enough for a label", () => {
    expect(labelledBands(widthForOctave(FREQUENCY_LABEL_SPACING_PX), TONE_BAND_COUNT)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("labels every second band, ending on 16 kHz, when octaves are narrower", () => {
    expect(labelledBands(widthForOctave(FREQUENCY_LABEL_SPACING_PX - 1), TONE_BAND_COUNT)).toEqual([1, 3, 5, 7, 9]);
    expect(labelledBands(0, TONE_BAND_COUNT)).toEqual([1, 3, 5, 7, 9]);
  });
});

describe("crispLine", () => {
  it.each([1, 1.5, 2, 2.625, 3])("puts a hairline on whole device pixels at a ratio of %s", (ratio) => {
    for (const at of [0, 10.3, 47.71, 99.5]) {
      const line = crispLine(at, ratio);
      const width = line.width * ratio;
      expect(width).toBeCloseTo(Math.max(1, Math.round(ratio)), 9);
      const start = (line.at - line.width / 2) * ratio;
      expect(Math.abs(start - Math.round(start))).toBeLessThan(1e-9);
      expect(Math.abs(line.at - at)).toBeLessThanOrEqual(line.width / 2 + 1 / ratio);
    }
  });

  it("treats a missing ratio as 1", () => {
    expect(crispLine(10.2, 0)).toEqual({ at: 10.5, width: 1 });
  });
});

describe("settle", () => {
  it("runs from 0 to 1 without ever passing 1 or going back", () => {
    expect(settle(0)).toBe(0);
    expect(settle(1)).toBe(1);
    expect(settle(-1)).toBe(0);
    expect(settle(2)).toBe(1);
    let previous = 0;
    for (let n = 1; n <= 100; n += 1) {
      const value = settle(n / 100);
      expect(value).toBeGreaterThanOrEqual(previous);
      expect(value).toBeLessThanOrEqual(1);
      previous = value;
    }
  });
});
