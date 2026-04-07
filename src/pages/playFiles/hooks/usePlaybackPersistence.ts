/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useEffect, useRef, useState } from "react";
import type { PlayableEntry, PlaylistItem, StoredPlaybackSession, StoredPlaylistState } from "../types";
import { PLAYBACK_SESSION_KEY, buildPlaylistStorageKey, isSongCategory, parseModifiedAt } from "../playFilesUtils";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { resolveLocalRuntimeFile } from "@/lib/sourceNavigation/localSourceAdapter";
import { buildLocalPlayFileFromTree, buildLocalPlayFileFromUri } from "@/lib/playback/fileLibraryUtils";
import type { PlaybackClock } from "@/lib/playback/playbackClock";
import type { LocalPlayFile } from "@/lib/playback/playbackRouter";
import { addErrorLog } from "@/lib/logging";
import { getPlaylistDataRepository } from "@/lib/playlistRepository";
import type { PlaylistSessionRecord, TrackRecord } from "@/lib/playlistRepository";
import { resolveStoredConfigOrigin } from "@/lib/config/playbackConfig";
import { commitPlaylistSnapshot, usePlaylistRepositorySyncSnapshot } from "@/pages/playFiles/playlistRepositorySync";

interface UsePlaybackPersistenceProps {
  playlist: PlaylistItem[];
  setPlaylist: (value: React.SetStateAction<PlaylistItem[]>) => void;
  currentIndex: number;
  setCurrentIndex: (value: React.SetStateAction<number>) => void;
  isPlaying: boolean;
  setIsPlaying: (value: boolean) => void;
  isPaused: boolean;
  setIsPaused: (value: boolean) => void;
  elapsedMs: number;
  setElapsedMs: (value: number) => void;
  playedMs: number;
  setPlayedMs: (value: number) => void;
  durationMs: number | undefined;
  setDurationMs: (value: number | undefined) => void;
  setCurrentSubsongCount: (value: number | null) => void;
  shuffleEnabled?: boolean;
  repeatEnabled?: boolean;
  activePlaylistQuery?: string | null;
  setActivePlaylistQuery?: (value: string) => void;

  resolvedDeviceId: string | null;
  playlistStorageKey: string;

  localEntriesBySourceId: Map<
    string,
    Map<
      string,
      {
        uri?: string | null;
        name: string;
        modifiedAt?: string | null;
        sizeBytes?: number | null;
      }
    >
  >;
  localSourceTreeUris: Map<string, string | null>;

  buildHvscLocalPlayFile: (virtualPath: string, fileName: string) => LocalPlayFile | null;
  buildPlaylistItem: (
    entry: PlayableEntry,
    songNrOverride?: number,
    addedAtOverride?: string | null,
  ) => PlaylistItem | null;

  playedClockRef: React.MutableRefObject<PlaybackClock>;
  trackStartedAtRef: React.MutableRefObject<number | null>;
  trackInstanceIdRef: React.MutableRefObject<number>;
  autoAdvanceGuardRef: React.MutableRefObject<any>; // Using any to avoid importing local type from Page
  setTrackInstanceId: (value: number) => void;
  setAutoAdvanceDueAtMs: (value: number | null) => void;
}

