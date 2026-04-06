/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getPlaylistDataRepository } from "@/lib/playlistRepository";
import { beginHvscPerfScope, endHvscPerfScope } from "@/lib/hvsc/hvscPerformance";
import { addErrorLog } from "@/lib/logging";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import { recordSmokeBenchmarkSnapshot } from "@/lib/smoke/smokeMode";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { usePlaylistRepositorySyncSnapshot } from "@/pages/playFiles/playlistRepositorySync";

const matchesPlaylistQuery = (item: PlaylistItem, query: string) => {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  const haystack = [item.label, item.path, item.request.path, item.request.source, item.category]
    .join(" ")
    .toLowerCase();
  return haystack.includes(trimmed);
};

export const useQueryFilteredPlaylist = ({
  playlist,
  playlistStorageKey,
  playlistTypeFilters,
  query = "",
  previewLimit,
  viewAllPageSize = 200,
}: {
  playlist: PlaylistItem[];
  playlistStorageKey: string;
  playlistTypeFilters: PlayFileCategory[];
  query?: string;
  previewLimit: number;
  viewAllPageSize?: number;
}) => {
  const initialViewAllLimit = Math.max(previewLimit, viewAllPageSize);
  const [queryFilteredPlaylist, setQueryFilteredPlaylist] = useState<PlaylistItem[]>([]);
  const [totalMatchCount, setTotalMatchCount] = useState(0);
  const [viewAllLimit, setViewAllLimit] = useState(initialViewAllLimit);
  const playlistRef = useRef(playlist);
  const queryRef = useRef(query);
  const repositorySnapshot = usePlaylistRepositorySyncSnapshot(playlistStorageKey);
  const repositoryReady = repositorySnapshot.phase === "READY" && repositorySnapshot.committedCount === playlist.length;

  playlistRef.current = playlist;
  queryRef.current = query;

  useEffect(() => {
    setViewAllLimit(initialViewAllLimit);
  }, [initialViewAllLimit, playlistStorageKey, playlistTypeFilters, query]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      const currentPlaylist = playlistRef.current;
      if (!currentPlaylist.length) {
        if (!cancelled) {
          setQueryFilteredPlaylist([]);
          setTotalMatchCount(0);
        }
        return;
      }

      const filterScope = beginHvscPerfScope("playlist:filter", {
        playlistId: playlistStorageKey,
        query,
        viewAllLimit,
        playlistSize: currentPlaylist.length,
        categoryFilters: playlistTypeFilters,
        repositoryPhase: repositorySnapshot.phase,
      });

      const finalizeFilterScope = (metadata: Record<string, unknown>) => {
        endHvscPerfScope(filterScope, {
          playlistId: playlistStorageKey,
          query,
          viewAllLimit,
          playlistSize: currentPlaylist.length,
          categoryFilters: playlistTypeFilters,
          ...metadata,
        });
        if (query.trim().length > 0) {
          void recordSmokeBenchmarkSnapshot({
            scenario: "playlist-filter",
            state: typeof metadata.outcome === "string" ? metadata.outcome : "complete",
            metadata: {
              playlistId: playlistStorageKey,
              query,
              viewAllLimit,
              playlistSize: currentPlaylist.length,
              categoryFilters: playlistTypeFilters,
              repositoryPhase: repositorySnapshot.phase,
              ...metadata,
            },
          });
        }
      };

      if (!repositoryReady) {
        const nextFiltered = currentPlaylist.filter(
          (item) => playlistTypeFilters.includes(item.category) && matchesPlaylistQuery(item, queryRef.current),
        );
        finalizeFilterScope({
          outcome: "memory",
          source: "memory",
          resultCount: Math.min(nextFiltered.length, viewAllLimit),
          totalMatchCount: nextFiltered.length,
          repositoryPhase: repositorySnapshot.phase,
        });
        if (!cancelled) {
          setQueryFilteredPlaylist(nextFiltered.slice(0, viewAllLimit));
          setTotalMatchCount(nextFiltered.length);
        }
        return;
      }

      const repository = getPlaylistDataRepository();
      const result = await repository.queryPlaylist({
        playlistId: playlistStorageKey,
        categoryFilter: playlistTypeFilters,
        query,
        limit: Math.max(1, viewAllLimit),
        offset: 0,
        sort: "playlist-position",
      });
      const byId = new Map(currentPlaylist.map((item) => [item.id, item]));
      const nextFiltered = result.rows
        .map((row) => byId.get(row.playlistItem.playlistItemId) ?? null)
        .filter((item): item is PlaylistItem => Boolean(item));

      finalizeFilterScope({
        outcome: "success",
        source: "repository",
        resultCount: nextFiltered.length,
        totalMatchCount: result.totalMatchCount,
        repositoryRevision: repositorySnapshot.revision,
      });

      if (!cancelled) {
        setQueryFilteredPlaylist(nextFiltered);
        setTotalMatchCount(result.totalMatchCount);
      }
    };

    run().catch((error) => {
      addErrorLog("Failed to query filtered playlist", {
        playlistStorageKey,
        error: (error as Error).message,
      });
      if (!cancelled) {
        const nextFiltered = playlistRef.current.filter(
          (item) => playlistTypeFilters.includes(item.category) && matchesPlaylistQuery(item, queryRef.current),
        );
        const fallbackScope = beginHvscPerfScope("playlist:filter", {
          playlistId: playlistStorageKey,
          query,
          viewAllLimit,
          playlistSize: playlistRef.current.length,
          categoryFilters: playlistTypeFilters,
        });
        endHvscPerfScope(fallbackScope, {
          outcome: "fallback-after-error",
          source: "memory",
          resultCount: Math.min(nextFiltered.length, viewAllLimit),
          totalMatchCount: nextFiltered.length,
          errorName: (error as Error).name,
          errorMessage: (error as Error).message,
        });
        setQueryFilteredPlaylist(nextFiltered.slice(0, viewAllLimit));
        setTotalMatchCount(nextFiltered.length);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    playlist,
    playlistStorageKey,
    playlistTypeFilters,
    query,
    repositoryReady,
    repositorySnapshot.phase,
    repositorySnapshot.revision,
    viewAllLimit,
  ]);

  const previewPlaylist = useMemo(
    () => queryFilteredPlaylist.slice(0, previewLimit),
    [previewLimit, queryFilteredPlaylist],
  );

  return {
    previewPlaylist,
    viewAllPlaylist: queryFilteredPlaylist,
    totalMatchCount,
    hasMoreViewAllResults: queryFilteredPlaylist.length < totalMatchCount,
    loadMoreViewAllResults: () => setViewAllLimit((current) => current + viewAllPageSize),
  };
};
