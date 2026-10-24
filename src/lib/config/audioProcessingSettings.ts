/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import { useEffect, useState } from "react";

import { addLog } from "@/lib/logging";
import type { AudioProcessingParams } from "@/lib/native/audioFx";
import {
  AMBIANCE_PRESETS,
  ORIGINAL_SOUND,
  cloneSound,
  soundsEqual,
  type SoundSettings,
} from "@/lib/audio/tone/ambiancePresets";
import {
  TONE_MAX_DB,
  TONE_MIN_DB,
  clampToneDb,
  legacyBands,
  normalizeBands,
  withBandGain,
} from "@/lib/audio/tone/toneCurve";

export const AUDIO_PROCESSING_KEY = "audio_processing";
export const AUDIO_PROCESSING_VERSION = 2 as const;
export const MAX_USER_PRESETS = 5;
export const MAX_PRESET_NAME_LENGTH = 24;

const LEGACY_LEVELLING_KEY = "c64u_audio_levelling";
const LEGACY_EQ_KEYS = ["c64u_audio_eq_bass_db", "c64u_audio_eq_mid_db", "c64u_audio_eq_treble_db"] as const;
const LEGACY_STEREO_WIDTH_KEY = "c64u_audio_stereo_width";
const LEGACY_REVERB_KEY = "c64u_audio_reverb";
const LEGACY_KEYS = [LEGACY_LEVELLING_KEY, ...LEGACY_EQ_KEYS, LEGACY_STEREO_WIDTH_KEY, LEGACY_REVERB_KEY];

export const AUDIO_AMOUNT_MAX = 100;

export const STEREO_WIDTH_PRESETS = [
  { id: "off", label: "Off", value: 0 },
  { id: "subtle", label: "Subtle", value: 35 },
  { id: "wide", label: "Wide", value: 70 },
] as const;

export const REVERB_PRESETS = [
  { id: "off", label: "Off", value: 0 },
  { id: "room", label: "Room", value: 25 },
  { id: "hall", label: "Hall", value: 55 },
] as const;

type Preset = { id: string; label: string; value: number };

export interface UserPreset {
  id: string;
  name: string;
  sound: SoundSettings;
}

export interface AudioProcessingRecord {
  version: typeof AUDIO_PROCESSING_VERSION;
  enabled: boolean;
  sound: SoundSettings;
  previous: SoundSettings | null;
  userPresets: UserPreset[];
}

export const DEFAULT_AUDIO_PROCESSING: AudioProcessingParams = {
  levelling: false,
  bandsDb: new Array<number>(10).fill(0),
  stereoWidth: 0,
  reverb: 0,
};

const SETTINGS_EVENT = "c64u-app-settings-updated";

const clampRounded = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export const clampEqDb = clampToneDb;
export const clampAudioAmount = (value: number) => clampRounded(value, 0, AUDIO_AMOUNT_MAX, 0);

export const defaultAudioProcessingRecord = (): AudioProcessingRecord => ({
  version: AUDIO_PROCESSING_VERSION,
  enabled: true,
  sound: cloneSound(ORIGINAL_SOUND),
  previous: null,
  userPresets: [],
});

const asSound = (value: unknown): SoundSettings | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.bandsDb)) return null;
  return {
    levelling: raw.levelling === true,
    bandsDb: normalizeBands(raw.bandsDb),
    stereoWidth: clampAudioAmount(Number(raw.stereoWidth ?? 0)),
    reverb: clampAudioAmount(Number(raw.reverb ?? 0)),
  };
};

const cleanName = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, MAX_PRESET_NAME_LENGTH) : "";

/** Validates a stored or imported record. Returns null when it is not a usable version 2 record. */
export const parseAudioProcessingRecord = (value: unknown): AudioProcessingRecord | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== AUDIO_PROCESSING_VERSION) return null;
  const sound = asSound(raw.sound);
  if (!sound) return null;
  const userPresets: UserPreset[] = [];
  for (const entry of Array.isArray(raw.userPresets) ? raw.userPresets : []) {
    const candidate = entry as Record<string, unknown> | null;
    const presetSound = asSound(candidate?.sound);
    const name = cleanName(candidate?.name);
    const id = typeof candidate?.id === "string" ? candidate.id : "";
    if (presetSound && name && id && userPresets.length < MAX_USER_PRESETS && !userPresets.some((p) => p.id === id)) {
      userPresets.push({ id, name, sound: presetSound });
    }
  }
  return {
    version: AUDIO_PROCESSING_VERSION,
    enabled: raw.enabled !== false,
    sound,
    previous: asSound(raw.previous),
    userPresets,
  };
};

