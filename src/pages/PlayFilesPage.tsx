import { wrapUserEvent } from '@/lib/tracing/userTrace';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
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
import { discoverConnection, getConnectionSnapshot } from '@/lib/connection/connectionManager';
import { getParentPath } from '@/lib/playback/localFileBrowser';
import { buildLocalPlayFileFromTree, buildLocalPlayFileFromUri } from '@/lib/playback/fileLibraryUtils';
import { buildPlayPlan, executePlayPlan, type PlaySource, type PlayRequest, type LocalPlayFile } from '@/lib/playback/playbackRouter';
import { formatPlayCategory, getPlayCategory, isSupportedPlayFile, type PlayFileCategory } from '@/lib/playback/fileTypes';
import { PlaybackClock } from '@/lib/playback/playbackClock';
import { calculatePlaylistTotals } from '@/lib/playback/playlistTotals';
import { createUltimateSourceLocation } from '@/lib/sourceNavigation/ftpSourceAdapter';
import { createHvscSourceLocation } from '@/lib/sourceNavigation/hvscSourceAdapter';
import { createLocalSourceLocation, resolveLocalRuntimeFile } from '@/lib/sourceNavigation/localSourceAdapter';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';
import {
  getLocalSourceListingMode,
  prepareDirectoryInput,
  requireLocalSourceEntries,
} from '@/lib/sourceNavigation/localSourcesStore';
import { LocalSourceListingError } from '@/lib/sourceNavigation/localSourceErrors';
import type { SelectedItem, SourceEntry, SourceLocation } from '@/lib/sourceNavigation/types';
import { computeSidMd5 } from '@/lib/sid/sidUtils';
import { isSonglengthsFileName } from '@/lib/sid/songlengthsDiscovery';
import { isSidVolumeName, resolveAudioMixerMuteValue } from '@/lib/config/audioMixerSolo';
import {
  AUDIO_MIXER_VOLUME_ITEMS,
  SID_ADDRESSING_ITEMS,
  SID_SOCKETS_ITEMS,
} from '@/lib/config/configItems';
import {
  buildEnabledSidMuteUpdates,
  buildEnabledSidRestoreUpdates,
  buildEnabledSidUnmuteUpdates,
  buildEnabledSidVolumeSnapshot,
  buildEnabledSidVolumeUpdates,
  buildSidEnablement,
  buildSidVolumeSteps,
  filterEnabledSidVolumeItems,
} from '@/lib/config/sidVolumeControl';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';
import { FolderPicker } from '@/lib/native/folderPicker';
import { redactTreeUri } from '@/lib/native/safUtils';
import { getHvscDurationByMd5Seconds, getHvscFolderListing } from '@/lib/hvsc';
import { AppBar } from '@/components/AppBar';
import { VolumeControls } from '@/pages/playFiles/components/VolumeControls';
import { PlaybackControlsCard } from '@/pages/playFiles/components/PlaybackControlsCard';
import { PlaybackSettingsPanel } from '@/pages/playFiles/components/PlaybackSettingsPanel';
import { PlaylistPanel } from '@/pages/playFiles/components/PlaylistPanel';
import { HvscControls } from '@/pages/playFiles/components/HvscControls';
import { useHvscLibrary } from '@/pages/playFiles/hooks/useHvscLibrary';
import { usePlaylistListItems } from '@/pages/playFiles/hooks/usePlaylistListItems';
import { useSonglengths } from '@/pages/playFiles/hooks/useSonglengths';
import { createAddFileSelectionsHandler } from '@/pages/playFiles/handlers/addFileSelections';
import type { PlayableEntry, PlaylistItem, StoredPlaybackSession, StoredPlaylistState } from '@/pages/playFiles/types';
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
  extractAudioMixerItems,
  formatBytes,
  formatDate,
  formatDurationSeconds,
  formatTime,
  getLocalFilePath,
  getSidSongCount,
  isSongCategory,
  parseDurationInput,
  parseModifiedAt,
  parseVolumeOption,
  shuffleArray,
  sliderToDurationSeconds,
} from '@/pages/playFiles/playFilesUtils';


