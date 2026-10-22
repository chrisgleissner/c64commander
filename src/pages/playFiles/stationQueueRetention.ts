/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlaylistItem } from "./types";

/** Evict only played radio history. The playing tune, upcoming tunes and user additions survive. */
export const retainStationQueue = (playlist: readonly PlaylistItem[], currentIndex: number, limit: number) => {
  let excess = Math.max(0, playlist.filter((item) => item.id.startsWith("radio:")).length - limit);
  let removedBeforeCurrent = 0;
  const removedIds = new Set<string>();
  const items = playlist.filter((item, index) => {
    if (excess > 0 && index < currentIndex && item.id.startsWith("radio:")) {
      excess--;
      removedBeforeCurrent++;
      removedIds.add(item.id);
      return false;
    }
    return true;
  });
  return { items, currentIndex: currentIndex - removedBeforeCurrent, removedIds };
};
