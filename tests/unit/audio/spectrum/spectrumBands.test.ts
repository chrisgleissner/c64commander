/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import {
  SPECTRUM_EDGES_HZ,
  SPECTRUM_FLOOR_DB,
  foldBands,
  frequencyToUnit,
  levelToUnit,
  spectrumEdgeHz,
} from "@/lib/audio/spectrum/spectrumBands";

describe("spectrum band layout", () => {
  it("spans 31.25 Hz to 16 kHz in 48 log-spaced bands, matching the native analyser formula", () => {
    expect(SPECTRUM_EDGES_HZ).toHaveLength(49);
    expect(SPECTRUM_EDGES_HZ[0]).toBeCloseTo(31.25, 6);
    expect(SPECTRUM_EDGES_HZ[48]).toBeCloseTo(16000, 3);
    expect(spectrumEdgeHz(24)).toBeCloseTo(31.25 * 2 ** 4.5, 6);
    expect(spectrumEdgeHz(5.333333333333333)).toBeCloseTo(62.5, 4);
  });

  it("places a frequency by the same law the bands follow", () => {
    expect(frequencyToUnit(31.25)).toBeCloseTo(0, 9);
    expect(frequencyToUnit(16000)).toBeCloseTo(1, 9);
    expect(frequencyToUnit(1000)).toBeCloseTo(Math.log2(32) / 9, 9);
  });

  it("maps -72..0 dB onto 0..1 and clamps outside it", () => {
    expect(levelToUnit(-72)).toBe(0);
    expect(levelToUnit(0)).toBe(1);
    expect(levelToUnit(-36)).toBeCloseTo(0.5, 9);
    expect(levelToUnit(-100)).toBe(0);
    expect(levelToUnit(6)).toBe(1);
  });

  it("folds bands by taking the loudest of each group, so a coarser tier reads at the same level", () => {
    const source = Float32Array.from([-50, -20, -80, -90, -10, -100, -60, -61]);
    const target = new Float32Array(4);
    foldBands(source, target);
    expect(Array.from(target)).toEqual([-20, -80, -10, -60]);
    const twelve = new Float32Array(2);
    foldBands(source, twelve);
    expect(Array.from(twelve)).toEqual([-20, -10]);
    foldBands(new Float32Array(4).fill(SPECTRUM_FLOOR_DB), new Float32Array(2));
  });
});
