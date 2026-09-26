/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";

import { calculatePlaylistTotals } from "@/lib/playback/playlistTotals";
import { resolvePlayOrderIndices } from "@/pages/playFiles/playFilesUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";

export const usePlaylistTotals = (
  playlist: PlaylistItem[],
  durationOf: (item: PlaylistItem, index: number) => number | undefined,
  {
    currentIndex,
    elapsedMs,
    shuffleEnabled,
    shuffleSeed,
  }: { currentIndex: number; elapsedMs: number; shuffleEnabled: boolean; shuffleSeed: number | null },
) => {
  const durations = useMemo(() => playlist.map((item, index) => durationOf(item, index)), [playlist, durationOf]);
  const playOrder = useMemo(
    () => resolvePlayOrderIndices(playlist, shuffleEnabled, shuffleSeed),
    [playlist, shuffleEnabled, shuffleSeed],
  );
  return useMemo(
    () => calculatePlaylistTotals(durations, { playOrder, currentIndex, elapsedMs }),
    [durations, playOrder, currentIndex, elapsedMs],
  );
};
