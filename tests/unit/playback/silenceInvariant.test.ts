/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The rule, stated once and enforced here: **no silent playback unless the listener asked for it.**
 *
 * Three separate defects have shipped where the app believed it was playing and the room stayed
 * quiet — a render budget that leaked, a crossfaded-out tune closing the next one's audio, and a
 * superseded sink writing over its successor. Each was found by a person, not by the suite, because
 * every counter the pipeline keeps describes supply and demand rather than sound.
 *
 * These tests are deliberately about the *rule* rather than about any one of those bugs. They are
 * the place to add a case when the next one turns up.
 */

import { describe, expect, it } from "vitest";

import { peakToPeak, SilenceDetector, SILENCE_PEAK_TO_PEAK } from "@/lib/playback/silenceDetector";

/** A rendering that is flat: audible to no one, whatever its offset or its RMS. */
const flatline = (value: number, samples = 4800) => {
  const pcm = new Int16Array(samples);
  pcm.fill(value);
  return pcm;
};

const music = (samples = 4800) => {
  const pcm = new Int16Array(samples);
  for (let i = 0; i < samples; i += 1) pcm[i] = Math.round(6000 * Math.sin(i / 7) + 2000 * Math.sin(i / 23));
  return pcm;
};

describe("no silent playback unless the listener asked for it", () => {
  it("calls a flat rendering silent however loud its DC offset is", () => {
    // Every one of these has a large RMS and not one zero sample. All are inaudible.
    for (const offset of [157, -157, 1000, -20000, 32000]) {
      expect(peakToPeak(flatline(offset)), `offset ${offset}`).toBe(0);
    }
  });

  it("is the specific failure SIDLite produces without the C64 ROMs", () => {
    // Measured: a constant +157, identical across four different tunes, with zero exactly-zero
    // samples. "RMS > 0" and "any non-zero sample" both call this playing audio.
    const rendered = flatline(157);
    const rms = Math.sqrt(rendered.reduce((sum, s) => sum + s * s, 0) / rendered.length);
    expect(rms).toBeGreaterThan(150);
    expect([...rendered].some((s) => s === 0)).toBe(false);
    expect(peakToPeak(rendered)).toBeLessThan(SILENCE_PEAK_TO_PEAK);
  });

  it("does not call real music silent", () => {
    expect(peakToPeak(music())).toBeGreaterThan(SILENCE_PEAK_TO_PEAK);
  });

  it("reports a fault for a tune that plays flat from the start", () => {
    const detector = new SilenceDetector({ toleranceSeconds: 12 });
    for (let second = 0; second < 12; second += 1) detector.observe(flatline(157), 1);
    expect(detector.isFaulty).toBe(true);
    expect(detector.hasBeenAudible).toBe(false);
  });

  it("reports a fault for a tune that starts well and then goes quiet", () => {
    // The shape of the crossfade defect: a fraction of a second of audio, then nothing.
    const detector = new SilenceDetector({ toleranceSeconds: 12 });
    detector.observe(music(), 0.3);
    expect(detector.hasBeenAudible).toBe(true);
    for (let second = 0; second < 12; second += 1) detector.observe(flatline(0), 1);
    expect(detector.isFaulty).toBe(true);
  });

  it("tolerates a musical rest", () => {
    const detector = new SilenceDetector({ toleranceSeconds: 12 });
    detector.observe(music(), 5);
    detector.observe(flatline(0), 3);
    detector.observe(music(), 5);
    expect(detector.isFaulty).toBe(false);
  });
});
