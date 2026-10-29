/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { describe, expect, it } from "vitest";

import { monotonePath, monotoneSlopes, smoothPath } from "@/lib/audio/tone/toneGeometry";
import { blend } from "@/lib/audio/tone/soundPalette";

const endpoints = (path: string): number[][] =>
  path
    .split("C")
    .slice(1)
    .map((segment) => segment.trim().split(" ").slice(-2).map(Number));

describe("smoothPath", () => {
  it("is empty for no points and a bare move for one point", () => {
    expect(smoothPath([])).toBe("");
    expect(smoothPath([{ x: 3, y: 4 }])).toBe("M3.000 4.000");
  });

  it("ends every segment exactly on the next point", () => {
    const points = [
      { x: 0, y: 100 },
      { x: 20, y: 30 },
      { x: 55, y: 80 },
      { x: 100, y: 100 },
    ];
    const path = smoothPath(points);
    expect(path.startsWith("M0.000 100.000")).toBe(true);
    expect(endpoints(path)).toEqual(points.slice(1).map((point) => [point.x, point.y]));
  });

  it("keeps the control points of three collinear points on their line", () => {
    const path = smoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 20 },
    ]);
    for (const segment of path.split("C").slice(1)) {
      const numbers = segment.trim().split(" ").map(Number);
      for (let i = 0; i < numbers.length; i += 2) expect(numbers[i]).toBeCloseTo(numbers[i + 1], 3);
    }
  });
});

describe("monotone curve with too few points", () => {
  it("has slope 0 for a single point and the shared secant for two", () => {
    expect(monotoneSlopes([{ x: 5, y: 9 }])).toEqual([0]);
    expect(
      monotoneSlopes([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
      ]),
    ).toEqual([0.5, 0.5]);
  });

  it("draws nothing for no points and only the start for one", () => {
    expect(monotonePath([])).toBe("");
    expect(monotonePath([{ x: 1, y: 2 }])).toBe("M1.000 2.000");
  });
});

describe("blend", () => {
  it("returns the base at alpha 0, the source at alpha 1 and the rounded midpoint between", () => {
    expect(blend("#102030", "#f0e0d0", 0)).toBe("#102030");
    expect(blend("#102030", "#f0e0d0", 1)).toBe("#f0e0d0");
    expect(blend("#000000", "#ffffff", 0.5)).toBe("#808080");
  });
});
