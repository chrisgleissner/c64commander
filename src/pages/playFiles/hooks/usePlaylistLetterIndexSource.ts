/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useMemo } from "react";
import type { LetterIndexEntry, LetterIndexSource } from "@/lib/lists/letterIndex";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import { resolveTrackDisplayName } from "@/lib/playback/sidDisplayName";
import { useFriendlySidNames } from "@/lib/playback/useFriendlySidNames";
import type { PlaylistItem } from "@/pages/playFiles/types";

/**
 * The whole type-filtered playlist for the view-all letter rail, which otherwise saw only the pages
 * loaded so far. Titles go through the same display-name rules as the rows, so a letter names what
 * the reader sees. A text query narrows the list through the playlist repository instead, so with a
 * query the rail indexes the loaded results only.
 */
export const usePlaylistLetterIndexSource = ({
  playlist,
  playlistTypeFilters,
  query,
  ensureLoaded,
}: {
  playlist: readonly PlaylistItem[];
  playlistTypeFilters: readonly PlayFileCategory[];
  query: string;
  ensureLoaded: (count: number) => void;
}): LetterIndexSource | undefined => {
  const friendlyNames = useFriendlySidNames();
  return useMemo(() => {
    if (query.trim()) return undefined;
    let entries: readonly LetterIndexEntry[] | null = null;
    return {
      getEntries: () => {
        entries ??= playlist
          .filter((item) => playlistTypeFilters.includes(item.category))
          .map((item) => ({
            id: item.id,
            title: resolveTrackDisplayName({ label: item.label, category: item.category, friendlyNames }).title,
          }));
        return entries;
      },
      ensureLoaded,
    };
  }, [ensureLoaded, friendlyNames, playlist, playlistTypeFilters, query]);
};
