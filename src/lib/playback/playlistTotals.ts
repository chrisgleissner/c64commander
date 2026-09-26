/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type PlaylistTotals = {
  total?: number;
  remaining?: number;
};

export type PlaylistPosition = {
  /** Playlist indices in the order they play: identity for linear play, the seeded order under shuffle. */
  playOrder: readonly number[];
  currentIndex: number;
  elapsedMs: number;
};

/**
 * Remaining runs from the current position to the end of this pass through the play order: what is
 * left of the current item plus every item still to come. Repeat does not wrap it, so it reads as
 * "time until this pass ends" rather than growing without bound.
 */
export const calculatePlaylistTotals = (
  durations: Array<number | undefined>,
  position: PlaylistPosition | null,
): PlaylistTotals => {
  if (!durations.length) return { total: undefined, remaining: undefined };
  const allKnown = durations.every((value) => value !== undefined);
  if (!allKnown) return { total: undefined, remaining: undefined };
  const total = durations.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const orderPosition = position ? position.playOrder.indexOf(position.currentIndex) : -1;
  if (!position || orderPosition < 0) return { total, remaining: total };
  const currentRemaining = Math.max(0, (durations[position.currentIndex] ?? 0) - Math.max(0, position.elapsedMs));
  let upcoming = 0;
  for (let index = orderPosition + 1; index < position.playOrder.length; index += 1) {
    upcoming += durations[position.playOrder[index]] ?? 0;
  }
  return { total, remaining: currentRemaining + upcoming };
};
