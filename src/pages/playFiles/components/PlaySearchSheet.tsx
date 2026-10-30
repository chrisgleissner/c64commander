/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback } from "react";

import { md548ForVirtualPath } from "@/lib/sidRadio/md5PathIndex";
import type { RecentlyPlayedEntry } from "@/lib/sidRadio/recentlyPlayed";
import { HvscSearchSheet } from "@/pages/playFiles/components/HvscSearchSheet";
import type { HvscSearchHit } from "@/pages/playFiles/hooks/useHvscArchiveSearch";
import { buildFoundTuneItem, buildRecentPlaylistItem, insertAfterCurrent } from "@/pages/playFiles/insertTuneNext";
import type { PlaylistItem } from "@/pages/playFiles/types";

export type PlaySearchSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery: string | null;
  playlist: PlaylistItem[];
  currentIndex: number;
  startPlaylist: (items: PlaylistItem[], startIndex?: number, options?: { replaceQueue?: boolean }) => Promise<boolean>;
  startSongRadio: (md5_48: string, seedLabel: string) => Promise<void>;
  stationActive: boolean;
};

/** The "Find a tune" sheet, wired to the Play page's playlist and SID Radio. */
export const PlaySearchSheet = ({
  open,
  onOpenChange,
  initialQuery,
  playlist,
  currentIndex,
  startPlaylist,
  startSongRadio,
  stationActive,
}: PlaySearchSheetProps) => {
  /**
   * Play one tune that was reached for by name, without losing the station.
   *
   * Inserted directly after what is playing rather than appended: a station keeps ten tunes queued
   * ahead of the cursor, so the tail is roughly half an hour away. Nothing about the station is
   * touched — it keeps its seed, its exclusion set and its place — so when this tune ends the queue
   * simply carries on into what the station had already lined up. That is the whole of "and then go
   * back to the station".
   */
  const playFoundTune = useCallback(
    (hit: HvscSearchHit) => {
      const item = buildFoundTuneItem(hit);
      const { items, index } = insertAfterCurrent(playlist, currentIndex, item);
      void startPlaylist(items, index, { replaceQueue: true });
    },
    [currentIndex, playlist, startPlaylist],
  );

  // The same path for a disk or a program out of Recent: its stored source kind and id are what
  // turn a remembered path back into something the router can dispatch.
  const playRecentItem = useCallback(
    (entry: RecentlyPlayedEntry) => {
      const item = buildRecentPlaylistItem(entry);
      const { items, index } = insertAfterCurrent(playlist, currentIndex, item);
      void startPlaylist(items, index, { replaceQueue: true });
    },
    [currentIndex, playlist, startPlaylist],
  );
  /**
   * Whether a station can be seeded from a tune found by name.
   *
   * The similarity corpus knows tunes by their content hash, and the archive index is what turns a
   * path back into one. A tune the corpus has never heard of can still be played — it just cannot be
   * the seed of anything, so the action is left off that row rather than offered and then failing.
   */
  const canSeedStationFrom = useCallback((hit: HvscSearchHit) => md548ForVirtualPath(hit.virtualPath) !== null, []);
  const startStationFromFoundTune = useCallback(
    (hit: HvscSearchHit) => {
      const md548 = md548ForVirtualPath(hit.virtualPath);
      if (!md548) return;
      void startSongRadio(md548, hit.title);
    },
    [startSongRadio],
  );

  return (
    <HvscSearchSheet
      open={open}
      onOpenChange={onOpenChange}
      onPlay={playFoundTune}
      onPlayRecent={playRecentItem}
      onStartStation={startStationFromFoundTune}
      canSeedStation={canSeedStationFrom}
      stationActive={stationActive}
      {...(initialQuery ? { initialQuery } : {})}
    />
  );
};
