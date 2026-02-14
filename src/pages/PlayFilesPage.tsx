/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { wrapUserEvent } from '@/lib/tracing/userTrace';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { AddItemsProgressOverlay, type AddItemsProgressState } from '@/components/itemSelection/AddItemsProgressOverlay';
import { ItemSelectionDialog, type SourceGroup } from '@/components/itemSelection/ItemSelectionDialog';
import { useC64ConfigItems, useC64Connection, useC64UpdateConfigBatch } from '@/hooks/useC64Connection';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { useLocalSources } from '@/hooks/useLocalSources';
import { useActionTrace } from '@/hooks/useActionTrace';
import { toast } from '@/hooks/use-toast';
import { addErrorLog, addLog } from '@/lib/logging';
import { reportUserError } from '@/lib/uiErrors';
import { getC64API } from '@/lib/c64api';
import type { TraceSourceKind } from '@/lib/tracing/types';
import { discoverConnection, getConnectionSnapshot } from '@/lib/connection/connectionManager';
import { getParentPath } from '@/lib/playback/localFileBrowser';
import { type PlayRequest } from '@/lib/playback/playbackRouter';
import { formatPlayCategory, getPlayCategory, isSupportedPlayFile, type PlayFileCategory } from '@/lib/playback/fileTypes';
import { PlaybackClock } from '@/lib/playback/playbackClock';
import { calculatePlaylistTotals } from '@/lib/playback/playlistTotals';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';
import { createHvscSourceLocation } from '@/lib/sourceNavigation/hvscSourceAdapter';
import { createLocalSourceLocation, resolveLocalRuntimeFile } from '@/lib/sourceNavigation/localSourceAdapter';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import {
  prepareDirectoryInput,
} from '@/lib/sourceNavigation/localSourcesStore';

import {
  buildEnabledSidMuteUpdates,
} from '@/lib/config/sidVolumeControl';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';
import { FolderPicker } from '@/lib/native/folderPicker';
import { redactTreeUri } from '@/lib/native/safUtils';
import { startBackgroundExecution, stopBackgroundExecution } from '@/lib/native/backgroundExecutionManager';
import { BackgroundExecution, onBackgroundAutoSkipDue } from '@/lib/native/backgroundExecution';

import { AppBar } from '@/components/AppBar';
import { FileOriginIcon } from '@/components/FileOriginIcon';
import { SOURCE_LABELS } from '@/lib/sourceNavigation/sourceTerms';
import { VolumeControls } from '@/pages/playFiles/components/VolumeControls';
import { PlaybackControlsCard } from '@/pages/playFiles/components/PlaybackControlsCard';
import { PlaybackSettingsPanel } from '@/pages/playFiles/components/PlaybackSettingsPanel';
import { PlaylistPanel } from '@/pages/playFiles/components/PlaylistPanel';
import { HvscManager } from '@/pages/playFiles/components/HvscManager';
import { useHvscLibrary } from '@/pages/playFiles/hooks/useHvscLibrary';
import { usePlaylistListItems } from '@/pages/playFiles/hooks/usePlaylistListItems';
import { useSonglengths } from '@/pages/playFiles/hooks/useSonglengths';
import { usePlaybackPersistence } from '@/pages/playFiles/hooks/usePlaybackPersistence';
import { usePlaylistManager } from '@/pages/playFiles/hooks/usePlaylistManager';
import { useVolumeOverride } from '@/pages/playFiles/hooks/useVolumeOverride';
import { useLocalEntries } from '@/pages/playFiles/hooks/useLocalEntries';
import { usePlaybackController } from '@/pages/playFiles/hooks/usePlaybackController';
import { usePlaybackResumeTriggers } from '@/pages/playFiles/hooks/usePlaybackResumeTriggers';
import { setPlaybackTraceSnapshot } from '@/pages/playFiles/playbackTraceStore';
import { getPlaylistDataRepository } from '@/lib/playlistRepository';
import type { PlaylistItemRecord, TrackRecord } from '@/lib/playlistRepository';
import { createAddFileSelectionsHandler } from '@/pages/playFiles/handlers/addFileSelections';
import {
  resolveVolumeSyncDecision,
} from '@/pages/playFiles/playbackGuards';
import type { PlaylistItem, StoredPlaybackSession, StoredPlaylistState } from '@/pages/playFiles/types';
import {
  CATEGORY_OPTIONS,
  DEFAULT_SONG_DURATION_MS,
  DURATION_SLIDER_STEPS,
  LAST_DEVICE_ID_KEY,
  PLAYBACK_SESSION_KEY,
  PLAYLIST_STORAGE_PREFIX,
  buildPlaylistStorageKey,
  clampDurationSeconds,
  durationSecondsToSlider,
  formatBytes,
  formatDate,
  formatDurationSeconds,
  formatTime,
  isSongCategory,
  parseDurationInput,

  sliderToDurationSeconds,
  shuffleArray,
} from '@/pages/playFiles/playFilesUtils';




