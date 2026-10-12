/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The spectrum band layout. The native analyser uses the same formula, so a band index means the
 * same frequency range on both sides of the plugin.
 *
 * Band i covers [f(i), f(i + 1)) with f(i) = 31.25 * 2^(i * 9 / 48) Hz for i = 0..48, which is
 * 31.25 Hz to 16 kHz in 9 octaves, 5.33 bands per octave. Band values are integer dBFS, 0 being a
 * full-scale sine inside the band and -100 the floor.
 */
export const SPECTRUM_BAND_COUNT = 48;
export const SPECTRUM_LOW_HZ = 31.25;
export const SPECTRUM_OCTAVES = 9;
export const SPECTRUM_FLOOR_DB = -100;

/** The scale the picture shows. Anything quieter than the lower end is drawn as an empty bar. */
export const SPECTRUM_DISPLAY_MIN_DB = -72;
export const SPECTRUM_DISPLAY_MAX_DB = 0;

export const spectrumEdgeHz = (edgeIndex: number): number =>
  SPECTRUM_LOW_HZ * 2 ** ((edgeIndex * SPECTRUM_OCTAVES) / SPECTRUM_BAND_COUNT);

export const SPECTRUM_EDGES_HZ: readonly number[] = Array.from({ length: SPECTRUM_BAND_COUNT + 1 }, (_, index) =>
  spectrumEdgeHz(index),
);

/** Horizontal position of a frequency across the layout, 0 at the lowest edge and 1 at the highest. */
export const frequencyToUnit = (hz: number): number => Math.log2(hz / SPECTRUM_LOW_HZ) / SPECTRUM_OCTAVES;

/** Height of a level on the display scale, 0 at the bottom and 1 at the top. */
export const levelToUnit = (db: number): number => {
  const unit = (db - SPECTRUM_DISPLAY_MIN_DB) / (SPECTRUM_DISPLAY_MAX_DB - SPECTRUM_DISPLAY_MIN_DB);
  return unit <= 0 ? 0 : unit >= 1 ? 1 : unit;
};

/**
 * Folds `source` into `target.length` bands by taking the loudest of each group, so a quality tier
 * with fewer bars reads at the same level as the full layout. `source.length` must be a multiple of
 * `target.length`.
 */
export const foldBands = (source: ArrayLike<number>, target: Float32Array): void => {
  const group = source.length / target.length;
  for (let bar = 0; bar < target.length; bar++) {
    let loudest = SPECTRUM_FLOOR_DB;
    const start = bar * group;
    for (let i = start; i < start + group; i++) {
      const value = source[i];
      if (value > loudest) loudest = value;
    }
    target[bar] = loudest;
  }
};
