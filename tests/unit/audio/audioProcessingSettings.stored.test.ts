/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addLog = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logging", () => ({ addLog }));
const setAudioProcessing = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/native/audioFx", () => ({ setAudioProcessing }));

import {
  AUDIO_PROCESSING_KEY,
  MAX_USER_PRESETS,
  loadAudioProcessing,
  loadAudioProcessingRecord,
  parseAudioProcessingRecord,
  resetAudioProcessingWarningsForTests,
  saveAudioEnabled,
  saveAudioReverb,
  saveAudioProcessingRecord,
  defaultAudioProcessingRecord,
} from "@/lib/config/audioProcessingSettings";
import { installAudioProcessingSync } from "@/lib/audio/audioProcessingSync";

const sound = { levelling: false, bandsDb: [0, 0, 0, 0, 0, 3, 0, 0, 0, 0], stereoWidth: 0, reverb: 0 };

describe("stored audio processing record", () => {
  beforeEach(() => {
    localStorage.clear();
    addLog.mockClear();
    setAudioProcessing.mockClear();
    resetAudioProcessingWarningsForTests();
  });
  afterEach(() => vi.restoreAllMocks());

  it("leaves a record of a newer version byte for byte untouched on read, at start-up and through the push", () => {
    const newer = JSON.stringify({ version: 3, enabled: true, sound, layers: [{ kind: "future" }] });
    localStorage.setItem(AUDIO_PROCESSING_KEY, newer);

    expect(loadAudioProcessingRecord().sound.bandsDb).toEqual(new Array(10).fill(0));
    expect(loadAudioProcessing().bandsDb).toEqual(new Array(10).fill(0));
    const stop = installAudioProcessingSync();
    stop();

    expect(localStorage.getItem(AUDIO_PROCESSING_KEY)).toBe(newer);
    expect(addLog).toHaveBeenCalledTimes(1);
  });

  it("replaces a record of a newer version only when the person changes a setting", () => {
    localStorage.setItem(AUDIO_PROCESSING_KEY, JSON.stringify({ version: 3, sound }));
    saveAudioEnabled(false);
    expect(JSON.parse(localStorage.getItem(AUDIO_PROCESSING_KEY) ?? "{}")).toMatchObject({
      version: 2,
      enabled: false,
    });
  });

  it("does not read the old keys again once a record exists", () => {
    localStorage.setItem(AUDIO_PROCESSING_KEY, JSON.stringify({ version: 3 }));
    localStorage.setItem("c64u_audio_reverb", "70");
    expect(loadAudioProcessingRecord().sound.reverb).toBe(0);
    expect(localStorage.getItem("c64u_audio_reverb")).toBe("70");
  });

  it("reads as the original sound, with one warning, when the storage read throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    expect(loadAudioProcessingRecord()).toEqual(defaultAudioProcessingRecord());
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Audio processing settings: storage read failed",
      expect.objectContaining({ key: AUDIO_PROCESSING_KEY, error: expect.stringContaining("storage blocked") }),
    );
  });

  it("still returns the migrated sound, and says so, when the migration cannot be stored", () => {
    localStorage.setItem("c64u_audio_levelling", "1");
    localStorage.setItem("c64u_audio_eq_bass_db", "4");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const record = loadAudioProcessingRecord();
    expect(record.sound.levelling).toBe(true);
    expect(record.sound.bandsDb.slice(1, 3)).toEqual([4, 4]);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Audio processing settings: migration could not be stored",
      expect.objectContaining({ error: expect.stringContaining("quota exceeded") }),
    );
    expect(localStorage.getItem("c64u_audio_levelling")).toBe("1");
  });

  it("migrates an old record whose values are damaged to flat and off", () => {
    localStorage.setItem("c64u_audio_levelling", "yes");
    localStorage.setItem("c64u_audio_eq_mid_db", "loud");
    localStorage.setItem("c64u_audio_reverb", "");
    expect(loadAudioProcessing()).toEqual({
      levelling: false,
      bandsDb: new Array(10).fill(0),
      stereoWidth: 0,
      reverb: 0,
    });
  });

  it("does nothing when storage does not exist", () => {
    vi.stubGlobal("localStorage", undefined);
    try {
      expect(() => saveAudioProcessingRecord(defaultAudioProcessingRecord())).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts only objects with a version 2 header and a band array", () => {
    expect(parseAudioProcessingRecord(null)).toBeNull();
    expect(parseAudioProcessingRecord("text")).toBeNull();
    expect(parseAudioProcessingRecord({ version: 2 })).toBeNull();
    expect(parseAudioProcessingRecord({ version: 2, sound: null })).toBeNull();
    expect(parseAudioProcessingRecord({ version: 2, sound: { stereoWidth: 5 } })).toBeNull();
    expect(parseAudioProcessingRecord({ version: 2, sound })).toMatchObject({ enabled: true, previous: null });
    expect(parseAudioProcessingRecord({ version: 2, sound, enabled: false })?.enabled).toBe(false);
  });

  it("keeps a usable previous sound and drops an unusable one", () => {
    expect(parseAudioProcessingRecord({ version: 2, sound, previous: sound })?.previous?.bandsDb[5]).toBe(3);
    expect(parseAudioProcessingRecord({ version: 2, sound, previous: { bandsDb: "x" } })?.previous).toBeNull();
  });

  it("keeps only well-formed saved sounds: a name, a unique id, a band array, at most five", () => {
    const entry = (id: unknown, name: unknown, s: unknown = sound) => ({ id, name, sound: s });
    const parsed = parseAudioProcessingRecord({
      version: 2,
      sound,
      userPresets: [
        entry("user-1", "First"),
        entry("user-1", "Duplicate id"),
        entry("user-2", "   "),
        entry("user-3", 42),
        entry(7, "Numeric id"),
        entry("user-4", "No bands", { bandsDb: null }),
        null,
        "text",
        entry("user-5", "Second"),
        entry("user-6", "Third"),
        entry("user-7", "Fourth"),
        entry("user-8", "Fifth"),
        entry("user-9", "Sixth, over the limit"),
      ],
    });
    expect(parsed?.userPresets.map((preset) => preset.name)).toEqual(["First", "Second", "Third", "Fourth", "Fifth"]);
    expect(parsed?.userPresets).toHaveLength(MAX_USER_PRESETS);
  });

  it("ignores a saved-sounds field that is not a list", () => {
    expect(parseAudioProcessingRecord({ version: 2, sound, userPresets: "none" })?.userPresets).toEqual([]);
  });

  it("keeps following a change when storage refuses the write: one warning, the event still fires, the value stays", () => {
    const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const events: unknown[] = [];
    const listen = (event: Event) => events.push((event as CustomEvent).detail?.key);
    window.addEventListener("c64u-app-settings-updated", listen);
    try {
      expect(() => saveAudioReverb(55)).not.toThrow();
      expect(() => saveAudioReverb(70)).not.toThrow();
    } finally {
      window.removeEventListener("c64u-app-settings-updated", listen);
    }
    expect(events).toEqual([AUDIO_PROCESSING_KEY, AUDIO_PROCESSING_KEY]);
    expect(loadAudioProcessingRecord().sound.reverb).toBe(70);
    expect(loadAudioProcessing().reverb).toBe(70);
    const warnings = addLog.mock.calls.filter(([, message]) => String(message).includes("could not be stored"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0][2]).toMatchObject({
      key: AUDIO_PROCESSING_KEY,
      error: expect.stringContaining("quota exceeded"),
    });

    refuse.mockRestore();
    saveAudioReverb(25);
    expect(JSON.parse(localStorage.getItem(AUDIO_PROCESSING_KEY) ?? "{}").sound.reverb).toBe(25);
    expect(loadAudioProcessingRecord().sound.reverb).toBe(25);
  });
});
