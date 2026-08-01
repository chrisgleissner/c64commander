/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { peakToPeak, SilenceDetector, SILENCE_PEAK_TO_PEAK } from "@/lib/playback/silenceDetector";

const constant = (value: number, samples = 4800) => {
  const pcm = new Int16Array(samples);
  pcm.fill(value);
  return pcm;
};

const tone = (amplitude: number, samples = 4800) => {
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) pcm[i] = Math.round(amplitude * Math.sin((i / 48) * Math.PI * 2));
  return pcm;
};

describe("peakToPeak", () => {
  it("reads zero for a constant, whatever its offset", () => {
    // This is the case that defeats the obvious detectors. Rendered without the C64 ROMs, SIDLite
    // emits a constant +157: its RMS is far from zero and not one sample is zero, so both "RMS > 0"
    // and "any non-zero sample" call it playing audio. It is a flat line and is inaudible.
    expect(peakToPeak(constant(157))).toBe(0);
    expect(peakToPeak(constant(0))).toBe(0);
    expect(peakToPeak(constant(-3000))).toBe(0);
  });

  it("reads the full swing of a tone", () => {
    expect(peakToPeak(tone(8000))).toBeGreaterThan(15000);
  });

  it("treats a few LSB of hum as silence", () => {
    expect(peakToPeak(tone(8))).toBeLessThan(SILENCE_PEAK_TO_PEAK);
  });

  it("answers zero for an empty buffer rather than throwing", () => {
    expect(peakToPeak(new Int16Array(0))).toBe(0);
  });
});

describe("SilenceDetector", () => {
  it("does not call a short rest a fault", () => {
    // SID music genuinely goes quiet. Two seconds is musical.
    const d = new SilenceDetector({ toleranceSeconds: 12 });
    d.observe(tone(6000), 1);
    d.observe(constant(0), 2);
    expect(d.isFaulty).toBe(false);
  });

  it("reports a fault once the output has been flat for long enough", () => {
    const d = new SilenceDetector({ toleranceSeconds: 12 });
    for (let i = 0; i < 12; i += 1) d.observe(constant(0), 1);
    expect(d.isFaulty).toBe(true);
    expect(d.silentSeconds).toBe(12);
  });

  it("is not fooled by SIDLite's flat DC output", () => {
    // The exact failure this exists for: a tune rendered without ROMs, sounding nothing, for a
    // quarter of a minute.
    const d = new SilenceDetector({ toleranceSeconds: 12 });
    for (let i = 0; i < 15; i += 1) d.observe(constant(157), 1);
    expect(d.isFaulty).toBe(true);
    expect(d.hasBeenAudible).toBe(false);
  });

  it("clears as soon as sound returns", () => {
    const d = new SilenceDetector({ toleranceSeconds: 12 });
    for (let i = 0; i < 11; i += 1) d.observe(constant(157), 1);
    d.observe(tone(6000), 1);
    expect(d.isFaulty).toBe(false);
    expect(d.silentSeconds).toBe(0);
    expect(d.hasBeenAudible).toBe(true);
  });

  it("judges a tune that never made a sound on the same clock", () => {
    const d = new SilenceDetector({ toleranceSeconds: 5 });
    for (let i = 0; i < 5; i += 1) d.observe(constant(157), 1);
    expect(d.isFaulty).toBe(true);
  });

  it("starts again on reset, so a recovery is given a fair chance", () => {
    const d = new SilenceDetector({ toleranceSeconds: 5 });
    for (let i = 0; i < 5; i += 1) d.observe(constant(0), 1);
    expect(d.isFaulty).toBe(true);
    d.reset();
    expect(d.isFaulty).toBe(false);
    expect(d.silentSeconds).toBe(0);
  });

  it("ignores a buffer of no duration rather than counting it", () => {
    const d = new SilenceDetector({ toleranceSeconds: 1 });
    d.observe(constant(0), 0);
    expect(d.silentSeconds).toBe(0);
  });
});

describe("peakToPeak sampling", () => {
  it("does not alias a periodic waveform into apparent flatness", () => {
    // This is why the buffer is scanned rather than sampled at a stride. A tone whose period
    // divides into the stride is caught at nearly the same phase every time, and a detector whose
    // job is to spot flatness then declares audible music silent. Several periods are tried so a
    // future optimisation cannot quietly reintroduce it.
    for (const period of [16, 32, 48, 64, 128, 192]) {
      const pcm = new Int16Array(4800);
      for (let i = 0; i < pcm.length; i += 1) pcm[i] = Math.round(8000 * Math.sin((i / period) * Math.PI * 2));
      expect(peakToPeak(pcm), `period ${period}`).toBeGreaterThan(15000);
    }
  });
});
