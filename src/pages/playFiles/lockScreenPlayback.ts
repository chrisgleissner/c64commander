/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** "Tune 3 of 19" for a file that holds several tunes, otherwise null. */
export const formatTuneAlbum = (tuneNumber: number | null, tuneCount: number | null): string | null => {
  if (tuneNumber === null || tuneCount === null) return null;
  if (tuneCount <= 1 || tuneNumber < 1 || tuneNumber > tuneCount) return null;
  return `Tune ${tuneNumber} of ${tuneCount}`;
};

/** The fraction of the tune a lock-screen seek names, or null when there is no length to divide by. */
export const positionMsToFraction = (positionMs: number, durationMs: number | undefined): number | null => {
  if (!Number.isFinite(positionMs) || !durationMs || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  return Math.min(1, Math.max(0, positionMs / durationMs));
};

/**
 * How far the elapsed time may stray from "last reading plus the wall clock since" before it counts
 * as a seek. The on-screen clock is read about once a second and can stall briefly while the engine
 * refills, so anything under this is the clock keeping its own pace.
 */
export const PLAYBACK_JUMP_TOLERANCE_MS = 1_500;

export type ObservedElapsed = { elapsedMs: number; atMs: number };

/**
 * Whether the elapsed time moved by something other than playing on, which is how a completed seek
 * looks from the clock: Android advances the lock-screen position by itself, so only a discontinuity
 * needs publishing again.
 */
export const isPlaybackPositionJump = ({
  last,
  elapsedMs,
  nowMs,
  playing,
}: {
  last: ObservedElapsed | null;
  elapsedMs: number;
  nowMs: number;
  playing: boolean;
}): boolean => {
  if (!last) return false;
  const expectedMs = last.elapsedMs + (playing ? nowMs - last.atMs : 0);
  return Math.abs(elapsedMs - expectedMs) > PLAYBACK_JUMP_TOLERANCE_MS;
};