export function usePlaybackPersistence({
  playlist,
  setPlaylist,
  currentIndex,
  setCurrentIndex,
  isPlaying,
  setIsPlaying,
  isPaused,
  setIsPaused,
  elapsedMs,
  setElapsedMs,
  playedMs,
  setPlayedMs,
  durationMs,
  setDurationMs,
  setCurrentSubsongCount,
  shuffleEnabled = false,
  repeatEnabled = false,
  activePlaylistQuery = null,
  setActivePlaylistQuery,
  resolvedDeviceId,
  playlistStorageKey,
  localEntriesBySourceId,
  localSourceTreeUris,
  buildPlaylistItem,
  playedClockRef,
  trackStartedAtRef,
  trackInstanceIdRef,
  autoAdvanceGuardRef,
  setTrackInstanceId,
  setAutoAdvanceDueAtMs,
}: UsePlaybackPersistenceProps) {
  const playlistRepository = getPlaylistDataRepository();
  const repositorySnapshot = usePlaylistRepositorySyncSnapshot(playlistStorageKey);
  const pendingPlaybackRestoreRef = useRef<StoredPlaybackSession | null>(null);
  const hydratedPlaylistKeyRef = useRef<string | null>(null);
  const completedInitialRestoreKeyRef = useRef<string | null>(null);
  const hasPlaylistRef = useRef(false);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const currentPlaylistItemId = currentIndex >= 0 ? (playlist[currentIndex]?.id ?? null) : null;

  if (completedInitialRestoreKeyRef.current && completedInitialRestoreKeyRef.current !== playlistStorageKey) {
    completedInitialRestoreKeyRef.current = null;
  }

  useEffect(() => {
    hasPlaylistRef.current = playlist.length > 0;
  }, [playlist]);

  const hydrateStoredPlaylist = (stored: StoredPlaylistState | null) => {
    if (!stored?.items?.length) return { items: [] as PlaylistItem[], index: -1 };
    const hydrated = stored.items
      .map((entry) => {
        const normalizedPath = normalizeSourcePath(entry.path);
        const localEntry =
          entry.source === "local" && entry.sourceId
            ? localEntriesBySourceId.get(entry.sourceId)?.get(normalizedPath)
            : null;
        const localTreeUri =
          entry.source === "local" && entry.sourceId ? localSourceTreeUris.get(entry.sourceId) : null;
        const playable: PlayableEntry = {
          source: entry.source,
          name: entry.name,
          path: entry.path,
          configRef: entry.configRef ?? null,
          configOrigin: resolveStoredConfigOrigin(entry.configRef ?? null, entry.configOrigin ?? null),
          configOverrides: entry.configOverrides ?? null,
          archiveRef: entry.archiveRef ?? null,
          durationMs: entry.durationMs,
          songNr: entry.songNr,
          subsongCount: entry.subsongCount,
          sourceId: entry.sourceId ?? null,
          file:
            entry.source === "local"
              ? resolveLocalRuntimeFile(entry.sourceId ?? "", normalizedPath) ||
                (localEntry?.uri
                  ? buildLocalPlayFileFromUri(
                      entry.name,
                      normalizedPath,
                      localEntry.uri,
                      parseModifiedAt(localEntry.modifiedAt),
                    )
                  : undefined) ||
                (localTreeUri
                  ? buildLocalPlayFileFromTree(
                      entry.name,
                      normalizedPath,
                      localTreeUri,
                      parseModifiedAt(localEntry?.modifiedAt),
                    )
                  : undefined)
              : undefined,
          sizeBytes: localEntry?.sizeBytes ?? entry.sizeBytes ?? null,
          modifiedAt: localEntry?.modifiedAt ?? entry.modifiedAt ?? null,
        };
        return buildPlaylistItem(playable, entry.songNr, entry.addedAt ?? null);
      })
      .filter((item): item is PlaylistItem => Boolean(item));
    return { items: hydrated, index: stored.currentIndex ?? -1 };
  };

  const resolveHydratedLocalSourceId = (track: TrackRecord) => {
    if (track.sourceKind !== "local") return null;
    if (track.sourceId) return track.sourceId;
    if (!track.sourceLocator.startsWith("/")) return track.sourceLocator;
    const legacyPrefix = "local:";
    if (!track.trackId.startsWith(legacyPrefix)) return null;
    const separatorIndex = track.trackId.indexOf(":", legacyPrefix.length);
    if (separatorIndex < 0) return null;
    const legacySourceId = track.trackId.slice(legacyPrefix.length, separatorIndex);
    return legacySourceId || null;
  };

  const hydrateFromRepository = async () => {
    const playlistItems = await playlistRepository.getPlaylistItems(playlistStorageKey);
    if (!playlistItems.length) {
      const session = await playlistRepository.getSession(playlistStorageKey);
      return {
        items: [] as PlaylistItem[],
        index: -1,
        activeQuery: session?.activeQuery ?? null,
      };
    }
    const trackIds = playlistItems.map((item) => item.trackId);
    const tracks = await playlistRepository.getTracksByIds(trackIds);
    const session = await playlistRepository.getSession(playlistStorageKey);
    const stored: StoredPlaylistState = {
      items: playlistItems
        .map((playlistItem) => {
          const track = tracks.get(playlistItem.trackId);
          if (!track) return null;
          return {
            source: track.sourceKind,
            path: track.path,
            name: track.title,
            configRef: playlistItem.configRef ?? track.configRef ?? null,
            configOrigin: resolveStoredConfigOrigin(
              playlistItem.configRef ?? track.configRef ?? null,
              playlistItem.configOrigin ?? null,
            ),
            configOverrides: playlistItem.configOverrides ?? null,
            archiveRef: track.archiveRef ?? null,
            durationMs: track.defaultDurationMs ?? undefined,
            songNr: playlistItem.songNr,
            subsongCount: track.subsongCount ?? undefined,
            sourceId: resolveHydratedLocalSourceId(track),
            sizeBytes: track.sizeBytes ?? null,
            modifiedAt: track.modifiedAt ?? null,
            addedAt: playlistItem.addedAt,
            status: playlistItem.status,
            unavailableReason: playlistItem.unavailableReason ?? null,
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
      currentIndex: -1,
    };
    const hydrated = hydrateStoredPlaylist(stored);
    const indexById = new Map(hydrated.items.map((item, index) => [item.id, index]));
    const restoredIndex = session?.currentPlaylistItemId ? (indexById.get(session.currentPlaylistItemId) ?? -1) : -1;
    return {
      items: hydrated.items,
      index: restoredIndex,
      activeQuery: session?.activeQuery ?? null,
    };
  };

  // Restore Session (Step 1: Read)
  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    try {
      const raw = sessionStorage.getItem(PLAYBACK_SESSION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as StoredPlaybackSession;
      if (!parsed || typeof parsed !== "object") return;
      pendingPlaybackRestoreRef.current = parsed;
    } catch (error) {
      addErrorLog("Failed to restore playback session", {
        error: (error as Error).message,
      });
    }
  }, []);

  // Restore Playlist (Local Storage)
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (hydratedPlaylistKeyRef.current === playlistStorageKey) return;
    hydratedPlaylistKeyRef.current = playlistStorageKey;
    (async () => {
      try {
        const defaultKey = buildPlaylistStorageKey("default");
        const candidateKeys = [playlistStorageKey];
        if (resolvedDeviceId !== "default") {
          candidateKeys.push(defaultKey);
        }

        const candidates: Array<{ key: string; parsed: StoredPlaylistState }> = [];
        for (const key of candidateKeys) {
          const raw = localStorage.getItem(key);
          if (!raw) continue;
          try {
            const parsed = JSON.parse(raw) as StoredPlaylistState;
            candidates.push({ key, parsed });
          } catch (error) {
            addErrorLog("Failed to parse stored playlist candidate", {
              key,
              error: (error as Error).message,
            });
          }
        }

        if (!candidates.length) {
          const repositoryRestored = await hydrateFromRepository();
          if (setActivePlaylistQuery && repositoryRestored.activeQuery !== null) {
            setActivePlaylistQuery(repositoryRestored.activeQuery);
          }
          if (repositoryRestored.items.length) {
            setPlaylist(repositoryRestored.items);
            setCurrentIndex(repositoryRestored.index);
          }
          return;
        }

        const preferred = candidates.find((entry) => entry.parsed?.items?.length) ?? candidates[0];
        const restored = hydrateStoredPlaylist(preferred.parsed);
        if (hasPlaylistRef.current && restored.items.length === 0) {
          return;
        }
        setPlaylist(restored.items);
        setCurrentIndex(restored.index);
        if (restored.items.length) {
          await commitPlaylistSnapshot({
            playlistId: playlistStorageKey,
            items: restored.items,
            repository: playlistRepository,
          });
        }
        // Clean up legacy localStorage blobs after migration to repository
        for (const { key } of candidates) {
          localStorage.removeItem(key);
        }
      } catch (error) {
        addErrorLog("Failed to hydrate stored playlist", {
          playlistStorageKey,
          resolvedDeviceId,
          error: (error as Error).message,
        });
      } finally {
        completedInitialRestoreKeyRef.current = playlistStorageKey;
        setRestoreVersion((version) => version + 1);
      }
    })().catch((error) => {
      addErrorLog("Playlist hydration task failed", {
        playlistStorageKey,
        error: (error as Error).message,
      });
      completedInitialRestoreKeyRef.current = playlistStorageKey;
      setRestoreVersion((version) => version + 1);
    });
  }, [
    playlistStorageKey,
    resolvedDeviceId,
    localEntriesBySourceId,
    localSourceTreeUris,
    buildPlaylistItem,
    setActivePlaylistQuery,
  ]);

  // Apply Session Restore (after Playlist Restore)
  useEffect(() => {
    const pending = pendingPlaybackRestoreRef.current;
    if (!pending) return;
    if (!playlist.length) return;
    if (pending.playlistKey !== playlistStorageKey) {
      pendingPlaybackRestoreRef.current = null;
      return;
    }
    const matchedIndex = pending.currentItemId
      ? playlist.findIndex((item) => item.id === pending.currentItemId)
      : pending.currentIndex;
    if (matchedIndex < 0 || matchedIndex >= playlist.length) {
      pendingPlaybackRestoreRef.current = null;
      return;
    }
    setCurrentIndex(matchedIndex);
    setElapsedMs(Math.max(0, pending.elapsedMs));
    setPlayedMs(Math.max(0, pending.playedMs));
    setDurationMs(pending.durationMs);
    setIsPlaying(pending.isPlaying);
    setIsPaused(pending.isPaused);
    const restoredItem = playlist[matchedIndex];
    if (restoredItem && isSongCategory(restoredItem.category)) {
      setCurrentSubsongCount(restoredItem.subsongCount ?? null);
    }
    const now = Date.now();
    if (pending.isPlaying && !pending.isPaused) {
      trackStartedAtRef.current = now - Math.max(0, pending.elapsedMs);
      playedClockRef.current.hydrate(Math.max(0, pending.playedMs), now);
      if (typeof pending.durationMs === "number" && pending.durationMs > 0) {
        const restoredTrackInstanceId = trackInstanceIdRef.current + 1;
        trackInstanceIdRef.current = restoredTrackInstanceId;
        setTrackInstanceId(restoredTrackInstanceId);
        autoAdvanceGuardRef.current = {
          trackInstanceId: restoredTrackInstanceId,
          dueAtMs: (trackStartedAtRef.current ?? now) + pending.durationMs,
          autoFired: false,
          userCancelled: false,
        };
        // Rehydrate native due-time so the background service knows when to auto-skip
        setAutoAdvanceDueAtMs(autoAdvanceGuardRef.current.dueAtMs);
      } else {
        autoAdvanceGuardRef.current = null;
        setAutoAdvanceDueAtMs(null);
      }
    } else {
      trackStartedAtRef.current = null;
      autoAdvanceGuardRef.current = null;
      setAutoAdvanceDueAtMs(null);
      playedClockRef.current.hydrate(Math.max(0, pending.playedMs), null);
    }
    pendingPlaybackRestoreRef.current = null;
  }, [playlist, playlistStorageKey, setTrackInstanceId, setAutoAdvanceDueAtMs]); // Depends on playlist being set

  // Persist Playlist
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    if (completedInitialRestoreKeyRef.current !== playlistStorageKey) return;
    if (
      repositorySnapshot.phase === "SCANNING" ||
      repositorySnapshot.phase === "INGESTING" ||
      repositorySnapshot.phase === "COMMITTING" ||
      repositorySnapshot.phase === "BACKGROUND_COMMITTING"
    ) {
      return;
    }
    try {
      // Clean up any legacy localStorage blobs — production persistence is repository-only
      localStorage.removeItem(playlistStorageKey);
      const defaultKey = buildPlaylistStorageKey("default");
      localStorage.removeItem(defaultKey);

      void commitPlaylistSnapshot({
        playlistId: playlistStorageKey,
        items: playlist,
        repository: playlistRepository,
      }).catch((error) => {
        addErrorLog("Failed to persist playlist repository state", {
          playlistStorageKey,
          error: (error as Error).message,
        });
      });
    } catch (error) {
      addErrorLog("Failed to persist playlist", {
        playlistStorageKey,
        error: (error as Error).message,
      });
    }
  }, [playlist, playlistRepository, playlistStorageKey, repositorySnapshot.phase, restoreVersion]);

  // Persist Repository Session
  useEffect(() => {
    if (completedInitialRestoreKeyRef.current !== playlistStorageKey) return;
    const session: PlaylistSessionRecord = {
      playlistId: playlistStorageKey,
      currentPlaylistItemId,
      isPlaying,
      isPaused,
      elapsedMs,
      playedMs,
      shuffleEnabled,
      repeatEnabled,
      randomSeed: null,
      randomCursor: null,
      activeQuery: activePlaylistQuery,
      updatedAt: new Date().toISOString(),
    };

    void playlistRepository.saveSession(session).catch((error) => {
      addErrorLog("Failed to persist playlist session to repository", {
        playlistStorageKey,
        error: (error as Error).message,
      });
    });
  }, [
    activePlaylistQuery,
    currentPlaylistItemId,
    elapsedMs,
    isPaused,
    isPlaying,
    playedMs,
    playlistRepository,
    playlistStorageKey,
    repeatEnabled,
    restoreVersion,
    shuffleEnabled,
  ]);

  // Persist Session
  useEffect(() => {
    if (typeof sessionStorage === "undefined") return;
    if (!isPlaying && !isPaused) {
      sessionStorage.removeItem(PLAYBACK_SESSION_KEY);
      return;
    }
    const currentItemLabel = currentIndex >= 0 ? (playlist[currentIndex]?.label ?? null) : null;
    const payload: StoredPlaybackSession = {
      playlistKey: playlistStorageKey,
      currentItemId: currentPlaylistItemId,
      currentItemLabel,
      currentIndex,
      isPlaying,
      isPaused,
      elapsedMs,
      playedMs,
      durationMs,
      updatedAt: new Date().toISOString(),
    };
    try {
      sessionStorage.setItem(PLAYBACK_SESSION_KEY, JSON.stringify(payload));
    } catch (error) {
      addErrorLog("Failed to persist playback session", {
        playlistStorageKey,
        error: (error as Error).message,
      });
    }
  }, [
    currentIndex,
    currentPlaylistItemId,
    durationMs,
    elapsedMs,
    isPaused,
    isPlaying,
    playedMs,
    playlist,
    playlistStorageKey,
  ]);
}
