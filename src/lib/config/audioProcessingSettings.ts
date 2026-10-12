/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useState } from "react";

import type { AudioProcessingParams } from "@/lib/native/audioFx";

const LEVELLING_KEY = "c64u_audio_levelling";
const EQ_BASS_KEY = "c64u_audio_eq_bass_db";
const EQ_MID_KEY = "c64u_audio_eq_mid_db";
const EQ_TREBLE_KEY = "c64u_audio_eq_treble_db";
const STEREO_WIDTH_KEY = "c64u_audio_stereo_width";
const REVERB_KEY = "c64u_audio_reverb";

export const AUDIO_EQ_MIN_DB = -12;
export const AUDIO_EQ_MAX_DB = 12;
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

export const DEFAULT_AUDIO_PROCESSING: AudioProcessingParams = {
  levelling: false,
  bassDb: 0,
  midDb: 0,
  trebleDb: 0,
  stereoWidth: 0,
  reverb: 0,
};

const SETTINGS_EVENT = "c64u-app-settings-updated";

const clampRounded = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

export const clampEqDb = (value: number) => clampRounded(value, AUDIO_EQ_MIN_DB, AUDIO_EQ_MAX_DB, 0);
export const clampAudioAmount = (value: number) => clampRounded(value, 0, AUDIO_AMOUNT_MAX, 0);

const readStored = (key: string): string | null =>
  typeof localStorage === "undefined" ? null : localStorage.getItem(key);

const readClamped = (key: string, clamp: (value: number) => number) => {
  const raw = readStored(key);
  return raw === null || raw === "" ? 0 : clamp(Number(raw));
};

const write = (key: string, stored: string, value: unknown) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, stored);
  window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: { key, value } }));
};

export const loadAudioProcessing = (): AudioProcessingParams => ({
  levelling: readStored(LEVELLING_KEY) === "1",
  bassDb: readClamped(EQ_BASS_KEY, clampEqDb),
  midDb: readClamped(EQ_MID_KEY, clampEqDb),
  trebleDb: readClamped(EQ_TREBLE_KEY, clampEqDb),
  stereoWidth: readClamped(STEREO_WIDTH_KEY, clampAudioAmount),
  reverb: readClamped(REVERB_KEY, clampAudioAmount),
});

export const saveAudioLevelling = (enabled: boolean) => write(LEVELLING_KEY, enabled ? "1" : "0", enabled);

export const saveAudioEqBand = (band: "bassDb" | "midDb" | "trebleDb", db: number) => {
  const key = band === "bassDb" ? EQ_BASS_KEY : band === "midDb" ? EQ_MID_KEY : EQ_TREBLE_KEY;
  const clamped = clampEqDb(db);
  write(key, String(clamped), clamped);
};

export const resetAudioEq = () => {
  saveAudioEqBand("bassDb", 0);
  saveAudioEqBand("midDb", 0);
  saveAudioEqBand("trebleDb", 0);
};

export const saveAudioStereoWidth = (value: number) => {
  const clamped = clampAudioAmount(value);
  write(STEREO_WIDTH_KEY, String(clamped), clamped);
};

export const saveAudioReverb = (value: number) => {
  const clamped = clampAudioAmount(value);
  write(REVERB_KEY, String(clamped), clamped);
};

/**
 * The preset whose value is closest to a stored amount. The stored number is kept as it is, so a
 * value written by a build with finer controls survives a round trip through this one; only the
 * highlighted segment is rounded.
 */
export const nearestPreset = <T extends Preset>(presets: readonly T[], value: number): T =>
  presets.reduce((best, preset) => (Math.abs(preset.value - value) < Math.abs(best.value - value) ? preset : best));

export const isAudioProcessingActive = (params: AudioProcessingParams): boolean =>
  params.levelling ||
  params.bassDb !== 0 ||
  params.midDb !== 0 ||
  params.trebleDb !== 0 ||
  params.stereoWidth !== 0 ||
  params.reverb !== 0;

export const formatEqDb = (db: number) => (db > 0 ? `+${db} dB` : `${db} dB`);

/** The processing settings, re-read whenever any app setting changes. */
export const useAudioProcessing = (): AudioProcessingParams => {
  const [params, setParams] = useState<AudioProcessingParams>(loadAudioProcessing);
  useEffect(() => {
    const handler = () =>
      setParams((current) => {
        const next = loadAudioProcessing();
        return JSON.stringify(next) === JSON.stringify(current) ? current : next;
      });
    window.addEventListener(SETTINGS_EVENT, handler);
    return () => window.removeEventListener(SETTINGS_EVENT, handler);
  }, []);
  return params;
};
