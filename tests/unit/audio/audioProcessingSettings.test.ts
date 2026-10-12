/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setAudioProcessing = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/native/audioFx", () => ({ setAudioProcessing }));

import {
  DEFAULT_AUDIO_PROCESSING,
  REVERB_PRESETS,
  STEREO_WIDTH_PRESETS,
  clampAudioAmount,
  clampEqDb,
  formatEqDb,
  isAudioProcessingActive,
  loadAudioProcessing,
  nearestPreset,
  resetAudioEq,
  saveAudioEqBand,
  saveAudioLevelling,
  saveAudioReverb,
  saveAudioStereoWidth,
} from "@/lib/config/audioProcessingSettings";
import { AUDIO_PROCESSING_PUSH_DELAY_MS, installAudioProcessingSync } from "@/lib/audio/audioProcessingSync";

describe("audio processing settings", () => {
  beforeEach(() => localStorage.clear());

  it("is off and flat by default", () => {
    expect(loadAudioProcessing()).toEqual(DEFAULT_AUDIO_PROCESSING);
    expect(isAudioProcessingActive(loadAudioProcessing())).toBe(false);
  });

  it("persists every control under its c64u_audio_ key", () => {
    saveAudioLevelling(true);
    saveAudioEqBand("bassDb", 4);
    saveAudioEqBand("midDb", -3);
    saveAudioEqBand("trebleDb", 12);
    saveAudioStereoWidth(35);
    saveAudioReverb(55);
    expect(loadAudioProcessing()).toEqual({
      levelling: true,
      bassDb: 4,
      midDb: -3,
      trebleDb: 12,
      stereoWidth: 35,
      reverb: 55,
    });
    expect(localStorage.getItem("c64u_audio_levelling")).toBe("1");
    expect(localStorage.getItem("c64u_audio_stereo_width")).toBe("35");
    expect(isAudioProcessingActive(loadAudioProcessing())).toBe(true);
  });

  it("clamps what is written and what is read", () => {
    saveAudioEqBand("bassDb", 40);
    saveAudioReverb(250);
    expect(loadAudioProcessing().bassDb).toBe(12);
    expect(loadAudioProcessing().reverb).toBe(100);
    localStorage.setItem("c64u_audio_eq_treble_db", "-99");
    localStorage.setItem("c64u_audio_eq_mid_db", "banana");
    expect(loadAudioProcessing().trebleDb).toBe(-12);
    expect(loadAudioProcessing().midDb).toBe(0);
    expect(clampEqDb(Number.NaN)).toBe(0);
    expect(clampAudioAmount(-5)).toBe(0);
  });

  it("resets the equalizer without touching the other controls", () => {
    saveAudioEqBand("bassDb", 4);
    saveAudioReverb(25);
    resetAudioEq();
    expect(loadAudioProcessing()).toMatchObject({ bassDb: 0, midDb: 0, trebleDb: 0, reverb: 25 });
  });

  it("keeps a raw value from a finer control and only rounds which preset is highlighted", () => {
    saveAudioStereoWidth(55);
    expect(loadAudioProcessing().stereoWidth).toBe(55);
    expect(nearestPreset(STEREO_WIDTH_PRESETS, 55).id).toBe("wide");
    expect(nearestPreset(STEREO_WIDTH_PRESETS, 10).id).toBe("off");
    expect(nearestPreset(STEREO_WIDTH_PRESETS, 30).id).toBe("subtle");
    expect(nearestPreset(REVERB_PRESETS, 41).id).toBe("hall");
  });

  it("formats the equalizer readout with a sign", () => {
    expect(formatEqDb(3)).toBe("+3 dB");
    expect(formatEqDb(-12)).toBe("-12 dB");
    expect(formatEqDb(0)).toBe("0 dB");
  });
});

describe("audio processing sync", () => {
  beforeEach(() => {
    localStorage.clear();
    setAudioProcessing.mockClear();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it("pushes the stored settings at start", () => {
    saveAudioLevelling(true);
    const stop = installAudioProcessingSync();
    expect(setAudioProcessing).toHaveBeenCalledWith({ ...DEFAULT_AUDIO_PROCESSING, levelling: true });
    stop();
  });

  it("merges a burst of slider changes into one call carrying the last value", () => {
    const stop = installAudioProcessingSync();
    setAudioProcessing.mockClear();
    for (const db of [1, 2, 3, 4]) saveAudioEqBand("bassDb", db);
    expect(setAudioProcessing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(AUDIO_PROCESSING_PUSH_DELAY_MS + 1);
    expect(setAudioProcessing).toHaveBeenCalledTimes(1);
    expect(setAudioProcessing).toHaveBeenCalledWith({ ...DEFAULT_AUDIO_PROCESSING, bassDb: 4 });
    stop();
  });

  it("ignores unrelated settings and stops listening when stopped", () => {
    const stop = installAudioProcessingSync();
    setAudioProcessing.mockClear();
    window.dispatchEvent(
      new CustomEvent("c64u-app-settings-updated", { detail: { key: "c64u_debug_logging_enabled" } }),
    );
    vi.advanceTimersByTime(500);
    expect(setAudioProcessing).not.toHaveBeenCalled();
    stop();
    saveAudioReverb(55);
    vi.advanceTimersByTime(500);
    expect(setAudioProcessing).not.toHaveBeenCalled();
  });
});
