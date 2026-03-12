/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type PlaybackSyncIntent = {
  index: number;
  muted: boolean;
  setAtMs: number;
};

export type PlaybackSyncState = {
  index: number;
  muted: boolean;
};

export type PlaybackSyncDecision = "apply" | "clear" | "defer";

export const resolvePlaybackSyncDecision = (
  pendingIntent: PlaybackSyncIntent | null,
  nextState: PlaybackSyncState,
  nowMs: number,
  holdMs = 2500,
): PlaybackSyncDecision => {
  if (!pendingIntent) return "apply";
  if (pendingIntent.index === nextState.index && pendingIntent.muted === nextState.muted) {
    return "clear";
  }
  if (nowMs - pendingIntent.setAtMs < holdMs) {
    return "defer";
  }
  return "clear";
};
