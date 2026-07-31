/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Playing one particular tune without losing what was playing.
 *
 * A station is endless and picks for you. Asking it for one specific tune therefore has to be an
 * interruption rather than a replacement: the tune goes in directly after the one playing, playback
 * moves to it, and when it ends the queue carries on into the tunes the station had already lined
 * up. Nothing about the station changes — not its seed, not its exclusion set, not its place — so
 * "return to the station afterwards" needs no return logic at all. It is simply what the queue does
 * next.
 *
 * Appending to the tail would not do: the station keeps ten tunes queued ahead of the cursor, so the
 * tune that was asked for would play about half an hour later.
 */

import type { PlaylistItem } from "@/pages/playFiles/types";

export type InsertNextResult<T> = {
  items: T[];
  /** Where the inserted item ended up, so the caller can move playback to it. */
  index: number;
};

/**
 * Put `item` directly after the playing track.
 *
 * An empty queue, or a cursor that is not on anything, puts the item at the end — which for an empty
 * queue is position zero, and for a queue that is not playing is the natural place for "and then
 * this".
 */
export const insertAfterCurrent = <T>(playlist: readonly T[], currentIndex: number, item: T): InsertNextResult<T> => {
  const index = currentIndex >= 0 && currentIndex < playlist.length ? currentIndex + 1 : playlist.length;
  const items = [...playlist.slice(0, index), item, ...playlist.slice(index)];
  return { items, index };
};

/**
 * A playlist item for a tune chosen by name from HVSC.
 *
 * The id has to be unique rather than merely descriptive: the same tune can be asked for more than
 * once in a session, and two items sharing an id are two rows React cannot tell apart and two
 * entries the session store would collapse into one. It is drawn from a random suffix rather than a
 * module counter — a counter shared by every importer is state that has to be reset between tests
 * and says nothing about the playlist it is numbering, and the only property actually needed here is
 * that two calls differ.
 */
export const buildFoundTuneItem = (hit: {
  virtualPath: string;
  title: string;
  songNr?: number;
  subsongCount?: number;
  durationMs?: number;
}): PlaylistItem => {
  const songNr = hit.songNr ?? 1;
  const unique = Math.random().toString(36).slice(2, 10);
  return {
    id: `found:${hit.virtualPath}#${songNr}:${unique}`,
    request: { source: "hvsc", path: hit.virtualPath, songNr },
    category: "sid",
    label: hit.virtualPath.split("/").filter(Boolean).pop() ?? hit.title,
    path: hit.virtualPath,
    ...(hit.subsongCount === undefined ? {} : { subsongCount: hit.subsongCount }),
    // Carried when the archive knows it, so the transport and the progress bar are right from the
    // first frame instead of falling back to the three-minute default. `durationSource` is left
    // unset so a later songlengths load does not treat this as a default it may overwrite.
    ...(hit.durationMs === undefined ? {} : { durationMs: hit.durationMs }),
  };
};
