/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setAudioProcessing = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/native/audioFx", () => ({ setAudioProcessing }));
const addLog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logging", () => ({ addLog }));

import {
  AUDIO_PROCESSING_KEY,
  DEFAULT_AUDIO_PROCESSING,
  MAX_USER_PRESETS,
  REVERB_PRESETS,
  STEREO_WIDTH_PRESETS,
  activeSoundPreset,
  applySound,
  applySoundPreset,
  backToPreviousSound,
  clampAudioAmount,
  clampEqDb,
  deleteUserPreset,
  isAudioProcessingActive,
  loadAudioProcessing,
  loadAudioProcessingRecord,
  nearestPreset,
  parseAudioProcessingRecord,
  renameUserPreset,
  resetAudioEq,
  resetAudioProcessingWarningsForTests,
  saveAudioBandGain,
  saveAudioEnabled,
  saveAudioLevelling,
  saveAudioReverb,
  saveAudioStereoWidth,
  saveUserPreset,
  stepSoundPreset,
  useAudioProcessing,
} from "@/lib/config/audioProcessingSettings";
import { AUDIO_PROCESSING_PUSH_DELAY_MS, installAudioProcessingSync } from "@/lib/audio/audioProcessingSync";
import { AMBIANCE_PRESETS } from "@/lib/audio/tone/ambiancePresets";

const flatWith = (index: number, db: number) => Object.assign(new Array<number>(10).fill(0), { [index]: db });

