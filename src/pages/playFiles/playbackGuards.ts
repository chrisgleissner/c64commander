/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type BooleanRef = { current: boolean };

export const tryAcquireSingleFlight = (ref: BooleanRef): boolean => {
  if (ref.current) return false;
  ref.current = true;
  return true;
};

export const releaseSingleFlight = (ref: BooleanRef): void => {
  ref.current = false;
};

export type VolumeUiTarget = {
  index: number;
  setAtMs: number;
};

export type VolumeSyncDecision = "apply" | "clear" | "defer";

export const resolveVolumeSyncDecision = (
  pendingTarget: VolumeUiTarget | null,
  nextIndex: number,
  nowMs: number,
  holdMs = 2500,
): VolumeSyncDecision => {
  if (!pendingTarget) return "apply";
  if (pendingTarget.index === nextIndex) return "clear";
  if (nowMs - pendingTarget.setAtMs < holdMs) return "defer";
  return "clear";
};

export type AutoAdvanceDurationChangeInput = {
  isPlaying: boolean;
  isPaused: boolean;
  durationMs: number | undefined;
  trackStartedAtMs: number | null;
  currentDueAtMs: number | undefined;
};

/**
 * Recomputes the auto-advance due-time when the playing track's duration
 * changes mid-track (the "Default duration" slider/input). Returns the new
 * absolute due-time, or null when no re-arm is needed (paused, no track
 * playing, or the recomputed value already matches). Only applies while
 * actively playing: on resume from pause, handlePauseResume already
 * recomputes dueAtMs from the live durationMs and elapsedMs. See HARD9-006.
 */
export const resolveAutoAdvanceDueAtMsOnDurationChange = ({
  isPlaying,
  isPaused,
  durationMs,
  trackStartedAtMs,
  currentDueAtMs,
}: AutoAdvanceDurationChangeInput): number | null => {
  if (!isPlaying || isPaused) return null;
  if (typeof durationMs !== "number") return null;
  if (trackStartedAtMs === null) return null;
  const nextDueAtMs = trackStartedAtMs + durationMs;
  if (nextDueAtMs === currentDueAtMs) return null;
  return nextDueAtMs;
};
