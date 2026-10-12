/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  SPECTRUM_BALLISTICS,
  SPECTRUM_BALLISTICS_REDUCED,
  createBallistics,
  resetBallistics,
  stepBallistics,
} from "@/lib/audio/spectrum/spectrumBallistics";

const run = (state: ReturnType<typeof createBallistics>, target: number, totalMs: number, stepMs = 16.7) => {
  const targets = new Float32Array(state.levels.length).fill(target);
  for (let t = 0; t < totalMs; t += stepMs) stepBallistics(state, targets, stepMs);
};

describe("spectrum ballistics", () => {
  it("rises with a 10 ms attack: nearly there within 30 ms", () => {
    const state = createBallistics(1);
    run(state, -20, 33.4);
    expect(state.levels[0]).toBeGreaterThan(-100 + 80 * 0.9);
  });

  it("falls with a 180 ms release: one time constant covers 63 percent of the way down", () => {
    const state = createBallistics(1);
    state.levels[0] = 0;
    state.peaks[0] = 0;
    const targets = Float32Array.from([-100]);
    stepBallistics(state, targets, 180);
    expect(state.levels[0]).toBeCloseTo(-100 * (1 - Math.exp(-1)), 3);
  });

  it("gives the same result however the elapsed time is cut into frames", () => {
    const a = createBallistics(1);
    const b = createBallistics(1);
    a.levels[0] = b.levels[0] = -10;
    const targets = Float32Array.from([-90]);
    stepBallistics(a, targets, 120);
    for (let i = 0; i < 12; i++) stepBallistics(b, targets, 10);
    expect(b.levels[0]).toBeCloseTo(a.levels[0], 3);
  });

  it("holds a peak for 600 ms, then lets it fall at 24 dB per second", () => {
    const state = createBallistics(1);
    state.levels[0] = -10;
    state.peaks[0] = -10;
    state.holdMsLeft[0] = SPECTRUM_BALLISTICS.peakHoldMs;
    const floor = Float32Array.from([-100]);
    stepBallistics(state, floor, 590);
    expect(state.peaks[0]).toBe(-10);
    stepBallistics(state, floor, 10 + 500);
    expect(state.peaks[0]).toBeCloseTo(-10 - 12, 3);
  });

  it("carries the part of a long frame that is beyond the hold into the fall", () => {
    const state = createBallistics(1);
    state.levels[0] = -10;
    state.peaks[0] = -10;
    state.holdMsLeft[0] = 600;
    stepBallistics(state, Float32Array.from([-100]), 1600);
    expect(state.peaks[0]).toBeCloseTo(-10 - 24, 3);
  });

  it("never lets a cap drop below its bar and re-arms the hold on a new maximum", () => {
    const state = createBallistics(1);
    run(state, -30, 2000);
    expect(state.peaks[0]).toBeGreaterThanOrEqual(state.levels[0]);
    run(state, -5, 100);
    expect(state.holdMsLeft[0]).toBe(SPECTRUM_BALLISTICS.peakHoldMs);
  });

  it("ignores a zero or negative step and can be reset to silence", () => {
    const state = createBallistics(2);
    stepBallistics(state, Float32Array.from([0, 0]), 0);
    expect(state.levels[0]).toBe(-100);
    run(state, -10, 200);
    resetBallistics(state);
    expect(Array.from(state.levels)).toEqual([-100, -100]);
    expect(Array.from(state.holdMsLeft)).toEqual([0, 0]);
  });

  it("settles more slowly under reduced motion", () => {
    const normal = createBallistics(1);
    const reduced = createBallistics(1);
    normal.levels[0] = reduced.levels[0] = 0;
    normal.peaks[0] = reduced.peaks[0] = 0;
    const floor = Float32Array.from([-100]);
    stepBallistics(normal, floor, 100, SPECTRUM_BALLISTICS);
    stepBallistics(reduced, floor, 100, SPECTRUM_BALLISTICS_REDUCED);
    expect(reduced.levels[0]).toBeGreaterThan(normal.levels[0]);
  });
});