export default function PlayFilesPage() {
  const navigate = useNavigate();
  const { status } = useC64Connection();
  const updateConfigBatch = useC64UpdateConfigBatch();
  const { data: audioMixerCategory } = useC64ConfigItems(
    'Audio Mixer',
    AUDIO_MIXER_VOLUME_ITEMS,
    status.isConnected || status.isConnecting,
  );
  const { data: sidSocketsCategory } = useC64ConfigItems(
    'SID Sockets Configuration',
    SID_SOCKETS_ITEMS,
    status.isConnected || status.isConnecting,
  );
  const { data: sidAddressingCategory } = useC64ConfigItems(
    'SID Addressing',
    SID_ADDRESSING_ITEMS,
    status.isConnected || status.isConnecting,
  );
  const deviceInfoId = status.deviceInfo?.unique_id ?? null;
  const { sources: localSources, addSourceFromPicker, addSourceFromFiles } = useLocalSources();
  const [browserOpen, setBrowserOpen] = useState(false);
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([]);
  const hasPlaylistRef = useRef(false);
  const [currentIndex, setCurrentIndex] = useState(-1);
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
    loadSonglengthsForPath,
    applySonglengthsToItems,
    mergeSonglengthsFiles,
    collectSonglengthsCandidates,
  } = useSonglengths({ playlist });
  const [recurseFolders, setRecurseFolders] = useState(true);
  const [shuffleEnabled, setShuffleEnabled] = useState(false);
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [playlistTypeFilters, setPlaylistTypeFilters] = useState<PlayFileCategory[]>(CATEGORY_OPTIONS);
  const [isPlaylistLoading, setIsPlaylistLoading] = useState(false);
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(new Set());
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
  const addItemsOverlayStartedAtRef = useRef<number | null>(null);
  const addItemsOverlayActiveRef = useRef(false);
  const [addItemsSurface, setAddItemsSurface] = useState<'dialog' | 'page'>('dialog');
  const { limit: listPreviewLimit } = useListPreviewLimit();
  const isAndroid = getPlatform() === 'android' && isNativePlatform();
  const trace = useActionTrace('PlayFilesPage');

  const { flags, isLoaded } = useFeatureFlags();
  const hvscControlsEnabled = isLoaded && flags.hvsc_enabled;

  const audioMixerItems = useMemo(() => extractAudioMixerItems(audioMixerCategory as Record<string, unknown> | undefined), [audioMixerCategory]);
  const sidVolumeItems = useMemo(
    () => audioMixerItems.filter((item) => isSidVolumeName(item.name)),
    [audioMixerItems],
  );
  const sidEnablement = useMemo(
    () =>
      buildSidEnablement(
        sidSocketsCategory as Record<string, unknown> | undefined,
        sidAddressingCategory as Record<string, unknown> | undefined,
      ),
    [sidAddressingCategory, sidSocketsCategory],
  );
  const enabledSidVolumeItems = useMemo(
    () => filterEnabledSidVolumeItems(sidVolumeItems, sidEnablement),
    [sidEnablement, sidVolumeItems],
  );
  const volumeSteps = useMemo(() => {
    const baseOptions = sidVolumeItems.find((item) => Array.isArray(item.options) && item.options.length)?.options ?? [];
    return buildSidVolumeSteps(baseOptions);
  }, [sidVolumeItems]);
  const {
    hvscStatus,
    hvscRoot,
    hvscAvailable,
    hvscLibraryAvailable,
    hvscFolderFilter,
    hvscFolders,
    hvscSongs,
    selectedHvscFolder,
    setHvscFolderFilter,
    loadHvscFolder,
    handleHvscInstall,
    handleHvscIngest,
    handleHvscCancel,
    buildHvscLocalPlayFile,
    formatHvscDuration,
    formatHvscTimestamp,
    hvscInstalled,
    hvscInProgress,
    hvscUpdating,
    hvscInlineError,
    hvscSummaryState,
    hvscSummaryFilesExtracted,
    hvscSummaryDurationMs,
    hvscSummaryUpdatedAt,
    hvscSummaryFailureLabel,
    hvscDownloadPercent,
    hvscDownloadBytes,
    hvscDownloadTotalBytes,
    hvscDownloadElapsedMs,
    hvscDownloadStatus,
    hvscExtractionPercent,
    hvscExtractionTotalFiles,
    hvscExtractionElapsedMs,
    hvscExtractionStatus,
    hvscCurrentFile,
    hvscActionLabel,
    hvscStage,
    hvscVisibleFolders,
  } = useHvscLibrary();
  const [volumeIndex, setVolumeIndex] = useState(0);
  const [volumeMuted, setVolumeMuted] = useState(false);
  const [reshuffleActive, setReshuffleActive] = useState(false);

  const localSourceInputRef = useRef<HTMLInputElement | null>(null);
  const songlengthsInputRef = useRef<HTMLInputElement | null>(null);
  const trackStartedAtRef = useRef<number | null>(null);
  const playedClockRef = useRef(new PlaybackClock());
  const addItemsStartedAtRef = useRef<number | null>(null);
  const manualMuteSnapshotRef = useRef<Record<string, string | number> | null>(null);
  const pauseMuteSnapshotRef = useRef<Record<string, string | number> | null>(null);
  const volumeSessionSnapshotRef = useRef<Record<string, string | number> | null>(null);
  const volumeSessionActiveRef = useRef(false);
  const volumeUpdateTimerRef = useRef<number | null>(null);
  const volumeUpdateSeqRef = useRef(0);
  const volumeDragRef = useRef(false);
  const reshuffleTimerRef = useRef<number | null>(null);
  const pendingPlaybackRestoreRef = useRef<StoredPlaybackSession | null>(null);
  const hasHydratedPlaylistRef = useRef(false);

  useEffect(() => {
    prepareDirectoryInput(localSourceInputRef.current);
  }, []);

  const defaultVolumeIndex = useMemo(() => {
    const zeroIndex = volumeSteps.findIndex((option) => option.numeric === 0);
    return zeroIndex >= 0 ? zeroIndex : 0;
  }, [volumeSteps]);

  const resolveVolumeIndex = useCallback((value: string | number) => {
    if (!volumeSteps.length) return defaultVolumeIndex;
    const stringValue = typeof value === 'string' ? value.trim() : value.toString();
    const directIndex = volumeSteps.findIndex((option) => option.option.trim() === stringValue);
    if (directIndex >= 0) return directIndex;
    const numeric = typeof value === 'number' ? value : parseVolumeOption(value);
    if (numeric !== undefined) {
      const numericIndex = volumeSteps.findIndex((option) => option.numeric === numeric);
      if (numericIndex >= 0) return numericIndex;
    }
    return defaultVolumeIndex;
  }, [defaultVolumeIndex, volumeSteps]);

  const withTimeout = useCallback(async <T,>(promise: Promise<T>, timeoutMs: number, operation: string) => {
    let timeoutId: number | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error(`${operation} timed out`)), timeoutMs);
    });
    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    }
  }, []);

  const applyAudioMixerUpdates = useCallback(async (updates: Record<string, string | number>, context: string) => {
    if (!Object.keys(updates).length) return;
    try {
      await withTimeout(
        updateConfigBatch.mutateAsync({ category: 'Audio Mixer', updates, immediate: true }),
        4000,
        `${context} audio mixer update`,
      );
    } catch (error) {
      if (context.startsWith('Restore')) {
        addErrorLog('Audio mixer restore failed', { error: (error as Error).message, context });
        return;
      }
      reportUserError({
        operation: 'VOLUME_UPDATE',
        title: 'Audio mixer update failed',
        description: (error as Error).message,
        error,
        context: {
          context,
          updates: Object.keys(updates),
        },
      });
    }
  }, [reportUserError, updateConfigBatch, withTimeout]);

  const resolveSidVolumeItems = useCallback(async (forceRefresh = false) => {
    if (sidVolumeItems.length && !forceRefresh) return sidVolumeItems;
    try {
      const data = await getC64API().getConfigItems('Audio Mixer', AUDIO_MIXER_VOLUME_ITEMS);
      return extractAudioMixerItems(data as Record<string, unknown>).filter((item) => isSidVolumeName(item.name));
    } catch (error) {
      addErrorLog('Audio mixer lookup failed', { error: (error as Error).message });
      return [];
    }
  }, [sidVolumeItems]);

  const resolveSidEnablement = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && sidSocketsCategory && sidAddressingCategory) {
      return buildSidEnablement(
        sidSocketsCategory as Record<string, unknown>,
        sidAddressingCategory as Record<string, unknown>,
      );
    }
    try {
      const api = getC64API();
      const [sockets, addressing] = await Promise.all([
        api.getConfigItems('SID Sockets Configuration', SID_SOCKETS_ITEMS),
        api.getConfigItems('SID Addressing', SID_ADDRESSING_ITEMS),
      ]);
      return buildSidEnablement(
        sockets as Record<string, unknown>,
        addressing as Record<string, unknown>,
      );
    } catch (error) {
      addErrorLog('SID enablement lookup failed', { error: (error as Error).message });
      return sidEnablement;
    }
  }, [sidAddressingCategory, sidEnablement, sidSocketsCategory]);

  const resolveEnabledSidVolumeItems = useCallback(async (forceRefresh = false) => {
    const items = await resolveSidVolumeItems(forceRefresh);
    const enablement = forceRefresh ? await resolveSidEnablement(true) : sidEnablement;
    return filterEnabledSidVolumeItems(items, enablement);
  }, [resolveSidEnablement, resolveSidVolumeItems, sidEnablement]);

  const ensureVolumeSessionSnapshot = useCallback(async () => {
    if (!isPlaying && !isPaused) return null;
    if (volumeSessionSnapshotRef.current) return volumeSessionSnapshotRef.current;
    const items = enabledSidVolumeItems.length
      ? enabledSidVolumeItems
      : await resolveEnabledSidVolumeItems(true);
    if (!items.length) return null;
    const snapshot = buildEnabledSidVolumeSnapshot(items, sidEnablement);
    volumeSessionSnapshotRef.current = snapshot;
    volumeSessionActiveRef.current = true;
    return snapshot;
  }, [buildEnabledSidVolumeSnapshot, enabledSidVolumeItems, isPaused, isPlaying, resolveEnabledSidVolumeItems, sidEnablement]);

  const restoreVolumeOverrides = useCallback(async (reason: string) => {
    if (!volumeSessionActiveRef.current) return;
    const snapshot = volumeSessionSnapshotRef.current;
    if (!snapshot) return;
    if (status.state === 'DEMO_ACTIVE' || (!status.isConnected && !status.isConnecting)) {
      volumeSessionSnapshotRef.current = null;
      volumeSessionActiveRef.current = false;
      manualMuteSnapshotRef.current = null;
      pauseMuteSnapshotRef.current = null;
      setVolumeMuted(false);
      return;
    }
    const items = await resolveEnabledSidVolumeItems(true);
    const updates = buildEnabledSidRestoreUpdates(items, sidEnablement, snapshot);
    if (Object.keys(updates).length) {
      await applyAudioMixerUpdates(updates, `Restore (${reason})`);
    }
    volumeSessionSnapshotRef.current = null;
    volumeSessionActiveRef.current = false;
    manualMuteSnapshotRef.current = null;
    pauseMuteSnapshotRef.current = null;
    setVolumeMuted(false);
  }, [applyAudioMixerUpdates, buildEnabledSidRestoreUpdates, resolveEnabledSidVolumeItems, sidEnablement, status.isConnected, status.isConnecting, status.state]);

  const restoreVolumeOverridesRef = useRef(restoreVolumeOverrides);

  useEffect(() => {
    restoreVolumeOverridesRef.current = restoreVolumeOverrides;
  }, [restoreVolumeOverrides]);

  const ensurePlaybackConnection = useCallback(async () => {
    if (status.isConnected) return;
    await discoverConnection('manual');
    const snapshot = getConnectionSnapshot();
    if (snapshot.state !== 'REAL_CONNECTED' && snapshot.state !== 'DEMO_ACTIVE') {
      throw new Error('Device not connected. Check connection settings.');
    }
  }, [status.isConnected]);

  useEffect(() => {
    if (!enabledSidVolumeItems.length || !volumeSteps.length) {
      setVolumeMuted(false);
      setVolumeIndex(defaultVolumeIndex);
      return;
    }
    const muteValues = enabledSidVolumeItems.map((item) => resolveAudioMixerMuteValue(item.options));
    const activeIndices: number[] = [];
    enabledSidVolumeItems.forEach((item, index) => {
      if (item.value === muteValues[index]) return;
      activeIndices.push(resolveVolumeIndex(item.value));
    });
    if (!activeIndices.length) {
      setVolumeMuted(true);
      const snapshot = manualMuteSnapshotRef.current;
      const snapshotIndices = snapshot
        ? Object.values(snapshot).map((value) => resolveVolumeIndex(value))
        : [];
      const muteIndices = muteValues.map((value) => resolveVolumeIndex(value));
      const muteCounts = new Map<number, number>();
      muteIndices.forEach((index) => muteCounts.set(index, (muteCounts.get(index) ?? 0) + 1));
      const muteIndex = Array.from(muteCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultVolumeIndex;
      if (snapshotIndices.length) {
        const counts = new Map<number, number>();
        snapshotIndices.forEach((index) => counts.set(index, (counts.get(index) ?? 0) + 1));
        const nextIndex = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultVolumeIndex;
        setVolumeIndex(nextIndex);
      } else {
        setVolumeIndex(muteIndex);
      }
      return;
    }
    setVolumeMuted(false);
    const counts = new Map<number, number>();
    activeIndices.forEach((index) => counts.set(index, (counts.get(index) ?? 0) + 1));
    const nextIndex = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultVolumeIndex;
    setVolumeIndex(nextIndex);
  }, [defaultVolumeIndex, enabledSidVolumeItems, resolveVolumeIndex, volumeSteps]);

  useEffect(() => {
    setSelectedPlaylistIds((prev) => {
      if (!prev.size) return prev;
      const ids = new Set(playlist.map((item) => item.id));
      const next = new Set(Array.from(prev).filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [playlist]);

  useEffect(() => {
    if (playlist.length > 0) return;
    playedClockRef.current.reset();
    setPlayedMs(0);
  }, [playlist.length]);

  useEffect(() => {
    if (isPlaying || isPaused) return;
    const now = Date.now();
    playedClockRef.current.stop(now, true);
    trackStartedAtRef.current = null;
    setPlayedMs(0);
  }, [isPaused, isPlaying]);

  useEffect(() => () => {
    if (volumeUpdateTimerRef.current) {
      window.clearTimeout(volumeUpdateTimerRef.current);
      volumeUpdateTimerRef.current = null;
    }
    if (reshuffleTimerRef.current) {
      window.clearTimeout(reshuffleTimerRef.current);
      reshuffleTimerRef.current = null;
    }
  }, []);

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
    } catch {
      // Ignore storage failures.
    }
  }, [deviceInfoId]);

  const resolvedDeviceId = deviceInfoId || lastKnownDeviceId || 'default';
  const playlistStorageKey = useMemo(() => buildPlaylistStorageKey(resolvedDeviceId), [resolvedDeviceId]);

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
    } else {
      trackStartedAtRef.current = null;
      playedClockRef.current.hydrate(Math.max(0, pending.playedMs), null);
    }
    pendingPlaybackRestoreRef.current = null;
  }, [playlist, playlistStorageKey]);

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
      { label: 'C64 Ultimate', sources: [ultimateSource] },
      { label: 'This device', sources: localGroupSources },
    ];
    if (hvscLibraryAvailable) {
      groups.push({ label: 'HVSC Library', sources: [createHvscSourceLocation(hvscRoot.path)] });
    }
    return groups;
  }, [hvscLibraryAvailable, hvscRoot.path, localSources]);

  const localEntriesBySourceId = useMemo(() => {
    const map = new Map<
      string,
      Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>
    >();
    localSources.forEach((source) => {
      if (getLocalSourceListingMode(source) !== 'entries') {
        map.set(source.id, new Map());
        return;
      }
      try {
        const entries = requireLocalSourceEntries(source, 'PlayFilesPage.localEntriesBySourceId');
        const entriesMap = new Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>();
        entries.forEach((entry) => {
          entriesMap.set(normalizeSourcePath(entry.relativePath), {
            uri: entry.uri,
            name: entry.name,
            modifiedAt: entry.modifiedAt ?? null,
            sizeBytes: entry.sizeBytes ?? null,
          });
        });
        map.set(source.id, entriesMap);
      } catch (error) {
        addErrorLog('Local source entries unavailable', {
          sourceId: source.id,
          error: {
            name: (error as Error).name,
            message: (error as Error).message,
            stack: (error as Error).stack,
          },
        });
        map.set(source.id, new Map());
      }
    });
    return map;
  }, [localSources]);

  const localSourceTreeUris = useMemo(() => {
    const map = new Map<string, string | null>();
    localSources.forEach((source) => {
      map.set(source.id, source.android?.treeUri ?? null);
    });
    return map;
  }, [localSources]);

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


  useEffect(() => {
    if (!isPlaying || isPaused || currentIndex < 0) return;
    const tick = () => {
      const now = Date.now();
      if (trackStartedAtRef.current) {
        setElapsedMs(now - trackStartedAtRef.current);
      }
      setPlayedMs(playedClockRef.current.current(now));
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [currentIndex, isPaused, isPlaying]);

  const durationFallbackMs = durationSeconds * 1000;

  const resolveSidMetadata = useCallback(
    async (file?: LocalPlayFile) => {
      if (!file) return { durationMs: undefined, subsongCount: undefined, readable: false } as const;
      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch {
        return { durationMs: durationFallbackMs, subsongCount: undefined, readable: false } as const;
      }
      const subsongCount = getSidSongCount(buffer);
      try {
        const filePath = getLocalFilePath(file);
        const songlengths = await loadSonglengthsForPath(filePath);
        if (songlengths?.pathToSeconds.has(filePath)) {
          const seconds = songlengths.pathToSeconds.get(filePath);
          const durationMs = seconds !== undefined && seconds !== null ? seconds * 1000 : durationFallbackMs;
          return { durationMs, subsongCount, readable: true } as const;
        }

        const md5 = await computeSidMd5(buffer);
        const md5Duration = songlengths?.md5ToSeconds.get(md5);
        if (md5Duration !== undefined && md5Duration !== null) {
          return { durationMs: md5Duration * 1000, subsongCount, readable: true } as const;
        }
        const seconds = await getHvscDurationByMd5Seconds(md5);
        const durationMs = seconds !== undefined && seconds !== null ? seconds * 1000 : durationFallbackMs;
        return { durationMs, subsongCount, readable: true } as const;
      } catch {
        return { durationMs: durationFallbackMs, subsongCount, readable: true } as const;
      }
    },
    [durationFallbackMs, loadSonglengthsForPath],
  );

  const playItem = useCallback(
    async (item: PlaylistItem, options?: { rebootBeforePlay?: boolean }) => {
      if (item.request.source === 'local' && !item.request.file) {
        throw new Error('Local file unavailable. Re-add it to the playlist.');
      }
      let durationOverride: number | undefined;
      let subsongCount: number | undefined;
      if (item.category === 'sid' && item.request.source === 'local') {
        const metadata = await resolveSidMetadata(item.request.file);
        durationOverride = metadata.durationMs;
        subsongCount = metadata.subsongCount;
        if (!metadata.readable) {
          throw new Error('Local file unavailable. Re-add it to the playlist.');
        }
      }
      await ensurePlaybackConnection();
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
      await executePlayPlan(api, plan, executionOptions);
      const now = Date.now();
      trackStartedAtRef.current = now;
      playedClockRef.current.start(now, true);
      setPlayedMs(playedClockRef.current.current(now));
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
    },
    [durationFallbackMs, ensurePlaybackConnection, resolveSidMetadata],
  );

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

  const currentItem = playlist[currentIndex];
  const currentDurationMs = currentItem ? playlistItemDuration(currentItem, currentIndex) : undefined;
  const currentDurationLabel = currentDurationMs !== undefined ? formatTime(currentDurationMs) : null;
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
      await playItem(nextItem);
      setPlaylist((prev) => prev.map((item, index) => (index === currentIndex ? nextItem : item)));
    } finally {
      setIsPlaylistLoading(false);
    }
  }, [currentIndex, currentItem, knownSubsongCount, playItem]);

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

  const hydrateStoredPlaylist = useCallback((stored: StoredPlaylistState | null) => {
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
  }, [buildPlaylistItem, localEntriesBySourceId, localSourceTreeUris]);

  useEffect(() => {
    hasPlaylistRef.current = playlist.length > 0;
  }, [playlist]);

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
  }, [hydrateStoredPlaylist, playlistStorageKey, resolvedDeviceId]);

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
    setCurrentIndex(startIndex);
    setIsPlaylistLoading(true);
    setIsPaused(false);
    try {
      await playItem(resolvedItems[startIndex]);
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
    } finally {
      setIsPlaylistLoading(false);
    }
  }, [applySonglengthsToItems, playItem, reportUserError]);

  const handlePlay = useCallback(trace(async function handlePlay() {
    if (!playlist.length) return;
    try {
      if (currentIndex < 0) {
        await startPlaylist(playlist, 0);
        return;
      }
      await playItem(playlist[currentIndex]);
    } catch (error) {
      reportUserError({
        operation: 'PLAYBACK_START',
        title: 'Playback failed',
        description: (error as Error).message,
        error,
        context: {
          item: playlist[currentIndex]?.label,
        },
      });
    }
  }), [currentIndex, playItem, playlist, reportUserError, startPlaylist, trace]);

  const handleStop = useCallback(trace(async function handleStop() {
    if (!isPlaying && !isPaused) return;
    const currentItem = playlist[currentIndex];
    const shouldReboot = currentItem?.category === 'disk';
    try {
      const api = getC64API();
      if (isPaused) {
        try {
          await withTimeout(api.machineResume(), 2000, 'Resume');
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
  }), [currentIndex, isPaused, isPlaying, playlist, reportUserError, restoreVolumeOverrides, withTimeout, trace]);

  useEffect(() => {
    if (isPlaying || isPaused) return;
    if (!volumeSessionActiveRef.current) return;
    void restoreVolumeOverrides('playback-ended');
  }, [isPaused, isPlaying, restoreVolumeOverrides]);

  useEffect(() => () => {
    void restoreVolumeOverridesRef.current('navigate');
  }, []);

  const handlePauseResume = useCallback(trace(async function handlePauseResume() {
    if (!isPlaying) return;
    const api = getC64API();
    try {
      if (isPaused) {
        const resumeItems = await resolveEnabledSidVolumeItems();
        const resumeSnapshot = pauseMuteSnapshotRef.current;
        const wasMuted = resumeSnapshot && resumeItems.length
          ? resumeItems.every((item) => resumeSnapshot[item.name] === resolveAudioMixerMuteValue(item.options))
          : false;
        if (pauseMuteSnapshotRef.current && resumeItems.length) {
          await applyAudioMixerUpdates(pauseMuteSnapshotRef.current, 'Resume');
        }
        await withTimeout(api.machineResume(), 3000, 'Resume');
        pauseMuteSnapshotRef.current = null;
        setIsPaused(false);
        setVolumeMuted(wasMuted);
        const now = Date.now();
        trackStartedAtRef.current = now - elapsedMs;
        playedClockRef.current.resume(now);
        setPlayedMs(playedClockRef.current.current(now));
      } else {
        const pauseItems = await resolveEnabledSidVolumeItems();
        if (pauseItems.length) {
          pauseMuteSnapshotRef.current = buildEnabledSidVolumeSnapshot(pauseItems, sidEnablement);
        }
        await withTimeout(api.machinePause(), 3000, 'Pause');
        if (pauseItems.length) {
          await applyAudioMixerUpdates(buildEnabledSidMuteUpdates(pauseItems, sidEnablement), 'Pause');
          setVolumeMuted(true);
        }
        const now = Date.now();
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        setIsPaused(true);
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
  }), [applyAudioMixerUpdates, buildEnabledSidMuteUpdates, buildEnabledSidVolumeSnapshot, elapsedMs, isPaused, isPlaying, reportUserError, resolveEnabledSidVolumeItems, sidEnablement, withTimeout, trace]);

  const scheduleVolumeUpdate = useCallback((nextIndex: number, immediate = false) => {
    if (!volumeSteps.length || !sidVolumeItems.length) return;
    const target = volumeSteps[nextIndex]?.option;
    if (!target) return;
    const updates = buildEnabledSidVolumeUpdates(sidVolumeItems, sidEnablement, target);
    manualMuteSnapshotRef.current = null;

    volumeUpdateSeqRef.current += 1;
    const token = volumeUpdateSeqRef.current;

    const runUpdate = () => {
      if (token !== volumeUpdateSeqRef.current) return;
      void ensureVolumeSessionSnapshot();
      void applyAudioMixerUpdates(updates, 'Volume');
      setVolumeMuted(false);
    };

    if (volumeUpdateTimerRef.current) {
      window.clearTimeout(volumeUpdateTimerRef.current);
      volumeUpdateTimerRef.current = null;
    }

    if (immediate) {
      runUpdate();
      return;
    }

    volumeUpdateTimerRef.current = window.setTimeout(runUpdate, 200);
  }, [applyAudioMixerUpdates, buildEnabledSidVolumeUpdates, ensureVolumeSessionSnapshot, sidEnablement, sidVolumeItems, volumeSteps]);

  const handleVolumeChange = useCallback((value: number[]) => {
    const nextIndex = value[0] ?? 0;
    setVolumeIndex(nextIndex);
    if (volumeMuted) {
      const snapshot = manualMuteSnapshotRef.current;
      const target = volumeSteps[nextIndex]?.option;
      if (snapshot && target) {
        manualMuteSnapshotRef.current = Object.fromEntries(
          Object.keys(snapshot).map((key) => [key, target]),
        );
      }
      return;
    }
    if (volumeDragRef.current) return;
    scheduleVolumeUpdate(nextIndex);
  }, [scheduleVolumeUpdate, volumeMuted, volumeSteps]);

  const handleVolumeCommit = useCallback(async (nextIndex: number) => {
    volumeDragRef.current = false;
    if (volumeMuted) {
      const snapshot = manualMuteSnapshotRef.current;
      const target = volumeSteps[nextIndex]?.option;
      if (snapshot && target) {
        manualMuteSnapshotRef.current = Object.fromEntries(
          Object.keys(snapshot).map((key) => [key, target]),
        );
      }
      return;
    }
    scheduleVolumeUpdate(nextIndex, true);
  }, [scheduleVolumeUpdate, volumeMuted, volumeSteps]);

  const handleVolumeInteraction = useCallback(() => {
    volumeDragRef.current = true;
    if (!volumeMuted) return;
  }, [volumeMuted]);

  const handleToggleMute = useCallback(async () => {
    const items = await resolveEnabledSidVolumeItems(true);
    if (!items.length) return;
    if (!volumeMuted) {
      await ensureVolumeSessionSnapshot();
      manualMuteSnapshotRef.current = buildEnabledSidVolumeSnapshot(items, sidEnablement);
      setVolumeMuted(true);
      await applyAudioMixerUpdates(buildEnabledSidMuteUpdates(items, sidEnablement), 'Mute');
      return;
    }
    const snapshot = manualMuteSnapshotRef.current;
    const updates = buildEnabledSidUnmuteUpdates(snapshot, sidEnablement);
    if (Object.keys(updates).length) {
      await applyAudioMixerUpdates(updates, 'Unmute');
    }
    setVolumeMuted(false);
    manualMuteSnapshotRef.current = null;
  }, [
    applyAudioMixerUpdates,
    buildEnabledSidUnmuteUpdates,
    buildEnabledSidVolumeSnapshot,
    ensureVolumeSessionSnapshot,
    resolveEnabledSidVolumeItems,
    sidEnablement,
    volumeMuted,
  ]);

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


  const handleNext = useCallback(async () => {
    if (!playlist.length) return;
    const now = Date.now();
    playedClockRef.current.pause(now);
    setPlayedMs(playedClockRef.current.current(now));
    const currentItem = playlist[currentIndex];
    let nextIndex = currentIndex + 1;
    if (nextIndex >= playlist.length) {
      if (!repeatEnabled) {
        playedClockRef.current.pause(Date.now());
        setIsPlaying(false);
        return;
      }
      nextIndex = 0;
    }
    setCurrentIndex(nextIndex);
    const nextItem = playlist[nextIndex];
    const shouldReboot = currentItem?.category === 'disk' || nextItem?.category === 'disk';
    await playItem(nextItem, { rebootBeforePlay: shouldReboot });
    setIsPaused(false);
  }, [currentIndex, playItem, playlist, repeatEnabled]);

  const handlePrevious = useCallback(async () => {
    if (!playlist.length) return;
    const now = Date.now();
    playedClockRef.current.pause(now);
    setPlayedMs(playedClockRef.current.current(now));
    const currentItem = playlist[currentIndex];
    const prevIndex = Math.max(0, currentIndex - 1);
    setCurrentIndex(prevIndex);
    const prevItem = playlist[prevIndex];
    const shouldReboot = currentItem?.category === 'disk' || prevItem?.category === 'disk';
    await playItem(prevItem, { rebootBeforePlay: shouldReboot });
    setIsPaused(false);
  }, [currentIndex, playItem, playlist]);

  useEffect(() => {
    if (!isPlaying || currentDurationMs === undefined) return;
    if (elapsedMs >= currentDurationMs) {
      void handleNext();
    }
  }, [currentDurationMs, elapsedMs, handleNext, isPlaying]);

  const reshufflePlaylist = useCallback((items: PlaylistItem[], lockedIndex: number) => {
    if (items.length < 2) return items;
    if (lockedIndex >= 0 && lockedIndex < items.length) {
      const currentItem = items[lockedIndex];
      const rest = items.filter((_, index) => index !== lockedIndex);
      const shuffled = shuffleArray(rest);
      const insertIndex = Math.min(lockedIndex, shuffled.length);
      let next = [...shuffled.slice(0, insertIndex), currentItem, ...shuffled.slice(insertIndex)];
      if (next.map((item) => item.id).join('|') === items.map((item) => item.id).join('|')) {
        if (rest.length > 1) {
          const swapped = [...shuffled];
          [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
          next = [...swapped.slice(0, insertIndex), currentItem, ...swapped.slice(insertIndex)];
        }
      }
      return next;
    }

    let shuffled = shuffleArray(items);
    if (shuffled.map((item) => item.id).join('|') === items.map((item) => item.id).join('|')) {
      if (shuffled.length > 1) {
        const swapped = [...shuffled];
        [swapped[0], swapped[1]] = [swapped[1], swapped[0]];
        shuffled = swapped;
      }
    }
    return shuffled;
  }, []);

  const handleReshuffle = useCallback(() => {
    if (!shuffleEnabled || !playlist.length) return;
    setReshuffleActive(true);
    if (reshuffleTimerRef.current) {
      window.clearTimeout(reshuffleTimerRef.current);
    }
    reshuffleTimerRef.current = window.setTimeout(() => {
      setReshuffleActive(false);
      reshuffleTimerRef.current = null;
    }, 200);
    setPlaylist((prev) => reshufflePlaylist(prev, currentIndex));
  }, [currentIndex, playlist.length, reshufflePlaylist, shuffleEnabled]);


  const handlePlayEntry = useCallback(async (entry: PlayableEntry) => {
    try {
      const item = buildPlaylistItem(entry);
      if (!item) throw new Error('Unsupported file format.');
      await startPlaylist([item]);
      toast({
        title: 'Playback started',
        description: `${formatPlayCategory(item.category)} added to playlist`,
      });
    } catch (error) {
      reportUserError({
        operation: 'PLAYBACK_START',
        title: 'Playback failed',
        description: (error as Error).message,
        error,
        context: {
          source: entry.source,
          path: entry.path,
        },
      });
    }
  }, [buildPlaylistItem, reportUserError, startPlaylist]);


  const buildHvscFile = useCallback((song: { id: number; virtualPath: string; fileName: string }) => {
    return buildHvscLocalPlayFile(song.virtualPath, song.fileName) as LocalPlayFile;
  }, [buildHvscLocalPlayFile]);

  const collectHvscSongs = useCallback(async (rootPath: string) => {
    const queuePaths = [rootPath || '/'];
    const results: Array<{ id: number; virtualPath: string; fileName: string; durationSeconds?: number | null }> = [];
    const visited = new Set<string>();
    while (queuePaths.length) {
      const currentPath = queuePaths.shift();
      if (!currentPath || visited.has(currentPath)) continue;
      visited.add(currentPath);
      const listing = await getHvscFolderListing(currentPath);
      listing.songs.forEach((song) => {
        results.push(song);
      });
      if (recurseFolders) {
        listing.folders.forEach((folder) => queuePaths.push(folder));
      }
    }
    return results;
  }, [recurseFolders]);


  const handlePlayHvscFolder = useCallback(async (path: string) => {
    try {
      if (!hvscStatus?.installedVersion) {
        reportUserError({
          operation: 'HVSC_PLAYBACK',
          title: 'HVSC unavailable',
          description: 'Install HVSC to play the collection.',
          context: { path },
        });
        return;
      }
      const songs = await collectHvscSongs(path);
      if (!songs.length) {
        reportUserError({
          operation: 'HVSC_PLAYBACK',
          title: 'No HVSC songs',
          description: 'No SID files found in this folder.',
          context: { path },
        });
        return;
      }
      const entries: PlayableEntry[] = songs.map((song) => ({
        source: 'hvsc',
        name: song.fileName,
        path: song.virtualPath,
        file: buildHvscFile(song),
        durationMs: song.durationSeconds ? song.durationSeconds * 1000 : undefined,
        sourceId: hvscRoot.path,
      }));
      const items = entries
        .map((entry) => buildPlaylistItem(entry))
        .filter((item): item is PlaylistItem => Boolean(item));
      if (!items.length) return;
      const playlistItems = shuffleEnabled ? shuffleArray(items) : items;
      await startPlaylist(playlistItems);
      toast({
        title: 'Playback started',
        description: `${playlistItems.length} files added to playlist`,
      });
    } catch (error) {
      reportUserError({
        operation: 'HVSC_PLAYBACK',
        title: 'HVSC playback failed',
        description: (error as Error).message,
        error,
        context: { path },
      });
    }
  }, [buildHvscFile, buildPlaylistItem, collectHvscSongs, hvscRoot.path, hvscStatus?.installedVersion, reportUserError, shuffleEnabled, startPlaylist]);

  const playlistTotals = useMemo(() => {
    const durations = playlist.map((item, index) => playlistItemDuration(item, index));
    return calculatePlaylistTotals(durations, playedMs);
  }, [playlist, playedMs, playlistItemDuration]);

  const filteredPlaylist = useMemo(
    () => playlist.filter((item) => playlistTypeFilters.includes(item.category)),
    [playlist, playlistTypeFilters],
  );

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
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-background/95">
      <AppBar
        title="Play Files"
        subtitle={status.isConnected ? 'Connected' : status.isConnecting ? 'Connecting…' : 'Offline'}
      />
      <main className="container max-w-3xl mx-auto px-4 py-6 pb-24 space-y-6">
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <PlaybackControlsCard
            hasCurrentItem={Boolean(currentItem)}
            currentItemLabel={currentItem?.label ?? null}
            currentDurationLabel={currentDurationLabel ?? null}
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
                onVolumeChange={handleVolumeChange}
                onVolumeCommit={(value) => void handleVolumeCommit(value)}
                onVolumeInteraction={handleVolumeInteraction}
                volumeLabel={volumeLabel}
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
          <HvscControls
            hvscInstalled={hvscInstalled}
            hvscInstalledVersion={hvscStatus?.installedVersion ?? null}
            hvscAvailable={hvscAvailable}
            hvscUpdating={hvscUpdating}
            hvscInProgress={hvscInProgress}
            hvscSummaryState={hvscSummaryState}
            hvscSummaryFilesExtracted={hvscSummaryFilesExtracted}
            hvscSummaryDurationMs={hvscSummaryDurationMs}
            hvscSummaryUpdatedAt={hvscSummaryUpdatedAt}
            hvscSummaryFailureLabel={hvscSummaryFailureLabel}
            hvscActionLabel={hvscActionLabel}
            hvscStage={hvscStage}
            hvscDownloadPercent={hvscDownloadPercent}
            hvscDownloadBytes={hvscDownloadBytes}
            hvscDownloadTotalBytes={hvscDownloadTotalBytes}
            hvscDownloadElapsedMs={hvscDownloadElapsedMs}
            hvscDownloadStatus={hvscDownloadStatus}
            hvscExtractionPercent={hvscExtractionPercent}
            hvscExtractionTotalFiles={hvscExtractionTotalFiles}
            hvscExtractionElapsedMs={hvscExtractionElapsedMs}
            hvscExtractionStatus={hvscExtractionStatus}
            hvscCurrentFile={hvscCurrentFile}
            hvscInlineError={hvscInlineError}
            hvscFolderFilter={hvscFolderFilter}
            hvscVisibleFolders={hvscVisibleFolders}
            hvscSongs={hvscSongs}
            selectedHvscFolder={selectedHvscFolder}
            hvscRootPath={hvscRoot.path}
            formatHvscDuration={formatHvscDuration}
            formatHvscTimestamp={formatHvscTimestamp}
            formatBytes={formatBytes}
            onInstall={() => void handleHvscInstall()}
            onIngest={() => void handleHvscIngest()}
            onCancel={() => void handleHvscCancel()}
            onFolderFilterChange={setHvscFolderFilter}
            onSelectFolder={(folder) => void loadHvscFolder(folder)}
            onPlayFolder={(folder) => void handlePlayHvscFolder(folder)}
            onPlayEntry={(entry) => void handlePlayEntry(entry)}
            buildHvscFile={buildHvscFile}
          />
        )}
      </main>
    </div>
  );
}