export default function PlayFilesPage() {


  type AutoAdvanceGuard = {
    trackInstanceId: number;
    dueAtMs: number;
    autoFired: boolean;
    userCancelled: boolean;
  };

  const navigate = useNavigate();
  const { status } = useC64Connection();
  const updateConfigBatch = useC64UpdateConfigBatch();
  const deviceInfoId = status.deviceInfo?.unique_id ?? null;
  const { sources: localSources, addSourceFromPicker, addSourceFromFiles } = useLocalSources();
  const [browserOpen, setBrowserOpen] = useState(false);
  const {
    playlist,
    setPlaylist,
    currentIndex,
    setCurrentIndex,
    shuffleEnabled,
    setShuffleEnabled,
    repeatEnabled,
    setRepeatEnabled,
    playlistTypeFilters,
    setPlaylistTypeFilters,
    selectedPlaylistIds,
    setSelectedPlaylistIds,
    isPlaylistLoading,
    setIsPlaylistLoading,
    reshuffleActive,
    handleReshuffle,
  } = usePlaylistManager();
  const hasPlaylistRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playedMs, setPlayedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const [durationSeconds, setDurationSeconds] = useState(() => Math.round(DEFAULT_SONG_DURATION_MS / 1000));
  const [durationInput, setDurationInput] = useState(() => formatDurationSeconds(Math.round(DEFAULT_SONG_DURATION_MS / 1000)));
  const [songNrInput, setSongNrInput] = useState('');
  const [currentSubsongCount, setCurrentSubsongCount] = useState<number | null>(null);
  const {
    songlengthsFiles,
    activeSonglengthsPath,
    songlengthsSummary,
    handleSonglengthsInput,
    handleSonglengthsPicked,
    applySonglengthsToItems,
    resolveSonglengthDurationMsForPath,
    mergeSonglengthsFiles,
    collectSonglengthsCandidates,
  } = useSonglengths({ playlist });
  const [recurseFolders, setRecurseFolders] = useState(true);

  const [songPickerOpen, setSongPickerOpen] = useState(false);
  const [addItemsProgress, setAddItemsProgress] = useState<AddItemsProgressState>({
    status: 'idle',
    count: 0,
    elapsedMs: 0,
    total: null,
    message: null,
  });
  const [showAddItemsOverlay, setShowAddItemsOverlay] = useState(false);
  const [isAddingItems, setIsAddingItems] = useState(false);
  const [queryFilteredPlaylist, setQueryFilteredPlaylist] = useState<PlaylistItem[]>([]);
  const addItemsOverlayStartedAtRef = useRef<number | null>(null);
  const addItemsOverlayActiveRef = useRef(false);
  const [addItemsSurface, setAddItemsSurface] = useState<'dialog' | 'page'>('dialog');
  const { limit: listPreviewLimit } = useListPreviewLimit();
  const isAndroid = getPlatform() === 'android' && isNativePlatform();
  const trace = useActionTrace('PlayFilesPage');

  const { flags, isLoaded } = useFeatureFlags();
  const hvscControlsEnabled = isLoaded && flags.hvsc_enabled;

  const {
    volumeState,
    dispatchVolume,
    volumeSteps,
    sidEnablement,
    enabledSidVolumeItems,
    resolveEnabledSidVolumeItems,
    restoreVolumeOverrides,
    applyAudioMixerUpdates,
    pauseMuteSnapshotRef,
    volumeSessionActiveRef,
    captureSidMuteSnapshot,
    snapshotToUpdates,
    handleVolumeLocalChange,
    handleVolumeAsyncChange,
    handleVolumeCommit,
    handleToggleMute,
  } = useVolumeOverride({ isPlaying, isPaused });
  const volumeIndex = volumeState.index;
  const volumeMuted = volumeState.muted;

  const {
    hvscStatus,
    hvscRoot,
    hvscLibraryAvailable,
    buildHvscLocalPlayFile,
  } = useHvscLibrary();

  const { localEntriesBySourceId, localSourceTreeUris } = useLocalEntries(localSources);


  const localSourceInputRef = useRef<HTMLInputElement | null>(null);
  const songlengthsInputRef = useRef<HTMLInputElement | null>(null);
  const trackStartedAtRef = useRef<number | null>(null);
  const playedClockRef = useRef(new PlaybackClock());
  const addItemsStartedAtRef = useRef<number | null>(null);


  const playTransitionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const playStartInFlightRef = useRef(false);
  const trackInstanceIdRef = useRef(0);
  const [trackInstanceId, setTrackInstanceId] = useState(0);
  const autoAdvanceGuardRef = useRef<AutoAdvanceGuard | null>(null);
  const [autoAdvanceDueAtMs, setAutoAdvanceDueAtMs] = useState<number | null>(null);
  const backgroundExecutionActiveRef = useRef(false);

  useEffect(() => {
    prepareDirectoryInput(localSourceInputRef.current);
  }, []);







  const enqueuePlayTransition = useCallback(async <T,>(task: () => Promise<T>) => {
    const run = playTransitionQueueRef.current.then(task, task);
    playTransitionQueueRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, []);

  const cancelAutoAdvance = useCallback(() => {
    if (!autoAdvanceGuardRef.current) return;
    autoAdvanceGuardRef.current.userCancelled = true;
    setAutoAdvanceDueAtMs(null);
  }, [setAutoAdvanceDueAtMs]);





  const ensurePlaybackConnection = useCallback(async () => {
    if (status.isConnected || status.isDemo) return;
    await discoverConnection('manual');
    const snapshot = getConnectionSnapshot();
    if (snapshot.state !== 'REAL_CONNECTED' && snapshot.state !== 'DEMO_ACTIVE') {
      throw new Error('Device not connected. Check connection settings.');
    }
  }, [status.isConnected, status.isDemo]);

  const {
    playItem,
    startPlaylist,
    handlePlay,
    handleStop,
    handlePauseResume,
    handleNext,
    handlePrevious,
    playlistItemDuration,
  } = usePlaybackController({
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
    setTrackInstanceId,
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
    setAutoAdvanceDueAtMs,
  });





  useEffect(() => {
    if (playlist.length > 0) return;
    playedClockRef.current.reset();
    autoAdvanceGuardRef.current = null;
    setPlayedMs(0);
  }, [playlist.length]);

  useEffect(() => {
    if (isPlaying || isPaused) return;
    const now = Date.now();
    playedClockRef.current.stop(now, true);
    trackStartedAtRef.current = null;
    autoAdvanceGuardRef.current = null;
    setPlayedMs(0);
  }, [isPaused, isPlaying]);

  useEffect(() => {
    if (isPlaying && !isPaused) {
      if (backgroundExecutionActiveRef.current) return;
      backgroundExecutionActiveRef.current = true;
      void startBackgroundExecution({
        source: 'playback-controller',
        reason: 'play',
        context: { trackInstanceId },
      });
      void BackgroundExecution.setDueAtMs({ dueAtMs: autoAdvanceDueAtMs });
      return;
    }
    if (!backgroundExecutionActiveRef.current) return;
    backgroundExecutionActiveRef.current = false;
    void stopBackgroundExecution({
      source: 'playback-controller',
      reason: isPaused ? 'pause' : 'stop',
      context: { trackInstanceId },
    });
    void BackgroundExecution.setDueAtMs({ dueAtMs: null });
  }, [autoAdvanceDueAtMs, isPaused, isPlaying, trackInstanceId]);

  useEffect(() => () => {
    if (!backgroundExecutionActiveRef.current) return;
    backgroundExecutionActiveRef.current = false;
    void stopBackgroundExecution({
      source: 'playback-controller',
      reason: 'cleanup',
      context: { trackInstanceId },
    });
    void BackgroundExecution.setDueAtMs({ dueAtMs: null });
  }, [trackInstanceId]);

  useEffect(() => {
    if (!backgroundExecutionActiveRef.current) return;
    if (!isNativePlatform() || getPlatform() !== 'android') return;
    void BackgroundExecution.setDueAtMs({ dueAtMs: autoAdvanceDueAtMs });
  }, [autoAdvanceDueAtMs]);

  useEffect(() => {
    if (addItemsProgress.status !== 'scanning') return undefined;
    const interval = window.setInterval(() => {
      const startedAt = addItemsStartedAtRef.current ?? Date.now();
      setAddItemsProgress((prev) => ({
        ...prev,
        elapsedMs: Date.now() - startedAt,
      }));
    }, 500);
    return () => window.clearInterval(interval);
  }, [addItemsProgress.status]);

  useEffect(() => {
    if (browserOpen) {
      setAddItemsSurface('dialog');
    }
  }, [browserOpen]);

  const [lastKnownDeviceId, setLastKnownDeviceId] = useState<string | null>(() => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(LAST_DEVICE_ID_KEY);
  });

  useEffect(() => {
    if (!deviceInfoId || typeof localStorage === 'undefined') return;
    setLastKnownDeviceId(deviceInfoId);
    try {
      localStorage.setItem(LAST_DEVICE_ID_KEY, deviceInfoId);
    } catch (error) {
      addErrorLog('Failed to persist last known device id', { error: (error as Error).message });
    }
  }, [deviceInfoId]);

  const resolvedDeviceId = deviceInfoId || lastKnownDeviceId || 'default';
  const playlistStorageKey = useMemo(() => buildPlaylistStorageKey(resolvedDeviceId), [resolvedDeviceId]);

  const handleAutoConfirmStart = useCallback(() => {
    setAddItemsSurface('page');
    setIsAddingItems(true);
    setShowAddItemsOverlay(true);
    addItemsOverlayStartedAtRef.current = Date.now();
    addItemsOverlayActiveRef.current = true;
  }, []);

  useEffect(() => {
    if (browserOpen) return;
    if (addItemsProgress.status === 'scanning') return;
    setAddItemsProgress({ status: 'idle', count: 0, elapsedMs: 0, total: null, message: null });
  }, [addItemsProgress.status, browserOpen]);

  useEffect(() => {
    if (browserOpen) return;
    if (addItemsProgress.status !== 'scanning') return;
    if (addItemsSurface !== 'page') {
      setAddItemsSurface('page');
    }
  }, [addItemsProgress.status, addItemsSurface, browserOpen]);

  useEffect(() => {
    if (addItemsProgress.status === 'scanning') return;
    if (addItemsSurface === 'page' && isAddingItems) return;
    if (addItemsSurface !== 'dialog') {
      setAddItemsSurface('dialog');
    }
  }, [addItemsProgress.status, addItemsSurface, isAddingItems]);

  const sourceGroups: SourceGroup[] = useMemo(() => {
    const ultimateSource = createUltimateSourceLocation();
    const localGroupSources = localSources.map((source) => createLocalSourceLocation(source));
    const groups: SourceGroup[] = [
      { label: SOURCE_LABELS.local, sources: localGroupSources },
      { label: SOURCE_LABELS.c64u, sources: [ultimateSource] },
    ];
    if (hvscLibraryAvailable) {
      groups.push({ label: SOURCE_LABELS.hvsc, sources: [createHvscSourceLocation(hvscRoot.path)] });
    }
    return groups;
  }, [hvscLibraryAvailable, hvscRoot.path, localSources]);



  const handleLocalSourceInput = useCallback((files: FileList | File[] | null) => {
    if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) return;
    addSourceFromFiles(files);
  }, [addSourceFromFiles]);

  const buildPlaylistItem = useCallback((entry: PlayableEntry, songNrOverride?: number, addedAtOverride?: string | null): PlaylistItem | null => {
    const category = getPlayCategory(entry.path);
    if (!category) return null;
    const songNrValue = songNrOverride ?? (songNrInput.trim() === '' ? undefined : Math.max(1, Number(songNrInput)));
    const request: PlayRequest = {
      source: entry.source,
      path: entry.path,
      file: entry.file,
      songNr: Number.isNaN(songNrValue) ? undefined : songNrValue,
    };
    const resolvedSourceId = entry.sourceId ?? (entry.source === 'hvsc' ? 'hvsc-library' : null);
    const idParts = [entry.source, resolvedSourceId ?? ''];
    return {
      id: `${idParts.join(':')}:${entry.path}`,
      request,
      category,
      label: entry.name,
      path: entry.path,
      durationMs: entry.durationMs,
      sourceId: resolvedSourceId,
      sizeBytes: entry.sizeBytes ?? null,
      modifiedAt: entry.modifiedAt ?? null,
      addedAt: addedAtOverride ?? new Date().toISOString(),
      status: 'ready',
      unavailableReason: null,
    };
  }, [songNrInput]);

  const handleAddFileSelections = useMemo(
    () => createAddFileSelectionsHandler({
      addItemsStartedAtRef,
      addItemsOverlayActiveRef,
      addItemsOverlayStartedAtRef,
      addItemsSurface,
      browserOpen,
      recurseFolders,
      songlengthsFiles,
      localSourceTreeUris,
      localEntriesBySourceId,
      setAddItemsSurface,
      setShowAddItemsOverlay,
      setIsAddingItems,
      setAddItemsProgress,
      setPlaylist,
      buildPlaylistItem,
      applySonglengthsToItems,
      mergeSonglengthsFiles,
      collectSonglengthsCandidates,
      buildHvscLocalPlayFile,
    }),
    [
      addItemsSurface,
      applySonglengthsToItems,
      browserOpen,
      buildPlaylistItem,
      collectSonglengthsCandidates,
      localEntriesBySourceId,
      localSourceTreeUris,
      mergeSonglengthsFiles,
      recurseFolders,
      songlengthsFiles,
      buildHvscLocalPlayFile,
    ],
  );


  const syncPlaybackTimeline = useCallback(() => {
    if (!isPlaying || isPaused || currentIndex < 0) return;
    const now = Date.now();
    if (trackStartedAtRef.current) {
      setElapsedMs(now - trackStartedAtRef.current);
    }
    setPlayedMs(playedClockRef.current.current(now));
    const guard = autoAdvanceGuardRef.current;
    if (guard && !guard.autoFired && !guard.userCancelled && now >= guard.dueAtMs) {
      void handleNext('auto', guard.trackInstanceId);
    }
  }, [currentIndex, handleNext, isPaused, isPlaying, playedClockRef]);

  useEffect(() => {
    if (!isPlaying || isPaused || currentIndex < 0) return;
    syncPlaybackTimeline();
    const timer = window.setInterval(syncPlaybackTimeline, 1000);
    return () => window.clearInterval(timer);
  }, [currentIndex, isPaused, isPlaying, syncPlaybackTimeline]);

  usePlaybackResumeTriggers(syncPlaybackTimeline);

  useEffect(() => {
    if (!isNativePlatform() || getPlatform() !== 'android') return;
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | null = null;

    void onBackgroundAutoSkipDue(() => {
      if (cancelled) return;
      syncPlaybackTimeline();
    }).then((next) => {
      handle = next;
      if (cancelled) {
        void handle.remove();
      }
    });

    return () => {
      cancelled = true;
      if (handle) {
        void handle.remove();
      }
    };
  }, [syncPlaybackTimeline]);



  const currentItem = playlist[currentIndex];
  const currentDurationMs = currentItem ? playlistItemDuration(currentItem, currentIndex) : undefined;
  const sourceKind = useMemo<TraceSourceKind | null>(() => {
    if (!currentItem) return null;
    return currentItem.request.source;
  }, [currentItem]);
  const localAccessMode = useMemo<'entries' | 'saf' | null>(() => {
    if (!currentItem || currentItem.request.source !== 'local') return null;
    const treeUri = currentItem.sourceId ? localSourceTreeUris.get(currentItem.sourceId) : null;
    return treeUri ? 'saf' : 'entries';
  }, [currentItem, localSourceTreeUris]);
  const playbackTraceContext = useMemo(() => {
    if (!playlist.length) return null;
    return {
      queueLength: playlist.length,
      currentIndex,
      currentItemId: currentItem?.id ?? null,
      isPlaying,
      elapsedMs,
      durationMs: currentDurationMs ?? null,
      sourceKind,
      localAccessMode,
      trackInstanceId,
      playlistItemId: currentItem?.id ?? null,
    };
  }, [currentDurationMs, currentIndex, currentItem?.id, elapsedMs, isPlaying, playlist.length, sourceKind, localAccessMode, trackInstanceId]);

  useEffect(() => {
    setPlaybackTraceSnapshot(playbackTraceContext);
  }, [playbackTraceContext]);

  useEffect(() => () => setPlaybackTraceSnapshot(null), []);
  const currentDurationLabel = formatTime(currentDurationMs);
  const progressPercent = currentDurationMs ? Math.min(100, (elapsedMs / currentDurationMs) * 100) : 0;
  const remainingMs = currentDurationMs !== undefined ? Math.max(0, currentDurationMs - elapsedMs) : undefined;
  const remainingLabel = currentDurationMs !== undefined ? `-${formatTime(remainingMs)}` : '—';
  const canControlVolume = enabledSidVolumeItems.length > 0 && volumeSteps.length > 0;
  const volumeLabel = volumeSteps[volumeIndex]?.label ?? '—';
  const knownSubsongCount = currentSubsongCount ?? (typeof currentItem?.subsongCount === 'number' ? currentItem.subsongCount : null);
  const subsongCount = knownSubsongCount ?? 1;
  const currentSongNr = currentItem?.request.songNr ?? 1;
  const clampedSongNr = Math.min(Math.max(1, currentSongNr), subsongCount);
  const isSongPlaying = Boolean(currentItem && isSongCategory(currentItem.category) && (isPlaying || isPaused));
  const songSelectorVisible = Boolean(isSongPlaying && knownSubsongCount && knownSubsongCount > 1);

  const handleSongSelection = useCallback(async (nextSongNr: number) => {
    if (!currentItem || !isSongCategory(currentItem.category)) return;
    const capped = knownSubsongCount ? Math.min(Math.max(1, nextSongNr), knownSubsongCount) : Math.max(1, nextSongNr);
    const nextItem = {
      ...currentItem,
      request: { ...currentItem.request, songNr: capped },
    };
    setSongNrInput(String(capped));
    setSongPickerOpen(false);
    setIsPlaylistLoading(true);
    try {
      cancelAutoAdvance();
      await playItem(nextItem, { playlistIndex: currentIndex });
      setPlaylist((prev) => prev.map((item, index) => (index === currentIndex ? nextItem : item)));
    } finally {
      setIsPlaylistLoading(false);
    }
  }, [cancelAutoAdvance, currentIndex, currentItem, knownSubsongCount, playItem]);

  useEffect(() => {
    if (!isSongPlaying && songPickerOpen) {
      setSongPickerOpen(false);
    }
  }, [isSongPlaying, songPickerOpen]);
  const playlistIds = useMemo(() => playlist.map((item) => item.id), [playlist]);
  const selectedPlaylistCount = selectedPlaylistIds.size;
  const allPlaylistSelected = selectedPlaylistCount > 0 && selectedPlaylistCount === playlistIds.length;
  const hasPlaylist = playlist.length > 0;
  const canTransport = hasPlaylist && !isPlaylistLoading;
  const canPause = isPlaying;
  const hasPrev = currentIndex > 0;
  const hasNext = hasPlaylist && (currentIndex < playlist.length - 1 || repeatEnabled);

  const togglePlaylistTypeFilter = (category: PlayFileCategory) => {
    setPlaylistTypeFilters((prev) =>
      prev.includes(category) ? prev.filter((item) => item !== category) : [...prev, category],
    );
  };


  const handlePlaylistSelect = useCallback((item: PlaylistItem, selected: boolean) => {
    setSelectedPlaylistIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(item.id);
      } else {
        next.delete(item.id);
      }
      return next;
    });
  }, []);

  const toggleSelectAllPlaylist = useCallback(() => {
    setSelectedPlaylistIds(allPlaylistSelected ? new Set() : new Set(playlistIds));
  }, [allPlaylistSelected, playlistIds]);

  useEffect(() => {
    if (!songlengthsFiles.length || !playlist.length) return;
    let cancelled = false;
    const snapshot = playlist;
    const applyUpdates = async () => {
      const updated = await applySonglengthsToItems(snapshot);
      if (cancelled) return;
      const changed = updated.some((item, index) => item.durationMs !== snapshot[index]?.durationMs);
      if (!changed) return;
      setPlaylist((prev) => (prev === snapshot ? updated : prev));
    };
    void applyUpdates();
    return () => {
      cancelled = true;
    };
  }, [applySonglengthsToItems, playlist, songlengthsFiles]);

  const removePlaylistItemsById = useCallback((ids: Set<string>) => {
    if (!ids.size) return;
    setPlaylist((prev) => {
      const next = prev.filter((item) => !ids.has(item.id));
      const currentId = prev[currentIndex]?.id;
      if (currentId && ids.has(currentId)) {
        setIsPlaying(false);
        setIsPaused(false);
        setElapsedMs(0);
        setDurationMs(undefined);
        trackStartedAtRef.current = null;
        autoAdvanceGuardRef.current = null;
      }
      setCurrentIndex((prevIndex) => {
        if (prevIndex < 0) return prevIndex;
        if (!currentId) return -1;
        return next.findIndex((entry) => entry.id === currentId);
      });
      return next;
    });
    setSelectedPlaylistIds((prev) => {
      if (!prev.size) return prev;
      const next = new Set(Array.from(prev).filter((id) => !ids.has(id)));
      return next;
    });
  }, [currentIndex]);

  const handleRemoveSelectedPlaylist = useCallback(() => {
    if (!selectedPlaylistIds.size) return;
    removePlaylistItemsById(new Set(selectedPlaylistIds));
  }, [removePlaylistItemsById, selectedPlaylistIds]);

  usePlaybackPersistence({
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
  });

  useEffect(() => {
    if (isPlaying || isPaused) return;
    if (!volumeSessionActiveRef.current) return;
    void restoreVolumeOverrides('playback-ended');
  }, [isPaused, isPlaying, restoreVolumeOverrides]);

  useEffect(() => () => {
    void restoreVolumeOverrides('navigate').catch((error) => {
      addErrorLog('Volume restore failed during navigation', { error: (error as Error).message });
    });
  }, [restoreVolumeOverrides]);





  const handleDurationSliderChange = useCallback((value: number[]) => {
    const nextSeconds = sliderToDurationSeconds(value[0] ?? 0);
    setDurationSeconds(nextSeconds);
    setDurationInput(formatDurationSeconds(nextSeconds));
  }, []);

  const handleDurationInputChange = useCallback((value: string) => {
    setDurationInput(value);
    const parsed = parseDurationInput(value);
    if (parsed === undefined) return;
    const nextSeconds = clampDurationSeconds(Math.round(parsed / 1000));
    setDurationSeconds(nextSeconds);
  }, []);

  const handleDurationInputBlur = useCallback(() => {
    const parsed = parseDurationInput(durationInput);
    if (parsed === undefined) {
      setDurationInput(formatDurationSeconds(durationSeconds));
      return;
    }
    const nextSeconds = clampDurationSeconds(Math.round(parsed / 1000));
    if (nextSeconds !== durationSeconds) {
      setDurationSeconds(nextSeconds);
    }
    setDurationInput(formatDurationSeconds(nextSeconds));
  }, [durationInput, durationSeconds]);

  const buildTrackId = useCallback((source: string, sourceId: string | null | undefined, path: string) =>
    `${source}:${sourceId ?? ''}:${normalizeSourcePath(path)}`,
  []);

  const serializePlaylistToQueryRepository = useCallback((items: PlaylistItem[], playlistId: string) => {
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
  }, [buildTrackId]);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!playlist.length) {
        if (!cancelled) {
          setQueryFilteredPlaylist([]);
        }
        return;
      }

      const repository = getPlaylistDataRepository();
      const serialized = serializePlaylistToQueryRepository(playlist, playlistStorageKey);
      await repository.upsertTracks(serialized.tracks);
      await repository.replacePlaylistItems(playlistStorageKey, serialized.playlistItems);
      const result = await repository.queryPlaylist({
        playlistId: playlistStorageKey,
        categoryFilter: playlistTypeFilters,
        limit: Math.max(1, playlist.length),
        offset: 0,
        sort: 'playlist-position',
      });
      const byId = new Map(playlist.map((item) => [item.id, item]));
      const nextFiltered = result.rows
        .map((row) => byId.get(row.playlistItem.playlistItemId) ?? null)
        .filter((item): item is PlaylistItem => Boolean(item));

      if (!cancelled) {
        setQueryFilteredPlaylist(nextFiltered);
      }
    };

    run().catch((error) => {
      addErrorLog('Failed to query filtered playlist', {
        playlistStorageKey,
        error: (error as Error).message,
      });
      if (!cancelled) {
        setQueryFilteredPlaylist(playlist.filter((item) => playlistTypeFilters.includes(item.category)));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [playlist, playlistStorageKey, playlistTypeFilters, serializePlaylistToQueryRepository]);







  const playlistTotals = useMemo(() => {
    const durations = playlist.map((item, index) => playlistItemDuration(item, index));
    return calculatePlaylistTotals(durations, playedMs);
  }, [playlist, playedMs, playlistItemDuration]);

  const filteredPlaylist = queryFilteredPlaylist;
  const currentPlayingItemId = (isPlaying || isPaused) && currentIndex >= 0
    ? playlist[currentIndex]?.id ?? null
    : null;

  const playlistListItems = usePlaylistListItems({
    filteredPlaylist,
    playlist,
    selectedPlaylistIds,
    isPlaylistLoading,
    handlePlaylistSelect,
    startPlaylist,
    playlistItemDuration,
    formatTime,
    formatPlayCategory,
    formatBytes,
    formatDate,
    getParentPath,
    currentPlayingItemId,
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95 pt-[var(--app-bar-height)]">
      <AppBar
        title="Play Files"
        subtitle={status.isConnected ? 'Connected' : status.isDemo ? 'Demo' : status.isConnecting ? 'Connecting…' : 'Offline'}
      />
      <main className="container max-w-3xl mx-auto px-4 py-6 pb-24 space-y-6">
        <div
          className="bg-card border border-border rounded-xl p-4 space-y-4"
          data-section-label="Playback controls"
          data-testid="play-section-playback"
        >
          <PlaybackControlsCard
            hasCurrentItem={Boolean(currentItem)}
            currentItemIcon={currentItem ? (
              <FileOriginIcon
                origin={currentItem.request.source === 'ultimate' ? 'ultimate' : currentItem.request.source === 'hvsc' ? 'hvsc' : 'local'}
                className="h-3.5 w-3.5 shrink-0 opacity-70"
              />
            ) : undefined}
            currentItemLabel={currentItem?.label ?? null}
            currentDurationLabel={currentDurationLabel}
            subsongLabel={knownSubsongCount && knownSubsongCount > 1 ? `Subsong ${clampedSongNr}/${subsongCount}` : null}
            canTransport={canTransport}
            hasPrev={hasPrev}
            hasNext={hasNext}
            isPlaying={isPlaying}
            isPaused={isPaused}
            hasPlaylist={hasPlaylist}
            isPlaylistLoading={isPlaylistLoading}
            canPause={canPause}
            onPrevious={() => void handlePrevious()}
            onPlay={() => void handlePlay()}
            onStop={() => void handleStop()}
            onPauseResume={() => void handlePauseResume()}
            onNext={() => void handleNext()}
            progressPercent={progressPercent}
            elapsedLabel={formatTime(elapsedMs)}
            remainingLabel={remainingLabel}
            totalLabel={formatTime(playlistTotals.total)}
            remainingTotalLabel={formatTime(playlistTotals.remaining)}
            volumeControls={(
              <VolumeControls
                volumeMuted={volumeMuted}
                canControlVolume={canControlVolume}
                isPending={updateConfigBatch.isPending}
                onToggleMute={() => void handleToggleMute()}
                volumeStepsCount={volumeSteps.length}
                volumeIndex={volumeIndex}
                onVolumeChange={handleVolumeLocalChange}
                onVolumeChangeAsync={handleVolumeAsyncChange}
                onVolumeCommit={(value) => void handleVolumeCommit(value)}
                volumeLabel={volumeLabel}
                volumeValueFormatter={(value) => volumeSteps[Math.round(value)]?.label ?? '—'}
              />
            )}
            recurseFolders={recurseFolders}
            onRecurseChange={(value) => setRecurseFolders(Boolean(value))}
            shuffleEnabled={shuffleEnabled}
            onShuffleChange={(value) => setShuffleEnabled(Boolean(value))}
            repeatEnabled={repeatEnabled}
            onRepeatChange={(value) => setRepeatEnabled(Boolean(value))}
            onReshuffle={handleReshuffle}
            reshuffleActive={reshuffleActive}
            reshuffleDisabled={!shuffleEnabled || playlist.length < 2}
          />
          <PlaybackSettingsPanel
            durationSliderMax={DURATION_SLIDER_STEPS}
            durationSliderValue={durationSecondsToSlider(durationSeconds)}
            durationInput={durationInput}
            onDurationSliderChange={handleDurationSliderChange}
            onDurationInputChange={handleDurationInputChange}
            onDurationInputBlur={handleDurationInputBlur}
            onChooseSonglengthsFile={async () => {
              if (!isAndroid) {
                songlengthsInputRef.current?.click();
                return;
              }
              try {
                const result = await FolderPicker.pickFile({
                  mimeTypes: ['text/plain', 'application/octet-stream'],
                });
                if (!result?.uri || !result?.permissionPersisted) {
                  throw new Error('Songlengths file access was not granted.');
                }
                handleSonglengthsPicked({
                  path: normalizeSourcePath(`/${result.name ?? 'songlengths.md5'}`),
                  uri: result.uri,
                  name: result.name ?? 'songlengths.md5',
                  sizeBytes: result.sizeBytes ?? null,
                  modifiedAt: result.modifiedAt ?? null,
                });
              } catch (error) {
                reportUserError({
                  operation: 'SONGLENGTHS_PICK',
                  title: 'Songlengths file selection failed',
                  description: (error as Error).message,
                  error,
                });
              }
            }}
            activeSonglengthsPath={activeSonglengthsPath}
            songlengthsName={songlengthsSummary.fileName}
            songlengthsSizeLabel={songlengthsSummary.sizeLabel}
            songlengthsEntryCount={songlengthsSummary.entryCount}
            songlengthsError={songlengthsSummary.error}
            songSelectorVisible={songSelectorVisible}
            songPickerOpen={songPickerOpen}
            onSongPickerPointerDown={() => setSongPickerOpen(true)}
            onSongPickerClick={() => {
              setSongNrInput(String(clampedSongNr));
              setSongPickerOpen(true);
            }}
            clampedSongNr={clampedSongNr}
            subsongCount={subsongCount}
            onSelectSong={(value) => void handleSongSelection(value)}
            onCloseSongPicker={() => setSongPickerOpen(false)}
          />
        </div>

        <div data-section-label="Playlist" data-testid="play-section-playlist">
          <PlaylistPanel
            items={playlistListItems}
            selectedCount={selectedPlaylistCount}
            allSelected={allPlaylistSelected}
            onToggleSelectAll={toggleSelectAllPlaylist}
            onRemoveSelected={handleRemoveSelectedPlaylist}
            maxVisible={listPreviewLimit}
            categoryOptions={CATEGORY_OPTIONS}
            playlistTypeFilters={playlistTypeFilters}
            onToggleFilter={togglePlaylistTypeFilter}
            formatCategory={formatPlayCategory}
            hasPlaylist={hasPlaylist}
            onAddItems={() => setBrowserOpen(true)}
            onClearPlaylist={() => removePlaylistItemsById(new Set(playlistIds))}
          />
        </div>

        <input
          ref={localSourceInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={wrapUserEvent((event) => {
            const selected = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
            handleLocalSourceInput(selected.length ? selected : null);
            event.currentTarget.value = '';
          }, 'upload', 'PlayFilesPage', { type: 'file' }, 'LocalInput')}
        />

        <input
          ref={songlengthsInputRef}
          type="file"
          accept=".md5,.MD5,.txt,.TXT,text/plain,application/octet-stream"
          className="hidden"
          onChange={wrapUserEvent((event) => {
            handleSonglengthsInput(event.target.files);
            event.currentTarget.value = '';
          }, 'upload', 'PlayFilesPage', { type: 'file' }, 'SonglengthsInput')}
        />

        <ItemSelectionDialog
          open={browserOpen}
          onOpenChange={setBrowserOpen}
          title="Add items"
          confirmLabel="Add to playlist"
          sourceGroups={sourceGroups}
          onAddLocalSource={async () => (await addSourceFromPicker(localSourceInputRef.current))?.id ?? null}
          onConfirm={handleAddFileSelections}
          filterEntry={(entry) => entry.type === 'dir' || isSupportedPlayFile(entry.path)}
          allowFolderSelection
          isConfirming={isAddingItems}
          progress={addItemsProgress}
          showProgressFooter={addItemsSurface === 'dialog'}
          autoConfirmCloseBefore={isAndroid}
          onAutoConfirmStart={handleAutoConfirmStart}
          autoConfirmLocalSource
        />

        {!browserOpen ? (
          <AddItemsProgressOverlay
            progress={addItemsProgress}
            title="Adding items"
            testId="add-items-overlay"
            visible={showAddItemsOverlay || addItemsProgress.status === 'scanning'}
          />
        ) : null}

        {hvscControlsEnabled && (
          <div data-section-label="HVSC" data-testid="play-section-hvsc">
            <HvscManager
              hvscControlsEnabled={true}
            />
          </div>
        )}
      </main>
    </div>
  );
}
