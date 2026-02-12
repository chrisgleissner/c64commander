import { useCallback, type MutableRefObject } from 'react';
import { getC64API } from '@/lib/c64api';
import { addErrorLog, addLog } from '@/lib/logging';
import { reportUserError } from '@/lib/uiErrors';
import { buildPlayPlan, executePlayPlan, tryFetchUltimateSidBlob, type LocalPlayFile, type PlayRequest } from '@/lib/playback/playbackRouter';
import { getHvscDurationByMd5Seconds } from '@/lib/hvsc';
import { getLocalFilePath, isSongCategory, resolvePlayTargetIndex, tryAcquireSingleFlight, releaseSingleFlight } from '@/pages/playFiles/playFilesUtils';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';

import { buildLocalPlayFileFromUri, buildLocalPlayFileFromTree } from '@/lib/playback/fileLibraryUtils';
import type { PlaylistItem } from '@/pages/playFiles/types';
import { resolveAudioMixerMuteValue } from '@/lib/config/audioMixerSolo';
import type { AudioMixerItem } from '@/pages/playFiles/playFilesUtils';
import type { VolumeAction } from '@/pages/playFiles/volumeState';
import type { SidEnablement } from '@/lib/config/sidVolumeControl';

type SidMuteSnapshot = {
    volumes: Record<string, string | number>;
    enablement: SidEnablement;
};

type AutoAdvanceGuard = {
    trackInstanceId: number;
    dueAtMs: number;
    autoFired: boolean;
    userCancelled: boolean;
};

interface UsePlaybackControllerProps {
    playlist: PlaylistItem[];
    setPlaylist: React.Dispatch<React.SetStateAction<PlaylistItem[]>>;
    currentIndex: number;
    setCurrentIndex: React.Dispatch<React.SetStateAction<number>>;

    isPlaying: boolean;
    setIsPlaying: (v: boolean) => void;
    isPaused: boolean;
    setIsPaused: (v: boolean) => void;
    setIsPlaylistLoading: (v: boolean) => void;

    elapsedMs: number;
    setElapsedMs: (v: number) => void;
    playedMs: number;
    setPlayedMs: (v: number) => void;
    durationMs: number | undefined;
    setDurationMs: (v: number | undefined) => void;
    setCurrentSubsongCount: (v: number | null) => void;
    setTrackInstanceId: (v: number) => void;

    repeatEnabled: boolean;

    // Dependencies
    localEntriesBySourceId: Map<string, Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>>;
    localSourceTreeUris: Map<string, string | null>;
    ensurePlaybackConnection: () => Promise<void>;
    resolveSonglengthDurationMsForPath: (path: string, file: LocalPlayFile | null, songNr: number | null) => Promise<number | null>;
    applySonglengthsToItems: (items: PlaylistItem[]) => Promise<PlaylistItem[]>;

    // Volume Control
    restoreVolumeOverrides: (reason: string) => Promise<void>;
    applyAudioMixerUpdates: (updates: Record<string, string | number>, reason: string) => Promise<void>;
    buildEnabledSidMuteUpdates: (items: AudioMixerItem[], enablement: SidEnablement) => Record<string, string | number>;
    captureSidMuteSnapshot: (items: AudioMixerItem[], enablement: SidEnablement) => SidMuteSnapshot;
    snapshotToUpdates: (
        snapshot: SidMuteSnapshot | null | undefined,
        currentItems?: AudioMixerItem[],
    ) => Record<string, string | number>;
    resolveEnabledSidVolumeItems: (includeDisabled?: boolean) => Promise<AudioMixerItem[]>;
    dispatchVolume: React.Dispatch<VolumeAction>;
    sidEnablement: SidEnablement;
    pauseMuteSnapshotRef: MutableRefObject<SidMuteSnapshot | null>;

    // Refs
    playedClockRef: MutableRefObject<{
        start: (now: number, playing: boolean) => void;
        stop: (now: number, playing: boolean) => void;
        pause: (now: number) => void;
        resume: (now: number) => void;
        reset: () => void;
        current: (now: number) => number;
    }>;
    trackStartedAtRef: MutableRefObject<number | null>;
    trackInstanceIdRef: MutableRefObject<number>;
    autoAdvanceGuardRef: MutableRefObject<AutoAdvanceGuard | null>;
    playStartInFlightRef: MutableRefObject<boolean>;