let invalidReported = false;

export const resetAudioProcessingWarningsForTests = () => {
  invalidReported = false;
};

const reportInvalid = (reason: string, detail: Record<string, unknown>) => {
  if (invalidReported) return;
  invalidReported = true;
  addLog("warn", "Audio processing settings are unusable; using the original sound", { reason, ...detail });
};

const readStored = (key: string): string | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch (error) {
    addLog("warn", "Audio processing settings: storage read failed", {
      key,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
    return null;
  }
};

const legacyNumber = (key: string, clamp: (value: number) => number): number => {
  const raw = readStored(key);
  return raw === null || raw === "" ? 0 : clamp(Number(raw));
};

const readLegacyRecord = (): AudioProcessingRecord | null => {
  if (LEGACY_KEYS.every((key) => readStored(key) === null)) return null;
  const [bass, mid, treble] = LEGACY_EQ_KEYS.map((key) => legacyNumber(key, clampToneDb));
  const sound: SoundSettings = {
    levelling: readStored(LEGACY_LEVELLING_KEY) === "1",
    bandsDb: legacyBands(bass, mid, treble),
    stereoWidth: legacyNumber(LEGACY_STEREO_WIDTH_KEY, clampAudioAmount),
    reverb: legacyNumber(LEGACY_REVERB_KEY, clampAudioAmount),
  };
  return { ...defaultAudioProcessingRecord(), sound };
};

const persist = (record: AudioProcessingRecord) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(AUDIO_PROCESSING_KEY, JSON.stringify(record));
};

const migrateLegacy = (record: AudioProcessingRecord) => {
  try {
    persist(record);
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
  } catch (error) {
    addLog("warn", "Audio processing settings: migration could not be stored", {
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
};

/** Reads the record. The old c64u_audio_ keys are converted once, then removed. */
export const loadAudioProcessingRecord = (): AudioProcessingRecord => {
  const raw = readStored(AUDIO_PROCESSING_KEY);
  if (raw === null) {
    const legacy = readLegacyRecord();
    if (!legacy) return defaultAudioProcessingRecord();
    migrateLegacy(legacy);
    return legacy;
  }
  try {
    const parsed = parseAudioProcessingRecord(JSON.parse(raw));
    if (parsed) return parsed;
    reportInvalid("unexpected shape or version", { key: AUDIO_PROCESSING_KEY });
  } catch (error) {
    reportInvalid("not valid JSON", {
      key: AUDIO_PROCESSING_KEY,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
    });
  }
  return defaultAudioProcessingRecord();
};

export const saveAudioProcessingRecord = (record: AudioProcessingRecord) => {
  if (typeof localStorage === "undefined") return;
  persist(record);
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { key: AUDIO_PROCESSING_KEY, value: record } }));
};

const update = (change: (record: AudioProcessingRecord) => AudioProcessingRecord) =>
  saveAudioProcessingRecord(change(loadAudioProcessingRecord()));

const withSound = (record: AudioProcessingRecord, sound: SoundSettings): AudioProcessingRecord => ({
  ...record,
  sound,
});

/** What the native chain should do now: the stored sound, or all off while the switch is off. */
export const effectiveAudioProcessing = (record: AudioProcessingRecord): AudioProcessingParams =>
  record.enabled
    ? { ...cloneSound(record.sound) }
    : { levelling: false, bandsDb: new Array<number>(10).fill(0), stereoWidth: 0, reverb: 0 };

export const loadAudioProcessing = (): AudioProcessingParams => effectiveAudioProcessing(loadAudioProcessingRecord());

export const saveAudioEnabled = (enabled: boolean) => update((record) => ({ ...record, enabled }));

export const saveAudioLevelling = (levelling: boolean) =>
  update((record) => withSound(record, { ...record.sound, levelling }));

export const saveAudioBandGain = (band: number, db: number) =>
  update((record) => withSound(record, { ...record.sound, bandsDb: withBandGain(record.sound.bandsDb, band, db) }));

export const saveAudioBands = (bandsDb: readonly number[]) =>
  update((record) => withSound(record, { ...record.sound, bandsDb: normalizeBands(bandsDb) }));

export const resetAudioEq = () => saveAudioBands([]);

export const saveAudioStereoWidth = (value: number) =>
  update((record) => withSound(record, { ...record.sound, stereoWidth: clampAudioAmount(value) }));

export const saveAudioReverb = (value: number) =>
  update((record) => withSound(record, { ...record.sound, reverb: clampAudioAmount(value) }));

