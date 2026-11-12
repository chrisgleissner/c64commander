/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { PlaylistItem } from "@/pages/playFiles/types";

export type RemovedRow = { item: PlaylistItem; index: number };

/** The rows `ids` names, with the positions they held, so that they can be put back where they were. */
export const captureRemovedRows = (playlist: readonly PlaylistItem[], ids: ReadonlySet<string>): RemovedRow[] =>
  playlist.flatMap((item, index) => (ids.has(item.id) ? [{ item, index }] : []));

/**
 * Puts removed rows back at their original positions. A row whose id is already present is skipped, so a
 * track added again after the removal is not duplicated. Rows that were at the end are clamped to the end
 * of the list as it is now. The row that is current keeps being current; nothing is started.
 */
export const restoreRemovedRows = (
  playlist: PlaylistItem[],
  currentIndex: number,
  removed: readonly RemovedRow[],
): { items: PlaylistItem[]; currentIndex: number } => {
  const present = new Set(playlist.map((item) => item.id));
  const items = playlist.slice();
  [...removed]
    .sort((left, right) => left.index - right.index)
    .forEach(({ item, index }) => {
      if (present.has(item.id)) return;
      items.splice(Math.min(index, items.length), 0, item);
      present.add(item.id);
    });
  const currentId = currentIndex >= 0 ? playlist[currentIndex]?.id : undefined;
  return { items, currentIndex: currentId ? items.findIndex((item) => item.id === currentId) : currentIndex };
};

export const describeRemoval = (count: number) => (count === 1 ? "Removed 1 item" : `Removed ${count} items`);