    cancelAutoAdvance: () => void;
    enqueuePlayTransition: (task: () => Promise<void>) => Promise<void>;
    durationSeconds: number; // for fallback

    setAutoAdvanceDueAtMs: (dueAtMs: number | null) => void;

    trace: any;
}

export function usePlaybackController({
    playlist,
    setPlaylist,
    currentIndex,
    setCurrentIndex,
    isPlaying,
    setIsPlaying,
    isPaused,
    setIsPaused,
    setIsPlaylistLoading,
    elapsedMs,
    setElapsedMs,
    playedMs,
    setPlayedMs,
    durationMs,
    setDurationMs,
    setCurrentSubsongCount,
    repeatEnabled,
    localEntriesBySourceId,
    localSourceTreeUris,
    ensurePlaybackConnection,
    resolveSonglengthDurationMsForPath,
    applySonglengthsToItems,
    restoreVolumeOverrides,
    applyAudioMixerUpdates,
    buildEnabledSidMuteUpdates,
    captureSidMuteSnapshot,
    snapshotToUpdates,
    resolveEnabledSidVolumeItems,
    dispatchVolume,
    sidEnablement,
    pauseMuteSnapshotRef,
    playedClockRef,
    trackStartedAtRef,
    trackInstanceIdRef,
    autoAdvanceGuardRef,
    playStartInFlightRef,
    cancelAutoAdvance,
    enqueuePlayTransition,
    durationSeconds,
    trace,
    setTrackInstanceId,
    setAutoAdvanceDueAtMs,
}: UsePlaybackControllerProps) {

    const durationFallbackMs = durationSeconds * 1000;

    const withTimeout = useCallback(async <T,>(promise: Promise<T>, timeoutMs: number, operation: string) => {
        let timeoutId: number | null = null;
        const timeoutPromise = new Promise<T>((_, reject) => {
            timeoutId = window.setTimeout(() => reject(new Error(`${operation} timed out`)), timeoutMs);
        });
        try {
            return await Promise.race([promise, timeoutPromise]);
        } finally {
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        }
    }, []);

    const resumeMachineWithRetry = useCallback(async (api: ReturnType<typeof getC64API>) => {
        try {
            await withTimeout(api.machineResume(), 6000, 'Resume');
        } catch (error) {
            addErrorLog('Machine resume first attempt failed', { error: (error as Error).message });
            await withTimeout(api.machineResume(), 6000, 'Resume');
        }
    }, [withTimeout]);

    const resolveSidMetadata = useCallback(
        async (file?: LocalPlayFile, songNr?: number | null) => {
            if (!file) return { durationMs: undefined, subsongCount: undefined, readable: false } as const;
            let buffer: ArrayBuffer;
            try {
                buffer = await file.arrayBuffer();
            } catch (error) {
                addErrorLog('Failed to read local SID file', { error: (error as Error).message });
                return { durationMs: durationFallbackMs, subsongCount: undefined, readable: false } as const;
            }
            const { getSidSongCount } = await import('@/lib/sid/sidUtils');
            const subsongCount = getSidSongCount(buffer);

            try {
                const filePath = getLocalFilePath(file);
                const localDurationMs = await resolveSonglengthDurationMsForPath(filePath, file, songNr ?? null);
                if (localDurationMs !== null) {
                    return { durationMs: localDurationMs, subsongCount, readable: true } as const;
                }

                const { computeSidMd5 } = await import('@/lib/sid/sidUtils');
                const md5 = await computeSidMd5(buffer);
                const seconds = await getHvscDurationByMd5Seconds(md5);
                const durationMs = seconds !== undefined && seconds !== null ? seconds * 1000 : durationFallbackMs;
                return { durationMs, subsongCount, readable: true } as const;
            } catch (error) {
                addErrorLog('Failed to resolve SID metadata', {
                    error: (error as Error).message,
                    file: file.name,
                });
                return { durationMs: durationFallbackMs, subsongCount, readable: true } as const;
            }
        },
        [durationFallbackMs, resolveSonglengthDurationMsForPath],
    );

    const resolveUltimateSidDurationByMd5 = useCallback(
        async (path: string, songNr?: number | null): Promise<number | null> => {
            try {
                const blob = await tryFetchUltimateSidBlob(path);
                if (!blob) return null;
                const buffer = await blob.arrayBuffer();
                const { computeSidMd5 } = await import('@/lib/sid/sidUtils');
                const md5 = await computeSidMd5(buffer);
                const seconds = await getHvscDurationByMd5Seconds(md5);
                if (seconds === undefined || seconds === null) return null;
                return seconds * 1000;
            } catch (error) {
                addLog('debug', 'Ultimate SID MD5 duration lookup failed', { path });
                addErrorLog('Ultimate SID MD5 duration lookup failed', {
                    path,
                    error: (error as Error).message,
                });
                return null;
            }
        },
        [],
    );

    const playItem = useCallback(
        async (item: PlaylistItem, options?: { rebootBeforePlay?: boolean; playlistIndex?: number }) => {
            return enqueuePlayTransition(async () => {
                if (item.request.source === 'local' && !item.request.file) {
                    const sourceId = item.sourceId;
                    const treeUri = sourceId ? localSourceTreeUris.get(sourceId) : null;
                    if (treeUri) {
                        const normalizedPath = normalizeSourcePath(item.path);
                        item.request.file = buildLocalPlayFileFromTree(item.label, normalizedPath, treeUri);
                    }
                    const localEntry = sourceId ? localEntriesBySourceId.get(sourceId)?.get(normalizeSourcePath(item.path)) : null;
                    if (!item.request.file && localEntry?.uri) {
                        item.request.file = buildLocalPlayFileFromUri(item.label, normalizeSourcePath(item.path), localEntry.uri);
                    }
                    if (!item.request.file) {
                        throw new Error('Local file unavailable. Re-add it to the playlist.');
                    }
                }
                let durationOverride: number | undefined;
                let subsongCount: number | undefined;
                if (item.category === 'sid' && item.request.source === 'local') {
                    const metadata = await resolveSidMetadata(item.request.file, item.request.songNr ?? null);
                    durationOverride = metadata.durationMs;
                    subsongCount = metadata.subsongCount;
                    if (!metadata.readable) {
                        throw new Error('Local file unavailable. Re-add it to the playlist.');
                    }
                } else if (item.category === 'sid' && item.request.source === 'ultimate' && !item.durationMs) {
                    try {
                        const pathMs = await resolveSonglengthDurationMsForPath(item.path, null, item.request.songNr ?? null);
                        if (pathMs !== null) {
                            durationOverride = pathMs;
                        } else {
                            const md5Ms = await resolveUltimateSidDurationByMd5(item.path, item.request.songNr ?? null);
                            if (md5Ms !== null) durationOverride = md5Ms;
                        }
                    } catch (error) {
                        addLog('debug', 'Ultimate SID duration resolution failed', { path: item.path });
                        addErrorLog('Ultimate SID duration resolution failed', {
                            path: item.path,
                            error: (error as Error).message,
                        });
                    }
                }
                try {
                    await ensurePlaybackConnection();
                } catch (error) {
                    reportUserError({
                        operation: 'PLAYBACK_CONNECT',
                        title: 'Connection failed',
                        description: (error as Error).message,
                        error,
                        context: {
                            item: item.label,
                        },
                    });
                    throw error;
                }
                const api = getC64API();
                if (isSongCategory(item.category)) {
                    setCurrentSubsongCount(subsongCount ?? item.subsongCount ?? null);
                } else {
                    setCurrentSubsongCount(null);
                }
                const request: PlayRequest = durationOverride
                    ? { ...item.request, durationMs: durationOverride }
                    : item.request;
                const plan = buildPlayPlan(request);
                const shouldReboot = options?.rebootBeforePlay ?? item.category === 'disk';
                const executionOptions = shouldReboot ? { rebootBeforeMount: true } : undefined;
                const resolvedDurationBase = durationOverride ?? item.durationMs;
                const resolvedDuration = isSongCategory(item.category)
                    ? resolvedDurationBase ?? durationFallbackMs
                    : resolvedDurationBase;
                setElapsedMs(0);
                setDurationMs(resolvedDuration);
                if (typeof options?.playlistIndex === 'number' && options.playlistIndex >= 0) {
                    setCurrentIndex(options.playlistIndex);
                }
                await executePlayPlan(api, plan, executionOptions);
                const now = Date.now();
                const nextTrackInstanceId = trackInstanceIdRef.current + 1;
                trackInstanceIdRef.current = nextTrackInstanceId;
                setTrackInstanceId(nextTrackInstanceId);
                trackStartedAtRef.current = now;
                playedClockRef.current.start(now, true);
                setPlayedMs(playedClockRef.current.current(now));
                if (isSongCategory(item.category) && typeof resolvedDuration === 'number') {
                    autoAdvanceGuardRef.current = {
                        trackInstanceId: nextTrackInstanceId,
                        dueAtMs: now + resolvedDuration,
                        autoFired: false,
                        userCancelled: false,
                    };
                    setAutoAdvanceDueAtMs(autoAdvanceGuardRef.current.dueAtMs);
                } else {
                    autoAdvanceGuardRef.current = null;
                    setAutoAdvanceDueAtMs(null);
                }
                if (resolvedDuration !== item.durationMs || subsongCount !== item.subsongCount) {
                    setPlaylist((prev) =>
                        prev.map((entry) =>
                            entry.id === item.id
                                ? { ...entry, durationMs: resolvedDuration, subsongCount: subsongCount ?? entry.subsongCount }
                                : entry,
                        ),
                    );
                }
                setIsPlaying(true);
                setIsPaused(false);
            });
        },
        [durationFallbackMs, enqueuePlayTransition, ensurePlaybackConnection, localEntriesBySourceId, localSourceTreeUris, resolveSidMetadata, resolveSonglengthDurationMsForPath, resolveUltimateSidDurationByMd5, setCurrentIndex, setCurrentSubsongCount, setDurationMs, setElapsedMs, setIsPaused, setIsPlaying, setPlayedMs, setPlaylist, setTrackInstanceId, setAutoAdvanceDueAtMs, autoAdvanceGuardRef, playedClockRef, trackInstanceIdRef, trackStartedAtRef],
    );

    const startPlaylist = useCallback(async (items: PlaylistItem[], startIndex = 0) => {
        if (!items.length) return;
        playedClockRef.current.reset();
        setPlayedMs(0);
        const resolvedItems = await applySonglengthsToItems(items);
        setPlaylist((prev) => {
            if (!prev.length) return resolvedItems;
            const baseIds = new Set(resolvedItems.map((item) => item.id));
            const extras = prev.filter((item) => !baseIds.has(item.id));
            return extras.length ? [...resolvedItems, ...extras] : resolvedItems;
        });
        setIsPlaylistLoading(true);
        setIsPaused(false);
        try {
            await playItem(resolvedItems[startIndex], { playlistIndex: startIndex });
        } catch (error) {
            reportUserError({
                operation: 'PLAYBACK_START',
                title: 'Playback failed',
                description: (error as Error).message,
                error,
                context: {
                    item: resolvedItems[startIndex]?.label,
                },
            });
            setIsPlaying(false);
            setIsPaused(false);
            trackStartedAtRef.current = null;
            autoAdvanceGuardRef.current = null;
            setAutoAdvanceDueAtMs(null);
        } finally {
            setIsPlaylistLoading(false);
        }
    }, [applySonglengthsToItems, playItem, playedClockRef, setAutoAdvanceDueAtMs, setIsPaused, setIsPlaying, setIsPlaylistLoading, setPlayedMs, setPlaylist, trackStartedAtRef, autoAdvanceGuardRef]);

    const handlePlay = useCallback(trace(async function handlePlay() {
        const targetIndex = resolvePlayTargetIndex(playlist.length, currentIndex);
        if (targetIndex === null) return;
        if (!tryAcquireSingleFlight(playStartInFlightRef)) return;
        setIsPlaylistLoading(true);
        try {
            if (currentIndex < 0) {
                await startPlaylist(playlist, targetIndex);
                return;
            }
            cancelAutoAdvance();
            await playItem(playlist[targetIndex], { playlistIndex: targetIndex });
        } catch (error) {
            reportUserError({
                operation: 'PLAYBACK_START',
                title: 'Playback failed',
                description: (error as Error).message,
                error,
                context: {
                    item: playlist[targetIndex]?.label,
                },
            });
        } finally {
            releaseSingleFlight(playStartInFlightRef);
            setIsPlaylistLoading(false);
        }
    }), [cancelAutoAdvance, currentIndex, playItem, playlist, startPlaylist, trace, playStartInFlightRef, setIsPlaylistLoading]);

    const handleStop = useCallback(trace(async function handleStop() {
        if (!isPlaying && !isPaused) return;
        const currentItem = playlist[currentIndex];
        const shouldReboot = currentItem?.category === 'disk';
        try {
            const api = getC64API();
            if (isPaused) {
                try {
                    await resumeMachineWithRetry(api);
                } catch (error) {
                    addErrorLog('Resume before stop failed', { error: (error as Error).message });
                }
            }
            if (shouldReboot) {
                await withTimeout(api.machineReboot(), 3000, 'Reboot');
            } else {
                await withTimeout(api.machineReset(), 3000, 'Reset');
            }
        } catch (error) {
            reportUserError({
                operation: 'PLAYBACK_STOP',
                title: 'Stop failed',
                description: (error as Error).message,
                error,
                context: {
                    currentIndex,
                    category: currentItem?.category,
                },
            });
        }
        await restoreVolumeOverrides('stop');
        const now = Date.now();
        playedClockRef.current.stop(now, true);
        setPlayedMs(0);
        setIsPlaying(false);
        setIsPaused(false);
        setElapsedMs(0);
        setDurationMs(undefined);
        setCurrentSubsongCount(null);
        trackStartedAtRef.current = null;
        autoAdvanceGuardRef.current = null;
        setAutoAdvanceDueAtMs(null);
    }), [currentIndex, isPaused, isPlaying, playlist, restoreVolumeOverrides, resumeMachineWithRetry, withTimeout, trace, playedClockRef, setAutoAdvanceDueAtMs, setPlayedMs, setIsPlaying, setIsPaused, setElapsedMs, setDurationMs, setCurrentSubsongCount, trackStartedAtRef, autoAdvanceGuardRef]);

    const handlePauseResume = useCallback(trace(async function handlePauseResume() {
        if (!isPlaying) return;
        const api = getC64API();
        try {
            if (isPaused) {
                const resumeItems = await resolveEnabledSidVolumeItems(true);
                const resumeSnapshot = pauseMuteSnapshotRef.current;
                const wasMuted = resumeSnapshot && resumeItems.length
                    ? resumeItems.every((item) => resumeSnapshot.volumes[item.name] === resolveAudioMixerMuteValue(item.options))
                    : false;
                await resumeMachineWithRetry(api);
                if (pauseMuteSnapshotRef.current && resumeItems.length) {
                    try {
                        await applyAudioMixerUpdates(snapshotToUpdates(pauseMuteSnapshotRef.current, resumeItems), 'Resume');
                    } catch (error) {
                        addErrorLog('Failed to reapply audio mixer settings after resume', {
                            error: (error as Error).message,
                            itemCount: resumeItems.length,
                        });
                    }
                }
                pauseMuteSnapshotRef.current = null;
                setIsPaused(false);
                dispatchVolume({ type: wasMuted ? 'mute' : 'unmute', reason: 'pause' });
                const now = Date.now();
                trackStartedAtRef.current = now - elapsedMs;
                playedClockRef.current.resume(now);
                setPlayedMs(playedClockRef.current.current(now));
                if (autoAdvanceGuardRef.current && typeof durationMs === 'number') {
                    autoAdvanceGuardRef.current.dueAtMs = now + Math.max(0, durationMs - elapsedMs);
                    autoAdvanceGuardRef.current.autoFired = false;
                    autoAdvanceGuardRef.current.userCancelled = false;
                    setAutoAdvanceDueAtMs(autoAdvanceGuardRef.current.dueAtMs);
                }
            } else {
                const pauseItems = await resolveEnabledSidVolumeItems();
                if (pauseItems.length) {
                    pauseMuteSnapshotRef.current = captureSidMuteSnapshot(pauseItems, sidEnablement);
                }
                await withTimeout(api.machinePause(), 3000, 'Pause');
                if (pauseItems.length) {
                    await applyAudioMixerUpdates(buildEnabledSidMuteUpdates(pauseItems, sidEnablement), 'Pause');
                    dispatchVolume({ type: 'mute', reason: 'pause' });
                }
                const now = Date.now();
                playedClockRef.current.pause(now);
                setPlayedMs(playedClockRef.current.current(now));
                setIsPaused(true);
                setAutoAdvanceDueAtMs(null);
            }
        } catch (error) {
            reportUserError({
                operation: 'PLAYBACK_CONTROL',
                title: 'Playback control failed',
                description: (error as Error).message,
                error,
                context: {
                    isPaused,
                    isPlaying,
                },
            });
        }
    }), [applyAudioMixerUpdates, buildEnabledSidMuteUpdates, captureSidMuteSnapshot, dispatchVolume, durationMs, elapsedMs, isPaused, isPlaying, resolveEnabledSidVolumeItems, sidEnablement, snapshotToUpdates, trace, pauseMuteSnapshotRef, playedClockRef, resumeMachineWithRetry, setAutoAdvanceDueAtMs, setPlayedMs, setIsPaused, trackStartedAtRef, autoAdvanceGuardRef]);

    const handleNext = useCallback(async (source: 'auto' | 'user' = 'user', expectedTrackInstanceId?: number) => {
        if (!playlist.length) return;
        if (source === 'auto') {
            const guard = autoAdvanceGuardRef.current;
            if (!guard || guard.autoFired || guard.userCancelled) return;
            if (typeof expectedTrackInstanceId === 'number' && guard.trackInstanceId !== expectedTrackInstanceId) return;
            guard.autoFired = true;
        } else {
            cancelAutoAdvance();
        }

        const now = Date.now();
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        const currentItem = playlist[currentIndex];
        let nextIndex = currentIndex + 1;
        if (nextIndex >= playlist.length) {
            if (!repeatEnabled) {
                playedClockRef.current.pause(Date.now());
                setIsPlaying(false);
                setIsPaused(false);
                autoAdvanceGuardRef.current = null;
                setAutoAdvanceDueAtMs(null);
                return;
            }
            nextIndex = 0;
        }

        const nextItem = playlist[nextIndex];
        const shouldReboot = currentItem?.category === 'disk' || nextItem?.category === 'disk';
        try {
            await playItem(nextItem, { rebootBeforePlay: shouldReboot, playlistIndex: nextIndex });
            setIsPaused(false);
        } catch (error) {
            reportUserError({
                operation: 'PLAYBACK_NEXT',
                title: 'Playback next failed',
                description: (error as Error).message,
                error,
                context: {
                    currentIndex,
                    nextIndex,
                    source,
                },
            });
            setIsPlaying(false);
            setIsPaused(false);
            trackStartedAtRef.current = null;
            autoAdvanceGuardRef.current = null;
            setAutoAdvanceDueAtMs(null);
        }
    }, [cancelAutoAdvance, currentIndex, playItem, playlist, repeatEnabled, playedClockRef, setAutoAdvanceDueAtMs, setPlayedMs, setIsPlaying, setIsPaused, autoAdvanceGuardRef, trackStartedAtRef]);

    const handlePrevious = useCallback(async () => {
        if (!playlist.length) return;
        cancelAutoAdvance();
        const now = Date.now();
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        const currentItem = playlist[currentIndex];
        const prevIndex = Math.max(0, currentIndex - 1);
        const prevItem = playlist[prevIndex];
        const shouldReboot = currentItem?.category === 'disk' || prevItem?.category === 'disk';
        try {
            await playItem(prevItem, { rebootBeforePlay: shouldReboot, playlistIndex: prevIndex });
            setIsPaused(false);
        } catch (error) {
            reportUserError({
                operation: 'PLAYBACK_PREVIOUS',
                title: 'Playback previous failed',
                description: (error as Error).message,
                error,
                context: {
                    currentIndex,
                    prevIndex,
                },
            });
            setIsPlaying(false);
            setIsPaused(false);
            trackStartedAtRef.current = null;
            autoAdvanceGuardRef.current = null;
            setAutoAdvanceDueAtMs(null);
        }
    }, [cancelAutoAdvance, currentIndex, playItem, playlist, playedClockRef, setAutoAdvanceDueAtMs, setPlayedMs, setIsPlaying, setIsPaused, trackStartedAtRef, autoAdvanceGuardRef]);

    const playlistItemDuration = useCallback(
        (item: PlaylistItem, index: number) => {
            const base = index === currentIndex ? durationMs ?? item.durationMs : item.durationMs;
            if (isSongCategory(item.category)) {
                return base ?? durationFallbackMs;
            }
            return base;
        },
        [currentIndex, durationFallbackMs, durationMs],
    );

    return {
        playItem,
        startPlaylist,
        handlePlay,
        handleStop,
        handlePauseResume,
        handleNext,
        handlePrevious,
        resolveSidMetadata,
        resolveUltimateSidDurationByMd5,
        playlistItemDuration,
        withTimeout,
    };
}
