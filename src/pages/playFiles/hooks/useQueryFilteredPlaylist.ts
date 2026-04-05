/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { getPlaylistDataRepository } from "@/lib/playlistRepository";
import type { PlaylistItemRecord, TrackRecord } from "@/lib/playlistRepository";
import { addErrorLog } from "@/lib/logging";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { resolveStoredConfigOrigin } from "@/lib/config/playbackConfig";
import type { PlaylistItem } from "@/pages/playFiles/types";

const buildTrackId = (source: string, sourceId: string | null | undefined, path: string) =>
  `${source}:${sourceId ?? ""}:${normalizeSourcePath(path)}`;

const serializePlaylistToQueryRepository = (items: PlaylistItem[], playlistId: string) => {
  const nowIso = new Date().toISOString();
  const tracks: TrackRecord[] = items.map((item) => ({
    trackId: buildTrackId(item.request.source, item.sourceId ?? null, item.path),
    sourceKind: item.request.source,
    sourceLocator: normalizeSourcePath(item.path),
    sourceId: item.sourceId ?? null,
    category: item.category,
    title: item.label,
    author: null,
    released: null,
    path: normalizeSourcePath(item.path),
    sizeBytes: item.sizeBytes ?? null,
    modifiedAt: item.modifiedAt ?? null,
    defaultDurationMs: item.durationMs ?? null,
    subsongCount: item.subsongCount ?? null,
    createdAt: item.addedAt ?? nowIso,
    updatedAt: nowIso,
  }));
  const playlistItems: PlaylistItemRecord[] = items.map((item, index) => ({
    playlistItemId: item.id,
    playlistId,
    trackId: buildTrackId(item.request.source, item.sourceId ?? null, item.path),
    configRef: item.configRef ?? null,
    configOrigin: item.configOrigin ?? resolveStoredConfigOrigin(item.configRef ?? null, null),
    configOverrides: item.configOverrides ?? null,
    songNr: item.request.songNr ?? 1,
    sortKey: String(index).padStart(8, "0"),
    durationOverrideMs: item.durationMs ?? null,
    status: item.status ?? "ready",
    unavailableReason: item.unavailableReason ?? null,
    addedAt: item.addedAt ?? nowIso,
  }));
  return { tracks, playlistItems };
};

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
  const [syncedRevision, setSyncedRevision] = useState(0);
  const [repositorySyncFailed, setRepositorySyncFailed] = useState(false);
  const [viewAllLimit, setViewAllLimit] = useState(initialViewAllLimit);
  const playlistRef = useRef(playlist);
  const filtersRef = useRef(playlistTypeFilters);
  const queryRef = useRef(query);
  const latestSyncRequestRef = useRef(0);

  playlistRef.current = playlist;
  filtersRef.current = playlistTypeFilters;
  queryRef.current = query;

  useEffect(() => {
    setViewAllLimit(initialViewAllLimit);
  }, [initialViewAllLimit, playlistStorageKey, playlistTypeFilters, query]);

  useEffect(() => {
    let cancelled = false;
    const syncRequestId = latestSyncRequestRef.current + 1;
    latestSyncRequestRef.current = syncRequestId;

    const run = async () => {
      if (!playlist.length) {
        if (!cancelled) {
          setQueryFilteredPlaylist([]);
          setTotalMatchCount(0);
          setRepositorySyncFailed(false);
          setSyncedRevision(syncRequestId);
        }
        return;
      }

      const repository = getPlaylistDataRepository();
      const serialized = serializePlaylistToQueryRepository(playlist, playlistStorageKey);
      await repository.upsertTracks(serialized.tracks);
      await repository.replacePlaylistItems(playlistStorageKey, serialized.playlistItems);
      if (!cancelled && latestSyncRequestRef.current === syncRequestId) {
        setRepositorySyncFailed(false);
        setSyncedRevision(syncRequestId);
      }
    };

    run().catch((error) => {
      addErrorLog("Failed to sync playlist query repository", {
        playlistStorageKey,
        error: (error as Error).message,
      });
      if (!cancelled && latestSyncRequestRef.current === syncRequestId) {
        const filteredPlaylist = playlist.filter(
          (item) => filtersRef.current.includes(item.category) && matchesPlaylistQuery(item, queryRef.current),
        );
        setQueryFilteredPlaylist(filteredPlaylist.slice(0, viewAllLimit));
        setTotalMatchCount(filteredPlaylist.length);
        setRepositorySyncFailed(true);
        setSyncedRevision(syncRequestId);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [playlist, playlistStorageKey]);

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

      if (syncedRevision === 0) return;

      if (repositorySyncFailed) {
        const nextFiltered = currentPlaylist.filter(
          (item) => playlistTypeFilters.includes(item.category) && matchesPlaylistQuery(item, queryRef.current),
        );
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
        setQueryFilteredPlaylist(nextFiltered.slice(0, viewAllLimit));
        setTotalMatchCount(nextFiltered.length);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [playlistStorageKey, playlistTypeFilters, query, repositorySyncFailed, syncedRevision, viewAllLimit]);

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
