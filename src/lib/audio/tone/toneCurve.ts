/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const TONE_BAND_HZ = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;
export const TONE_BAND_COUNT = TONE_BAND_HZ.length;
export const TONE_MIN_DB = -12;
export const TONE_MAX_DB = 12;
export const TONE_BAND_Q = 1.4;
/** The native pipeline designs its filters at the device output rate, 48 kHz on the supported phones; see toneResponse.test.ts for the error at 44.1 kHz. */
export const TONE_SAMPLE_RATE = 48000;

export type BandGains = readonly number[];

export const flatBands = (): number[] => new Array<number>(TONE_BAND_COUNT).fill(0);

export const clampToneDb = (value: number): number =>
  Number.isFinite(value) ? Math.min(TONE_MAX_DB, Math.max(TONE_MIN_DB, Math.round(value))) : 0;

/** Ten clamped whole-dB gains; anything that is not an array of numbers reads as flat, missing entries as 0. */
export const normalizeBands = (value: unknown): number[] =>
  Array.isArray(value)
    ? Array.from({ length: TONE_BAND_COUNT }, (_, index) => clampToneDb(Number(value[index] ?? 0)))
    : flatBands();

export const bandsEqual = (a: BandGains, b: BandGains): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export const isFlat = (bands: BandGains): boolean => bands.every((value) => value === 0);

/** The old three-band settings spread over the ten bands, the same way the native side maps them. */
export const legacyBands = (bassDb: number, midDb: number, trebleDb: number): number[] =>
  normalizeBands([0, bassDb, bassDb, 0, midDb, midDb, midDb, trebleDb, trebleDb, trebleDb]);

const PLOT_LOW_HZ = 20;
const PLOT_HIGH_HZ = 20000;

/** Position of a frequency on the log axis, 0 at 20 Hz and 1 at 20 kHz. */
export const frequencyToFraction = (hz: number): number =>
  Math.log(hz / PLOT_LOW_HZ) / Math.log(PLOT_HIGH_HZ / PLOT_LOW_HZ);

export const fractionToFrequency = (fraction: number): number =>
  PLOT_LOW_HZ * (PLOT_HIGH_HZ / PLOT_LOW_HZ) ** Math.min(1, Math.max(0, fraction));

export const dbToFraction = (db: number): number => (TONE_MAX_DB - db) / (TONE_MAX_DB - TONE_MIN_DB);

export const fractionToDb = (fraction: number): number =>
  clampToneDb(TONE_MAX_DB - fraction * (TONE_MAX_DB - TONE_MIN_DB));

export const formatBandHz = (hz: number): string => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);

export const formatToneDb = (db: number): string => (db > 0 ? `+${db} dB` : `${db} dB`);

/** The nearest of the ten bands to a position on the log axis. */
export const nearestBandAtFraction = (fraction: number): number => {
  let best = 0;
  let distance = Infinity;
  TONE_BAND_HZ.forEach((hz, index) => {
    const gap = Math.abs(frequencyToFraction(hz) - fraction);
    if (gap < distance) {
      distance = gap;
      best = index;
    }
  });
  return best;
};

export const withBandGain = (bands: BandGains, index: number, db: number): number[] =>
  bands.map((value, at) => (at === index ? clampToneDb(db) : value));

export interface TonePreset {
  id: string;
  label: string;
  bandsDb: readonly number[];
}

export const TONE_PRESETS: readonly TonePreset[] = [
  { id: "flat", label: "Flat", bandsDb: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "bass-boost", label: "Bass boost", bandsDb: [6, 6, 5, 3, 1, 0, 0, 0, 0, 0] },
  { id: "treble-boost", label: "Treble boost", bandsDb: [0, 0, 0, 0, 0, 1, 2, 4, 5, 6] },
  { id: "vocal-presence", label: "Vocal presence", bandsDb: [-2, -1, 0, 0, 1, 2, 4, 3, 1, 0] },
  { id: "loudness", label: "Loudness", bandsDb: [6, 5, 3, 0, -1, -1, 0, 2, 4, 5] },
  { id: "warm", label: "Warm", bandsDb: [3, 3, 3, 2, 1, 0, -1, -2, -3, -4] },
  { id: "bright", label: "Bright", bandsDb: [-1, -1, 0, 0, 0, 1, 3, 4, 5, 5] },
];

export const activeTonePreset = (bands: BandGains): TonePreset | undefined =>
  TONE_PRESETS.find((preset) => bandsEqual(preset.bandsDb, bands));
