/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type ReorderResult<T> = { items: T[]; currentIndex: number };

type Identified = { id: string };

const idOfCurrentRow = <T extends Identified>(playlist: readonly T[], currentIndex: number): string | null =>
  currentIndex >= 0 && currentIndex < playlist.length ? playlist[currentIndex].id : null;

const followCurrentRow = <T extends Identified>(items: T[], currentId: string | null, currentIndex: number) => {
  if (currentId === null) return currentIndex;
  return items.findIndex((item) => item.id === currentId);
};

/** A move that changes nothing returns the input array itself, so a state setter fed with it renders nothing. */
const unchanged = <T extends Identified>(playlist: T[], currentIndex: number): ReorderResult<T> => ({
  items: playlist,
  currentIndex,
});

const placeRow = <T extends Identified>(playlist: T[], currentIndex: number, from: number, to: number) => {
  const items = playlist.slice();
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  const currentId = idOfCurrentRow(playlist, currentIndex);
  return { items, currentIndex: followCurrentRow(items, currentId, currentIndex) };
};

/** Moves the row with `id` by `delta` places. `currentIndex` is the row that keeps playing, or -1 for none. */
export const moveItem = <T extends Identified>(
  playlist: T[],
  id: string,
  delta: number,
  currentIndex: number,
): ReorderResult<T> => {
  const from = playlist.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || delta === 0 || to < 0 || to >= playlist.length) return unchanged(playlist, currentIndex);
  return placeRow(playlist, currentIndex, from, to);
};

/**
 * Moves the row with `id` directly after the playing row, or to the top when nothing is playing.
 * `currentIndex` is the row that keeps playing or is selected; `playing` says whether it is sounding.
 */
export const moveAfterCurrent = <T extends Identified>(
  playlist: T[],
  currentIndex: number,
  id: string,
  playing = true,
): ReorderResult<T> => {
  const from = playlist.findIndex((item) => item.id === id);
  const anchorId = playing ? idOfCurrentRow(playlist, currentIndex) : null;
  if (from < 0 || id === anchorId) return unchanged(playlist, currentIndex);
  const remaining = playlist.filter((item) => item.id !== id);
  const anchorIndex = anchorId === null ? -1 : remaining.findIndex((item) => item.id === anchorId);
  const to = anchorIndex + 1;
  if (to === from) return unchanged(playlist, currentIndex);
  return placeRow(playlist, currentIndex, from, to);
};
