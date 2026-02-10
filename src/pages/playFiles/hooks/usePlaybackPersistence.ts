import { useEffect, useRef, useState } from 'react';
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
}: UsePlaybackPersistenceProps) {
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

    // Restore Session (Step 1: Read)
    useEffect(() => {
        if (typeof sessionStorage === 'undefined') return;
        try {
            const raw = sessionStorage.getItem(PLAYBACK_SESSION_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as StoredPlaybackSession;
            if (!parsed || typeof parsed !== 'object') return;
            pendingPlaybackRestoreRef.current = parsed;
        } catch {
            // Ignore invalid session payloads.
        }
    }, []);

    // Restore Playlist (Local Storage)
    useEffect(() => {
        if (typeof localStorage === 'undefined') return;
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

            if (!candidateKeys.length) return;

            const candidates: Array<{ key: string; parsed: StoredPlaylistState }> = [];
            for (const key of candidateKeys) {
                const raw = localStorage.getItem(key);
                if (!raw) continue;
                try {
                    const parsed = JSON.parse(raw) as StoredPlaylistState;
                    candidates.push({ key, parsed });
                } catch {
                    // Ignore invalid stored playlists.
                }
            }

            if (!candidates.length) return;

            const preferred =
                candidates.find((entry) => entry.parsed?.items?.length)
                ?? candidates[0];
            const restored = hydrateStoredPlaylist(preferred.parsed);
            if (hasPlaylistRef.current && restored.items.length === 0) {
                return;
            }
            setPlaylist(restored.items);
            setCurrentIndex(restored.index);
        } catch {
            // Ignore invalid stored playlists.
        } finally {
            hasHydratedPlaylistRef.current = true;
        }
    }, [playlistStorageKey, resolvedDeviceId]); // Reduced dependencies as hydration depends on props mostly

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
                autoAdvanceGuardRef.current = {
                    trackInstanceId: restoredTrackInstanceId,
                    dueAtMs: (trackStartedAtRef.current ?? now) + pending.durationMs,
                    autoFired: false,
                    userCancelled: false,
                };
            } else {
                autoAdvanceGuardRef.current = null;
            }
        } else {
            trackStartedAtRef.current = null;
            autoAdvanceGuardRef.current = null;
            playedClockRef.current.hydrate(Math.max(0, pending.playedMs), null);
        }
        pendingPlaybackRestoreRef.current = null;
    }, [playlist, playlistStorageKey]); // Depends on playlist being set

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
        } catch {
            // Ignore storage failures.
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
        } catch {
            // Ignore storage failures.
        }
    }, [currentIndex, durationMs, elapsedMs, isPaused, isPlaying, playedMs, playlist, playlistStorageKey]);
}
