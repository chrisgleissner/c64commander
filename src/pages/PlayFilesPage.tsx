/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { wrapUserEvent } from "@/lib/tracing/userTrace";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Gamepad2, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RemoteInputSheet } from "@/components/remoteInput/RemoteInputSheet";
import { PlaybackConfigSheet } from "@/pages/playFiles/components/PlaybackConfigSheet";
import {
  AddItemsProgressOverlay,
  type AddItemsProgressState,
} from "@/components/itemSelection/AddItemsProgressOverlay";
import { ItemSelectionDialog, type SourceGroup } from "@/components/itemSelection/ItemSelectionDialog";
import { useC64ConfigItems, useC64Connection, useC64UpdateConfigBatch } from "@/hooks/useC64Connection";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useListPreviewLimit } from "@/hooks/useListPreviewLimit";
import { useLocalSources } from "@/hooks/useLocalSources";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { useActionTrace } from "@/hooks/useActionTrace";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { reportUserError } from "@/lib/uiErrors";
import { getC64API } from "@/lib/c64api";
import { createLatestIntentWriteLane, type LatestIntentWriteLane } from "@/lib/deviceInteraction/latestIntentWriteLane";
import type { TraceSourceKind } from "@/lib/tracing/types";
import { classifyError } from "@/lib/tracing/failureTaxonomy";
import { discoverConnection, getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { getParentPath } from "@/lib/playback/localFileBrowser";
import { type PlayRequest } from "@/lib/playback/playbackRouter";
import {
  formatPlayCategory,
  getPlayCategory,
  isSupportedPlayFile,
  type PlayFileCategory,
} from "@/lib/playback/fileTypes";
import { PlaybackClock } from "@/lib/playback/playbackClock";
import { calculatePlaylistTotals } from "@/lib/playback/playlistTotals";
import { createUltimateSourceLocation } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { createHvscSourceLocation } from "@/lib/sourceNavigation/hvscSourceAdapter";
import { ensureHvscSonglengthsReadyOnColdStart, resolveHvscSonglengthDuration } from "@/lib/hvsc/hvscSongLengthService";
import { createStationDurationResolver } from "@/pages/playFiles/stationDurationResolver";
import { Checkbox } from "@/components/ui/checkbox";
import { resolveTraversalOrdering } from "@/pages/playFiles/stationOrdering";
import { createArchiveSourceLocation } from "@/lib/sourceNavigation/archiveSourceAdapter";
import { createLocalSourceLocation, resolveLocalRuntimeFile } from "@/lib/sourceNavigation/localSourceAdapter";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { prepareDirectoryInput } from "@/lib/sourceNavigation/localSourcesStore";
import type { SelectedItem, SourceLocation } from "@/lib/sourceNavigation/types";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import { buildSelectedDeviceBoundOrigin } from "@/lib/savedDevices/deviceBoundOrigin";

import { buildEnabledSidMuteUpdates } from "@/lib/config/sidVolumeControl";
import { parseSidHeaderMetadata, type SidClock, type SidModel } from "@/lib/sid/sidUtils";
import { buildNowPlayingMetadata } from "@/lib/playback/nowPlayingMetadata";
import { resolveTrackDisplayName, type SidChipCount } from "@/lib/playback/sidDisplayName";
import { useFriendlySidNames } from "@/lib/playback/useFriendlySidNames";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { FolderPicker } from "@/lib/native/folderPicker";
import { redactTreeUri } from "@/lib/native/safUtils";
import {
  isBackgroundExecutionActive,
  startBackgroundExecution,
  stopBackgroundExecution,
} from "@/lib/native/backgroundExecutionManager";
import { BackgroundExecution, onBackgroundAutoSkipDue } from "@/lib/native/backgroundExecution";

import { AppBar } from "@/components/AppBar";
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { SOURCE_LABELS } from "@/lib/sourceNavigation/sourceTerms";
import { VolumeControls } from "@/pages/playFiles/components/VolumeControls";
import { resolvePlaybackVolumeBinding } from "@/pages/playFiles/playbackVolumeBinding";
import { localVolumeGainForIndex, localVolumeIndexForGain } from "@/lib/playback/localPlaybackVolume";
import { PlaybackControlsCard } from "@/pages/playFiles/components/PlaybackControlsCard";
import { PlaybackEngineToggle } from "@/pages/playFiles/components/PlaybackEngineToggle";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";
import { NowPlayingRanking } from "@/pages/playFiles/components/NowPlayingRanking";
import { useCurrentTuneMd5 } from "@/pages/playFiles/hooks/useCurrentTuneMd5";
import { useSidRadioFlags } from "@/lib/sidRadio/useSidRadioFlags";
import { LikedTunesSheet } from "@/pages/playFiles/components/LikedTunesSheet";
import { useSidRadio } from "@/pages/playFiles/hooks/useSidRadio";
import { SidRadioChip } from "@/pages/playFiles/components/SidRadioChip";
import { SidRadioLauncherSheet } from "@/pages/playFiles/components/SidRadioLauncherSheet";
import { useLikedTuneCount } from "@/lib/sidRadio/useLikedTuneCount";
import { recordSkip } from "@/lib/sidRadio/sidRadioStats";
import { Radio as RadioIcon } from "lucide-react";
import { PlaybackSettingsPanel } from "@/pages/playFiles/components/PlaybackSettingsPanel";
import { PlaylistPanel } from "@/pages/playFiles/components/PlaylistPanel";
import { HvscManager } from "@/pages/playFiles/components/HvscManager";
import { HvscPreparationSheet } from "@/pages/playFiles/components/HvscPreparationSheet";
import { PageContainer, PageStack, ProfileSplitSection } from "@/components/layout/PageContainer";
import { useHvscLibrary } from "@/pages/playFiles/hooks/useHvscLibrary";
import {
  shouldCancelHvscLifecycleOnDisable,
  shouldIncludeHvscSource,
  shouldOpenHvscPreparation,
  shouldShowHvscControls,
} from "@/pages/playFiles/hvscControlsVisibility";
import { usePlaylistListItems } from "@/pages/playFiles/hooks/usePlaylistListItems";
import { useSonglengths } from "@/pages/playFiles/hooks/useSonglengths";
import { usePlaybackPersistence } from "@/pages/playFiles/hooks/usePlaybackPersistence";
import { usePlaylistManager } from "@/pages/playFiles/hooks/usePlaylistManager";
import { usePlayFilesVolumeBindings } from "@/pages/playFiles/hooks/usePlayFilesVolumeBindings";
import { useLocalEntries } from "@/pages/playFiles/hooks/useLocalEntries";
import { useAddItemsOverlayState } from "@/pages/playFiles/hooks/useAddItemsOverlayState";
import { useImportNavigationGuards } from "@/pages/playFiles/hooks/useImportNavigationGuards";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import { usePlaybackResumeTriggers } from "@/pages/playFiles/hooks/usePlaybackResumeTriggers";
import { useResolvedPlaybackDeviceId } from "@/pages/playFiles/hooks/useResolvedPlaybackDeviceId";
import { getSelectedSavedDevice } from "@/lib/savedDevices/store";
import { useArchiveClientSettings } from "@/pages/playFiles/hooks/useArchiveClientSettings";
import { useDebouncedValue } from "@/pages/playFiles/hooks/useDebouncedValue";
import { useQueryFilteredPlaylist } from "@/pages/playFiles/hooks/useQueryFilteredPlaylist";
import {
  isBackgroundExecutionEnabled,
  shouldStartBackgroundExecution,
  shouldStopBackgroundExecution,
  shouldSyncBackgroundExecutionDueAt,
} from "@/pages/playFiles/backgroundExecutionPolicy";
import { setPlaybackTraceSnapshot } from "@/pages/playFiles/playbackTraceStore";
import { createAddFileSelectionsHandler } from "@/pages/playFiles/handlers/addFileSelections";
import { planPlaylistItemRemoval, resolveAutoAdvanceDueAtMsOnDurationChange } from "@/pages/playFiles/playbackGuards";
import type { PlayableEntry, PlaylistItem, StoredPlaybackSession, StoredPlaylistState } from "@/pages/playFiles/types";
import {
  buildConfigReferenceFromBrowserSelection,
  buildLocalConfigReferenceFromAndroidPicker,
  buildLocalConfigReferenceFromWebFile,
} from "@/lib/config/configFileReferenceSelection";
import { discoverConfigCandidates } from "@/lib/config/configDiscovery";
import { resolvePlaybackConfig } from "@/lib/config/configResolution";
import { areConfigReferencesEqual, type ConfigCandidate, resolveStoredConfigOrigin } from "@/lib/config/playbackConfig";
import { syncPlaybackDecisionFromTrace } from "@/lib/diagnostics/decisionState";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useLightingStudio } from "@/hooks/useLightingStudio";
import { LightingAutomationCue } from "@/components/lighting/LightingStudioDialog";
import {
  CATEGORY_OPTIONS,
  DEFAULT_SONG_DURATION_MS,
  DURATION_SLIDER_STEPS,
  PLAYBACK_SESSION_KEY,
  PLAYLIST_STORAGE_PREFIX,
  SHARED_PLAYLIST_STORAGE_KEY,
  buildPlaylistStorageKey,
  buildPlaylistItemId,
  buildSubsongSwitchItem,
  canAdvanceNext,
  canAdvancePrevious,
  shouldDetachPlaybackOnSavedDeviceSwitch,
  applyDurationOverrideToPlaylist,
  clampDurationSeconds,
  durationSecondsToSlider,
  formatBytes,
  formatDate,
  formatDurationSeconds,
  formatTime,
  isSongCategory,
  normalizeDurationInputDraft,
  parseDurationInput,
  sliderToDurationSeconds,
  shuffleArray,
} from "@/pages/playFiles/playFilesUtils";
import { getSharedLocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { describePendingSeek, type PendingSeekState } from "@/lib/playback/pendingSeekStatus";
import { useActivePlayback } from "@/hooks/useActivePlayback";

const ACTIVE_ADD_ITEMS_PROGRESS_STATES = new Set<AddItemsProgressState["status"]>([
  "scanning",
  "ingesting",
  "committing",
]);

export default function PlayFilesPage() {
  type AutoAdvanceGuard = {
    trackInstanceId: number;
    dueAtMs: number;
    autoFired: boolean;
    userCancelled: boolean;
  };

  type ConfigPickerState =
    { itemId: string; sourceType: "ultimate" } | { itemId: string; sourceType: "local"; sourceId: string };

  type PendingConfigChangeState = {
    itemId: string;
    configRef: PlaylistItem["configRef"];
    origin?: PlaylistItem["configOrigin"];
    candidates?: PlaylistItem["configCandidates"];
  };

  type UnavailableConfigPromptState = {
    item: PlaylistItem;
    configFileName: string | null;
    reason: string;
    resolve: (choice: "play-without-config" | "cancel") => void;
  };

  const navigate = useNavigate();
  const { status } = useC64Connection();
  const updateConfigBatch = useC64UpdateConfigBatch();
  const deviceInfoId = status.deviceInfo?.unique_id ?? null;
  const { sources: localSources, addSourceFromPicker } = useLocalSources();
  const [browserOpen, setBrowserOpen] = useState(false);
  // Written from `sidRadio.active` below. A ref, because `useSidRadio` is created after the playback
  // controller and consumes the handlers it returns, so the flag cannot travel as a plain prop.
  const stationActiveRef = useRef(false);
  const {
    playlist,
    setPlaylist,
    currentIndex,
    setCurrentIndex,
    shuffleEnabled,
    setShuffleEnabled,
    shuffleSeed,
    setShuffleSeed,
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
  const playlistSnapshotRef = useRef(playlist);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playlistFilterInputText, setPlaylistFilterInputText] = useState("");
  const [playlistFilterText, setPlaylistFilterText] = useState("");
  const debouncedPlaylistFilterText = useDebouncedValue(playlistFilterInputText, 200);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playedMs, setPlayedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const [pendingDurationOverrideMs, setPendingDurationOverrideMs] = useState<number | undefined>(undefined);
  const debouncedDurationOverrideMs = useDebouncedValue(pendingDurationOverrideMs, 500);
  const [durationSeconds, setDurationSeconds] = useState(() => Math.round(DEFAULT_SONG_DURATION_MS / 1000));
  const [durationInput, setDurationInput] = useState(() =>
    formatDurationSeconds(Math.round(DEFAULT_SONG_DURATION_MS / 1000)),
  );
  const [songNrInput, setSongNrInput] = useState("");
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
  const [hvscPreparationOpen, setHvscPreparationOpen] = useState(false);
  const [browserInitialSourceId, setBrowserInitialSourceId] = useState<string | null>(null);
  const [addItemsProgress, setAddItemsProgress] = useState<AddItemsProgressState>({
    status: "idle",
    count: 0,
    elapsedMs: 0,
    total: null,
    message: null,
  });

  useEffect(() => {
    setPlaylistFilterText(debouncedPlaylistFilterText);
  }, [debouncedPlaylistFilterText]);

  const handlePlaylistFilterTextChange = useCallback((value: string) => {
    setPlaylistFilterInputText(value);
  }, []);

  const restorePlaylistFilterText = useCallback((value: string) => {
    setPlaylistFilterInputText(value);
    setPlaylistFilterText(value);
  }, []);
  const {
    addItemsOverlayActiveRef,
    addItemsOverlayStartedAtRef,
    addItemsSurface,
    handleAutoConfirmStart,
    isAddingItems,
    isImportNavigationBlocked,
    setAddItemsSurface,
    setIsAddingItems,
    setShowAddItemsOverlay,
    showAddItemsOverlay,
  } = useAddItemsOverlayState({ browserOpen, addItemsProgressStatus: addItemsProgress.status });
  const { limit: listPreviewLimit } = useListPreviewLimit();
  const isAndroid = getPlatform() === "android" && isNativePlatform();
  const trace = useActionTrace("PlayFilesPage");

  const featureFlags = useFeatureFlags();
  const hvscControlsEnabled = shouldShowHvscControls(featureFlags);
  const backgroundExecutionEnabled = isBackgroundExecutionEnabled(featureFlags);
  const { archiveConfig, commoserveEnabled } = useArchiveClientSettings();
  const { value: lightingStudioEnabled } = useFeatureFlag("lighting_studio_enabled");
  const { value: remoteInputEnabled } = useFeatureFlag("remote_input_enabled");
  const [remoteInputSheetOpen, setRemoteInputSheetOpen] = useState(false);
  const [likedTunesSheetOpen, setLikedTunesSheetOpen] = useState(false);
  const [sidRadioLauncherOpen, setSidRadioLauncherOpen] = useState(false);
  const likedTuneCount = useLikedTuneCount();

  const {
    volumeSliderPreviewIntervalMs,
    volumeState,
    dispatchVolume,
    volumeSteps,
    sidEnablement,
    enabledSidVolumeItems,
    resolveEnabledSidVolumeItems,
    restoreVolumeOverrides,
    discardVolumeSession,
    applyAudioMixerUpdates,
    pauseMuteSnapshotRef,
    pausingFromPauseRef,
    volumeSessionActiveRef,
    captureSidMuteSnapshot,
    snapshotToUpdates,
    handleVolumeDraftChange,
    handleVolumePreview,
    handleVolumeCommit,
    handleToggleMute,
    resumingFromPauseRef,
    ensureUnmuted,
  } = usePlayFilesVolumeBindings({ isPlaying, isPaused, resolvedDeviceId: getSelectedSavedDevice()?.id ?? null });
  const volumeIndex = volumeState.index;
  const volumeMuted = volumeState.muted;

  // HARD19-026: pass the live hvsc_enabled gate so the hook's background native
  // lifecycle (status/recover/hydration) stays dormant when HVSC is disabled.
  const hvsc = useHvscLibrary(hvscControlsEnabled);
  const { hvscStatus, hvscRoot, hvscAvailable, buildHvscLocalPlayFile } = hvsc;

  const { localEntriesBySourceId, localSourceTreeUris } = useLocalEntries(localSources);

  const localSourceInputRef = useRef<HTMLInputElement | null>(null);
  const localConfigInputRef = useRef<HTMLInputElement | null>(null);
  const songlengthsInputRef = useRef<HTMLInputElement | null>(null);
  const trackStartedAtRef = useRef<number | null>(null);
  const playedClockRef = useRef(new PlaybackClock());
  const addItemsStartedAtRef = useRef<number | null>(null);
  const addItemsAbortControllerRef = useRef<AbortController | null>(null);
  const pendingLocalConfigItemIdRef = useRef<string | null>(null);

  const playTransitionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const playStartInFlightRef = useRef(false);
  const trackInstanceIdRef = useRef(0);
  const [trackInstanceId, setTrackInstanceId] = useState(0);
  const autoAdvanceGuardRef = useRef<AutoAdvanceGuard | null>(null);
  const [autoAdvanceDueAtMs, setAutoAdvanceDueAtMs] = useState<number | null>(null);
  const backgroundDueWriteLaneRef = useRef<LatestIntentWriteLane<number | null> | null>(null);
  // Adopt an already-running background-execution session on remount (e.g. after
  // navigating away from Play while playing) instead of issuing a second start,
  // which would unbalance the manager's reference count and leak the wake lock
  // after Stop (BUG-025).
  const backgroundExecutionActiveRef = useRef(isBackgroundExecutionActive());
  // True once THIS Play instance has actually observed active playback. A fresh
  // instance adopts the running session above (BUG-025) but starts isPlaying=false
  // until its async session restore runs. A transient instance created during a
  // tab transition can therefore mount-and-unmount while still isPlaying=false and
  // would otherwise tear down the wake lock owned by the live playback session
  // (BUG-040). Only an instance that genuinely owned playback may release it.
  const hasObservedActivePlaybackRef = useRef(false);
  const hvscDisableCancellationRequestedRef = useRef(false);
  const [configPickerState, setConfigPickerState] = useState<ConfigPickerState | null>(null);
  const [activeConfigItemId, setActiveConfigItemId] = useState<string | null>(null);
  const [pendingConfigChange, setPendingConfigChange] = useState<PendingConfigChangeState | null>(null);
  const [unavailableConfigPrompt, setUnavailableConfigPrompt] = useState<UnavailableConfigPromptState | null>(null);

  useEffect(() => {
    prepareDirectoryInput(localSourceInputRef.current);
  }, []);

  useEffect(() => {
    hasPlaylistRef.current = playlist.length > 0;
    playlistSnapshotRef.current = playlist;
  }, [playlist]);

  const enqueuePlayTransition = useCallback(async <T,>(task: () => Promise<T>) => {
    const run = playTransitionQueueRef.current.then(task, task);
    playTransitionQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const cancelAutoAdvance = useCallback(() => {
    if (!autoAdvanceGuardRef.current) return;
    autoAdvanceGuardRef.current.userCancelled = true;
    setAutoAdvanceDueAtMs(null);
  }, [setAutoAdvanceDueAtMs]);

  if (!backgroundDueWriteLaneRef.current) {
    backgroundDueWriteLaneRef.current = createLatestIntentWriteLane<number | null>({
      run: async (nextDueAtMs) => {
        await BackgroundExecution.setDueAtMs({ dueAtMs: nextDueAtMs });
      },
    });
  }

  const queueBackgroundDueAtUpdate = useCallback(async (nextDueAtMs: number | null) => {
    await backgroundDueWriteLaneRef.current?.schedule(nextDueAtMs);
  }, []);
  const queueBackgroundDueAtUpdateRef = useRef(queueBackgroundDueAtUpdate);
  useEffect(() => {
    queueBackgroundDueAtUpdateRef.current = queueBackgroundDueAtUpdate;
  }, [queueBackgroundDueAtUpdate]);
  const stopBackgroundExecutionRef = useRef(stopBackgroundExecution);
  useEffect(() => {
    stopBackgroundExecutionRef.current = stopBackgroundExecution;
  }, [stopBackgroundExecution]);
  const backgroundCleanupTrackInstanceIdRef = useRef(trackInstanceId);
  useEffect(() => {
    backgroundCleanupTrackInstanceIdRef.current = trackInstanceId;
  }, [trackInstanceId]);

  const ensurePlaybackConnection = useCallback(async () => {
    if (status.isConnected) return;
    await discoverConnection("manual");
    const snapshot = getConnectionSnapshot();
    if (snapshot.state !== "REAL_CONNECTED" && snapshot.state !== "DEMO_ACTIVE") {
      throw new Error("Device not connected. Check connection settings.");
    }
  }, [status.isConnected]);

  const archiveConfigs = useMemo((): Record<string, ArchiveClientConfigInput> => {
    const configs: Record<string, ArchiveClientConfigInput> = {};
    if (commoserveEnabled) {
      configs[archiveConfig.id] = archiveConfig;
    }
    return configs;
  }, [archiveConfig, commoserveEnabled]);

  const resolveUnavailableConfigDecision = useCallback(
    (item: PlaylistItem, context: { configFileName: string | null; reason: string }) =>
      new Promise<"play-without-config" | "cancel">((resolve) => {
        setUnavailableConfigPrompt({
          item,
          configFileName: context.configFileName,
          reason: context.reason,
          resolve,
        });
      }),
    [],
  );

  const {
    playItem,
    startPlaylist,
    handlePlay,
    handleStop,
    handlePauseResume,
    handleNext,
    handlePrevious,
    handleSeekBy,
    beginScrub,
    scrubBy,
    endScrub,
    seekToFraction,
    scrubTargetMs,
    playlistEnded,
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
    shuffleEnabled,
    stationActiveRef,
    shuffleSeed,
    localEntriesBySourceId,
    localSourceTreeUris,
    buildHvscLocalPlayFile,
    deviceProduct: status.deviceInfo?.product ?? null,
    ensurePlaybackConnection,
    resolveSonglengthDurationMsForPath,
    applySonglengthsToItems,
    archiveConfigs,
    restoreVolumeOverrides,
    applyAudioMixerUpdates,
    enabledSidVolumeItems,
    buildEnabledSidMuteUpdates,
    captureSidMuteSnapshot,
    snapshotToUpdates,
    resolveEnabledSidVolumeItems,
    dispatchVolume,
    sidEnablement,
    pauseMuteSnapshotRef,
    pausingFromPauseRef,
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
    resumingFromPauseRef,
    ensureUnmuted,
    resolveUnavailableConfigDecision,
  });
  const handleNextRef = useRef(handleNext);
  useEffect(() => {
    handleNextRef.current = handleNext;
  }, [handleNext]);
  const playbackStateRef = useRef({ isPlaying, isPaused });
  useEffect(() => {
    playbackStateRef.current = { isPlaying, isPaused };
    if (isPlaying) {
      hasObservedActivePlaybackRef.current = true;
    }
  }, [isPlaying, isPaused]);

  const selectedSavedDeviceId = useSavedDevices().selectedDeviceId;
  const playbackDeviceIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousDeviceId = playbackDeviceIdRef.current;
    playbackDeviceIdRef.current = selectedSavedDeviceId;
    if (
      !shouldDetachPlaybackOnSavedDeviceSwitch({
        previousDeviceId,
        nextDeviceId: selectedSavedDeviceId,
        isPlaying,
        isPaused,
      })
    ) {
      return;
    }
    // Saved devices + the always-visible health-badge switcher let a user hop
    // devices while Play stays mounted. executeSavedDeviceSwitch already
    // mutated the C64 API singleton in place by the time this observes the
    // change, so transport controls/auto-advance calling getC64API() now
    // target the NEW device: auto-advance would launch the next track (and
    // reset/reboot for disk items) on the wrong C64, while the device that
    // was actually playing keeps going with no reachable control. Detach
    // locally instead - no device call (it would hit the wrong target), keep
    // playlist/currentIndex so pressing Play again resumes on the new device.
    // See HARD11-002.
    cancelAutoAdvance();
    setIsPlaying(false);
    setIsPaused(false);
    autoAdvanceGuardRef.current = null;
    setAutoAdvanceDueAtMs(null);
    trackStartedAtRef.current = null;
    playedClockRef.current.stop(Date.now(), true);
    setPlayedMs(0);
    // The captured volume-override snapshot belongs to the OLD device;
    // restoreVolumeOverrides() would write it to whatever getC64API() now
    // resolves to (the NEW device's mixer). Discard it locally instead.
    discardVolumeSession("saved-device-switch");
    toast({
      title: "Playback controls detached",
      description: "The connected device changed while playing.",
    });
  }, [selectedSavedDeviceId]);

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
    if (
      shouldStartBackgroundExecution({
        backgroundExecutionEnabled,
        backgroundExecutionActive: backgroundExecutionActiveRef.current,
        isPlaying,
        isPaused,
        playlistEnded,
      })
    ) {
      backgroundExecutionActiveRef.current = true;
      void startBackgroundExecution({
        source: "playback-controller",
        reason: "play",
        context: { trackInstanceId },
      }).catch((error) => {
        reportUserError({
          operation: "startBackgroundExecution",
          title: "Background playback unavailable",
          description: "Foreground playback continues, but background auto-advance may be interrupted.",
          error,
          context: { trackInstanceId },
          // Playback itself succeeded; degraded background capability is a
          // notice, not a destructive error (ERROR_POLICY §1 S2).
          severity: "S2",
        });
      });
      void queueBackgroundDueAtUpdate(autoAdvanceDueAtMs);
      return;
    }
    if (
      !shouldStopBackgroundExecution({
        backgroundExecutionEnabled,
        backgroundExecutionActive: backgroundExecutionActiveRef.current,
        isPlaying,
        isPaused,
        playlistEnded,
      })
    ) {
      return;
    }
    // Never let an instance that only adopted the running session (and has not
    // itself observed playback) stop it — that transient case is BUG-040. Keep
    // the adopted flag so a later restore on this instance does not double-start.
    if (!hasObservedActivePlaybackRef.current) {
      return;
    }
    backgroundExecutionActiveRef.current = false;
    void stopBackgroundExecution({
      source: "playback-controller",
      reason: isPaused ? "pause" : "stop",
      context: { trackInstanceId },
    }).catch((error) => {
      reportUserError({
        operation: "stopBackgroundExecution",
        title: "Background playback cleanup failed",
        description: "Background playback guard could not be fully stopped.",
        error,
        context: { trackInstanceId, reason: isPaused ? "pause" : "stop" },
        // Background guard cleanup is system work; failures are diagnostics
        // material, never a toast (ERROR_POLICY §3).
        background: true,
      });
    });
    void queueBackgroundDueAtUpdate(null);
  }, [
    autoAdvanceDueAtMs,
    backgroundExecutionEnabled,
    isPaused,
    isPlaying,
    queueBackgroundDueAtUpdate,
    trackInstanceId,
  ]);

  useEffect(
    () => () => {
      if (!backgroundExecutionActiveRef.current) return;
      const latestPlaybackState = playbackStateRef.current;
      // Keep the wake lock when this instance is still playing OR when it never
      // observed playback (a transient instance that only adopted the running
      // session must not release the live session's lock — BUG-040).
      if ((latestPlaybackState.isPlaying && !latestPlaybackState.isPaused) || !hasObservedActivePlaybackRef.current) {
        addLog("debug", "Leaving background playback guard active across Play page unmount", {
          trackInstanceId: backgroundCleanupTrackInstanceIdRef.current,
          dueAtMs: autoAdvanceGuardRef.current?.dueAtMs ?? null,
        });
        return;
      }
      backgroundExecutionActiveRef.current = false;
      void stopBackgroundExecutionRef
        .current({
          source: "playback-controller",
          reason: "cleanup",
          context: { trackInstanceId: backgroundCleanupTrackInstanceIdRef.current },
        })
        .catch((error) => {
          reportUserError({
            operation: "stopBackgroundExecution",
            title: "Background playback cleanup failed",
            description: "Background playback guard could not be fully stopped.",
            error,
            context: {
              trackInstanceId: backgroundCleanupTrackInstanceIdRef.current,
              reason: "cleanup",
            },
            // Unmount-time cleanup is never user-initiated (ERROR_POLICY §3).
            background: true,
          });
        });
      void queueBackgroundDueAtUpdateRef.current(null);
    },
    [],
  );

  useEffect(() => {
    if (
      !shouldSyncBackgroundExecutionDueAt(
        backgroundExecutionEnabled,
        backgroundExecutionActiveRef.current,
        isNativePlatform() && getPlatform() === "android",
      )
    ) {
      return;
    }
    void queueBackgroundDueAtUpdate(autoAdvanceDueAtMs);
  }, [autoAdvanceDueAtMs, backgroundExecutionEnabled, queueBackgroundDueAtUpdate]);

  useEffect(() => {
    if (!ACTIVE_ADD_ITEMS_PROGRESS_STATES.has(addItemsProgress.status)) return undefined;
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
      setAddItemsSurface("dialog");
    }
  }, [browserOpen]);

  useEffect(() => {
    if (!hvscControlsEnabled || !hvscPreparationOpen) return;
    if (hvsc.hvscPreparationState === "READY") return;
    if (hvsc.hvscUpdating) return;
    void hvsc.runHvscPreparation();
  }, [hvsc.hvscPreparationState, hvsc.hvscUpdating, hvsc.runHvscPreparation, hvscControlsEnabled, hvscPreparationOpen]);

  useEffect(() => {
    if (hvscControlsEnabled) {
      hvscDisableCancellationRequestedRef.current = false;
      return;
    }

    if (hvscPreparationOpen) {
      setHvscPreparationOpen(false);
    }

    if (!shouldCancelHvscLifecycleOnDisable(hvscControlsEnabled, hvsc.hvscPreparationState)) {
      hvscDisableCancellationRequestedRef.current = false;
      return;
    }

    if (hvscDisableCancellationRequestedRef.current) return;
    hvscDisableCancellationRequestedRef.current = true;

    void hvsc.handleHvscCancel().catch((error) => {
      hvscDisableCancellationRequestedRef.current = false;
      reportUserError({
        operation: "HVSC_CANCEL",
        title: "HVSC shutdown failed",
        description: "HVSC was disabled, but the active preparation task could not be cancelled cleanly.",
        error,
        context: { preparationState: hvsc.hvscPreparationState },
        // The disable itself succeeded; a lingering background task is a
        // notice, not a destructive error (ERROR_POLICY §1 S2).
        severity: "S2",
      });
    });
  }, [hvsc.handleHvscCancel, hvsc.hvscPreparationState, hvscControlsEnabled, hvscPreparationOpen]);

  useImportNavigationGuards(isImportNavigationBlocked);

  const handleBrowserOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setBrowserInitialSourceId(null);
    }
    setBrowserOpen(open);
  }, []);

  const handleOpenAddItems = useCallback(() => {
    setBrowserInitialSourceId(null);
    setBrowserOpen(true);
  }, []);

  const handleHvscSourceSelection = useCallback(
    async (source: SourceLocation) => {
      if (source.type !== "hvsc") {
        return true;
      }
      if (!shouldOpenHvscPreparation(featureFlags, source.type, hvsc.hvscPreparationState)) {
        return hvscControlsEnabled && hvsc.hvscPreparationState === "READY";
      }

      setBrowserOpen(false);
      setBrowserInitialSourceId(null);
      setHvscPreparationOpen(true);
      return false;
    },
    [featureFlags, hvsc.hvscPreparationState, hvscControlsEnabled],
  );

  const handleBrowsePreparedHvsc = useCallback(() => {
    if (!hvscControlsEnabled) return;
    setHvscPreparationOpen(false);
    setBrowserInitialSourceId("hvsc-library");
    setBrowserOpen(true);
  }, [hvscControlsEnabled]);

  const handleCancelHvscPreparation = useCallback(async () => {
    if (hvsc.hvscPreparationState === "DOWNLOADING" || hvsc.hvscPreparationState === "INGESTING") {
      await hvsc.handleHvscCancel();
    }
    setHvscPreparationOpen(false);
  }, [hvsc.handleHvscCancel, hvsc.hvscPreparationState]);

  const resolvedDeviceId = useResolvedPlaybackDeviceId(deviceInfoId);
  const playlistStorageKey = SHARED_PLAYLIST_STORAGE_KEY;

  useEffect(() => {
    if (browserOpen) return;
    if (ACTIVE_ADD_ITEMS_PROGRESS_STATES.has(addItemsProgress.status)) return;
    setAddItemsProgress({
      status: "idle",
      count: 0,
      elapsedMs: 0,
      total: null,
      message: null,
    });
  }, [addItemsProgress.status, browserOpen]);

  const sourceGroups: SourceGroup[] = useMemo(() => {
    const ultimateSource = createUltimateSourceLocation();
    const localGroupSources = localSources.map((source) => createLocalSourceLocation(source));
    const groups: SourceGroup[] = [
      { label: SOURCE_LABELS.local, sources: localGroupSources },
      { label: SOURCE_LABELS.c64u, sources: [ultimateSource] },
    ];
    if (shouldIncludeHvscSource(featureFlags, hvscAvailable)) {
      groups.push({
        label: SOURCE_LABELS.hvsc,
        sources: [createHvscSourceLocation(hvscRoot.path)],
      });
    }
    if (commoserveEnabled) {
      groups.push({
        label: SOURCE_LABELS.commoserve,
        sources: [createArchiveSourceLocation(archiveConfig)],
      });
    }
    return groups;
  }, [archiveConfig, commoserveEnabled, featureFlags, hvscAvailable, hvscRoot.path, localSources]);

  const updatePlaylistItemConfigRef = useCallback(
    (
      itemId: string,
      configRef: PlaylistItem["configRef"],
      options?: {
        origin?: PlaylistItem["configOrigin"];
        overrides?: PlaylistItem["configOverrides"];
        candidates?: PlaylistItem["configCandidates"];
      },
    ) => {
      setPlaylist((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? {
                ...item,
                configRef,
                configOrigin: options?.origin ?? resolveStoredConfigOrigin(configRef ?? null, null),
                configOverrides: options?.overrides ?? (configRef ? (item.configOverrides ?? null) : null),
                configCandidates: options?.candidates ?? item.configCandidates ?? null,
              }
            : item,
        ),
      );
    },
    [],
  );

  const updatePlaylistItemOverrides = useCallback((item: PlaylistItem, overrides: PlaylistItem["configOverrides"]) => {
    setPlaylist((prev) =>
      prev.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              configOverrides: overrides,
              configOrigin: overrides?.length
                ? "manual"
                : entry.configRef
                  ? resolveStoredConfigOrigin(entry.configRef, entry.configOrigin ?? null)
                  : entry.configOrigin === "manual-none"
                    ? "manual-none"
                    : "none",
            }
          : entry,
      ),
    );
  }, []);

  const requestPlaylistItemConfigRefUpdate = useCallback(
    (
      itemId: string,
      configRef: PlaylistItem["configRef"],
      options?: {
        origin?: PlaylistItem["configOrigin"];
        candidates?: PlaylistItem["configCandidates"];
      },
    ) => {
      const currentItem = playlist.find((item) => item.id === itemId);
      if (!currentItem) return;
      const baseConfigChanged = !areConfigReferencesEqual(currentItem.configRef ?? null, configRef ?? null);
      const hasOverrides = Boolean(currentItem.configOverrides?.length);
      if (configRef && baseConfigChanged && hasOverrides) {
        setPendingConfigChange({
          itemId,
          configRef,
          origin: options?.origin,
          candidates: options?.candidates,
        });
        return;
      }
      updatePlaylistItemConfigRef(itemId, configRef, {
        origin: options?.origin,
        candidates: options?.candidates,
        overrides: baseConfigChanged ? null : (currentItem.configOverrides ?? null),
      });
    },
    [playlist, updatePlaylistItemConfigRef],
  );

  const resolveConfigBrowserSourceId = useCallback(
    (item: PlaylistItem) => {
      const configuredSourceId = item.configRef?.kind === "local" ? (item.configRef.sourceId ?? null) : null;
      if (configuredSourceId && localSources.some((source) => source.id === configuredSourceId)) {
        return configuredSourceId;
      }
      if (
        item.request.source === "local" &&
        item.sourceId &&
        localSources.some((source) => source.id === item.sourceId)
      ) {
        return item.sourceId;
      }
      return localSources.length === 1 ? (localSources[0]?.id ?? null) : null;
    },
    [localSources],
  );

  const handleAttachUltimateConfig = useCallback((item: PlaylistItem) => {
    setConfigPickerState({ itemId: item.id, sourceType: "ultimate" });
  }, []);

  const handleAttachLocalConfig = useCallback(
    async (item: PlaylistItem) => {
      const browserSourceId = resolveConfigBrowserSourceId(item);
      if (browserSourceId) {
        setConfigPickerState({ itemId: item.id, sourceType: "local", sourceId: browserSourceId });
        return;
      }

      if (isAndroid) {
        try {
          const result = await FolderPicker.pickFile({
            extensions: ["cfg"],
            mimeTypes: ["text/plain", "application/octet-stream"],
          });
          requestPlaylistItemConfigRefUpdate(item.id, buildLocalConfigReferenceFromAndroidPicker(result), {
            origin: "manual",
          });
        } catch (error) {
          reportUserError({
            operation: "PLAYLIST_CONFIG_PICK",
            title: "Config file selection failed",
            description: (error as Error).message,
            error,
          });
        }
        return;
      }

      pendingLocalConfigItemIdRef.current = item.id;
      localConfigInputRef.current?.click();
    },
    [isAndroid, requestPlaylistItemConfigRefUpdate, resolveConfigBrowserSourceId],
  );

  const handleRemoveConfig = useCallback(
    (item: PlaylistItem) => {
      updatePlaylistItemConfigRef(item.id, null, {
        origin: "manual-none",
        overrides: null,
        candidates: item.configCandidates ?? null,
      });
    },
    [updatePlaylistItemConfigRef],
  );

  const activeConfigItem = useMemo(
    () => (activeConfigItemId ? (playlist.find((item) => item.id === activeConfigItemId) ?? null) : null),
    [activeConfigItemId, playlist],
  );

  const resolveDiscoverySource = useCallback(
    (item: PlaylistItem): SourceLocation | null => {
      if (item.request.source === "ultimate") {
        return createUltimateSourceLocation();
      }
      if (item.request.source === "local" && item.sourceId) {
        const source = localSources.find((entry) => entry.id === item.sourceId);
        return source ? createLocalSourceLocation(source) : null;
      }
      return null;
    },
    [localSources],
  );

  const handleChooseConfigCandidate = useCallback(
    (item: PlaylistItem, candidate: ConfigCandidate) => {
      requestPlaylistItemConfigRefUpdate(item.id, candidate.ref, {
        origin: "manual",
        candidates: item.configCandidates ?? null,
      });
    },
    [requestPlaylistItemConfigRefUpdate],
  );

  const handleRediscoverConfig = useCallback(
    async (item: PlaylistItem) => {
      const source = resolveDiscoverySource(item);
      if (!source || (source.type !== "local" && source.type !== "ultimate")) {
        toast({ title: "Playback config re-discovery unavailable" });
        return;
      }

      try {
        const candidates = await discoverConfigCandidates({
          sourceType: source.type,
          sourceId: source.type === "local" ? source.id : null,
          sourceRootPath: source.rootPath,
          targetFile: { name: item.label, path: item.path },
          listEntries: source.listEntries,
          localEntriesBySourceId,
        });
        const resolved = resolvePlaybackConfig({ candidates });
        requestPlaylistItemConfigRefUpdate(item.id, resolved.configRef, {
          origin: resolved.configOrigin,
          candidates: resolved.configCandidates,
        });
        toast({
          title: resolved.configRef ? `Resolved ${resolved.configRef.fileName}` : "Playback config candidates updated",
        });
      } catch (error) {
        reportUserError({
          operation: "PLAYLIST_CONFIG_REDISCOVER",
          title: "Config discovery failed",
          description: (error as Error).message,
          error,
          context: {
            item: item.label,
            source: item.request.source,
            path: item.path,
          },
        });
      }
    },
    [localEntriesBySourceId, requestPlaylistItemConfigRefUpdate, resolveDiscoverySource],
  );

  const configPickerTarget = useMemo(
    () => (configPickerState ? (playlist.find((item) => item.id === configPickerState.itemId) ?? null) : null),
    [configPickerState, playlist],
  );

  const configPickerSourceGroups = useMemo((): SourceGroup[] => {
    if (!configPickerState) return [];
    if (configPickerState.sourceType === "ultimate") {
      return [{ label: SOURCE_LABELS.c64u, sources: [createUltimateSourceLocation()] }];
    }
    const source = localSources.find((entry) => entry.id === configPickerState.sourceId);
    if (!source) return [];
    return [{ label: SOURCE_LABELS.local, sources: [createLocalSourceLocation(source)] }];
  }, [configPickerState, localSources]);

  const configPickerInitialSourceId = configPickerSourceGroups[0]?.sources[0]?.id ?? null;

  const handleConfigPickerConfirm = useCallback(
    async (source: SourceLocation, selections: SelectedItem[]) => {
      if (!configPickerState) return false;
      if (selections.length !== 1) {
        reportUserError({
          operation: "PLAYLIST_CONFIG_ATTACH",
          title: "Select one config file",
          description: "Choose exactly one .cfg file to attach.",
        });
        return false;
      }

      try {
        requestPlaylistItemConfigRefUpdate(
          configPickerState.itemId,
          buildConfigReferenceFromBrowserSelection(source, selections[0]),
          { origin: "manual" },
        );
        return true;
      } catch (error) {
        reportUserError({
          operation: "PLAYLIST_CONFIG_ATTACH",
          title: "Config attachment failed",
          description: (error as Error).message,
          error,
        });
        return false;
      }
    },
    [configPickerState, requestPlaylistItemConfigRefUpdate],
  );

  const handleLocalConfigInput = useCallback(
    (files: FileList | null) => {
      const itemId = pendingLocalConfigItemIdRef.current;
      pendingLocalConfigItemIdRef.current = null;
      if (!itemId || !files?.length) return;

      try {
        requestPlaylistItemConfigRefUpdate(itemId, buildLocalConfigReferenceFromWebFile(files[0]), {
          origin: "manual",
        });
      } catch (error) {
        reportUserError({
          operation: "PLAYLIST_CONFIG_PICK",
          title: "Config file selection failed",
          description: (error as Error).message,
          error,
        });
      }
    },
    [requestPlaylistItemConfigRefUpdate],
  );

  const buildPlaylistItem = useCallback(
    (entry: PlayableEntry, songNrOverride?: number, addedAtOverride?: string | null): PlaylistItem | null => {
      const category = getPlayCategory(entry.path);
      if (!category) return null;
      const songNrValue =
        songNrOverride ?? entry.songNr ?? (songNrInput.trim() === "" ? undefined : Math.max(1, Number(songNrInput)));
      const request: PlayRequest = {
        source: entry.source,
        path: entry.path,
        origin: entry.origin ?? (entry.source === "ultimate" ? buildSelectedDeviceBoundOrigin(entry.path) : null),
        file: entry.file,
        songNr: Number.isNaN(songNrValue) ? undefined : songNrValue,
      };
      const resolvedSourceId = entry.sourceId ?? (entry.source === "hvsc" ? "hvsc-library" : null);
      const originDeviceId = request.origin?.originDeviceId ?? null;
      const addedAt = addedAtOverride ?? new Date().toISOString();
      return {
        id: buildPlaylistItemId({
          source: entry.source,
          sourceId: resolvedSourceId,
          originDeviceId,
          path: entry.path,
          addedAt,
        }),
        request,
        category,
        label: entry.name,
        path: entry.path,
        origin: request.origin,
        configRef: entry.configRef ?? null,
        configOrigin: entry.configOrigin ?? resolveStoredConfigOrigin(entry.configRef ?? null, null),
        configOverrides: entry.configOverrides ?? null,
        configCandidates: entry.configCandidates ?? null,
        configPreview: entry.configPreview ?? null,
        archiveRef: entry.archiveRef ?? null,
        durationMs: entry.durationMs,
        durationSource: entry.durationSource ?? null,
        subsongCount: entry.subsongCount,
        sourceId: resolvedSourceId,
        sizeBytes: entry.sizeBytes ?? null,
        modifiedAt: entry.modifiedAt ?? null,
        addedAt,
        status: "ready",
        unavailableReason: null,
      };
    },
    [songNrInput],
  );

  const handleAddFileSelections = useMemo(
    () =>
      createAddFileSelectionsHandler({
        addItemsStartedAtRef,
        addItemsOverlayActiveRef,
        addItemsOverlayStartedAtRef,
        addItemsAbortControllerRef,
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
        playlistSnapshotRef,
        playlistStorageKey,
        buildPlaylistItem,
        applySonglengthsToItems,
        mergeSonglengthsFiles,
        collectSonglengthsCandidates,
        buildHvscLocalPlayFile,
        archiveConfigs,
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
      archiveConfigs,
    ],
  );

  const handleCancelAddItems = useCallback(() => {
    addItemsAbortControllerRef.current?.abort();
  }, []);

  const syncPlaybackTimeline = useCallback(
    (options?: { allowAutoAdvance?: boolean }) => {
      const allowAutoAdvance = options?.allowAutoAdvance ?? true;
      if (!isPlaying || isPaused || currentIndex < 0) return;
      const now = Date.now();
      if (trackStartedAtRef.current) {
        setElapsedMs(now - trackStartedAtRef.current);
      }
      setPlayedMs(playedClockRef.current.current(now));
      const guard = autoAdvanceGuardRef.current;
      if (allowAutoAdvance && guard && !guard.autoFired && !guard.userCancelled && now >= guard.dueAtMs) {
        addLog("debug", "Auto-advance due guard fired on timeline reconciliation", {
          trackInstanceId: guard.trackInstanceId,
          dueAtMs: guard.dueAtMs,
          nowMs: now,
          overdueMs: now - guard.dueAtMs,
        });
        void handleNext("auto", guard.trackInstanceId);
      }
    },
    [currentIndex, handleNext, isPaused, isPlaying, playedClockRef],
  );
  const syncPlaybackTimelineRef = useRef(syncPlaybackTimeline);
  useEffect(() => {
    syncPlaybackTimelineRef.current = syncPlaybackTimeline;
  }, [syncPlaybackTimeline]);

  useEffect(() => {
    if (!isPlaying || isPaused || currentIndex < 0) return;
    syncPlaybackTimeline();
    const timer = window.setInterval(syncPlaybackTimeline, 1000);
    return () => window.clearInterval(timer);
  }, [currentIndex, isPaused, isPlaying, syncPlaybackTimeline]);

  usePlaybackResumeTriggers(syncPlaybackTimeline);

  useEffect(() => {
    if (!isNativePlatform() || getPlatform() !== "android") return;
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | null = null;
    const registerBackgroundAutoSkipListener = async () => {
      try {
        const nextHandle = await onBackgroundAutoSkipDue((event) => {
          if (cancelled) return;
          syncPlaybackTimelineRef.current({ allowAutoAdvance: false });
          const guard = autoAdvanceGuardRef.current;
          const playbackState = playbackStateRef.current;
          if (!guard || !playbackState.isPlaying || playbackState.isPaused) return;
          if (event.dueAtMs !== guard.dueAtMs) return;
          const expectedTrackInstanceId = guard.trackInstanceId;
          void (async () => {
            try {
              await handleNextRef.current("auto", expectedTrackInstanceId);
              if (cancelled) return;
              const nextGuard = autoAdvanceGuardRef.current;
              if (!nextGuard) {
                setAutoAdvanceDueAtMs(null);
                await queueBackgroundDueAtUpdateRef.current(null);
                addLog("debug", "Cleared background auto-advance watchdog after auto next with no remaining guard", {
                  expectedTrackInstanceId,
                  dueAtMs: event.dueAtMs,
                });
                return;
              }
              if (nextGuard.trackInstanceId === expectedTrackInstanceId) {
                setAutoAdvanceDueAtMs(null);
                await queueBackgroundDueAtUpdateRef.current(null);
                addLog("warn", "Background auto-advance did not move to a new track instance; cleared stale watchdog", {
                  expectedTrackInstanceId,
                  dueAtMs: event.dueAtMs,
                  nextDueAtMs: nextGuard.dueAtMs,
                });
                return;
              }
              setAutoAdvanceDueAtMs(nextGuard.dueAtMs);
              await queueBackgroundDueAtUpdateRef.current(nextGuard.dueAtMs);
            } catch (error) {
              addErrorLog("Failed to re-arm background auto-advance", {
                error: error instanceof Error ? error.message : String(error),
                expectedTrackInstanceId,
                dueAtMs: event.dueAtMs,
              });
            }
          })();
        });
        if (cancelled) {
          await nextHandle.remove();
          return;
        }
        handle = nextHandle;
      } catch (error) {
        addErrorLog("Failed to register background auto-advance listener", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };

    void registerBackgroundAutoSkipListener();

    return () => {
      cancelled = true;
      if (handle) {
        void handle.remove();
      }
    };
  }, [autoAdvanceGuardRef, handleNextRef, playbackStateRef, queueBackgroundDueAtUpdateRef, syncPlaybackTimelineRef]);

  const currentItem = playlist[currentIndex];
  const sidRadioFlags = useSidRadioFlags();
  const playbackEngine = usePlaybackEngine();
  const currentTuneMd5 = useCurrentTuneMd5(currentItem ?? null, sidRadioFlags.sidRadioEnabled);
  // Load the HVSC songlength store before a station needs it, not during the refill that first asks.
  // `resolveHvscSonglengthDuration` awaits the load, which is right — treating "not loaded yet" as
  // "no such length" is what let short tunes into the queue — but paying for it inside a refill put
  // 6.9 s on the device's first `lastRefillMs` against a 150 ms budget. Warming it here moves that
  // cost off the refill path entirely; it is idempotent and memoised, so this costs nothing after
  // the first call.
  useEffect(() => {
    if (!sidRadioFlags.sidRadioEnabled) return;
    void ensureHvscSonglengthsReadyOnColdStart();
  }, [sidRadioFlags.sidRadioEnabled]);

  const stationDurationResolver = useMemo(
    () =>
      createStationDurationResolver({
        resolveHvscSeconds: async (virtualPath, songNr) =>
          (await resolveHvscSonglengthDuration({ virtualPath, songNr: songNr })).durationSeconds,
        resolveFileSeconds: async (virtualPath, songNr) => {
          const ms = await resolveSonglengthDurationMsForPath(virtualPath, null, songNr);
          return ms === null || ms === undefined ? null : ms / 1000;
        },
      }),
    [resolveSonglengthDurationMsForPath],
  );
  const sidRadio = useSidRadio({
    enabled: sidRadioFlags.sidRadioEnabled,
    startPlaylist: (items) => {
      // Replace, never merge: the station owns the queue for as long as it runs.
      void startPlaylist(items, 0, { replaceQueue: true });
    },
    appendItems: (items) => setPlaylist((prev) => [...prev, ...items]),
    advanceToNext: handleNext,
    currentIndex,
    playlistLength: playlist.length,
    // Lets the station leave out sound effects. HVSC carries jingles, one-shot effects and test
    // tones alongside the music, and a station that serves them between pieces reads as broken.
    // Which store answers, and why the order matters, is in `stationDurationResolver.ts`.
    resolveDurationSeconds: stationDurationResolver,
    // The station's `resolvePath` reads an index built as a side effect of loading the HVSC
    // songlengths, so the first refill has to wait for it or it burns every candidate it is given.
    ensureResolvable: ensureHvscSonglengthsReadyOnColdStart,
  });
  // Mirrored into the ref the playback controller reads, so a skip resolved at any point after this
  // render sees the current state of the station rather than the one captured when its handlers were
  // created.
  stationActiveRef.current = sidRadio.active;

  const sidRadioWhyThisTune = sidRadio.station
    ? sidRadio.station.seedKind === "song"
      ? `Similar to ${sidRadio.station.seedLabel}`
      : sidRadio.station.seedKind === "style"
        ? `Matches ${sidRadio.station.seedLabel}`
        : "From tunes you like"
    : null;
  /**
   * The tune the launcher's mood choices apply to.
   *
   * An active Song station wins over whatever is playing right now: re-aiming that station keeps the
   * tune it was seeded by, so naming the current track here would describe the wrong seed.
   */
  const sidRadioSongSeedLabel =
    sidRadio.station?.seedKind === "song"
      ? sidRadio.station.seedLabel
      : !sidRadio.active && currentTuneMd5 && currentItem?.category === "sid"
        ? (currentItem.label ?? "this tune")
        : null;
  const startSidRadioSongMood = (styleBit: number | null) => {
    // Re-aim rather than restart while a Song station is running, so the seed survives the change of
    // mood; the hook holds the seed, which is also what makes this work for a resumed station.
    if (sidRadio.station?.seedKind === "song") {
      void sidRadio.setSongStationStyleFilter(styleBit);
      return;
    }
    if (!currentTuneMd5) return;
    void sidRadio.startSongRadio(currentTuneMd5.slice(0, 12), currentItem?.label ?? "this tune", styleBit);
  };
  const { setPlaybackContext, resolved: lightingResolved, openStudio, openContextLens } = useLightingStudio();
  const currentDurationMs = currentItem ? playlistItemDuration(currentItem, currentIndex) : undefined;
  const sourceKind = useMemo<TraceSourceKind | null>(() => {
    if (!currentItem) return null;
    return currentItem.request.source;
  }, [currentItem]);
  const localAccessMode = useMemo<"entries" | "saf" | null>(() => {
    if (!currentItem || currentItem.request.source !== "local") return null;
    const treeUri = currentItem.sourceId ? localSourceTreeUris.get(currentItem.sourceId) : null;
    return treeUri ? "saf" : "entries";
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
  }, [
    currentDurationMs,
    currentIndex,
    currentItem?.id,
    elapsedMs,
    isPlaying,
    playlist.length,
    sourceKind,
    localAccessMode,
    trackInstanceId,
  ]);

  useEffect(() => {
    setPlaybackTraceSnapshot(playbackTraceContext);
    syncPlaybackDecisionFromTrace(playbackTraceContext, "Play page playback state updated");
  }, [playbackTraceContext]);

  useEffect(
    () => () => {
      setPlaybackTraceSnapshot(null);
      syncPlaybackDecisionFromTrace(null, "Play page unmounted; playback state is no longer directly observable");
    },
    [],
  );
  useEffect(() => {
    setPlaybackContext({
      sourceBucket:
        isPlaying && currentItem
          ? currentItem.request.source === "ultimate"
            ? "c64u"
            : currentItem.request.source
          : null,
      activeItemLabel: isPlaying && currentItem ? currentItem.label : null,
    });
    return () => {
      setPlaybackContext({ sourceBucket: null, activeItemLabel: null });
    };
  }, [currentItem, isPlaying, setPlaybackContext]);
  const currentDurationLabel = formatTime(currentDurationMs);
  // While the user is scrubbing, the bar and the timer follow the FINGER rather
  // than the audio clock. The engine is deliberately behind — it is catching up
  // to the target in the background — and showing its position would make the
  // control feel dead for as long as a rewind takes to re-render.
  const isScrubbing = scrubTargetMs !== null;
  // Composer, year and SID chip count, read from the tune's own SID header. Every SID carries them,
  // so this works for every source rather than only the ones with a metadata database behind them; a
  // tune that leaves the fields blank simply shows nothing.
  //
  // The chip count is the authoritative one: `sidChipCount` comes from the second and third chip
  // address bytes, which is what the player itself obeys. It is only available where the file's
  // bytes are in hand, so a tune the app has not opened yet falls back to the file-name marker.
  const [currentItemCredits, setCurrentItemCredits] = useState<{
    author: string | null;
    released: string | null;
    chipCount: SidChipCount | null;
    /** One entry per chip the file addresses; a 2SID or 3SID may mix models. */
    sidModels: SidModel[];
    clock: SidClock | null;
  }>({
    author: null,
    released: null,
    chipCount: null,
    sidModels: [],
    clock: null,
  });
  useEffect(() => {
    let cancelled = false;
    setCurrentItemCredits({ author: null, released: null, chipCount: null, sidModels: [], clock: null });
    const file = currentItem?.request.file;
    if (!file || currentItem?.category !== "sid") return;
    void (async () => {
      try {
        const header = parseSidHeaderMetadata(new Uint8Array(await file.arrayBuffer()));
        if (cancelled) return;
        setCurrentItemCredits({
          author: header.author || null,
          released: header.released || null,
          chipCount: header.sidChipCount === 2 || header.sidChipCount === 3 ? header.sidChipCount : 1,
          // `sid2Model`/`sid3Model` are null unless the file actually addresses that chip, so this is
          // one entry per real chip rather than a fixed three.
          sidModels: [header.sid1Model, header.sid2Model, header.sid3Model].filter((model): model is SidModel =>
            Boolean(model),
          ),
          clock: header.clock,
        });
      } catch (error) {
        // Not a readable SID header — nothing to show, which is the same as a tune that names nobody.
        addLog("debug", "Could not read tune credits from the SID header", {
          item: currentItem?.label,
          error: (error as Error)?.message ?? String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentItem?.id, currentItem?.request.file, currentItem?.category]);

  // How the tune is named on screen. `currentItem.label` stays the raw file name — the session
  // persistence, the playlist and every lookup still use it — and only what the transport draws
  // changes.
  const friendlySidNames = useFriendlySidNames();
  const currentDisplay = currentItem
    ? resolveTrackDisplayName({
        label: currentItem.label,
        category: currentItem.category,
        friendlyNames: friendlySidNames,
        chipCount: currentItemCredits.chipCount,
      })
    : null;

  // How much of the tune the on-device engine has rendered, as a percentage of its length. Only the
  // local engine has this: libsidplayfp cannot rewind, so a seek beyond what is rendered has to be
  // rendered up to. Polled rather than pushed — it changes a few times a second at most.
  const [renderedSeconds, setRenderedSeconds] = useState<number | null>(null);
  /**
   * The seek being waited for, if any: target, the render head when it was accepted, and the last
   * position that was genuinely audible. Held as the engine's own record rather than flattened to a
   * percentage, because each field answers a different question on screen.
   */
  const [pendingSeekState, setPendingSeekState] = useState<PendingSeekState | null>(null);
  const localEngineActive = playbackEngine.engine === "local";
  // Read inside the poll below, which outlives any one render of this page.
  const currentDurationMsRef = useRef(currentDurationMs);
  currentDurationMsRef.current = currentDurationMs;
  /**
   * Keep the auto-advance deadline from running down during a wait.
   *
   * The deadline is "now plus what is left of the tune", and a seek sets it from the target the
   * instant the target is accepted — before a note of that position has been heard. A wait of
   * twenty seconds therefore spent twenty seconds of the tune's own time, and a target deep into a
   * long tune advanced the playlist before playback resumed at all. Re-setting it from the target on
   * every poll holds it still for as long as the wait lasts, and leaves it exactly right the moment
   * the wait ends.
   */
  const holdAutoAdvanceWhilePending = useCallback(
    (pending: PendingSeekState | null) => {
      const durationMs = currentDurationMsRef.current;
      const guard = autoAdvanceGuardRef.current;
      if (!pending || !guard || !durationMs) return;
      const dueAtMs = Date.now() + Math.max(0, durationMs - pending.targetSeconds * 1000);
      guard.dueAtMs = dueAtMs;
      guard.autoFired = false;
      setAutoAdvanceDueAtMs(dueAtMs);
    },
    [autoAdvanceGuardRef, setAutoAdvanceDueAtMs],
  );
  useEffect(() => {
    if (!localEngineActive) {
      setRenderedSeconds(null);
      setPendingSeekState(null);
      return;
    }
    // Debug seam for HIL: the engine's own state, which the sink counters cannot show.
    (globalThis as Record<string, unknown>).__localEngineDebug = () =>
      getSharedLocalSidPlaybackController().debugState();
    const read = () => {
      const controller = getSharedLocalSidPlaybackController();
      setRenderedSeconds(controller.renderedSeconds());
      const pending = controller.pendingSeek();
      // Compared field by field rather than by identity: the engine hands out a copy each poll, so
      // storing it unconditionally would re-render the whole page twice a second for nothing.
      setPendingSeekState((previous) =>
        previous === pending ||
        (previous !== null &&
          pending !== null &&
          previous.targetSeconds === pending.targetSeconds &&
          previous.generation === pending.generation &&
          previous.trackInstanceId === pending.trackInstanceId)
          ? previous
          : pending,
      );
      holdAutoAdvanceWhilePending(pending);
    };
    read();
    const timer = window.setInterval(read, 500);
    return () => window.clearInterval(timer);
  }, [localEngineActive, currentItem?.id, holdAutoAdvanceWhilePending]);
  const pendingSeek =
    localEngineActive && pendingSeekState
      ? (describePendingSeek({
          state: pendingSeekState,
          renderedSeconds: renderedSeconds ?? pendingSeekState.renderedAtRequestSeconds,
          durationMs: currentDurationMs ?? 0,
        }) ?? undefined)
      : undefined;
  const renderedPercent =
    localEngineActive && renderedSeconds !== null && currentDurationMs
      ? Math.min(100, (renderedSeconds * 1000 * 100) / currentDurationMs)
      : undefined;

  // While a seek waits for the renderer, the engine is silent and the elapsed clock must sit at the
  // last position that was genuinely heard. It cannot read its own clock for this: the scheduler was
  // reset to the target when the seek was accepted, so every position source already reports the
  // target. A clock advancing normally through a silence is exactly what a listener reads as
  // playback having died, which is why the target is shown separately on the bar instead.
  const displayElapsedMs = isScrubbing ? scrubTargetMs : (pendingSeek?.audibleMs ?? elapsedMs);

  const progressPercent = currentDurationMs ? Math.min(100, (displayElapsedMs / currentDurationMs) * 100) : 0;
  const remainingMs = currentDurationMs !== undefined ? Math.max(0, currentDurationMs - displayElapsedMs) : undefined;
  const remainingLabel = currentDurationMs !== undefined ? `-${formatTime(remainingMs)}` : "—";
  // On-device playback attenuates its own PCM before it reaches the speaker, so the Play page's
  // volume control drives whichever route is sounding. Android's media volume is never touched:
  // that dial belongs to the person holding the phone, not to this app.
  //
  // Seeded from the engine rather than from a constant. The engine is process-wide and outlives this
  // page, so a listener who set -12 dB, navigated away and came back would otherwise find the slider
  // claiming 0 dB over a tune still playing at -12.
  const [localMuted, setLocalMuted] = useState(() => getSharedLocalSidPlaybackController().muted());
  const [localVolumeIndex, setLocalVolumeIndex] = useState(() =>
    localVolumeIndexForGain(getSharedLocalSidPlaybackController().volume()),
  );
  const setLocalVolumeFromIndex = useCallback((index: number) => {
    setLocalVolumeIndex(index);
    // The step's decibels, not its position in the list. The ladder is uneven, so an index fraction
    // would bear no relation to the figure the listener is reading — see localPlaybackVolume.
    getSharedLocalSidPlaybackController().setVolume(localVolumeGainForIndex(index));
  }, []);
  const toggleLocalMute = useCallback(() => {
    setLocalMuted((muted) => {
      // Only the mute flag moves; the step index stays where the listener left it, so unmuting comes
      // back to the same level rather than to a default.
      getSharedLocalSidPlaybackController().setMuted(!muted);
      return !muted;
    });
  }, []);

  const canControlVolume = enabledSidVolumeItems.length > 0 && volumeSteps.length > 0;
  const volumeBinding = resolvePlaybackVolumeBinding({
    route: playbackEngine.engine === "local" ? "local" : "c64",
    local: {
      index: localVolumeIndex,
      muted: localMuted,
      onIndexChange: setLocalVolumeFromIndex,
      onToggleMute: toggleLocalMute,
    },
    device: {
      index: volumeIndex,
      muted: volumeMuted,
      steps: volumeSteps,
      canControl: canControlVolume,
      onDraftChange: handleVolumeDraftChange,
      onPreview: handleVolumePreview,
      onCommit: handleVolumeCommit,
      onToggleMute: () =>
        void handleToggleMute().catch((error) => {
          addErrorLog("Mute toggle failed", { error: (error as Error).message });
          reportUserError({
            operation: "PLAYBACK_MUTE_TOGGLE",
            title: "Mute toggle failed",
            description: (error as Error).message,
            error,
          });
        }),
    },
  });
  const knownSubsongCount =
    currentSubsongCount ?? (typeof currentItem?.subsongCount === "number" ? currentItem.subsongCount : null);
  const subsongCount = knownSubsongCount ?? 1;
  const currentSongNr = currentItem?.request.songNr ?? 1;
  const clampedSongNr = Math.min(Math.max(1, currentSongNr), subsongCount);
  const isSongPlaying = Boolean(currentItem && isSongCategory(currentItem.category) && (isPlaying || isPaused));
  const songSelectorVisible = Boolean(isSongPlaying && knownSubsongCount && knownSubsongCount > 1);
  // Everything the tune's own header says about itself, on one line under the title. The order and
  // the omission rules live in buildNowPlayingMetadata; this only supplies the fields.
  const currentItemMetadata = currentItem
    ? buildNowPlayingMetadata({
        author: currentItemCredits.author,
        released: currentItemCredits.released,
        sidModels: currentItemCredits.sidModels,
        clock: currentItemCredits.clock,
        tuneNumber: clampedSongNr,
        tuneCount: knownSubsongCount,
        lengthLabel: currentDurationLabel,
      })
    : null;

  const handleSongSelection = useCallback(
    async (nextSongNr: number) => {
      if (!currentItem || !isSongCategory(currentItem.category)) return;
      // Strip the previous subsong's resolved duration so playItem re-resolves
      // it for the new songNr; otherwise auto-advance fires at the wrong time
      // and the stale duration persists onto the playlist item (HARD11-004).
      const nextItem = buildSubsongSwitchItem(currentItem, nextSongNr, knownSubsongCount);
      setSongNrInput(String(nextItem.request.songNr));
      setSongPickerOpen(false);
      setIsPlaylistLoading(true);
      try {
        cancelAutoAdvance();
        await playItem(nextItem, { playlistIndex: currentIndex });
      } catch (error) {
        // reportUserError no-ops when playItem already reported/marked the
        // error handled internally, so this only surfaces genuinely
        // unreported failures (e.g. a launch failure from executePlayPlan).
        reportUserError({
          operation: "PLAYBACK_SUBSONG_SELECT",
          title: "Tune switch failed",
          description: (error as Error).message,
          error,
          context: {
            item: currentItem.label,
            songNr: nextItem.request.songNr,
          },
        });
      } finally {
        setIsPlaylistLoading(false);
      }
    },
    [cancelAutoAdvance, currentIndex, currentItem, knownSubsongCount, playItem],
  );

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
  // Playing according to the APP, not according to this page instance.
  //
  // `isPlaying` is this component's own state and starts false, so a Play page
  // mounted while a tune is already playing — navigate Home, come back —
  // rendered Pause disabled and dropped Rewind/Fast Forward entirely, on audio
  // the user could hear. It corrects itself when the async session restore
  // lands, which is too late to be a transport. The union is deliberate:
  // whichever source knows first wins, and neither can turn the other off.
  const activePlayback = useActivePlayback();
  const playbackRunning = isPlaying || activePlayback.any;
  const localPlaybackRunning = isPlaying || activePlayback.local;
  const canPause = playbackRunning;
  // HARD12-005: Next/Prev enablement must reflect the shuffle-aware traversal
  // (what tapping them will do), not the linear playlist position.
  // A running station owns the order, so the enablement has to be computed from the same ordering the
  // traversal will actually use — see `resolveTraversalOrdering`.
  const traversalOrdering = resolveTraversalOrdering({ repeatEnabled, shuffleEnabled }, sidRadio.active);
  const hasPrev = canAdvancePrevious(
    playlist,
    currentIndex,
    traversalOrdering.repeatEnabled,
    traversalOrdering.shuffleEnabled,
    shuffleSeed,
  );
  const hasNext = canAdvanceNext(
    playlist,
    currentIndex,
    traversalOrdering.repeatEnabled,
    traversalOrdering.shuffleEnabled,
    shuffleSeed,
  );

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
      // ID-based merge: apply enriched durations to items still in the playlist even
      // if the playlist reference changed (e.g. new items added) during async enrichment.
      // Only overwrites durations that were absent (null/undefined) to avoid stale clobber.
      setPlaylist((prev) => {
        const durationById = new Map(updated.map((item) => [item.id, item.durationMs]));
        const merged = prev.map((item) => {
          if (item.durationMs !== undefined && item.durationMs !== null) return item;
          const enrichedDuration = durationById.get(item.id);
          if (enrichedDuration === undefined || enrichedDuration === null) return item;
          return { ...item, durationMs: enrichedDuration };
        });
        return merged.some((item, index) => item !== prev[index]) ? merged : prev;
      });
    };
    void applyUpdates();
    return () => {
      cancelled = true;
    };
  }, [applySonglengthsToItems, playlist, songlengthsFiles]);

  const removePlaylistItemsById = useCallback(
    (ids: Set<string>) => {
      if (!ids.size) return;
      const plan = planPlaylistItemRemoval(playlist, currentIndex, ids, isPlaying, isPaused);
      if (plan.shouldStopDevice) {
        // Route through handleStop so the C64 actually stops instead of
        // continuing to play a track the playlist no longer has, and so the
        // native auto-advance watchdog due-time is cleared. handleStop
        // performs the full teardown (resume-if-paused, device stop, volume
        // restore, guard/due-at clear) that used to be partially and
        // impurely duplicated as setState calls inside the setPlaylist
        // updater below. See HARD9-030.
        void handleStop();
      }
      setPlaylist(plan.next);
      if (currentIndex >= 0) {
        setCurrentIndex(plan.nextCurrentIndex);
      }
      setSelectedPlaylistIds((prev) => {
        if (!prev.size) return prev;
        return new Set(Array.from(prev).filter((id) => !ids.has(id)));
      });
    },
    [currentIndex, handleStop, isPaused, isPlaying, playlist],
  );

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
    autoAdvanceDueAtMs,
    setCurrentSubsongCount,
    setShuffleEnabled,
    setShuffleSeed,
    setRepeatEnabled,
    shuffleEnabled,
    shuffleSeed,
    repeatEnabled,
    activePlaylistQuery: playlistFilterText,
    setActivePlaylistQuery: restorePlaylistFilterText,
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
    void restoreVolumeOverrides("playback-ended");
  }, [isPaused, isPlaying, restoreVolumeOverrides]);

  const restoreVolumeOverridesOnNavigateRef = useRef(restoreVolumeOverrides);
  const navigateCleanupIsPlayingRef = useRef(isPlaying);
  const navigateCleanupIsPausedRef = useRef(isPaused);

  useEffect(() => {
    restoreVolumeOverridesOnNavigateRef.current = restoreVolumeOverrides;
  }, [restoreVolumeOverrides]);

  useEffect(() => {
    navigateCleanupIsPlayingRef.current = isPlaying;
    navigateCleanupIsPausedRef.current = isPaused;
  }, [isPaused, isPlaying]);

  useEffect(
    () => () => {
      if (navigateCleanupIsPlayingRef.current || navigateCleanupIsPausedRef.current) {
        return;
      }
      void restoreVolumeOverridesOnNavigateRef.current("navigate").catch((error) => {
        addErrorLog("Volume restore failed during navigation", {
          error: (error as Error).message,
        });
      });
    },
    [],
  );

  const persistDurationOverride = useCallback(
    (durationOverrideMs: number) => {
      setPlaylist((prev) => applyDurationOverrideToPlaylist(prev, durationOverrideMs));
    },
    [setPlaylist],
  );

  useEffect(() => {
    if (debouncedDurationOverrideMs === undefined) return;
    persistDurationOverride(debouncedDurationOverrideMs);
  }, [debouncedDurationOverrideMs, persistDurationOverride]);

  // Re-arm the auto-advance guard when the playing track's duration changes
  // mid-track (slider/input), so auto-advance fires at the new duration
  // instead of the stale one captured at track launch. No-op while paused
  // (handlePauseResume already recomputes dueAtMs from the live durationMs
  // on resume) and a no-op on ordinary track launches, since playItem sets
  // trackStartedAtRef/guard.dueAtMs and durationMs together already in sync.
  useEffect(() => {
    const guard = autoAdvanceGuardRef.current;
    const nextDueAtMs = resolveAutoAdvanceDueAtMsOnDurationChange({
      isPlaying,
      isPaused,
      durationMs,
      trackStartedAtMs: trackStartedAtRef.current,
      currentDueAtMs: guard?.dueAtMs,
    });
    if (nextDueAtMs === null || !guard) return;
    guard.dueAtMs = nextDueAtMs;
    guard.autoFired = false;
    setAutoAdvanceDueAtMs(nextDueAtMs);
  }, [durationMs, isPaused, isPlaying, setAutoAdvanceDueAtMs]);

  const handleDurationSliderChange = useCallback(
    (value: number[]) => {
      const nextSeconds = sliderToDurationSeconds(value[0] ?? 0);
      const nextDurationMs = nextSeconds * 1000;
      setDurationSeconds(nextSeconds);
      setDurationMs(nextDurationMs);
      setPendingDurationOverrideMs(nextDurationMs);
      setDurationInput(formatDurationSeconds(nextSeconds));
    },
    [setDurationMs],
  );

  const handleDurationSliderCommit = useCallback(
    (value: number[]) => {
      const nextSeconds = sliderToDurationSeconds(value[0] ?? 0);
      const nextDurationMs = nextSeconds * 1000;
      setDurationSeconds(nextSeconds);
      setDurationMs(nextDurationMs);
      setDurationInput(formatDurationSeconds(nextSeconds));
      persistDurationOverride(nextDurationMs);
      setPendingDurationOverrideMs(undefined);
    },
    [persistDurationOverride, setDurationMs],
  );

  const handleDurationInputChange = useCallback(
    (value: string) => {
      const normalizedValue = normalizeDurationInputDraft(value);
      setDurationInput(normalizedValue);
      const parsed = parseDurationInput(normalizedValue);
      if (parsed === undefined) return;
      const nextSeconds = clampDurationSeconds(Math.round(parsed / 1000));
      const nextDurationMs = nextSeconds * 1000;
      setDurationSeconds(nextSeconds);
      setDurationMs(nextDurationMs);
      setPendingDurationOverrideMs(nextDurationMs);
    },
    [setDurationMs],
  );

  const handleDurationInputBlur = useCallback(() => {
    const parsed = parseDurationInput(durationInput);
    if (parsed === undefined) {
      setDurationInput(formatDurationSeconds(durationSeconds));
      return;
    }
    const nextSeconds = clampDurationSeconds(Math.round(parsed / 1000));
    const nextDurationMs = nextSeconds * 1000;
    if (nextSeconds !== durationSeconds) {
      setDurationSeconds(nextSeconds);
    }
    setDurationMs(nextDurationMs);
    persistDurationOverride(nextDurationMs);
    setPendingDurationOverrideMs(undefined);
    setDurationInput(formatDurationSeconds(nextSeconds));
  }, [durationInput, durationSeconds, persistDurationOverride, setDurationMs]);

  const queryFilteredPlaylist = useQueryFilteredPlaylist({
    playlist,
    playlistStorageKey,
    playlistTypeFilters,
    query: playlistFilterText,
    previewLimit: listPreviewLimit,
  });

  const effectivePlaylistItemDuration = useCallback(
    (item: PlaylistItem, index: number) => pendingDurationOverrideMs ?? playlistItemDuration(item, index),
    [pendingDurationOverrideMs, playlistItemDuration],
  );

  const playlistTotals = useMemo(() => {
    const durations = playlist.map((item, index) => effectivePlaylistItemDuration(item, index));
    return calculatePlaylistTotals(durations, playedMs);
  }, [playlist, playedMs, effectivePlaylistItemDuration]);

  const previewFilteredPlaylist = queryFilteredPlaylist.previewPlaylist;
  const filteredPlaylist = queryFilteredPlaylist.viewAllPlaylist;
  const currentPlayingItemId =
    (isPlaying || isPaused) && currentIndex >= 0 ? (playlist[currentIndex]?.id ?? null) : null;

  // Stable identities so usePlaylistListItems's useMemo isn't defeated by a
  // fresh inline arrow on every 1s elapsedMs tick during playback (HARD9-032).
  const handleAttachLocalConfigVoid = useCallback(
    (item: PlaylistItem) => void handleAttachLocalConfig(item),
    [handleAttachLocalConfig],
  );
  const handleOpenConfig = useCallback((item: PlaylistItem) => setActiveConfigItemId(item.id), []);

  const playlistPreviewListItems = usePlaylistListItems({
    filteredPlaylist: previewFilteredPlaylist,
    playlist,
    selectedPlaylistIds,
    isPlaylistLoading,
    handlePlaylistSelect,
    onAttachLocalConfig: handleAttachLocalConfigVoid,
    onAttachUltimateConfig: handleAttachUltimateConfig,
    onOpenConfig: handleOpenConfig,
    onRemoveConfig: handleRemoveConfig,
    startPlaylist,
    playlistItemDuration: effectivePlaylistItemDuration,
    formatTime,
    formatPlayCategory,
    formatBytes,
    formatDate,
    getParentPath,
    currentPlayingItemId,
  });

  const playlistViewAllListItems = usePlaylistListItems({
    filteredPlaylist,
    playlist,
    selectedPlaylistIds,
    isPlaylistLoading,
    handlePlaylistSelect,
    onAttachLocalConfig: handleAttachLocalConfigVoid,
    onAttachUltimateConfig: handleAttachUltimateConfig,
    onOpenConfig: handleOpenConfig,
    onRemoveConfig: handleRemoveConfig,
    startPlaylist,
    playlistItemDuration: effectivePlaylistItemDuration,
    formatTime,
    formatPlayCategory,
    formatBytes,
    formatDate,
    getParentPath,
    currentPlayingItemId,
  });
  const pageShellClassName = usePrimaryPageShellClassName("bg-gradient-to-b from-background to-background/95");

  return (
    <div className={pageShellClassName}>
      <AppBar title="Play Files" />
      <PageContainer>
        <PageStack>
          {lightingStudioEnabled && lightingResolved.sourceCue ? (
            <LightingAutomationCue
              label={lightingResolved.sourceCue.label}
              onOpenStudio={openStudio}
              onOpenContextLens={openContextLens}
            />
          ) : null}
          <ProfileSplitSection minColumnWidth="22rem" testId="play-primary-layout">
            <div
              className="bg-card border border-border rounded-xl p-4 space-y-4"
              data-section-label="Playback controls"
              data-testid="play-section-playback"
            >
              {playbackEngine.localEngineEnabled && currentItem?.category === "sid" ? <PlaybackEngineToggle /> : null}
              <PlaybackControlsCard
                hasCurrentItem={Boolean(currentItem)}
                currentItemLabel={currentDisplay?.title ?? null}
                currentItemMetadata={currentItemMetadata}
                // Which station (or, when none is running, which playlist) is producing this tune
                // leads the card: it is context for the title, the transport and everything else
                // below it. Rendered in both states, and the same height in both, so that starting
                // or stopping a station never shifts the controls underneath.
                stationIndicator={
                  sidRadioFlags.sidRadioEnabled ? (
                    <SidRadioChip station={sidRadio.station} whyThisTune={sidRadioWhyThisTune} onStop={sidRadio.stop} />
                  ) : undefined
                }
                stationActive={sidRadio.active}
                rankingControls={
                  sidRadioFlags.rankingActive ? (
                    <NowPlayingRanking
                      md5={currentTuneMd5}
                      enabled={sidRadioFlags.rankingActive}
                      onNotForMe={
                        sidRadio.active
                          ? () => {
                              // Record the skip HERE, where the ✕ actually
                              // drives the queue. useSidRadio.steer() also calls
                              // recordSkip, but nothing consumes steer — so
                              // `skips` and `skipToLaunchMs` were never
                              // populated and the pinned budget could not be
                              // measured at all.
                              const started = performance.now();
                              void Promise.resolve(handleNext()).finally(() => recordSkip(performance.now() - started));
                            }
                          : undefined
                      }
                    />
                  ) : undefined
                }
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
                // Only offered when the tune is actually rendering here: the C64
                // plays the SID itself and cannot be scrubbed, so on that route
                // Previous/Next stay plain track controls.
                onSeek={
                  playbackEngine.engine === "local" && currentItem?.category === "sid" && localPlaybackRunning
                    ? (deltaSeconds) => void handleSeekBy(deltaSeconds)
                    : undefined
                }
                onScrubStart={
                  playbackEngine.engine === "local" && currentItem?.category === "sid" && localPlaybackRunning
                    ? () => beginScrub(currentDurationMs)
                    : undefined
                }
                onScrubStep={scrubBy}
                onSeekToFraction={
                  playbackEngine.engine === "local" && currentItem?.category === "sid" && currentDurationMs
                    ? (fraction) => seekToFraction(fraction, currentDurationMs)
                    : undefined
                }
                onScrubEnd={() => void endScrub()}
                isScrubbing={isScrubbing}
                progressPercent={progressPercent}
                renderedPercent={renderedPercent}
                pendingSeek={pendingSeek}
                elapsedLabel={formatTime(displayElapsedMs)}
                remainingLabel={remainingLabel}
                totalLabel={formatTime(playlistTotals.total)}
                remainingTotalLabel={formatTime(playlistTotals.remaining)}
                volumeControls={
                  // Bound to whichever route is sounding — see resolvePlaybackVolumeBinding. The two
                  // routes must not be blended: while the C64 route's handlers also ran on this
                  // device, its synchronisation loop pulled the slider back to the Ultimate's level
                  // a moment after every drag.
                  <VolumeControls
                    {...volumeBinding}
                    previewIntervalMs={volumeSliderPreviewIntervalMs}
                    useNativeRangeInput={isAndroid}
                  />
                }
                shuffleEnabled={shuffleEnabled}
                onShuffleChange={(value) => setShuffleEnabled(Boolean(value))}
                repeatEnabled={repeatEnabled}
                onRepeatChange={(value) => setRepeatEnabled(Boolean(value))}
                onReshuffle={handleReshuffle}
                reshuffleActive={reshuffleActive}
                reshuffleDisabled={!shuffleEnabled || playlist.length < 2}
                shuffleSeed={shuffleSeed}
              />
              {/*
               * One row for everything on this page that opens a sheet: start or change a station,
               * open the Likes list, reach the controller. They are grouped because they are the
               * same kind of action, and Remote Input comes last because it leaves the music
               * behind — the two station actions are about what plays, and belong nearer the
               * controls that play it. Sharing one wrapping row also costs no extra height over
               * the two-row arrangement it replaces.
               */}
              {sidRadioFlags.sidRadioEnabled || (remoteInputEnabled && isPlaying) ? (
                <div className="flex w-full flex-col gap-2">
                  {/* The station's identity and its Stop now lead the card above; what is left here
                      are the actions that start or change a station, which belong after the
                      controls they will replace rather than before them. */}
                  <div className="flex flex-wrap gap-2">
                    {sidRadioFlags.sidRadioEnabled &&
                    !sidRadio.active &&
                    currentTuneMd5 &&
                    currentItem?.category === "sid" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="sid-radio-start"
                        onClick={() =>
                          void sidRadio.startSongRadio(currentTuneMd5.slice(0, 12), currentItem?.label ?? "this tune")
                        }
                      >
                        <RadioIcon className="mr-1.5 h-4 w-4" /> Start Radio
                      </Button>
                    ) : null}
                    {/*
                     * Offered while a station is playing too, which it was not before: the mood a
                     * Song station is constrained to is changed from this sheet, and stopping the
                     * station to reach that control would throw away the seed it is meant to keep.
                     */}
                    {sidRadioFlags.sidRadioEnabled ? (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="sid-radio-launcher"
                          onClick={() => {
                            void sidRadio.ensureStylePopulations();
                            setSidRadioLauncherOpen(true);
                          }}
                        >
                          <RadioIcon className="mr-1.5 h-4 w-4" /> SID Radio
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="sid-radio-liked-tunes-open"
                          onClick={() => setLikedTunesSheetOpen(true)}
                        >
                          <Heart className="mr-1.5 h-4 w-4" /> Liked Tunes
                        </Button>
                      </>
                    ) : null}
                    {remoteInputEnabled && isPlaying ? (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid="play-open-controller"
                        onClick={() => setRemoteInputSheetOpen(true)}
                      >
                        <Gamepad2 className="mr-1.5 h-4 w-4" /> Remote Input
                      </Button>
                    ) : null}
                  </div>
                  {sidRadioFlags.sidRadioEnabled && sidRadio.notice ? (
                    <p className="text-xs text-muted-foreground" data-testid="sid-radio-notice">
                      {sidRadio.notice === "no-radio-for-tune"
                        ? "No radio for this tune yet — try a style or your likes."
                        : sidRadio.notice === "no-hvsc"
                          ? "No HVSC music is installed yet — install it below, then any station will play."
                          : sidRadio.notice === "station-ended"
                            ? "This station has played everything it could find — pick another to keep going."
                            : "No radio available yet — like a few tunes to seed one."}
                    </p>
                  ) : null}
                </div>
              ) : null}
              <PlaybackSettingsPanel
                durationSliderMax={DURATION_SLIDER_STEPS}
                durationSliderValue={durationSecondsToSlider(durationSeconds)}
                durationInput={durationInput}
                onDurationSliderChange={handleDurationSliderChange}
                onDurationSliderCommit={handleDurationSliderCommit}
                onDurationInputChange={handleDurationInputChange}
                onDurationInputBlur={handleDurationInputBlur}
                onChooseSonglengthsFile={async () => {
                  if (!isAndroid) {
                    songlengthsInputRef.current?.click();
                    return;
                  }
                  try {
                    const result = await FolderPicker.pickFile({
                      mimeTypes: ["text/plain", "application/octet-stream"],
                    });
                    if (!result?.uri || !result?.permissionPersisted) {
                      throw new Error("Songlengths file access was not granted.");
                    }
                    handleSonglengthsPicked({
                      path: normalizeSourcePath(`/${result.name ?? "songlengths.md5"}`),
                      uri: result.uri,
                      name: result.name ?? "songlengths.md5",
                      sizeBytes: result.sizeBytes ?? null,
                      modifiedAt: result.modifiedAt ?? null,
                    });
                  } catch (error) {
                    // A user dismissing the SAF file picker (Android back-out)
                    // throws "File selection canceled". That is an expected,
                    // benign outcome, not an application error. Routing it
                    // through reportUserError logged it at error severity and
                    // raised a persistent destructive (red) toast for a normal
                    // cancel — a false-positive foreground error. Swallow
                    // expected user-cancellations; the genuine "access was not
                    // granted" throw above is not classified "cancelled" and so
                    // still surfaces. Mirrors the local-folder-picker fix. See
                    // HARD23-006 (sibling of HARD23-002).
                    if (classifyError(error).category === "cancelled") {
                      return;
                    }
                    reportUserError({
                      operation: "SONGLENGTHS_PICK",
                      title: "Songlengths file selection failed",
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
                previewItems={playlistPreviewListItems}
                viewAllItems={playlistViewAllListItems}
                totalItemCount={queryFilteredPlaylist.totalMatchCount}
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
                onAddItems={handleOpenAddItems}
                onClearPlaylist={() => removePlaylistItemsById(new Set(playlistIds))}
                playlistFilterText={playlistFilterInputText}
                onPlaylistFilterTextChange={handlePlaylistFilterTextChange}
                hasMoreViewAllItems={queryFilteredPlaylist.hasMoreViewAllResults}
                onViewAllEndReached={queryFilteredPlaylist.loadMoreViewAllResults}
              />
            </div>
          </ProfileSplitSection>

          <input
            ref={localSourceInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={wrapUserEvent(
              (event) => {
                event.currentTarget.value = "";
              },
              "upload",
              "PlayFilesPage",
              { type: "file" },
              "LocalInput",
            )}
          />

          <input
            ref={localConfigInputRef}
            type="file"
            accept=".cfg,.CFG,text/plain,application/octet-stream"
            className="hidden"
            onChange={wrapUserEvent(
              (event) => {
                handleLocalConfigInput(event.target.files);
                event.currentTarget.value = "";
              },
              "upload",
              "PlayFilesPage",
              { type: "file" },
              "PlaylistConfigInput",
            )}
          />

          <input
            ref={songlengthsInputRef}
            type="file"
            accept=".md5,.MD5,.txt,.TXT,text/plain,application/octet-stream"
            className="hidden"
            onChange={wrapUserEvent(
              (event) => {
                handleSonglengthsInput(event.target.files);
                event.currentTarget.value = "";
              },
              "upload",
              "PlayFilesPage",
              { type: "file" },
              "SonglengthsInput",
            )}
          />

          <ItemSelectionDialog
            open={browserOpen}
            onOpenChange={handleBrowserOpenChange}
            title="Add items"
            confirmLabel="Add to playlist"
            initialSourceId={browserInitialSourceId}
            sourceGroups={sourceGroups}
            archiveConfigs={archiveConfigs}
            onAddLocalSource={async () => (await addSourceFromPicker(localSourceInputRef.current))?.id ?? null}
            onConfirm={handleAddFileSelections}
            onSelectSource={handleHvscSourceSelection}
            filterEntry={(entry) => entry.type === "dir" || isSupportedPlayFile(entry.path)}
            allowFolderSelection
            isConfirming={isAddingItems}
            progress={addItemsProgress}
            showProgressFooter={addItemsSurface === "dialog"}
            onCancelScan={handleCancelAddItems}
            autoConfirmCloseBefore={isAndroid}
            onAutoConfirmStart={handleAutoConfirmStart}
            autoConfirmLocalSource
            // "Recurse" used to live on the playback card, where it was the only control left once a
            // station took over the play order. It is not a playback setting at all: it decides what
            // a folder selection means. Here it sits next to the folders it governs, and it can say
            // so in words rather than in one.
            folderOptions={
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={recurseFolders}
                  onCheckedChange={(value) => setRecurseFolders(Boolean(value))}
                  aria-label="Include subfolders"
                  data-testid="playback-recurse"
                />
                Include subfolders
              </label>
            }
          />

          <HvscPreparationSheet
            open={hvscControlsEnabled && hvscPreparationOpen}
            onOpenChange={setHvscPreparationOpen}
            state={hvsc.hvscPreparationState}
            statusLabel={hvsc.hvscPreparationStatusLabel}
            failedPhase={hvsc.hvscPreparationFailedPhase}
            stage={hvsc.hvscStage}
            step={hvsc.hvscStageStep}
            stagePercent={hvsc.hvscStagePercent}
            stageDone={hvsc.hvscStageDone}
            stageTotal={hvsc.hvscStageTotal}
            throughputLabel={hvsc.hvscPreparationThroughputLabel}
            readySongCount={hvsc.hvscReadySongCount}
            errorReason={hvsc.hvscPreparationErrorReason}
            onBrowse={handleBrowsePreparedHvsc}
            onCancel={() => void handleCancelHvscPreparation()}
            onRetry={() => void hvsc.retryHvscPreparation()}
          />

          <ItemSelectionDialog
            open={Boolean(configPickerState && configPickerSourceGroups.length && configPickerTarget)}
            onOpenChange={(open) => {
              if (!open) {
                setConfigPickerState(null);
              }
            }}
            title={configPickerTarget ? `Attach .cfg to ${configPickerTarget.label}` : "Attach .cfg"}
            confirmLabel="Attach config"
            initialSourceId={configPickerInitialSourceId}
            selectionMode="single"
            sourceGroups={configPickerSourceGroups}
            onAddLocalSource={async () => (await addSourceFromPicker(localSourceInputRef.current))?.id ?? null}
            onConfirm={handleConfigPickerConfirm}
            filterEntry={(entry) => entry.type === "file" && entry.name.toLowerCase().endsWith(".cfg")}
            allowFolderSelection={false}
          />

          <PlaybackConfigSheet
            item={activeConfigItem}
            open={Boolean(activeConfigItem)}
            canRediscover={Boolean(
              activeConfigItem &&
              resolveDiscoverySource(activeConfigItem) &&
              (activeConfigItem.request.source === "local" || activeConfigItem.request.source === "ultimate"),
            )}
            onOpenChange={(open) => {
              if (!open) {
                setActiveConfigItemId(null);
              }
            }}
            onAttachLocalConfig={(item) => void handleAttachLocalConfig(item)}
            onAttachUltimateConfig={handleAttachUltimateConfig}
            onChooseCandidate={handleChooseConfigCandidate}
            onRemoveConfig={handleRemoveConfig}
            onRediscover={(item) => void handleRediscoverConfig(item)}
            onUpdateOverrides={updatePlaylistItemOverrides}
          />

          {remoteInputEnabled ? (
            <RemoteInputSheet open={remoteInputSheetOpen} onOpenChange={setRemoteInputSheetOpen} />
          ) : null}

          <LikedTunesSheet
            open={likedTunesSheetOpen}
            onOpenChange={setLikedTunesSheetOpen}
            onPlay={(items, startIndex) => void startPlaylist(items, startIndex)}
          />
          <SidRadioLauncherSheet
            open={sidRadioLauncherOpen}
            onOpenChange={setSidRadioLauncherOpen}
            likeCount={likedTuneCount}
            stylePopulations={sidRadio.stylePopulations}
            onStartStyle={(bit, label, fromLikes) => void sidRadio.startStyleRadio(bit, label, fromLikes)}
            onStartTaste={() => void sidRadio.startTasteRadio()}
            onSurprise={() => void sidRadio.startSurpriseRadio()}
            songSeedLabel={sidRadioSongSeedLabel}
            songStyleBit={sidRadio.station?.seedKind === "song" ? sidRadio.station.styleBit : null}
            onStartSong={startSidRadioSongMood}
          />

          <AlertDialog
            open={Boolean(pendingConfigChange)}
            onOpenChange={(open) => {
              if (!open && pendingConfigChange) {
                setPendingConfigChange(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear custom edits?</AlertDialogTitle>
                <AlertDialogDescription>
                  Changing the config file will clear this item&apos;s custom value edits. Continue only if you want to
                  replace the current base config.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (!pendingConfigChange) return;
                    updatePlaylistItemConfigRef(pendingConfigChange.itemId, pendingConfigChange.configRef, {
                      origin: pendingConfigChange.origin,
                      candidates: pendingConfigChange.candidates,
                      overrides: null,
                    });
                    setPendingConfigChange(null);
                  }}
                >
                  Continue
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog
            open={Boolean(unavailableConfigPrompt)}
            onOpenChange={(open) => {
              if (!open && unavailableConfigPrompt) {
                unavailableConfigPrompt.resolve("cancel");
                setUnavailableConfigPrompt(null);
              }
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Config unavailable</AlertDialogTitle>
                <AlertDialogDescription>
                  {unavailableConfigPrompt
                    ? `${unavailableConfigPrompt.configFileName ?? "The selected config"} is unavailable for ${unavailableConfigPrompt.item.label}. Play without config, or cancel?`
                    : "The selected config is unavailable."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {unavailableConfigPrompt ? (
                <div className="text-sm text-muted-foreground">{unavailableConfigPrompt.reason}</div>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogCancel
                  onClick={() => {
                    if (!unavailableConfigPrompt) return;
                    unavailableConfigPrompt.resolve("cancel");
                    setUnavailableConfigPrompt(null);
                  }}
                >
                  Cancel
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (!unavailableConfigPrompt) return;
                    unavailableConfigPrompt.resolve("play-without-config");
                    setUnavailableConfigPrompt(null);
                  }}
                >
                  Play without config
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {!browserOpen ? (
            <AddItemsProgressOverlay
              progress={addItemsProgress}
              title="Adding items"
              testId="add-items-overlay"
              visible={showAddItemsOverlay || addItemsProgress.status === "scanning"}
              onCancel={handleCancelAddItems}
            />
          ) : null}

          {hvscControlsEnabled && (
            <div data-section-label="HVSC" data-testid="play-section-hvsc">
              <HvscManager hvscControlsEnabled={true} hvsc={hvsc} />
            </div>
          )}
        </PageStack>
      </PageContainer>
    </div>
  );
}
