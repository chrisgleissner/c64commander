/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useMemo } from "react";

import { calculatePlaylistTotals, type PlaylistTotals } from "@/lib/playback/playlistTotals";
import { resolvePlayOrderIndices } from "@/pages/playFiles/playFilesUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";

/** The playlist's total and remaining time for any elapsed time in the current item, which changes every second. */
export const usePlaylistTotals = (
  playlist: PlaylistItem[],
  durationOf: (item: PlaylistItem, index: number) => number | undefined,
  {
    currentIndex,
    shuffleEnabled,
    shuffleSeed,
    shuffleAnchorId,
  }: { currentIndex: number; shuffleEnabled: boolean; shuffleSeed: number | null; shuffleAnchorId?: string | null },
): ((elapsedMs: number) => PlaylistTotals) => {
  const durations = useMemo(() => playlist.map((item, index) => durationOf(item, index)), [playlist, durationOf]);
  const playOrder = useMemo(
    () => resolvePlayOrderIndices(playlist, shuffleEnabled, shuffleSeed, shuffleAnchorId),
    [playlist, shuffleEnabled, shuffleSeed, shuffleAnchorId],
  );
  return useCallback(
    (elapsedMs: number) => calculatePlaylistTotals(durations, { playOrder, currentIndex, elapsedMs }),
    [durations, playOrder, currentIndex],
  );
};