/** Makes a whole sound current and remembers the one it replaces, for "Back to previous sound". */
export const applySound = (sound: SoundSettings) =>
  update((record) =>
    soundsEqual(record.sound, sound)
      ? { ...record, enabled: true }
      : { ...record, enabled: true, previous: cloneSound(record.sound), sound: cloneSound(sound) },
  );

export const backToPreviousSound = () =>
  update((record) =>
    record.previous ? { ...record, enabled: true, sound: record.previous, previous: record.sound } : record,
  );

export type SoundPreset = { id: string; label: string; sound: SoundSettings; builtIn: boolean };

export const allSoundPresets = (record: AudioProcessingRecord): SoundPreset[] => [
  ...AMBIANCE_PRESETS.map((preset) => ({ ...preset, builtIn: true })),
  ...record.userPresets.map((preset) => ({ id: preset.id, label: preset.name, sound: preset.sound, builtIn: false })),
];

/** The preset the current sound equals exactly, or undefined, which the card calls "Custom". */
export const activeSoundPreset = (record: AudioProcessingRecord): SoundPreset | undefined =>
  allSoundPresets(record).find((preset) => soundsEqual(preset.sound, record.sound));

export const applySoundPreset = (id: string) => {
  const preset = allSoundPresets(loadAudioProcessingRecord()).find((candidate) => candidate.id === id);
  if (preset) applySound(preset.sound);
};

/** Steps through the preset list: 1 for the next sound, -1 for the previous one. Wraps around. */
export const stepSoundPreset = (direction: 1 | -1) => {
  const record = loadAudioProcessingRecord();
  const presets = allSoundPresets(record);
  const current = presets.findIndex((preset) => soundsEqual(preset.sound, record.sound));
  const next =
    current < 0 ? (direction === 1 ? 0 : presets.length - 1) : (current + direction + presets.length) % presets.length;
  applySound(presets[next].sound);
};

const nextUserPresetId = (presets: readonly UserPreset[]): string => {
  for (let n = 1; ; n += 1) {
    if (!presets.some((preset) => preset.id === `user-${n}`)) return `user-${n}`;
  }
};

/** Saves the current sound under a name. Returns false when the name is empty or five presets exist already. */
export const saveUserPreset = (name: string): boolean => {
  const record = loadAudioProcessingRecord();
  const cleaned = cleanName(name);
  if (!cleaned || record.userPresets.length >= MAX_USER_PRESETS) return false;
  saveAudioProcessingRecord({
    ...record,
    userPresets: [
      ...record.userPresets,
      { id: nextUserPresetId(record.userPresets), name: cleaned, sound: cloneSound(record.sound) },
    ],
  });
  return true;
};

export const renameUserPreset = (id: string, name: string): boolean => {
  const cleaned = cleanName(name);
  if (!cleaned) return false;
  update((record) => ({
    ...record,
    userPresets: record.userPresets.map((preset) => (preset.id === id ? { ...preset, name: cleaned } : preset)),
  }));
  return true;
};

export const deleteUserPreset = (id: string) =>
  update((record) => ({ ...record, userPresets: record.userPresets.filter((preset) => preset.id !== id) }));

/**
 * The preset whose value is closest to a stored amount. The stored number is kept as it is, so a
 * value written by a build with finer controls survives a round trip through this one; only the
 * highlighted segment is rounded.
 */
export const nearestPreset = <T extends Preset>(presets: readonly T[], value: number): T =>
  presets.reduce((best, preset) => (Math.abs(preset.value - value) < Math.abs(best.value - value) ? preset : best));

export const isAudioProcessingActive = (params: AudioProcessingParams): boolean =>
  params.levelling || params.bandsDb.some((db) => db !== 0) || params.stereoWidth !== 0 || params.reverb !== 0;

/** The stored record, re-read whenever any app setting changes. */
export const useAudioProcessingRecord = (): AudioProcessingRecord => {
  const [record, setRecord] = useState<AudioProcessingRecord>(loadAudioProcessingRecord);
  useEffect(() => {
    const handler = () =>
      setRecord((current) => {
        const next = loadAudioProcessingRecord();
        return JSON.stringify(next) === JSON.stringify(current) ? current : next;
      });
    window.addEventListener(SETTINGS_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_EVENT, handler);
  }, []);
  return record;
};

/** What the native chain is doing now, re-read whenever any app setting changes. */
export const useAudioProcessing = (): AudioProcessingParams => {
  const record = useAudioProcessingRecord();
  return effectiveAudioProcessing(record);
};
