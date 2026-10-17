/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import type { PlaylistTotals } from "@/lib/playback/playlistTotals";
import { formatTime } from "@/pages/playFiles/playFilesUtils";
import type { PlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";

export type PlaybackTimeDisplay = {
  progressPercent: number;
  elapsedLabel: string;
  remainingLabel: string;
  totalLabel: string;
  remainingTotalLabel: string;
  /** False when the playlist is just this tune, so the playlist counters would repeat the tune's own times. */
  playlistCountersShown: boolean;
};

/** The Play page's progress bar and time labels: the clock they follow, and what they show at any elapsed time. */
export type PlaybackTimeline = {
  playbackTime: PlaybackTimeStore;
  display: (elapsedMs: number) => PlaybackTimeDisplay;
};

export type PlaybackTimelineInputs = {
  durationMs: number | undefined;
  /** A skip's chosen track is launching, and the previous track's clock is not shown against it. */
  launching: boolean;
  /**
   * Nothing is playing or paused on the shown track, so it has no position: a track chosen after Stop, after a
   * station is left, or after the playlist ended shows 0:00 and its own length, not the clock of the last track.
   */
  idle: boolean;
  /** Where a scrub or a drag on the bar is heading. */
  scrubTargetMs: number | null;
  /** The last audible position, while a seek waits for the renderer. */
  heldAtMs: number | undefined;
  playlistTotalsAt: (elapsedMs: number) => PlaylistTotals;
};

/**
 * The bar and the timer show the same position, or they disagree mid-gesture. A scrub shows its target. While a seek
 * waits for the renderer, the engine is silent and the clock sits at the last position that was genuinely heard: the
 * scheduler was reset to the target when the seek was accepted, so every position source already reports the target,
 * and a clock advancing through a silence is exactly what a listener reads as playback having died.
 */
export const describePlaybackTime = (
  { durationMs, launching, idle, scrubTargetMs, heldAtMs, playlistTotalsAt }: PlaybackTimelineInputs,
  elapsedMs: number,
): PlaybackTimeDisplay => {
  const shownMs = launching || idle ? 0 : scrubTargetMs !== null ? scrubTargetMs : (heldAtMs ?? elapsedMs);
  const totals = playlistTotalsAt(shownMs);
  return {
    progressPercent: durationMs ? Math.min(100, (shownMs / durationMs) * 100) : 0,
    elapsedLabel: formatTime(shownMs),
    remainingLabel: durationMs !== undefined ? `-${formatTime(Math.max(0, durationMs - shownMs))}` : "—",
    totalLabel: formatTime(totals.total),
    remainingTotalLabel: formatTime(totals.remaining),
    playlistCountersShown: totals.total !== undefined && totals.total !== durationMs,
  };
};

/** Several labels show one elapsed time per render, so the display for it is worked out once. */
export const usePlaybackTimeline = (
  playbackTime: PlaybackTimeStore,
  { durationMs, launching, idle, scrubTargetMs, heldAtMs, playlistTotalsAt }: PlaybackTimelineInputs,
): PlaybackTimeline =>
  useMemo(() => {
    let last: { elapsedMs: number; display: PlaybackTimeDisplay } | null = null;
    const inputs = { durationMs, launching, idle, scrubTargetMs, heldAtMs, playlistTotalsAt };
    return {
      playbackTime,
      display: (elapsedMs) => {
        if (last?.elapsedMs !== elapsedMs) last = { elapsedMs, display: describePlaybackTime(inputs, elapsedMs) };
        return last.display;
      },
    };
  }, [playbackTime, durationMs, launching, idle, scrubTargetMs, heldAtMs, playlistTotalsAt]);
