/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/** How long before a timed sleep timer's deadline the volume starts to fall, so it reaches the floor on time. */
export const SLEEP_TIMER_FADE_MS = 10_000;

/** Seconds between volume steps. Device steps are slower because each one is a write to the Ultimate. */
export const SLEEP_TIMER_FADE_STEP_MS = { local: 250, device: 1000 } as const;

export const sleepFadeStartsAtMs = (endsAtMs: number, fadeMs = SLEEP_TIMER_FADE_MS) => endsAtMs - fadeMs;

/**
 * The volume step for `nowMs`, falling linearly from `startIndex` when the fade began to 0 at the deadline.
 *
 * Measured from when the fade actually began rather than from its nominal start, so a fade that began
 * late (the page was in the background) still finishes at the deadline without first jumping down.
 */
export const fadedVolumeIndex = (startIndex: number, beganAtMs: number, endsAtMs: number, nowMs: number): number => {
  const span = endsAtMs - beganAtMs;
  if (span <= 0 || nowMs >= endsAtMs) return 0;
  const remaining = Math.min(1, Math.max(0, (endsAtMs - nowMs) / span));
  return Math.round(startIndex * remaining);
};
