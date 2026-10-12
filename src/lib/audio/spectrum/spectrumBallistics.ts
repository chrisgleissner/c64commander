/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { SPECTRUM_FLOOR_DB } from "@/lib/audio/spectrum/spectrumBands";

export interface SpectrumBallisticsOptions {
  attackMs: number;
  releaseMs: number;
  peakHoldMs: number;
  peakFallDbPerSecond: number;
}

export const SPECTRUM_BALLISTICS: SpectrumBallisticsOptions = {
  attackMs: 10,
  releaseMs: 180,
  peakHoldMs: 600,
  peakFallDbPerSecond: 24,
};

/** Reduced motion keeps every value but lets bars settle more slowly, so there is less flicker. */
export const SPECTRUM_BALLISTICS_REDUCED: SpectrumBallisticsOptions = {
  ...SPECTRUM_BALLISTICS,
  attackMs: 40,
  releaseMs: 420,
};

export interface SpectrumBallisticsState {
  levels: Float32Array;
  peaks: Float32Array;
  holdMsLeft: Float32Array;
}

export const createBallistics = (bars: number): SpectrumBallisticsState => ({
  levels: new Float32Array(bars).fill(SPECTRUM_FLOOR_DB),
  peaks: new Float32Array(bars).fill(SPECTRUM_FLOOR_DB),
  holdMsLeft: new Float32Array(bars),
});

export const resetBallistics = (state: SpectrumBallisticsState): void => {
  state.levels.fill(SPECTRUM_FLOOR_DB);
  state.peaks.fill(SPECTRUM_FLOOR_DB);
  state.holdMsLeft.fill(0);
};

/**
 * Moves each displayed level toward its target and updates the peak-hold caps, in place. The target
 * arrives at the data rate and this runs at the draw rate, so the exponential approach is what
 * turns 30 samples a second into motion that is smooth at 60.
 *
 * A cap holds for `peakHoldMs`, then falls at a constant rate, and never drops below its bar.
 */
export const stepBallistics = (
  state: SpectrumBallisticsState,
  target: ArrayLike<number>,
  elapsedMs: number,
  options: SpectrumBallisticsOptions = SPECTRUM_BALLISTICS,
): void => {
  if (elapsedMs <= 0) return;
  const attack = 1 - Math.exp(-elapsedMs / options.attackMs);
  const release = 1 - Math.exp(-elapsedMs / options.releaseMs);
  const { levels, peaks, holdMsLeft } = state;
  for (let i = 0; i < levels.length; i++) {
    const goal = target[i];
    const level = levels[i];
    const next = level + (goal - level) * (goal > level ? attack : release);
    levels[i] = next;
    if (next >= peaks[i]) {
      peaks[i] = next;
      holdMsLeft[i] = options.peakHoldMs;
      continue;
    }
    const heldMs = Math.min(holdMsLeft[i], elapsedMs);
    holdMsLeft[i] -= heldMs;
    const fallingMs = elapsedMs - heldMs;
    peaks[i] = Math.max(next, peaks[i] - (options.peakFallDbPerSecond * fallingMs) / 1000);
  }
};
