/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlaylistItem } from "./types";

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

export type PlaylistRemovalPlan = {
  next: PlaylistItem[];
  nextCurrentIndex: number;
  shouldStopDevice: boolean;
};

/**
 * Computes the result of removing a set of playlist items: the filtered
 * playlist, the recomputed current index, and whether the device needs to be
 * stopped because the currently-playing/paused item is one of the ones being
 * removed. Deleting the playing item without stopping the device leaves the
 * C64 playing a track the playlist no longer has, with the UI showing
 * stopped. See HARD9-030.
 */
export const planPlaylistItemRemoval = (
  playlist: PlaylistItem[],
  currentIndex: number,
  ids: ReadonlySet<string>,
  isPlaying: boolean,
  isPaused: boolean,
): PlaylistRemovalPlan => {
  const currentId = currentIndex >= 0 ? playlist[currentIndex]?.id : undefined;
  const removingPlayingItem = Boolean(currentId && ids.has(currentId));
  const next = playlist.filter((item) => !ids.has(item.id));
  const nextCurrentIndex =
    currentIndex < 0 ? currentIndex : currentId ? next.findIndex((entry) => entry.id === currentId) : -1;
  return {
    next,
    nextCurrentIndex,
    shouldStopDevice: removingPlayingItem && (isPlaying || isPaused),
  };
};
