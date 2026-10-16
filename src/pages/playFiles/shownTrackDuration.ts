/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlaylistItem } from "./types";

export type ShownDurationState = {
  currentIndex: number;
  durationMs: number | undefined;
  /** The item `durationMs` was set for: the launched track, or the one a session restore put back. */
  durationMsItemId: string | null;
  isPlaying: boolean;
  isPaused: boolean;
  fallbackMs: number;
};

/**
 * A skip moves the current index at once, while the previous track plays on until the chosen one has
 * launched. Until then the current item is not the one `durationMs` and the elapsed clock describe.
 */
export const isChosenTrackLaunching = (
  item: PlaylistItem | undefined,
  { durationMsItemId, isPlaying, isPaused }: Pick<ShownDurationState, "durationMsItemId" | "isPlaying" | "isPaused">,
) => item !== undefined && (isPlaying || isPaused) && durationMsItemId !== null && item.id !== durationMsItemId;

/**
 * The length shown for a playlist item. A track chosen by a skip shows its own length while it launches,
 * or no length when it has none yet, rather than the default length the launch would replace.
 */
export const resolveShownItemDurationMs = (
  item: PlaylistItem,
  index: number,
  state: ShownDurationState,
): number | undefined => {
  if (index !== state.currentIndex) return item.durationMs ?? state.fallbackMs;
  if (isChosenTrackLaunching(item, state)) return item.durationMs;
  const durationMsIsItems = state.durationMsItemId === null || state.durationMsItemId === item.id;
  return (durationMsIsItems ? state.durationMs : undefined) ?? item.durationMs ?? state.fallbackMs;
};
