/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Treating a SID as what it is: a small album.
 *
 * A SID file routinely holds ten, twenty, thirty tunes, and the one worth hearing is often not the
 * one the header nominates. The app already said so — the credits line reads "Tune 1 of 19" — and
 * then offered nothing on the card that acted on it. The subsong selector exists, but it is in the
 * settings panel below the fold and it asks you to pick them off one at a time.
 *
 * So the whole file goes into the queue instead. That is deliberately not a new player, a new list
 * or a new mode: once the tunes are ordinary playlist items, next, previous, shuffle, repeat, the
 * playlist panel and the station's own refill all work on them unchanged, and there is nothing new
 * to learn. One action, named after what it does.
 *
 * The tunes replace the single item they came from rather than being appended, because that item IS
 * one of them — appending would leave the file's first tune queued twice.
 */

import type { PlaylistItem } from "@/pages/playFiles/types";

/** How many tunes a file has to hold before offering to play them all means anything. */
export const MIN_TUNES_TO_EXPAND = 2;

/**
 * Are this file's tunes already in the queue?
 *
 * The action is not idempotent — expanding again would add a second copy of all nineteen — so the
 * offer is withdrawn once it has been taken. That is the whole signal: a control that has already
 * done its job stops being offered, which needs no explaining and cannot be tapped twice by
 * accident.
 */
export const hasAllTunesQueued = (playlist: readonly PlaylistItem[], path: string, tuneCount: number): boolean =>
  playlist.filter((entry) => entry.path === path).length >= tuneCount;

export type ExpandSubsongsResult = {
  items: PlaylistItem[];
  /** Where the tune that was playing ended up, so playback can carry on from it. */
  index: number;
};

/**
 * Replace `item` in `playlist` with one entry per tune in the file.
 *
 * The tune currently selected keeps its place in the running order — expanding from tune 5 of 19
 * puts all nineteen in, and leaves playback on the fifth. Anything already resolved for that one
 * (its duration in particular) is kept, and the others are left for the songlengths pass to fill in;
 * carrying tune 5's duration onto tune 12 would set the wrong end for it.
 */
export const expandSubsongs = (
  playlist: readonly PlaylistItem[],
  itemIndex: number,
  tuneCount: number,
  /**
   * Each tune's own length in milliseconds, indexed by `songNr - 1`.
   *
   * Supplied because the tunes inside one SID are wildly different lengths — a nineteen-tune file
   * routinely holds a five-minute piece and a one-second jingle — and an item with no length falls
   * back to the three-minute default, which is what ends the track. Without these, playing all of
   * them means sitting through nearly three minutes of silence after most of them.
   */
  durationsMs: readonly (number | null | undefined)[] = [],
  /**
   * What STIL calls each tune, indexed by `songNr - 1`.
   *
   * This is what stops the expansion producing nineteen rows that read identically. STIL names
   * tunes for a minority of files, so an absent title is the normal case and simply leaves the row
   * as it was.
   */
  titles: readonly (string | null | undefined)[] = [],
): ExpandSubsongsResult => {
  const item = playlist[itemIndex];
  if (!item || tuneCount < MIN_TUNES_TO_EXPAND) {
    return { items: [...playlist], index: itemIndex };
  }
  const titleFor = (songNr: number): string | undefined => {
    const title = titles[songNr - 1];
    return typeof title === "string" && title.trim() ? title.trim() : undefined;
  };
  const currentSongNr = Math.min(Math.max(1, item.request.songNr ?? 1), tuneCount);
  const expanded: PlaylistItem[] = [];
  for (let songNr = 1; songNr <= tuneCount; songNr += 1) {
    if (songNr === currentSongNr) {
      // The one that is playing keeps its id, its duration and its place: the session store and the
      // transport are holding that id. Only the title is added, because it was not known when the
      // item was created and changing it moves nothing.
      const title = titleFor(songNr);
      expanded.push(title ? { ...item, tuneTitle: title } : item);
      continue;
    }
    const durationMs = durationsMs[songNr - 1];
    expanded.push({
      ...item,
      id: `${item.id}#tune${songNr}`,
      request: { ...item.request, songNr },
      // This tune's own length, never the one that was playing: they are different pieces. Left
      // unset when unknown so a later songlengths pass can still fill it in, rather than pinning the
      // wrong end here.
      durationMs: typeof durationMs === "number" && durationMs > 0 ? durationMs : undefined,
      durationSource: null,
      subsongCount: tuneCount,
      tuneTitle: titleFor(songNr),
    });
  }
  return {
    items: [...playlist.slice(0, itemIndex), ...expanded, ...playlist.slice(itemIndex + 1)],
    index: itemIndex + currentSongNr - 1,
  };
};
