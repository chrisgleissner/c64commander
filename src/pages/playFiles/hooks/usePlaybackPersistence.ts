import { useEffect, useRef } from 'react';
import type { PlayableEntry, PlaylistItem, StoredPlaybackSession, StoredPlaylistState } from '../types';
import {
    PLAYBACK_SESSION_KEY,
    PLAYLIST_STORAGE_PREFIX,
    buildPlaylistStorageKey,
    isSongCategory,
    parseModifiedAt,
} from '../playFilesUtils';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import { resolveLocalRuntimeFile } from '@/lib/sourceNavigation/localSourceAdapter';
import { buildLocalPlayFileFromTree, buildLocalPlayFileFromUri } from '@/lib/playback/fileLibraryUtils';
import type { PlaybackClock } from '@/lib/playback/playbackClock';
import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import { addErrorLog } from '@/lib/logging';
import { getPlaylistDataRepository } from '@/lib/playlistRepository';
import type { PlaylistItemRecord, TrackRecord } from '@/lib/playlistRepository';

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

    resolvedDeviceId: string | null;
    playlistStorageKey: string;

    localEntriesBySourceId: Map<string, Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>>;
    localSourceTreeUris: Map<string, string | null>;

    buildHvscLocalPlayFile: (virtualPath: string, fileName: string) => LocalPlayFile | null;
    buildPlaylistItem: (entry: PlayableEntry, songNrOverride?: number, addedAtOverride?: string | null) => PlaylistItem | null;

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
    resolvedDeviceId,
    playlistStorageKey,
    localEntriesBySourceId,
    localSourceTreeUris,
    buildHvscLocalPlayFile,
    buildPlaylistItem,
    playedClockRef,
    trackStartedAtRef,
    trackInstanceIdRef,
    autoAdvanceGuardRef,
    setTrackInstanceId,
    setAutoAdvanceDueAtMs,
}: UsePlaybackPersistenceProps) {
    const playlistRepository = getPlaylistDataRepository();
    const pendingPlaybackRestoreRef = useRef<StoredPlaybackSession | null>(null);
    const hasHydratedPlaylistRef = useRef(false);
    const hasPlaylistRef = useRef(false);

    useEffect(() => {
        hasPlaylistRef.current = playlist.length > 0;
    }, [playlist]);

    const hydrateStoredPlaylist = (stored: StoredPlaylistState | null) => {
        if (!stored?.items?.length) return { items: [] as PlaylistItem[], index: -1 };
        const hydrated = stored.items
            .map((entry) => {
                const normalizedPath = normalizeSourcePath(entry.path);
                const localEntry = entry.source === 'local' && entry.sourceId
                    ? localEntriesBySourceId.get(entry.sourceId)?.get(normalizedPath)
                    : null;
                const localTreeUri = entry.source === 'local' && entry.sourceId
                    ? localSourceTreeUris.get(entry.sourceId)
                    : null;
                const playable: PlayableEntry = {
                    source: entry.source,
                    name: entry.name,
                    path: entry.path,
                    durationMs: entry.durationMs,
                    sourceId: entry.sourceId ?? null,
                    file: entry.source === 'local'
                        ? resolveLocalRuntimeFile(entry.sourceId ?? '', normalizedPath)
                        || (localEntry?.uri
                            ? buildLocalPlayFileFromUri(entry.name, normalizedPath, localEntry.uri, parseModifiedAt(localEntry.modifiedAt))
                            : undefined)
                        || (localTreeUri
                            ? buildLocalPlayFileFromTree(entry.name, normalizedPath, localTreeUri, parseModifiedAt(localEntry?.modifiedAt))
                            : undefined)
                        : entry.source === 'hvsc'
                            ? buildHvscLocalPlayFile(normalizedPath, entry.name)
                            : undefined,
                    sizeBytes: localEntry?.sizeBytes ?? entry.sizeBytes ?? null,
                    modifiedAt: localEntry?.modifiedAt ?? entry.modifiedAt ?? null,
                };
                return buildPlaylistItem(playable, entry.songNr, entry.addedAt ?? null);
            })
            .filter((item): item is PlaylistItem => Boolean(item));
        return { items: hydrated, index: stored.currentIndex ?? -1 };
    };

    const buildTrackId = (source: string, sourceId: string | null | undefined, path: string) =>
        `${source}:${sourceId ?? ''}:${normalizeSourcePath(path)}`;

    const serializePlaylistToRepository = (items: PlaylistItem[], playlistId: string) => {
        const nowIso = new Date().toISOString();
        const tracks: TrackRecord[] = items.map((item) => ({
            trackId: buildTrackId(item.request.source, item.sourceId ?? null, item.path),
            sourceKind: item.request.source,
            sourceLocator: normalizeSourcePath(item.path),
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
            songNr: item.request.songNr ?? 1,
            sortKey: String(index).padStart(8, '0'),
            durationOverrideMs: item.durationMs ?? null,
            status: item.status ?? 'ready',
            unavailableReason: item.unavailableReason ?? null,
            addedAt: item.addedAt ?? nowIso,
        }));
        return { tracks, playlistItems };
    };

    const persistSerializedPlaylist = async (
        serialized: { tracks: TrackRecord[]; playlistItems: PlaylistItemRecord[] },
        chunkSize = 500,
    ) => {
        for (let index = 0; index < serialized.tracks.length; index += chunkSize) {
            const chunk = serialized.tracks.slice(index, index + chunkSize);
            await playlistRepository.upsertTracks(chunk);
        }
        await playlistRepository.replacePlaylistItems(playlistStorageKey, serialized.playlistItems);
    };

    const hydrateFromRepository = async () => {
        const playlistItems = await playlistRepository.getPlaylistItems(playlistStorageKey);
        if (!playlistItems.length) return { items: [] as PlaylistItem[], index: -1 };
        const trackIds = playlistItems.map((item) => item.trackId);
        const tracks = await playlistRepository.getTracksByIds(trackIds);
        const stored: StoredPlaylistState = {
            items: playlistItems
                .map((playlistItem) => {
                    const track = tracks.get(playlistItem.trackId);
                    if (!track) return null;
                    return {
                        source: track.sourceKind,
                        path: track.path,
                        name: track.title,
                        durationMs: track.defaultDurationMs ?? undefined,
                        songNr: playlistItem.songNr,
                        sourceId: track.sourceKind === 'local' ? (track.sourceLocator.startsWith('/') ? null : track.sourceLocator) : null,
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
        return hydrateStoredPlaylist(stored);
    };

    // Restore Session (Step 1: Read)
    useEffect(() => {
        if (typeof sessionStorage === 'undefined') return;
        try {
            const raw = sessionStorage.getItem(PLAYBACK_SESSION_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as StoredPlaybackSession;
            if (!parsed || typeof parsed !== 'object') return;
            pendingPlaybackRestoreRef.current = parsed;
        } catch (error) {
            addErrorLog('Failed to restore playback session', { error: (error as Error).message });
        }
    }, []);

    // Restore Playlist (Local Storage)
    useEffect(() => {
        if (typeof localStorage === 'undefined') return;
        if (hasHydratedPlaylistRef.current) return;
        hasHydratedPlaylistRef.current = true;
        (async () => {
            try {
                const seenKeys = new Set<string>();
                const candidateKeys: string[] = [];
                const pushKey = (key: string | null | undefined) => {
                    if (!key || seenKeys.has(key)) return;
                    seenKeys.add(key);
                    candidateKeys.push(key);
                };

                const defaultKey = buildPlaylistStorageKey('default');
                pushKey(playlistStorageKey);
                if (resolvedDeviceId !== 'default') {
                    pushKey(defaultKey);
                }

                for (let i = 0; i < localStorage.length; i += 1) {
                    const key = localStorage.key(i);
                    if (key && key.startsWith(PLAYLIST_STORAGE_PREFIX)) {
                        pushKey(key);
                    }
                }

                if (!candidateKeys.length) {
                    const repositoryRestored = await hydrateFromRepository();
                    if (repositoryRestored.items.length) {
                        setPlaylist(repositoryRestored.items);
                        setCurrentIndex(repositoryRestored.index);
                    }
                    return;
                }

                const candidates: Array<{ key: string; parsed: StoredPlaylistState }> = [];
                for (const key of candidateKeys) {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    try {
                        const parsed = JSON.parse(raw) as StoredPlaylistState;
                        candidates.push({ key, parsed });
                    } catch (error) {
                        addErrorLog('Failed to parse stored playlist candidate', {
                            key,
                            error: (error as Error).message,
                        });
                    }
                }

                if (!candidates.length) {
                    const repositoryRestored = await hydrateFromRepository();
                    if (repositoryRestored.items.length) {
                        setPlaylist(repositoryRestored.items);
                        setCurrentIndex(repositoryRestored.index);
                    }
                    return;
                }

                const preferred =
                    candidates.find((entry) => entry.parsed?.items?.length)
                    ?? candidates[0];
                const restored = hydrateStoredPlaylist(preferred.parsed);
                if (hasPlaylistRef.current && restored.items.length === 0) {
                    return;
                }
                setPlaylist(restored.items);
                setCurrentIndex(restored.index);
                if (restored.items.length) {
                    const serialized = serializePlaylistToRepository(restored.items, playlistStorageKey);
                    await persistSerializedPlaylist(serialized);
                }
            } catch (error) {
                addErrorLog('Failed to hydrate stored playlist', {
                    playlistStorageKey,
                    resolvedDeviceId,
                    error: (error as Error).message,
                });
            }
        })().catch((error) => {
            addErrorLog('Playlist hydration task failed', {
                playlistStorageKey,
                error: (error as Error).message,
            });
        });
    }, [
        playlistStorageKey,
        resolvedDeviceId,
        localEntriesBySourceId,
        localSourceTreeUris,
        buildHvscLocalPlayFile,
        buildPlaylistItem,
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
            if (typeof pending.durationMs === 'number' && pending.durationMs > 0) {
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
        if (typeof localStorage === 'undefined') return;
        if (!hasHydratedPlaylistRef.current) return;
        const stored: StoredPlaylistState = {
            items: playlist.map((item) => ({
                source: item.request.source,
                path: item.path,
                name: item.label,
                durationMs: item.durationMs,
                songNr: item.request.songNr,
                sourceId: item.sourceId ?? null,
                sizeBytes: item.sizeBytes ?? null,
                modifiedAt: item.modifiedAt ?? null,
                addedAt: item.addedAt ?? null,
                status: item.status ?? 'ready',
                unavailableReason: item.unavailableReason ?? null,
            })),
            currentIndex,
        };
        try {
            const payload = JSON.stringify(stored);
            localStorage.setItem(playlistStorageKey, payload);
            const defaultKey = buildPlaylistStorageKey('default');
            if (playlistStorageKey !== defaultKey) {
                localStorage.setItem(defaultKey, payload);
            }
            const serialized = serializePlaylistToRepository(playlist, playlistStorageKey);
            void persistSerializedPlaylist(serialized).catch((error) => {
                addErrorLog('Failed to persist playlist repository state', {
                    playlistStorageKey,
                    error: (error as Error).message,
                });
            });
        } catch (error) {
            addErrorLog('Failed to persist playlist', {
                playlistStorageKey,
                error: (error as Error).message,
            });
        }
    }, [currentIndex, playlist, playlistStorageKey]);

    // Persist Session
    useEffect(() => {
        if (typeof sessionStorage === 'undefined') return;
        if (!isPlaying && !isPaused) {
            sessionStorage.removeItem(PLAYBACK_SESSION_KEY);
            return;
        }
        const currentItemId = playlist[currentIndex]?.id ?? null;
        const payload: StoredPlaybackSession = {
            playlistKey: playlistStorageKey,
            currentItemId,
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
            addErrorLog('Failed to persist playback session', {
                playlistStorageKey,
                error: (error as Error).message,
            });
        }
    }, [currentIndex, durationMs, elapsedMs, isPaused, isPlaying, playedMs, playlist, playlistStorageKey]);
}
