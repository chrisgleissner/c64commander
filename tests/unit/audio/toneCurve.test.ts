/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { describe, expect, it } from "vitest";

import {
  TONE_BAND_HZ,
  TONE_PRESETS,
  activeTonePreset,
  clampToneDb,
  dbToFraction,
  flatBands,
  formatBandHz,
  formatToneDb,
  fractionToDb,
  fractionToFrequency,
  frequencyToFraction,
  isFlat,
  legacyBands,
  nearestBandAtFraction,
  normalizeBands,
  withBandGain,
} from "@/lib/audio/tone/toneCurve";

const only = (index: number, db: number) => flatBands().map((v, i) => (i === index ? db : v));

describe("tone curve math", () => {
  it("has ten fixed bands from 31 Hz to 16 kHz", () => {
    expect(TONE_BAND_HZ).toEqual([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
  });

  it("clamps and rounds gains to whole decibels within plus or minus 12", () => {
    expect(clampToneDb(40)).toBe(12);
    expect(clampToneDb(-40)).toBe(-12);
    expect(clampToneDb(2.6)).toBe(3);
    expect(clampToneDb(Number.NaN)).toBe(0);
  });

  it("normalizes any input to ten clamped gains", () => {
    expect(normalizeBands([20, -20, "x", 3])).toEqual([12, -12, 0, 3, 0, 0, 0, 0, 0, 0]);
    expect(normalizeBands("nope")).toEqual(flatBands());
  });

  it("maps the old three-band settings to the documented bands", () => {
    expect(legacyBands(3, -2, 20)).toEqual([0, 3, 3, 0, -2, -2, -2, 12, 12, 12]);
  });

  it("changes only the touched band", () => {
    expect(withBandGain(flatBands(), 3, 99)).toEqual(only(3, 12));
  });

  it("converts between frequency, gain and plot fractions both ways", () => {
    expect(frequencyToFraction(20)).toBeCloseTo(0, 6);
    expect(frequencyToFraction(20000)).toBeCloseTo(1, 6);
    expect(fractionToFrequency(frequencyToFraction(1000))).toBeCloseTo(1000, 3);
    expect(fractionToFrequency(5)).toBeCloseTo(20000, 3);
    expect(dbToFraction(12)).toBe(0);
    expect(dbToFraction(-12)).toBe(1);
    expect(fractionToDb(0.5)).toBe(0);
    expect(fractionToDb(-3)).toBe(12);
  });

  it("finds the nearest band for a touch position", () => {
    expect(nearestBandAtFraction(frequencyToFraction(1100))).toBe(5);
    expect(nearestBandAtFraction(0)).toBe(0);
    expect(nearestBandAtFraction(1)).toBe(9);
  });

  it("formats readouts", () => {
    expect(formatBandHz(31)).toBe("31 Hz");
    expect(formatBandHz(1000)).toBe("1 kHz");
    expect(formatBandHz(16000)).toBe("16 kHz");
    expect(formatToneDb(3)).toBe("+3 dB");
    expect(formatToneDb(-3)).toBe("-3 dB");
    expect(formatToneDb(0)).toBe("0 dB");
  });

  it("offers the seven tone presets, each of ten in-range gains", () => {
    expect(TONE_PRESETS.map((p) => p.label)).toEqual([
      "Flat",
      "Bass boost",
      "Treble boost",
      "Vocal presence",
      "Loudness",
      "Warm",
      "Bright",
    ]);
    for (const preset of TONE_PRESETS) {
      expect(preset.bandsDb).toHaveLength(10);
      expect(preset.bandsDb.every((db) => db >= -12 && db <= 12 && Number.isInteger(db))).toBe(true);
    }
  });

  it("names the tone preset the curve equals, and none after an edit", () => {
    expect(activeTonePreset(TONE_PRESETS[1].bandsDb)?.id).toBe("bass-boost");
    expect(activeTonePreset(withBandGain(TONE_PRESETS[1].bandsDb, 0, 5))).toBeUndefined();
  });
});
