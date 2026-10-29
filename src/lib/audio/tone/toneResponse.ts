/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */
import {
  TONE_BAND_COUNT,
  TONE_BAND_HZ,
  TONE_BAND_Q,
  TONE_MAX_DB,
  TONE_MIN_DB,
  TONE_SAMPLE_RATE,
  type BandGains,
} from "@/lib/audio/tone/toneCurve";
import type { ToneTarget } from "@/lib/audio/tone/toneGeometry";

export const TONE_RESPONSE_POINTS = 240;
export const TONE_PLOT_LOW_HZ = 20;
export const TONE_PLOT_HIGH_HZ = 20000;
export const SOLVER_TOLERANCE_DB = 0.01;
const SOLVER_ITERATIONS = 16;
const SOLVER_RIDGE = 0.01;
const JACOBIAN_PROBE_DB = 6;

/** Normalised peaking biquad as dsp/Equalizer.kt designs it: b0, b1, b2, a1, a2. */
export const peakingCoefficients = (centreHz: number, sampleRate: number, gainDb: number): number[] => {
  const amplitude = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * centreHz) / sampleRate;
  const cosW = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * TONE_BAND_Q);
  const a0 = 1 + alpha / amplitude;
  return [
    (1 + alpha * amplitude) / a0,
    (-2 * cosW) / a0,
    (1 - alpha * amplitude) / a0,
    (-2 * cosW) / a0,
    (1 - alpha / amplitude) / a0,
  ];
};

/** Magnitude in dB of one peaking band at one frequency. */
export const bandResponseDb = (band: number, gainDb: number, hz: number, sampleRate = TONE_SAMPLE_RATE): number => {
  if (gainDb === 0) return 0;
  const [b0, b1, b2, a1, a2] = peakingCoefficients(TONE_BAND_HZ[band], sampleRate, gainDb);
  const w = (2 * Math.PI * hz) / sampleRate;
  const nr = b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w);
  const ni = -(b1 * Math.sin(w) + b2 * Math.sin(2 * w));
  const dr = 1 + a1 * Math.cos(w) + a2 * Math.cos(2 * w);
  const di = -(a1 * Math.sin(w) + a2 * Math.sin(2 * w));
  return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
};

/** The true response of the whole cascade at one frequency: the dB responses of the ten bands add. */
export const cascadeResponseDb = (gainsDb: BandGains, hz: number, sampleRate = TONE_SAMPLE_RATE): number =>
  gainsDb.reduce((sum, gain, band) => sum + bandResponseDb(band, gain, hz, sampleRate), 0);

export const responseFrequencies = (points = TONE_RESPONSE_POINTS): number[] =>
  Array.from(
    { length: points },
    (_, index) => TONE_PLOT_LOW_HZ * (TONE_PLOT_HIGH_HZ / TONE_PLOT_LOW_HZ) ** (index / (points - 1)),
  );

export const FREQUENCIES_HZ: readonly number[] = responseFrequencies();

/** The cascade response sampled at {@link FREQUENCIES_HZ}. */
export const sampleResponse = (gainsDb: BandGains, sampleRate = TONE_SAMPLE_RATE): number[] =>
  FREQUENCIES_HZ.map((hz) => cascadeResponseDb(gainsDb, hz, sampleRate));

/** The cascade response at the ten band centres. */
export const responseAtCentres = (gainsDb: BandGains, sampleRate = TONE_SAMPLE_RATE): number[] =>
  TONE_BAND_HZ.map((hz) => cascadeResponseDb(gainsDb, hz, sampleRate));

const clampGain = (value: number) => Math.min(TONE_MAX_DB, Math.max(TONE_MIN_DB, value));

const jacobian = (sampleRate: number): number[][] =>
  TONE_BAND_HZ.map((hz) =>
    Array.from(
      { length: TONE_BAND_COUNT },
      (_, band) => bandResponseDb(band, JACOBIAN_PROBE_DB, hz, sampleRate) / JACOBIAN_PROBE_DB,
    ),
  );

/** Solves matrix x = rhs by Gaussian elimination with partial pivoting. */
export const solveLinear = (matrix: readonly (readonly number[])[], rhs: readonly number[]): number[] => {
  const n = rhs.length;
  const m = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = col + 1; row < n; row += 1) {
      const factor = m[row][col] / m[col][col];
      for (let k = col; k <= n; k += 1) m[row][k] -= factor * m[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = m[row][n];
    for (let k = row + 1; k < n; k += 1) sum -= m[row][k] * x[k];
    x[row] = sum / m[row][row];
  }
  return x;
};

/**
 * Band gains that make the drawn cascade response pass through the target points at the ten centres.
 * Adjacent bands overlap, so a band's own gain is not the response at its centre. A ridge-regularised
 * Newton iteration in dB, clamped to the band range at every step, finds them; a target that cannot be
 * reached inside the clamp ends at the nearest reachable value. All-zero targets return exactly zeros;
 * a missing or non-finite target counts as 0 dB.
 */
export const compensatedGains = (requestedDb: BandGains, sampleRate = TONE_SAMPLE_RATE): number[] => {
  const targetsDb = Array.from({ length: TONE_BAND_COUNT }, (_, band) =>
    Number.isFinite(requestedDb[band]) ? requestedDb[band] : 0,
  );
  if (targetsDb.every((db) => db === 0)) return new Array<number>(TONE_BAND_COUNT).fill(0);
  const a = jacobian(sampleRate).map((row, i) => row.map((v, j) => v + (i === j ? SOLVER_RIDGE : 0)));
  let gains = targetsDb.map((db) => clampGain(db));
  for (let step = 0; step < SOLVER_ITERATIONS; step += 1) {
    const reached = responseAtCentres(gains, sampleRate);
    const error = targetsDb.map((db, i) => db - reached[i]);
    if (
      error.every(
        (e, i) => Math.abs(e) < SOLVER_TOLERANCE_DB || (Math.abs(gains[i]) >= TONE_MAX_DB && e * gains[i] > 0),
      )
    )
      break;
    const delta = solveLinear(a, error);
    gains = gains.map((gain, i) => clampGain(gain + delta[i]));
  }
  return gains.map((gain) => Math.round(gain * 100) / 100 + 0);
};

/** The values the drawn curve actually reaches at the centres for these target points. */
export const reachableTargets = (targetsDb: BandGains, sampleRate = TONE_SAMPLE_RATE): number[] =>
  responseAtCentres(compensatedGains(targetsDb, sampleRate), sampleRate);

/** The handles the plot draws for these target points: each at the value the filters reach at its centre. */
export const plotTargets = (targetsDb: BandGains, sampleRate = TONE_SAMPLE_RATE): ToneTarget[] => {
  const reached = reachableTargets(targetsDb, sampleRate);
  return TONE_BAND_HZ.map((freq, band) => ({ band, freq, db: reached[band], setDb: targetsDb[band] }));
};
