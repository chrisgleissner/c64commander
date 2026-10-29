/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { BandGains } from "./toneCurve";

/** One complete sound: the curve, normalize volume, stereo width and reverb. */
export interface SoundSettings {
  levelling: boolean;
  bandsDb: number[];
  stereoWidth: number;
  reverb: number;
}

export interface AmbiancePreset {
  id: string;
  label: string;
  sound: SoundSettings;
}

const sound = (
  bandsDb: BandGains,
  options: { levelling?: boolean; stereoWidth?: number; reverb?: number } = {},
): SoundSettings => ({
  levelling: options.levelling ?? false,
  bandsDb: [...bandsDb],
  stereoWidth: options.stereoWidth ?? 0,
  reverb: options.reverb ?? 0,
});

const FLAT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

export const AMBIANCE_PRESETS: readonly AmbiancePreset[] = [
  { id: "original", label: "Original", sound: sound(FLAT) },
  {
    id: "late-night",
    label: "Late night",
    sound: sound([2, 2, 1, 0, 0, 0, -1, -2, -3, -4], { levelling: true }),
  },
  { id: "headphones", label: "Headphones", sound: sound(FLAT, { stereoWidth: 35, reverb: 25 }) },
  {
    id: "phone-speaker",
    label: "Phone speaker",
    sound: sound([0, 0, 1, 4, 4, 2, 0, 3, 4, 3], { levelling: true }),
  },
  { id: "warm", label: "Warm", sound: sound([3, 4, 4, 3, 1, 0, -1, -2, -3, -4]) },
  { id: "bright-arcade", label: "Bright arcade", sound: sound([0, 0, 0, 0, 0, 1, 3, 5, 5, 4]) },
  { id: "hall", label: "Hall", sound: sound(FLAT, { stereoWidth: 70, reverb: 55 }) },
  { id: "studio", label: "Studio", sound: sound(FLAT, { stereoWidth: 35 }) },
];

export const ORIGINAL_SOUND: SoundSettings = AMBIANCE_PRESETS[0].sound;

export const cloneSound = (value: SoundSettings): SoundSettings => ({ ...value, bandsDb: [...value.bandsDb] });

export const soundsEqual = (a: SoundSettings, b: SoundSettings): boolean =>
  a.levelling === b.levelling &&
  a.stereoWidth === b.stereoWidth &&
  a.reverb === b.reverb &&
  a.bandsDb.length === b.bandsDb.length &&
  a.bandsDb.every((value, index) => value === b.bandsDb[index]);