describe("audio processing settings record", () => {
  beforeEach(() => {
    localStorage.clear();
    addLog.mockClear();
    resetAudioProcessingWarningsForTests();
  });

  it("is off and flat by default", () => {
    expect(loadAudioProcessing()).toEqual(DEFAULT_AUDIO_PROCESSING);
    expect(isAudioProcessingActive(loadAudioProcessing())).toBe(false);
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe("original");
  });

  it("persists every control in one audio_processing record of version 2", () => {
    saveAudioLevelling(true);
    saveAudioBandGain(5, 4);
    saveAudioBandGain(8, -3);
    saveAudioStereoWidth(35);
    saveAudioReverb(55);
    expect(loadAudioProcessing()).toEqual({
      levelling: true,
      bandsDb: flatWith(5, 4).map((v, i) => (i === 8 ? -3 : v)),
      stereoWidth: 35,
      reverb: 55,
    });
    expect(JSON.parse(localStorage.getItem(AUDIO_PROCESSING_KEY) ?? "{}").version).toBe(2);
    expect(isAudioProcessingActive(loadAudioProcessing())).toBe(true);
  });

  it("sends all off while the switch is off and keeps every setting", () => {
    saveAudioReverb(55);
    saveAudioEnabled(false);
    expect(loadAudioProcessing()).toEqual(DEFAULT_AUDIO_PROCESSING);
    saveAudioEnabled(true);
    expect(loadAudioProcessing().reverb).toBe(55);
  });

  it("migrates the old c64u_audio_ keys once, spreading bass, mid and treble over the bands, then removes them", () => {
    localStorage.setItem("c64u_audio_levelling", "1");
    localStorage.setItem("c64u_audio_eq_bass_db", "3");
    localStorage.setItem("c64u_audio_eq_mid_db", "-2");
    localStorage.setItem("c64u_audio_eq_treble_db", "20");
    localStorage.setItem("c64u_audio_stereo_width", "35");
    localStorage.setItem("c64u_audio_reverb", "25");
    expect(loadAudioProcessing()).toEqual({
      levelling: true,
      bandsDb: [0, 3, 3, 0, -2, -2, -2, 12, 12, 12],
      stereoWidth: 35,
      reverb: 25,
    });
    expect(localStorage.getItem("c64u_audio_reverb")).toBeNull();
    expect(localStorage.getItem("c64u_audio_levelling")).toBeNull();
    expect(JSON.parse(localStorage.getItem(AUDIO_PROCESSING_KEY) ?? "{}").version).toBe(2);
    expect(loadAudioProcessing().reverb).toBe(25);
  });

  it("falls back to flat and logs one warning for an unusable record", () => {
    localStorage.setItem(AUDIO_PROCESSING_KEY, "{not json");
    expect(loadAudioProcessing()).toEqual(DEFAULT_AUDIO_PROCESSING);
    expect(loadAudioProcessing()).toEqual(DEFAULT_AUDIO_PROCESSING);
    localStorage.setItem(AUDIO_PROCESSING_KEY, JSON.stringify({ version: 1 }));
    expect(loadAudioProcessing()).toEqual(DEFAULT_AUDIO_PROCESSING);
    expect(addLog).toHaveBeenCalledTimes(1);
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("unusable"), expect.any(Object));
  });

  it("clamps gains, amounts and names from a stored or imported record", () => {
    const parsed = parseAudioProcessingRecord({
      version: 2,
      enabled: true,
      sound: { levelling: true, bandsDb: [40, -40, "x", 5], stereoWidth: 250, reverb: -4 },
      userPresets: [{ id: "user-1", name: "  A very long preset name that overflows  ", sound: { bandsDb: [1] } }],
    });
    expect(parsed?.sound.bandsDb).toEqual([12, -12, 0, 5, 0, 0, 0, 0, 0, 0]);
    expect(parsed?.sound.stereoWidth).toBe(100);
    expect(parsed?.sound.reverb).toBe(0);
    expect(parsed?.userPresets[0].name).toHaveLength(24);
    expect(clampEqDb(Number.NaN)).toBe(0);
    expect(clampAudioAmount(-5)).toBe(0);
  });

  it("resets the equalizer without touching the other controls", () => {
    saveAudioBandGain(2, 4);
    saveAudioReverb(25);
    resetAudioEq();
    expect(loadAudioProcessing()).toMatchObject({ bandsDb: new Array(10).fill(0), reverb: 25 });
  });

  it("keeps a raw value from a finer control and only rounds which preset is highlighted", () => {
    saveAudioStereoWidth(55);
    expect(loadAudioProcessing().stereoWidth).toBe(55);
    expect(nearestPreset(STEREO_WIDTH_PRESETS, 55).id).toBe("wide");
    expect(nearestPreset(STEREO_WIDTH_PRESETS, 10).id).toBe("off");
    expect(nearestPreset(STEREO_WIDTH_PRESETS, 30).id).toBe("subtle");
    expect(nearestPreset(REVERB_PRESETS, 41).id).toBe("hall");
  });

  it("reads defaults and ignores writes when storage is unavailable", () => {
    vi.stubGlobal("localStorage", undefined);
    try {
      expect(loadAudioProcessing()).toEqual(DEFAULT_AUDIO_PROCESSING);
      expect(() => saveAudioLevelling(true)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    expect(localStorage.getItem(AUDIO_PROCESSING_KEY)).toBeNull();
  });
});

describe("ambiance presets and user presets", () => {
  beforeEach(() => localStorage.clear());

  it("applies every built-in preset exactly and names it as active", () => {
    for (const preset of AMBIANCE_PRESETS) {
      applySoundPreset(preset.id);
      expect(loadAudioProcessingRecord().sound).toEqual(preset.sound);
      expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe(preset.id);
    }
  });

  it("reads as Custom after a manual change", () => {
    applySoundPreset("hall");
    saveAudioReverb(54);
    expect(activeSoundPreset(loadAudioProcessingRecord())).toBeUndefined();
  });

  it("applying a preset switches the card on", () => {
    saveAudioEnabled(false);
    applySoundPreset("warm");
    expect(loadAudioProcessingRecord().enabled).toBe(true);
  });

  it("toggles between the last two sounds with back to previous sound", () => {
    applySoundPreset("warm");
    applySoundPreset("hall");
    backToPreviousSound();
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe("warm");
    backToPreviousSound();
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe("hall");
  });

  it("does nothing for back to previous sound before any change", () => {
    const before = loadAudioProcessingRecord();
    backToPreviousSound();
    expect(loadAudioProcessingRecord()).toEqual(before);
  });

  it("does not remember the same sound as its own predecessor", () => {
    applySoundPreset("warm");
    applySoundPreset("warm");
    expect(loadAudioProcessingRecord().previous?.bandsDb).toEqual(new Array(10).fill(0));
  });

  it("steps through the presets in both directions and wraps", () => {
    stepSoundPreset(1);
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe(AMBIANCE_PRESETS[1].id);
    stepSoundPreset(-1);
    stepSoundPreset(-1);
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe(AMBIANCE_PRESETS[AMBIANCE_PRESETS.length - 1].id);
    stepSoundPreset(1);
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe("original");
  });

  it("steps from a custom sound to the first or the last preset", () => {
    saveAudioReverb(7);
    stepSoundPreset(1);
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe("original");
    saveAudioReverb(7);
    stepSoundPreset(-1);
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe(AMBIANCE_PRESETS[AMBIANCE_PRESETS.length - 1].id);
  });

  it("saves, renames and deletes up to five user presets", () => {
    saveAudioReverb(40);
    expect(saveUserPreset("  ")).toBe(false);
    for (let n = 1; n <= MAX_USER_PRESETS; n += 1) expect(saveUserPreset(`Mine ${n}`)).toBe(true);
    expect(saveUserPreset("One too many")).toBe(false);
    expect(loadAudioProcessingRecord().userPresets.map((p) => p.id)).toEqual([
      "user-1",
      "user-2",
      "user-3",
      "user-4",
      "user-5",
    ]);
    expect(renameUserPreset("user-2", "Evening")).toBe(true);
    expect(renameUserPreset("user-2", "   ")).toBe(false);
    expect(loadAudioProcessingRecord().userPresets[1].name).toBe("Evening");
    deleteUserPreset("user-3");
    expect(saveUserPreset("Again")).toBe(true);
    expect(loadAudioProcessingRecord().userPresets.map((p) => p.id)).toContain("user-3");
  });

  it("applies a saved user preset", () => {
    saveAudioReverb(40);
    saveUserPreset("Mine");
    applySoundPreset("original");
    applySoundPreset("user-1");
    expect(loadAudioProcessing().reverb).toBe(40);
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe("user-1");
  });

  it("ignores an unknown preset id", () => {
    applySoundPreset("nope");
    expect(activeSoundPreset(loadAudioProcessingRecord())?.id).toBe("original");
    expect(() => applySound(AMBIANCE_PRESETS[0].sound)).not.toThrow();
  });
});

describe("useAudioProcessing", () => {
  beforeEach(() => localStorage.clear());

  it("follows setting changes and keeps the same object when nothing relevant changed", () => {
    const { result } = renderHook(() => useAudioProcessing());
    expect(result.current).toEqual(DEFAULT_AUDIO_PROCESSING);
    act(() => saveAudioReverb(55));
    expect(result.current.reverb).toBe(55);
    const before = result.current;
    act(() => {
      window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: { key: "other" } }));
    });
    expect(result.current).toEqual(before);
  });

  it("stops listening after unmount", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useAudioProcessing());
    unmount();
    expect(remove).toHaveBeenCalledWith("c64u-app-settings-updated", expect.any(Function));
    remove.mockRestore();
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
    for (const db of [1, 2, 3, 4]) saveAudioBandGain(1, db);
    expect(setAudioProcessing).not.toHaveBeenCalled();
    vi.advanceTimersByTime(AUDIO_PROCESSING_PUSH_DELAY_MS + 1);
    expect(setAudioProcessing).toHaveBeenCalledTimes(1);
    expect(setAudioProcessing).toHaveBeenCalledWith({ ...DEFAULT_AUDIO_PROCESSING, bandsDb: flatWith(1, 4) });
    stop();
  });

  it("pushes all off when the switch is turned off", () => {
    saveAudioReverb(55);
    const stop = installAudioProcessingSync();
    setAudioProcessing.mockClear();
    saveAudioEnabled(false);
    vi.advanceTimersByTime(AUDIO_PROCESSING_PUSH_DELAY_MS + 1);
    expect(setAudioProcessing).toHaveBeenCalledWith(DEFAULT_AUDIO_PROCESSING);
    stop();
  });

  it("ignores an event without a string key", () => {
    saveAudioReverb(25);
    const stop = installAudioProcessingSync();
    setAudioProcessing.mockClear();
    window.dispatchEvent(new CustomEvent("c64u-app-settings-updated"));
    window.dispatchEvent(new CustomEvent("c64u-app-settings-updated", { detail: { key: 5 } }));
    vi.advanceTimersByTime(500);
    expect(setAudioProcessing).not.toHaveBeenCalled();
    stop();
  });

  it("cancels a pending push when stopped", () => {
    const stop = installAudioProcessingSync();
    setAudioProcessing.mockClear();
    saveAudioReverb(55);
    stop();
    vi.advanceTimersByTime(500);
    expect(setAudioProcessing).not.toHaveBeenCalled();
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
