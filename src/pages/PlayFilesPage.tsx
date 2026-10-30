/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { wrapUserEvent } from "@/lib/tracing/userTrace";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Joystick, Heart, Keyboard, ListMusic, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RemoteInputSheet } from "@/components/remoteInput/RemoteInputSheet";
import { PlaybackConfigSheet } from "@/pages/playFiles/components/PlaybackConfigSheet";
import {
  AddItemsProgressOverlay,
  type AddItemsProgressState,
} from "@/components/itemSelection/AddItemsProgressOverlay";
import { ItemSelectionDialog, type SourceGroup } from "@/components/itemSelection/ItemSelectionDialog";
import { useC64Connection } from "@/hooks/useC64Connection";
import { useFeatureFlags } from "@/hooks/useFeatureFlags";
import { useDisplayProfile } from "@/hooks/useDisplayProfile";
import { useListPreviewLimit } from "@/hooks/useListPreviewLimit";
import { useLocalSources } from "@/hooks/useLocalSources";
import { useSavedDevices } from "@/hooks/useSavedDevices";
import { useActionTrace } from "@/hooks/useActionTrace";
import { PLAY_PAGE_TRACE_COMPONENT } from "@/lib/tracing/traceContext";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { DEVICE_NOT_CONNECTED_MESSAGE, reportUserError } from "@/lib/uiErrors";
import { createLatestIntentWriteLane, type LatestIntentWriteLane } from "@/lib/deviceInteraction/latestIntentWriteLane";
import type { TraceSourceKind } from "@/lib/tracing/types";
import { classifyError } from "@/lib/tracing/failureTaxonomy";
import { discoverConnection, getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { isNetworkKnownOffline } from "@/lib/connection/networkStatusWatch";
import { getParentPath } from "@/lib/playback/localFileBrowser";
import { type PlayRequest } from "@/lib/playback/playbackRouter";
import {
  formatPlayCategory,
  getPlayCategory,
  isSupportedPlayFile,
  type PlayFileCategory,
} from "@/lib/playback/fileTypes";
import { PlaybackClock } from "@/lib/playback/playbackClock";
import { createUltimateSourceLocation } from "@/lib/sourceNavigation/ftpSourceAdapter";
import { useUltimateSourceLocation } from "@/lib/sourceNavigation/useUltimateSourceLocation";
import { createHvscSourceLocation } from "@/lib/sourceNavigation/hvscSourceAdapter";
import { ensureHvscSonglengthsReadyOnColdStart, resolveHvscSonglengthDuration } from "@/lib/hvsc/hvscSongLengthService";
import { getHvscSubsongDurationsSeconds, getHvscSubsongTitles } from "@/lib/hvsc";
import { createStationDurationResolver } from "@/pages/playFiles/stationDurationResolver";
import { Checkbox } from "@/components/ui/checkbox";
import { resolveTraversalOrdering } from "@/pages/playFiles/stationOrdering";
import { createArchiveSourceLocation } from "@/lib/sourceNavigation/archiveSourceAdapter";
import { createLocalSourceLocation } from "@/lib/sourceNavigation/localSourceAdapter";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { prepareDirectoryInput } from "@/lib/sourceNavigation/localSourcesStore";
import type { SelectedItem, SourceLocation } from "@/lib/sourceNavigation/types";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import { buildSelectedDeviceBoundOrigin } from "@/lib/savedDevices/deviceBoundOrigin";

import { buildEnabledSidMuteUpdates } from "@/lib/config/sidVolumeControl";
import { parseSidHeaderMetadata, type SidClock, type SidModel } from "@/lib/sid/sidUtils";
import { buildNowPlayingMetadataParts } from "@/lib/playback/nowPlayingMetadata";
import { useStilInfo } from "@/pages/playFiles/hooks/useStilInfo";
import { useShownNowPlaying } from "@/pages/playFiles/hooks/useShownNowPlaying";
import { useLaunchStopGuard } from "@/pages/playFiles/hooks/useLaunchStopGuard";
import { useSleepTimer } from "@/pages/playFiles/hooks/useSleepTimer";
import { SleepTimerControl } from "@/pages/playFiles/components/SleepTimerControl";
import { resolveTrackDisplayName, type SidChipCount } from "@/lib/playback/sidDisplayName";
import { tuneShareForItem } from "@/lib/playback/tuneShare";
import { useFriendlySidNames } from "@/lib/playback/useFriendlySidNames";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { FolderPicker } from "@/lib/native/folderPicker";
import {
  isBackgroundExecutionActive,
  setBackgroundExecutionPaused,
  startBackgroundExecution,
  stopBackgroundExecution,
} from "@/lib/native/backgroundExecutionManager";
import { BackgroundExecution, onBackgroundAutoSkipDue } from "@/lib/native/backgroundExecution";

import { AppBar } from "@/components/AppBar";
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { SOURCE_LABELS } from "@/lib/sourceNavigation/sourceTerms";
import { VolumeControls } from "@/pages/playFiles/components/VolumeControls";
import {
  rendersOnPhone,
  resolvePlaybackVolumeBinding,
  resolveSoundingRoute,
} from "@/pages/playFiles/playbackVolumeBinding";
import { localVolumeGainForIndex, localVolumeIndexForGain } from "@/lib/playback/localPlaybackVolume";
import { PlaybackControlsCard } from "@/pages/playFiles/components/PlaybackControlsCard";
import { PlaybackSpectrumCard } from "@/components/playback/SpectrumCard";
import { PlaybackSoundCard } from "@/components/playback/SoundCard";
import { PlaybackEngineToggle } from "@/pages/playFiles/components/PlaybackEngineToggle";
import { usePlaybackEngine } from "@/lib/playback/usePlaybackEngine";
import { NowPlayingRanking } from "@/pages/playFiles/components/NowPlayingRanking";
import { useCurrentTuneMd5 } from "@/pages/playFiles/hooks/useCurrentTuneMd5";
import { useSidRadioFlags } from "@/lib/sidRadio/useSidRadioFlags";
import { LikedTunesSheetHost } from "@/pages/playFiles/components/LikedTunesSheet";
import { useExternalOpenState } from "@/hooks/useExternalOpenState";
import { PlayDeepLinks, type PlayDeepLinkHandlers } from "@/pages/playFiles/hooks/usePlayDeepLinks";
import { useLockScreenPlayback } from "@/pages/playFiles/hooks/useLockScreenPlayback";
import { usePlayTransportCommands } from "@/pages/playFiles/hooks/usePlayTransportCommands";
import { resolveSeekToFraction } from "@/pages/playFiles/resolveSeekToFraction";
import { transportCommandBus } from "@/lib/input/latchedCommandBus";
import { useRemoteInputOpenRequest } from "@/hooks/useRemoteInputOpenRequest";
import { useSidRadio } from "@/pages/playFiles/hooks/useSidRadio";
import { useRestoreVolumeWhenPlaybackEnds } from "@/pages/playFiles/hooks/useRestoreVolumeWhenPlaybackEnds";
import { SidRadioChip, whyThisTuneFor } from "@/pages/playFiles/components/SidRadioChip";
import { StationQueueEditedDialog } from "@/pages/playFiles/components/StationQueueEditedDialog";
import { useStationPlaylistHandover } from "@/pages/playFiles/hooks/useStationPlaylistHandover";
import { SidRadioLauncherSheet } from "@/pages/playFiles/components/SidRadioLauncherSheet";
import { SID_RADIO_NOTICE_TEXT } from "@/pages/playFiles/sidRadioNotices";
import { usePlaylistTotals } from "@/pages/playFiles/hooks/usePlaylistTotals";
import { createPlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import { usePlaybackTimeline } from "@/pages/playFiles/playbackTimeline";
import { PlaySearchSheet } from "@/pages/playFiles/components/PlaySearchSheet";
import {
  PlaylistConfigDialogs,
  type PendingConfigChangeState,
  type UnavailableConfigPromptState,
} from "@/pages/playFiles/components/PlaylistConfigDialogs";
import { TuneListSheet } from "@/pages/playFiles/components/TuneListSheet";
import { expandSubsongs, hasAllTunesQueued, MIN_TUNES_TO_EXPAND } from "@/pages/playFiles/expandSubsongs";
import { isMd548InHvsc, md548ForVirtualPath } from "@/lib/sidRadio/md5PathIndex";
import { useRecordRecentlyPlayed } from "@/pages/playFiles/hooks/useRecordRecentlyPlayed";
import { useLikedTuneCount } from "@/lib/sidRadio/useLikedTuneCount";
import { recordSkip } from "@/lib/sidRadio/sidRadioStats";
import { Radio as RadioIcon } from "lucide-react";
import { PlaybackSettingsPanel } from "@/pages/playFiles/components/PlaybackSettingsPanel";
import { PlaylistPanel } from "@/pages/playFiles/components/PlaylistPanel";
import { HvscManager } from "@/pages/playFiles/components/HvscManager";
import { HvscPreparationSheet } from "@/pages/playFiles/components/HvscPreparationSheet";
import { PageContainer, PageStack, ProfileSplitSection } from "@/components/layout/PageContainer";
import { useHvscLibrary } from "@/pages/playFiles/hooks/useHvscLibrary";
import { useDemoPlaylistCleanup } from "@/pages/playFiles/hooks/useDemoPlaylistCleanup";
import {
  shouldAutoRunHvscPreparation,
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
import { useC64MuteFollowsRoute } from "@/pages/playFiles/hooks/useC64MuteFollowsRoute";
import { useLocalEntries } from "@/pages/playFiles/hooks/useLocalEntries";
import { useAddItemsOverlayState } from "@/pages/playFiles/hooks/useAddItemsOverlayState";
import { useImportNavigationGuards } from "@/pages/playFiles/hooks/useImportNavigationGuards";
import { useOnPageLeft } from "@/hooks/useOnPageLeft";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import { useSoundingTune } from "@/pages/playFiles/hooks/useSoundingTune";
import {
  BACKGROUND_ADVANCE_LOG_MESSAGES,
  resolveBackgroundAdvanceOutcome,
} from "@/pages/playFiles/backgroundAdvanceOutcome";
import { usePlaybackTimelineTicks } from "@/pages/playFiles/hooks/usePlaybackTimelineTicks";
import { useLocalPendingSeek } from "@/pages/playFiles/hooks/useLocalPendingSeek";
import { useRemoteSidSeek } from "@/pages/playFiles/hooks/useRemoteSidSeek";
import { isRemoteSidSeekBusy } from "@/lib/playback/remoteSeek/activeRemoteSidSeek";
import { usePlaybackResumeTriggers } from "@/pages/playFiles/hooks/usePlaybackResumeTriggers";
import { useResolvedPlaybackDeviceId } from "@/pages/playFiles/hooks/useResolvedPlaybackDeviceId";
import { getSelectedSavedDevice } from "@/lib/savedDevices/store";
import { useArchiveClientSettings } from "@/pages/playFiles/hooks/useArchiveClientSettings";
import { useDebouncedValue } from "@/pages/playFiles/hooks/useDebouncedValue";
import { useQueryFilteredPlaylist } from "@/pages/playFiles/hooks/useQueryFilteredPlaylist";
import { usePlaylistLetterIndexSource } from "@/pages/playFiles/hooks/usePlaylistLetterIndexSource";
import {
  isBackgroundExecutionEnabled,
  resolveBackgroundExecutionAction,
  shouldSyncBackgroundExecutionDueAt,
} from "@/pages/playFiles/backgroundExecutionPolicy";
import { usePublishedPlaybackTrace } from "@/pages/playFiles/hooks/usePublishedPlaybackTrace";
import { createAddFileSelectionsHandler } from "@/pages/playFiles/handlers/addFileSelections";
import { loadGameModeOnLaunch, shouldEnterGameModeOnLaunch, startGameMode } from "@/lib/remoteInput/gameModeLaunch";
import {
  deferSleepTimerToTuneEnd,
  planPlaylistItemRemoval,
  resolveAutoAdvanceDueAtMsOnDurationChange,
  runClaimedLaunch,
} from "@/pages/playFiles/playbackGuards";
import { autoAdvanceDelayMs, crossfadeLeadMs } from "@/pages/playFiles/crossfadeLead";
import type { PlayableEntry, PlaylistItem } from "@/pages/playFiles/types";
import {
  buildConfigReferenceFromBrowserSelection,
  buildLocalConfigReferenceFromAndroidPicker,
  buildLocalConfigReferenceFromWebFile,
} from "@/lib/config/configFileReferenceSelection";
import { discoverConfigCandidates } from "@/lib/config/configDiscovery";
import { resolvePlaybackConfig } from "@/lib/config/configResolution";
import { useDurationOverride } from "@/pages/playFiles/hooks/useDurationOverride";
import { areConfigReferencesEqual, type ConfigCandidate, resolveStoredConfigOrigin } from "@/lib/config/playbackConfig";
import { useFeatureFlag } from "@/hooks/useFeatureFlags";
import { useGameModeAvailable } from "@/hooks/useGameModeAvailable";
import { useLightingStudio } from "@/hooks/useLightingStudio";
import { LightingAutomationCue } from "@/components/lighting/LightingStudioDialog";
import {
  DURATION_SLIDER_STEPS,
  SHARED_PLAYLIST_STORAGE_KEY,
  buildPlaylistItemId,
  buildSubsongSwitchItem,
  canAdvanceNext,
  canAdvancePrevious,
  shouldDetachPlaybackOnSavedDeviceSwitch,
  mergeResolvedSonglengthDurations,
  durationSecondsToSlider,
  formatBytes,
  formatDate,
  formatTime,
  isSongCategory,
  addThenMaybeLaunch,
  resolvePickerConfirm,
} from "@/pages/playFiles/playFilesUtils";
import { getSharedLocalSidPlaybackController } from "@/lib/playback/localSidPlaybackController";
import { describePendingSeek } from "@/lib/playback/pendingSeekStatus";
import { resolvePlayheadAnchor, seekAwareDelayMs, shouldRefreshDeadline } from "@/lib/playback/playheadAnchor";
import { useActivePlayback } from "@/hooks/useActivePlayback";

/** Buttons that open a sheet from the Play page share rows: short labels that grow to fill the row. */
const SHEET_OPENER_CLASS = "flex-auto whitespace-nowrap px-2";

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
    deferredToEnd?: boolean;
  };

  type ConfigPickerState =
    { itemId: string; sourceType: "ultimate" } | { itemId: string; sourceType: "local"; sourceId: string };

  const { status } = useC64Connection();
  const deviceInfoId = status.deviceInfo?.unique_id ?? null;
  const { sources: localSources, addSourceFromPicker } = useLocalSources();
  const [browserOpen, setBrowserOpen] = useState(false);
  // Written by the station playlist handover below. A ref, because `useSidRadio` is created after the playback
  // controller and consumes the handlers it returns, so the flag cannot travel as a plain prop.
  const stationActiveRef = useRef(false);
  const stationFinishingRef = useRef(false);
  const {
    playlist,
    setPlaylist,
    currentIndex,
    setCurrentIndex,
    shuffleEnabled,
    setShuffleEnabled,
    shuffleSeed,
    shuffleAnchorId,
    setShuffleSeed,
    setShuffleAnchorId,
    repeatOneEnabled,
    setRepeatOneEnabled,
    repeatEnabled,
    setRepeatEnabled,
    playlistTypeFilters,
    setPlaylistTypeFilters,
    selectedPlaylistIds,
    setSelectedPlaylistIds,
    isPlaylistLoading,
    setIsPlaylistLoading,
  } = usePlaylistManager();
  const hasPlaylistRef = useRef(false);
  const playlistSnapshotRef = useRef(playlist);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  // usePlaybackPersistence sets this once the stored session has been applied or
  // rejected. Declared here because the transport latch below is declared long
  // before that hook runs.
  const [sessionRestoreSettled, setSessionRestoreSettled] = useState(false);
  const [playlistRestored, setPlaylistRestored] = useState(false); // Set below, after the persistence hook.
  const [playlistFilterInputText, setPlaylistFilterInputText] = useState("");
  const [playlistFilterText, setPlaylistFilterText] = useState("");
  const debouncedPlaylistFilterText = useDebouncedValue(playlistFilterInputText, 200);
  const [playbackTime] = useState(createPlaybackTimeStore);
  const { setElapsedMs, setPlayedMs } = playbackTime;
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const {
    pendingDurationOverrideMs,
    durationSeconds,
    durationInput,
    handleDurationSliderChange,
    handleDurationSliderCommit,
    handleDurationInputChange,
    handleDurationInputBlur,
  } = useDurationOverride(setPlaylist, setDurationMs);
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

  const [hvscPreparationOpen, setHvscPreparationOpen] = useState(false);
  // Set when SID Radio asked for HVSC, so the finished install leads back to the radio.
  const [hvscPreparationForRadio, setHvscPreparationForRadio] = useState(false);
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
  const { profile: displayProfile } = useDisplayProfile();
  const isAndroid = getPlatform() === "android" && isNativePlatform();
  const trace = useActionTrace(PLAY_PAGE_TRACE_COMPONENT);

  const featureFlags = useFeatureFlags();
  const hvscControlsEnabled = shouldShowHvscControls(featureFlags);
  const backgroundExecutionEnabled = isBackgroundExecutionEnabled(featureFlags);
  const { archiveConfig, commoserveEnabled } = useArchiveClientSettings();
  const { value: lightingStudioEnabled } = useFeatureFlag("lighting_studio_enabled");
  const { value: remoteInputEnabled } = useFeatureFlag("remote_input_enabled");
  const gameModeAvailable = useGameModeAvailable();
  const [remoteInputSheetOpen, setRemoteInputSheetOpen] = useState(false);
  // Claimed here as well as on Home: search publishes without navigating when Play is on screen.
  useRemoteInputOpenRequest(() => setRemoteInputSheetOpen(true));
  const likedTunesSheet = useExternalOpenState();
  const [sidRadioLauncherOpen, setSidRadioLauncherOpen] = useState(false);
  const [hvscSearchOpen, setHvscSearchOpen] = useState(false);
  /**
   * What the search sheet should open with, when it was opened from a composer's name.
   *
   * Cleared when the sheet closes so that opening it again from the toolbar starts empty, which is
   * what that entry point means.
   */
  const [hvscSearchSeed, setHvscSearchSeed] = useState<string | null>(null);
  /** Whether the list of tunes in the current file is open. */
  const [tuneListOpen, setTuneListOpen] = useState(false);
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
    isManualMuteHeld,
    releaseManualMute,
  } = usePlayFilesVolumeBindings({ isPlaying, isPaused, resolvedDeviceId: getSelectedSavedDevice()?.id ?? null });
  const volumeIndex = volumeState.index;
  const volumeMuted = volumeState.muted;

  // HARD19-026: pass the live hvsc_enabled gate so the hook's background native
  // lifecycle (status/recover/hydration) stays dormant when HVSC is disabled.
  const hvsc = useHvscLibrary(hvscControlsEnabled);
  const { hvscRoot, hvscAvailable, buildHvscLocalPlayFile } = hvsc;

  const { localEntriesBySourceId, localSourceTreeUris } = useLocalEntries(localSources);

  const localSourceInputRef = useRef<HTMLInputElement | null>(null);
  const localConfigInputRef = useRef<HTMLInputElement | null>(null);
  const songlengthsInputRef = useRef<HTMLInputElement | null>(null);
  const trackStartedAtRef = useRef<number | null>(null);
  const { soundingTuneRef, soundingTune, setSoundingTune } = useSoundingTune();
  // The playing track's length. Declared here rather than beside the value it mirrors because the
  // timeline tick and the pending-seek poll both read it, and both outlive any one render.
  const currentDurationMsRef = useRef<number | undefined>(undefined);
  // What the previous tick anchored the clock to, so this one can tell a playhead that is moving
  // from one that has stopped. See `stalled` in `playheadAnchor`.
  const anchoredElapsedRef = useRef<number | null>(null);
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
    if (isNetworkKnownOffline()) throw new Error(DEVICE_NOT_CONNECTED_MESSAGE);
    await discoverConnection("manual");
    const snapshot = getConnectionSnapshot();
    if (snapshot.state !== "REAL_CONNECTED" && snapshot.state !== "DEMO_ACTIVE") {
      throw new Error(DEVICE_NOT_CONNECTED_MESSAGE);
    }
  }, [status.isConnected]);

  const archiveConfigs = useMemo((): Record<string, ArchiveClientConfigInput> => {
    const configs: Record<string, ArchiveClientConfigInput> = {};
    if (commoserveEnabled) {
      configs[archiveConfig.id] = archiveConfig;
    }
    return configs;
  }, [archiveConfig, commoserveEnabled]);

  const remoteInputSheetOpenRef = useRef(remoteInputSheetOpen);
  remoteInputSheetOpenRef.current = remoteInputSheetOpen;

  /**
   * Launching a game ends in the playing state without a further keystroke, which is
   * the whole point on a handset with no touchscreen. Every condition that keeps it
   * from becoming a surprise lives in `shouldEnterGameModeOnLaunch`.
   */
  const handleUserLaunchedItem = useCallback(
    (item: PlaylistItem) => {
      if (!gameModeAvailable) return;
      if (
        !shouldEnterGameModeOnLaunch({
          category: item.category,
          origin: "user",
          sheetAlreadyOpen: remoteInputSheetOpenRef.current,
          enabled: loadGameModeOnLaunch(),
        })
      ) {
        return;
      }
      void startGameMode();
    },
    [gameModeAvailable],
  );

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
    pauseShown,
    handleNext,
    handlePrevious,
    handleSeekBy,
    rebasePlaybackPosition,
    beginScrub,
    scrubBy,
    endScrub,
    seekToFraction,
    scrubTargetMs,
    playlistEnded,
    setPlaylistEnded,
    playlistItemDuration,
    chosenTrackLaunching,
    setDurationMsItemId,
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
    playbackTime,
    durationMs,
    setDurationMs,
    setCurrentSubsongCount,
    setTrackInstanceId,
    repeatEnabled,
    shuffleEnabled,
    stationActiveRef,
    stationFinishingRef,
    repeatOneEnabled,
    shuffleSeed,
    shuffleAnchorId,
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
    soundingTuneRef,
    soundingTune,
    setSoundingTune,
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
    isManualMuteHeld,
    resolveUnavailableConfigDecision,
    onUserLaunchedItem: handleUserLaunchedItem,
  });
  const { stopPending, stopping, stopPlayback } = useLaunchStopGuard({
    isPlaylistLoading,
    isPlaying,
    stop: handleStop,
  });
  const handleNextRef = useRef(handleNext);
  useEffect(() => {
    handleNextRef.current = handleNext;
  }, [handleNext]);

  // Home's tiles and the search overlay send this page here to do one thing (spec.md 6.3).
  const deepLinkHandlers: PlayDeepLinkHandlers = {
    openRadioLauncher: () => setSidRadioLauncherOpen(true),
    // Recently played is the empty state of the archive search sheet, which is where that list has
    // always lived; a second list of the same rows would be a second idea of what a result is.
    openRecentlyPlayed: () => setHvscSearchOpen(true),
    openFindATune: (seed) => {
      setHvscSearchSeed(seed ?? null);
      setHvscSearchOpen(true);
    },
    openLikedTunes: () => likedTunesSheet.set(true),
    resumeSession: () => transportCommandBus.publish("play"),
  };

  usePlayTransportCommands(
    {
      isPlaying,
      isPaused,
      play: () => void handlePlay(),
      pauseResume: () => void handlePauseResume(),
      next: () => void handleNext(),
      previous: () => void handlePrevious(),
      stop: stopPlayback,
    },
    playlist.length > 0 && sessionRestoreSettled,
  );
  const sleepTimer = useSleepTimer({
    onExpire: stopPlayback,
    isPlaying,
  });
  const sleepTimerRef = useRef(sleepTimer);
  sleepTimerRef.current = sleepTimer;
  /**
   * A tune has ended on its own: advance, unless the sleep timer says that was the last one.
   *
   * Every automatic advance goes through here — the foreground timeline reconciliation and the
   * background watchdog both — so the two cannot disagree about whether the session is over. A
   * user pressing next is deliberately not routed through this: they are asking for the next tune,
   * not telling the timer anything.
   */
  const advanceOnTrackEnd = useCallback(
    (trackInstanceId?: number) => {
      const endDueAtMs = deferSleepTimerToTuneEnd(
        autoAdvanceGuardRef.current,
        sleepTimerRef.current.mode,
        Date.now(),
        trackStartedAtRef.current,
        currentDurationMsRef.current,
      );
      if (endDueAtMs !== null) {
        setAutoAdvanceDueAtMs(endDueAtMs);
        return Promise.resolve();
      }
      if (sleepTimerRef.current.notifyTuneEnded(trackInstanceId)) return Promise.resolve();
      return handleNextRef.current("auto", trackInstanceId);
    },
    [handleNextRef],
  );
  const advanceOnTrackEndRef = useRef(advanceOnTrackEnd);
  advanceOnTrackEndRef.current = advanceOnTrackEnd;
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
    setSoundingTune(null);
    autoAdvanceGuardRef.current = null;
    setPlayedMs(0);
  }, [isPaused, isPlaying]);

  useEffect(() => {
    const backgroundExecutionAction = resolveBackgroundExecutionAction({
      backgroundExecutionEnabled,
      backgroundExecutionActive: backgroundExecutionActiveRef.current,
      isPlaying,
      isPaused,
      playlistEnded,
    });
    if (backgroundExecutionAction === "start") {
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
    if (backgroundExecutionAction === "publish-paused" || backgroundExecutionAction === "publish-playing") {
      // HARD27-007: a pause or resume of a live session updates the service in place. Stopping it
      // on pause released the MediaSession, so the headset Play that followed reached nothing.
      const paused = backgroundExecutionAction === "publish-paused";
      void setBackgroundExecutionPaused(paused, {
        source: "playback-controller",
        reason: paused ? "pause" : "resume",
        context: { trackInstanceId },
      }).catch((error) => {
        reportUserError({
          operation: "setBackgroundExecutionPaused",
          title: "Background playback state update failed",
          description: "Lock-screen and headset controls may not match the current playback state.",
          error,
          context: { trackInstanceId, paused },
          // System bookkeeping around a transport action the user already saw
          // succeed; diagnostics material, never a toast (ERROR_POLICY §3).
          background: true,
        });
      });
      return;
    }
    if (backgroundExecutionAction !== "stop") {
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
      reason: "stop",
      context: { trackInstanceId },
    }).catch((error) => {
      reportUserError({
        operation: "stopBackgroundExecution",
        title: "Background playback cleanup failed",
        description: "Background playback guard could not be fully stopped.",
        error,
        context: { trackInstanceId, reason: "stop" },
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
      // session must not release the live session's lock — BUG-040). A paused
      // session is kept too (HARD27-007): the service has already dropped its
      // wake lock and its own grace period bounds how long it survives, so
      // tabbing away from Play must not be what kills the headset controls.
      if (latestPlaybackState.isPlaying || !hasObservedActivePlaybackRef.current) {
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
    const autoRun = shouldAutoRunHvscPreparation({
      enabled: hvscControlsEnabled,
      sheetOpen: hvscPreparationOpen,
      updating: hvsc.hvscUpdating,
      preparationState: hvsc.hvscPreparationState,
    });
    if (autoRun) void hvsc.runHvscPreparation();
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
        description: "HVSC was disabled, but the active preparation task could not be canceled cleanly.",
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
    if (hvscPreparationForRadio) {
      setHvscPreparationForRadio(false);
      setSidRadioLauncherOpen(true);
      return;
    }
    setBrowserInitialSourceId("hvsc-library");
    setBrowserOpen(true);
  }, [hvscControlsEnabled, hvscPreparationForRadio]);

  const handleCancelHvscPreparation = useCallback(async () => {
    if (hvsc.hvscPreparationState === "DOWNLOADING" || hvsc.hvscPreparationState === "INGESTING") {
      await hvsc.handleHvscCancel();
    }
    setHvscPreparationOpen(false);
  }, [hvsc.handleHvscCancel, hvsc.hvscPreparationState]);

  const resolvedDeviceId = useResolvedPlaybackDeviceId(deviceInfoId, status.state === "DEMO_ACTIVE");
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

  const ultimateSource = useUltimateSourceLocation(status.deviceInfo?.product, status.state !== "OFFLINE_NO_DEMO");
  const sourceGroups: SourceGroup[] = useMemo(() => {
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
  }, [archiveConfig, commoserveEnabled, featureFlags, hvscAvailable, hvscRoot.path, localSources, ultimateSource]);

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
      return [{ label: SOURCE_LABELS.c64u, sources: [createUltimateSourceLocation({ name: ultimateSource.name })] }];
    }
    const source = localSources.find((entry) => entry.id === configPickerState.sourceId);
    if (!source) return [];
    return [{ label: SOURCE_LABELS.local, sources: [createLocalSourceLocation(source)] }];
  }, [configPickerState, localSources, ultimateSource.name]);

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

  /**
   * Confirming the picker with exactly one game in the selection launches it as well
   * as queueing it, which is what the button has already said it would do. The item
   * is read back from the playlist snapshot rather than rebuilt, because the add
   * handler is what resolves a selection into a playable item.
   */
  const handlePickerConfirm = useCallback(
    async (source: SourceLocation, selections: SelectedItem[]) => {
      const { launches } = resolvePickerConfirm(selections);
      const indexBeforeAdd = playlistSnapshotRef.current.length;
      return addThenMaybeLaunch({
        launches,
        add: () => handleAddFileSelections(source, selections),
        takeLaunchTarget: () => playlistSnapshotRef.current[indexBeforeAdd],
        launch: (item) =>
          runClaimedLaunch(playStartInFlightRef, setIsPlaylistLoading, () =>
            playItem(item, { playlistIndex: indexBeforeAdd }),
          ),
      });
    },
    [handleAddFileSelections, playItem, playlistSnapshotRef],
  );

  const handleCancelAddItems = useCallback(() => {
    addItemsAbortControllerRef.current?.abort();
  }, []);
  // Leaving Play unmounted it, and the import with it; the page is now kept, so leaving cancels the import instead.
  useOnPageLeft(handleCancelAddItems);

  const syncPlaybackTimeline = useCallback(
    (options?: { allowAutoAdvance?: boolean; shownAtMs?: number }) => {
      const allowAutoAdvance = (options?.allowAutoAdvance ?? true) && !isRemoteSidSeekBusy();
      if (!isPlaying || isPaused || currentIndex < 0) return;
      const now = Date.now();
      // On-device playback knows exactly where it is, so it — and not wall time — is the clock. See
      // `playheadAnchor`: every wait the renderer takes is a permanent offset otherwise, and the
      // auto-advance deadline computed from a clock that ran ahead cuts the tune off before its end.
      const controller = getSharedLocalSidPlaybackController();
      const localActive = controller.isActive();
      const awaitingSeek = localActive && controller.isSeeking();
      const anchor = resolvePlayheadAnchor({
        enginePositionMs: localActive ? controller.positionSeconds() * 1000 : null,
        trackStartedAtMs: trackStartedAtRef.current,
        nowMs: now,
        // Any seek, not only the one the progress bar reports. A seek that fell through to the
        // worker is silent and unannounced but every bit as deliberate, and letting the deadline run
        // down through it would skip the track the listener is waiting to hear.
        previousElapsedMs: anchoredElapsedRef.current,
        awaitingSeek,
      });
      if (anchor) {
        trackStartedAtRef.current = anchor.trackStartedAtMs;
        anchoredElapsedRef.current = anchor.elapsedMs;
        setElapsedMs(anchor.elapsedMs + Math.max(0, (options?.shownAtMs ?? now) - now));
        // Only when it actually moved, and never while the playhead is stuck. The first is because
        // this deadline is mirrored to the native background watchdog and rewriting it every second
        // would be constant bridge traffic for nothing. The second is the important one: the
        // deadline is what rescues a tune that has stopped producing audio, and re-deriving it from
        // a frozen playhead would push it into the future for ever — see `stalled`.
        const guard = autoAdvanceGuardRef.current;
        if (
          guard &&
          !guard.userCancelled &&
          currentDurationMsRef.current &&
          shouldRefreshDeadline(anchor, awaitingSeek, guard.dueAtMs - now)
        ) {
          const dueAtMs =
            now +
            seekAwareDelayMs(
              autoAdvanceDelayMs(currentDurationMsRef.current, anchor.elapsedMs, localActive),
              awaitingSeek,
            );
          guard.dueAtMs = dueAtMs;
          guard.autoFired = false;
          guard.deferredToEnd = false;
          setAutoAdvanceDueAtMs(dueAtMs);
        }
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
        void advanceOnTrackEnd(guard.trackInstanceId);
      }
    },
    [advanceOnTrackEnd, currentIndex, isPaused, isPlaying, playedClockRef],
  );
  const syncPlaybackTimelineRef = useRef(syncPlaybackTimeline);
  useEffect(() => {
    syncPlaybackTimelineRef.current = syncPlaybackTimeline;
  }, [syncPlaybackTimeline]);

  const tickTimeline = useCallback((shownAtMs: number) => syncPlaybackTimeline({ shownAtMs }), [syncPlaybackTimeline]);
  usePlaybackTimelineTicks({
    tick: tickTimeline,
    running: isPlaying && !isPaused && currentIndex >= 0,
    startedAtRef: trackStartedAtRef,
    autoAdvanceDueAtMs,
  });

  usePlaybackResumeTriggers(syncPlaybackTimeline);

  useEffect(() => {
    if (!isNativePlatform() || getPlatform() !== "android") return;
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | null = null;
    const registerBackgroundAutoSkipListener = async () => {
      try {
        const nextHandle = await onBackgroundAutoSkipDue((event) => {
          if (cancelled) return;
          if (isRemoteSidSeekBusy()) {
            addLog("info", "Background auto-advance left to the seek under way", { dueAtMs: event.dueAtMs });
            return;
          }
          syncPlaybackTimelineRef.current({ allowAutoAdvance: false });
          const guard = autoAdvanceGuardRef.current;
          const playbackState = playbackStateRef.current;
          if (!guard || !playbackState.isPlaying || playbackState.isPaused) return;
          if (event.dueAtMs !== guard.dueAtMs) return;
          const expectedTrackInstanceId = guard.trackInstanceId;
          void (async () => {
            try {
              await advanceOnTrackEndRef.current(expectedTrackInstanceId);
              if (cancelled) return;
              const nextGuard = autoAdvanceGuardRef.current;
              const outcome = resolveBackgroundAdvanceOutcome(expectedTrackInstanceId, nextGuard);
              if (!nextGuard || outcome === "in-flight" || outcome === "stuck") {
                if (outcome !== "in-flight") {
                  setAutoAdvanceDueAtMs(null);
                  await queueBackgroundDueAtUpdateRef.current(null);
                }
                addLog(
                  outcome === "stuck" ? "warn" : "debug",
                  BACKGROUND_ADVANCE_LOG_MESSAGES[outcome as "no-guard" | "in-flight" | "stuck"],
                  { expectedTrackInstanceId, dueAtMs: event.dueAtMs, nextDueAtMs: nextGuard?.dueAtMs ?? null },
                );
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
        // Caught, not fire-and-forget: an unhandled rejection here is reported as an app error by
        // the global handler, and a listener that cannot be removed is worth naming on its own.
        void handle.remove().catch((error: unknown) => {
          addLog("debug", "Play: removing the background auto-skip listener failed", {
            error: (error as Error)?.message ?? String(error),
          });
        });
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
    startPlaylist: (items) => stationHandover.startStationQueue(items),
    appendItems: (items) => stationHandover.appendStationItems(items),
    advanceToNext: handleNext,
    currentIndex,
    playlistLength: playlist.length,
    queueReady: playlistRestored && sessionRestoreSettled,
    // Lets the station leave out sound effects. HVSC carries jingles, one-shot effects and test
    // tones alongside the music, and a station that serves them between pieces reads as broken.
    // Which store answers, and why the order matters, is in `stationDurationResolver.ts`.
    resolveDurationSeconds: stationDurationResolver,
    // The station's `resolvePath` reads an index built as a side effect of loading the HVSC
    // songlengths, so the first refill has to wait for it or it burns every candidate it is given.
    ensureResolvable: ensureHvscSonglengthsReadyOnColdStart,
  });

  const sidRadioWhyThisTune = sidRadio.station ? whyThisTuneFor(sidRadio.station) : null;
  /**
   * The tune the launcher's mood choices apply to.
   *
   * An active Song station wins over whatever is playing right now: re-aiming that station keeps the
   * tune it was seeded by, so naming the current track here would describe the wrong seed.
   */
  /**
   * The corpus identity of whatever is playing, for "more like this".
   *
   * Two ways to get it, because the tracks that most often prompt the question are the ones the
   * first way cannot answer. Hashing the tune's bytes works for anything the app is holding a file
   * for, but a track a station served — or one found by name — is a path and a subsong, with no
   * blob attached until playback resolves one. The archive index turns that path straight into the
   * identity the corpus uses, which is both cheaper and available sooner.
   */
  const currentSeedMd548 =
    (currentTuneMd5 ? currentTuneMd5.slice(0, 12) : null) ??
    (currentItem?.path ? md548ForVirtualPath(currentItem.path) : null);
  const sidRadioSongSeedLabel =
    sidRadio.station?.seedKind === "song"
      ? sidRadio.station.seedLabel
      : !sidRadio.active && currentSeedMd548 && currentItem?.category === "sid"
        ? (currentItem.label ?? "this tune")
        : null;
  const sidRadioSeedIsHvscTune = isMd548InHvsc(currentSeedMd548);
  const startSidRadioSongMood = (styleBit: number | null) => {
    // Re-aim rather than restart while a Song station is running, so the seed survives the change of
    // mood; the hook holds the seed, which is also what makes this work for a resumed station.
    if (sidRadio.station?.seedKind === "song") {
      void sidRadio.setSongStationStyleFilter(styleBit);
      return;
    }
    if (!currentSeedMd548) return;
    void sidRadio.startSongRadio(currentSeedMd548, currentItem?.label ?? "this tune", styleBit);
  };
  const { setPlaybackContext, resolved: lightingResolved, openStudio, openContextLens } = useLightingStudio();
  const currentDurationMs = currentItem ? playlistItemDuration(currentItem, currentIndex) : undefined;
  const shownNowPlaying = useShownNowPlaying({ playlist, currentIndex, durationMs: currentDurationMs, playbackTime });
  const shownItem = shownNowPlaying.item;
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
    isPlaying,
    playlist.length,
    sourceKind,
    localAccessMode,
    trackInstanceId,
  ]);

  usePublishedPlaybackTrace(playbackTraceContext, playbackTime);
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
  const currentDurationLabel = formatTime(shownNowPlaying.durationMs);
  // While the user is scrubbing, the bar and the timer follow the FINGER rather
  // than the audio clock. The engine is deliberately behind — it is catching up
  // to the target in the background — and showing its position would make the
  // control feel dead for as long as a rewind takes to re-render.
  // Composer, year and SID chip count, read from the tune's own SID header. Every SID carries them,
  // so this works for every source rather than only the ones with a metadata database behind them; a
  // tune that leaves the fields blank simply shows nothing.
  //
  // The chip count is the authoritative one: `sidChipCount` comes from the second and third chip
  // address bytes, which is what the player itself obeys. It is only available where the file's
  // bytes are in hand, so a tune the app has not opened yet falls back to the file-name marker.
  const [currentItemCredits, setCurrentItemCredits] = useState<{
    itemId: string | null;
    author: string | null;
    released: string | null;
    chipCount: SidChipCount | null;
    /** One entry per chip the file addresses; a 2SID or 3SID may mix models. */
    sidModels: SidModel[];
    clock: SidClock | null;
  }>({
    itemId: null,
    author: null,
    released: null,
    chipCount: null,
    sidModels: [],
    clock: null,
  });
  useEffect(() => {
    let cancelled = false;
    setCurrentItemCredits({ itemId: null, author: null, released: null, chipCount: null, sidModels: [], clock: null });
    const file = shownItem?.request.file;
    if (!file || shownItem?.category !== "sid") return;
    void (async () => {
      try {
        const header = parseSidHeaderMetadata(new Uint8Array(await file.arrayBuffer()));
        if (cancelled) return;
        setCurrentItemCredits({
          itemId: shownItem.id,
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
          item: shownItem?.label,
          error: (error as Error)?.message ?? String(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shownItem?.id, shownItem?.request.file, shownItem?.category]);

  // How the tune is named on screen. `currentItem.label` stays the raw file name — the session
  // persistence, the playlist and every lookup still use it — and only what the transport draws
  // changes.
  const friendlySidNames = useFriendlySidNames();
  const currentDisplay = shownItem
    ? resolveTrackDisplayName({
        label: shownItem.label,
        category: shownItem.category,
        friendlyNames: friendlySidNames,
        chipCount: currentItemCredits.chipCount,
      })
    : null;
  useRecordRecentlyPlayed({
    trackInstanceId,
    item: currentItem,
    title: shownItem === currentItem ? currentDisplay?.title : undefined,
    credits: currentItemCredits,
  });

  /*
   * What the lock screen and the notification shade say is playing (HARD27-040).
   *
   * Handed over on every track change, and whether or not a background session is running: the
   * manager keeps the last tune and republishes it once a session starts, because the page names
   * the track in the commit before the one that starts playback.
   */
  const nowPlayingTitle = currentDisplay?.title ?? shownItem?.label ?? null;
  const nowPlayingArtist = currentItemCredits.author;
  const activePlayback = useActivePlayback();
  const localEngineActive = rendersOnPhone(playbackEngine.engine, activePlayback.local);
  const remoteSeek = useRemoteSidSeek({
    item: currentItem,
    active: !localEngineActive && (isPlaying || activePlayback.any),
    paused: isPaused,
    trackInstanceId,
    deviceInfo: status.deviceInfo,
    playbackTime,
    durationMs: currentDurationMs,
    rebasePlaybackPosition,
  });
  const onSeekToFraction = resolveSeekToFraction({
    category: currentItem?.category,
    remoteHandlers: remoteSeek.handlers,
    localEngineActive,
    durationMs: currentDurationMs,
    seekLocal: seekToFraction,
  });
  const shownScrubTargetMs = remoteSeek.targetMs ?? scrubTargetMs;
  const isScrubbing = shownScrubTargetMs !== null;
  currentDurationMsRef.current = currentDurationMs;
  /*
   * The auto-advance deadline used to be held still here, from the pending seek's target, on every
   * poll of this 500 ms loop. It no longer is, because the timeline tick already does it and does it
   * from the one place that knows: the engine's playhead, which sits exactly at the target for as
   * long as the wait lasts. Two mechanisms writing the same deadline is one too many, and this was
   * the expensive one — the deadline is mirrored to the native background watchdog, so a twenty
   * second wait spent forty bridge calls saying the same thing. See `playheadAnchor`.
   */
  useEffect(() => {
    // A new track starts its playhead at zero, which is not the previous track's playhead having
    // stopped. Forgetting the last reading here is what keeps that from reading as a stall.
    anchoredElapsedRef.current = null;
  }, [localEngineActive, currentItem?.id]);
  const { renderedSeconds, pendingSeekState, nowMs } = useLocalPendingSeek(localEngineActive, currentItem?.id, () =>
    syncPlaybackTimelineRef.current(),
  );
  const pendingSeek =
    localEngineActive && pendingSeekState
      ? (describePendingSeek({
          state: pendingSeekState,
          renderedSeconds: renderedSeconds ?? pendingSeekState.renderedAtRequestSeconds,
          durationMs: currentDurationMs ?? 0,
          nowMs,
        }) ?? undefined)
      : undefined;
  const renderedPercent =
    localEngineActive && renderedSeconds !== null && currentDurationMs
      ? Math.min(100, (renderedSeconds * 1000 * 100) / currentDurationMs)
      : undefined;

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

  const muteLocalOutput = useCallback(() => {
    getSharedLocalSidPlaybackController().setMuted(true);
    setLocalMuted(true);
  }, []);
  const soundingRoute = resolveSoundingRoute(playbackEngine.engine, status.state, activePlayback.local);
  useC64MuteFollowsRoute({
    route: soundingRoute,
    c64Mute: { volumeState, isManualMuteHeld, releaseManualMute },
    sidPlaying: isPlaying && currentItem?.category === "sid",
    muteHere: muteLocalOutput,
  });
  const canControlVolume = enabledSidVolumeItems.length > 0 && volumeSteps.length > 0;
  const volumeBinding = resolvePlaybackVolumeBinding({
    route: soundingRoute,
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

  const gameModeLeadsTransportRow = Boolean(currentItem && !isSongCategory(currentItem.category));
  // The transport row wraps rather than scrolls, and on the compact profile (320 CSS px
  // across) the full name pushes this button onto a line of its own. Compact-only; the
  // wider profiles keep "Game Mode".
  const playGameModeLabel = displayProfile === "compact" ? "Game" : "Game Mode";
  const playGameModeButton = (
    <Button
      variant="outline"
      size="sm"
      className={SHEET_OPENER_CLASS}
      data-testid="play-open-game-mode"
      onClick={() => void startGameMode()}
    >
      <Joystick className="mr-1.5 h-4 w-4" /> {playGameModeLabel}
    </Button>
  );
  const playRemoteInputButton = (
    <Button
      variant="outline"
      size="sm"
      className={SHEET_OPENER_CLASS}
      aria-label="Remote Input"
      data-testid="play-open-controller"
      onClick={() => setRemoteInputSheetOpen(true)}
    >
      <Keyboard className="mr-1.5 h-4 w-4" /> Input
    </Button>
  );
  /**
   * Put every tune in this file into the queue.
   *
   * A SID is a small album, and until now the app said so — "Tune 1 of 19" — while offering nothing
   * on the card that acted on it. Once they are ordinary playlist items, next, previous, shuffle,
   * repeat and the playlist panel all work on them unchanged, so this adds an action rather than a
   * surface. The tunes replace the item they came from, because that item is one of them.
   */
  const canPlayAllTunes = Boolean(
    currentItem &&
    isSongCategory(currentItem.category) &&
    knownSubsongCount &&
    knownSubsongCount >= MIN_TUNES_TO_EXPAND &&
    currentIndex >= 0 &&
    // Withdrawn once taken: expanding again would queue a second copy of all nineteen, and a
    // control that has already done its job is better removed than made to explain itself.
    !hasAllTunesQueued(playlist, currentItem.path, knownSubsongCount),
  );
  const playAllTunes = useCallback(async () => {
    const item = playlist[currentIndex];
    if (!item || !knownSubsongCount) return;
    // Each tune's own length, resolved before they go in. They differ wildly inside one file — a
    // nineteen-tune SID routinely holds a five-minute piece and a one-second jingle — and an item
    // with no length falls back to the three-minute default, so without this most of them would be
    // followed by minutes of silence.
    //
    // Read from the browse index, which carries the whole array. The songlength store answers per
    // file rather than per tune, so it can say how long the SID is but not how long tune twelve is.
    const isHvsc = item.request.source === "hvsc";
    // Both resolved before the expansion rather than after it, because both belong on the items the
    // expansion creates: their own length, so each tune ends when it ends rather than at the
    // three-minute default, and their own name, so nineteen rows are not nineteen copies of the
    // file name. Requested together so the expansion is one state change, not three.
    const [seconds, titles] = await Promise.all([
      isHvsc ? getHvscSubsongDurationsSeconds(item.path) : Promise.resolve<number[]>([]),
      isHvsc ? getHvscSubsongTitles(item.path, knownSubsongCount) : Promise.resolve<string[]>([]),
    ]);
    const durationsMs = seconds.map((value) => (typeof value === "number" && value > 0 ? value * 1000 : null));
    const { items, index } = expandSubsongs(playlist, currentIndex, knownSubsongCount, durationsMs, titles);
    if (items.length === playlist.length) return;
    void startPlaylist(items, index, { replaceQueue: true });
  }, [currentIndex, knownSubsongCount, playlist, startPlaylist]);
  // "More by this person" — the composer's name has been printed on the card all along without
  // doing anything, and the archive-wide search that answers it already exists.
  const openSearchForComposer = useCallback((composer: string) => {
    setHvscSearchSeed(composer);
    setHvscSearchOpen(true);
  }, []);
  // What the archive's editors say about this tune, as opposed to what its header declares. Only
  // HVSC has STIL, so anything played from a device, a local file or an archive resolves to nothing
  // without a lookup.
  const stilInfo = useStilInfo({
    virtualPath: shownItem?.request.source === "hvsc" ? shownItem.path : null,
    songNr: clampedSongNr ?? undefined,
  });
  // Everything the tune's own header says about itself, on one line under the title. The order and
  // the omission rules live in buildNowPlayingMetadataParts; this only supplies the fields.
  const currentItemMetadataParts = shownItem
    ? buildNowPlayingMetadataParts({
        author: currentItemCredits.author,
        released: currentItemCredits.released,
        sidModels: currentItemCredits.sidModels,
        clock: currentItemCredits.clock,
        tuneNumber: clampedSongNr,
        tuneCount: knownSubsongCount,
        lengthLabel: currentDurationLabel,
      })
    : [];

  useLockScreenPlayback({
    title: nowPlayingTitle,
    artist: nowPlayingArtist,
    durationMs: shownNowPlaying.durationMs ?? null,
    tuneNumber: clampedSongNr,
    tuneCount: knownSubsongCount,
    trackInstanceId,
    playing: isPlaying && !isPaused,
    playbackTime,
    onSeekToFraction,
  });

  const handleSongSelection = useCallback(
    async (nextSongNr: number) => {
      if (!currentItem || !isSongCategory(currentItem.category)) return;
      // Strip the previous subsong's resolved duration so playItem re-resolves
      // it for the new songNr; otherwise auto-advance fires at the wrong time
      // and the stale duration persists onto the playlist item (HARD11-004).
      const nextItem = buildSubsongSwitchItem(currentItem, nextSongNr, knownSubsongCount);
      setSongNrInput(String(nextItem.request.songNr));
      setTuneListOpen(false);
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

  // The list of a file's tunes belongs to the tune that is playing, so it closes with it.
  useEffect(() => {
    if (!isSongPlaying && tuneListOpen) {
      setTuneListOpen(false);
    }
  }, [isSongPlaying, tuneListOpen]);
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
  const playbackRunning = isPlaying || activePlayback.any;
  const localPlaybackRunning = isPlaying || activePlayback.local;
  const canPause = playbackRunning;

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
      setPlaylist((prev) => mergeResolvedSonglengthDurations(prev, updated));
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
        // HARD9-030: the full teardown, so the C64 stops a track the playlist no longer has and the
        // native auto-advance due-time is cleared.
        stopPlayback();
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
    [currentIndex, stopPlayback, isPaused, isPlaying, playlist],
  );

  useDemoPlaylistCleanup(playlist, removePlaylistItemsById);

  const handleRemoveSelectedPlaylist = useCallback(() => {
    if (!selectedPlaylistIds.size) return;
    removePlaylistItemsById(new Set(selectedPlaylistIds));
  }, [removePlaylistItemsById, selectedPlaylistIds]);

  const { readRepositoryPlaylist, playlistHydrated } = usePlaybackPersistence({
    playlist,
    setPlaylist,
    currentIndex,
    setCurrentIndex,
    isPlaying,
    setIsPlaying,
    isPaused,
    setIsPaused,
    playbackTime,
    durationMs,
    setDurationMs,
    setDurationMsItemId,
    autoAdvanceDueAtMs,
    setCurrentSubsongCount,
    setShuffleEnabled,
    setShuffleSeed,
    setShuffleAnchorId,
    setRepeatEnabled,
    shuffleEnabled,
    shuffleSeed,
    shuffleAnchorId,
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
    soundingTuneRef,
    setSoundingTune,
    trackInstanceIdRef,
    autoAdvanceGuardRef,
    setTrackInstanceId,
    setAutoAdvanceDueAtMs,
    playlistEnded,
    setPlaylistEnded,
    setSessionRestoreSettled,
  });
  useEffect(() => setPlaylistRestored(playlistHydrated), [playlistHydrated]);
  const stationHandover = useStationPlaylistHandover({
    queue: { playlist, setPlaylist, currentIndex, setCurrentIndex, selectedPlaylistIds, setSelectedPlaylistIds },
    playback: {
      isPlaying,
      isPaused,
      playlistEnded,
      isPlaylistLoading,
      startPlaylist,
      stopPlayback,
      stationActiveRef,
      stationFinishingRef,
    },
    persistence: { ready: playlistHydrated && sessionRestoreSettled, readSavedPlaylist: readRepositoryPlaylist },
    station: sidRadio,
  });
  // HARD12-005: Next/Prev enablement comes from the ordering the traversal uses. A station owns that
  // order until its last tune ends, and the traversal reads the same `stationOrdersQueue` flag.
  const traversalOrdering = resolveTraversalOrdering(
    { repeatEnabled, shuffleEnabled },
    stationHandover.stationOrdersQueue,
    stationFinishingRef.current,
  );
  const hasPrev = canAdvancePrevious(
    playlist,
    currentIndex,
    traversalOrdering.repeatEnabled,
    traversalOrdering.shuffleEnabled,
    shuffleSeed,
    shuffleAnchorId,
  );
  const hasNext = canAdvanceNext(
    playlist,
    currentIndex,
    traversalOrdering.repeatEnabled,
    traversalOrdering.shuffleEnabled,
    shuffleSeed,
    shuffleAnchorId,
  );

  useRestoreVolumeWhenPlaybackEnds({
    sessionRestoreSettled,
    isPlaying,
    isPaused,
    volumeSessionActiveRef,
    restoreVolumeOverrides,
  });

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
      leadMs:
        typeof durationMs === "number"
          ? crossfadeLeadMs(durationMs, getSharedLocalSidPlaybackController().isActive())
          : 0,
    });
    if (nextDueAtMs === null || !guard) return;
    guard.dueAtMs = nextDueAtMs;
    guard.autoFired = false;
    setAutoAdvanceDueAtMs(nextDueAtMs);
  }, [durationMs, isPaused, isPlaying, setAutoAdvanceDueAtMs]);

  const queryFilteredPlaylist = useQueryFilteredPlaylist({
    playlist,
    playlistStorageKey,
    playlistTypeFilters,
    query: playlistFilterText,
    previewLimit: listPreviewLimit,
  });
  const playlistLetterIndexSource = usePlaylistLetterIndexSource({
    playlist,
    playlistTypeFilters,
    query: playlistFilterText,
    ensureLoaded: queryFilteredPlaylist.ensureViewAllLoaded,
  });

  const effectivePlaylistItemDuration = useCallback(
    (item: PlaylistItem, index: number) => pendingDurationOverrideMs ?? playlistItemDuration(item, index),
    [pendingDurationOverrideMs, playlistItemDuration],
  );

  const playlistTotalsAt = usePlaylistTotals(playlist, effectivePlaylistItemDuration, {
    currentIndex: shownNowPlaying.index,
    shuffleEnabled: traversalOrdering.shuffleEnabled,
    shuffleSeed,
    shuffleAnchorId,
  });
  const timeline = usePlaybackTimeline(shownNowPlaying.time, {
    durationMs: shownNowPlaying.durationMs,
    launching: chosenTrackLaunching && shownNowPlaying.index === currentIndex,
    idle: !playbackRunning && !isPaused && shownNowPlaying.index === currentIndex,
    scrubTargetMs: shownScrubTargetMs,
    heldAtMs: pendingSeek?.audibleMs,
    playlistTotalsAt,
  });

  const previewFilteredPlaylist = queryFilteredPlaylist.previewPlaylist;
  const filteredPlaylist = queryFilteredPlaylist.viewAllPlaylist;
  const currentPlayingItemId = (isPlaying || isPaused) && shownNowPlaying.index >= 0 ? (shownItem?.id ?? null) : null;

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
      <PlayDeepLinks {...deepLinkHandlers} />
      <AppBar title="Play" />
      <PageContainer>
        <PageStack>
          <ProfileSplitSection minColumnWidth="22rem" testId="play-primary-layout">
            <div className="flex flex-col gap-4" data-testid="play-primary-column">
              <div
                className="bg-card border border-border rounded-panel p-4 space-y-4"
                data-section-label="Playback controls"
                data-testid="play-section-playback"
              >
                <PlaybackControlsCard
                  hasCurrentItem={Boolean(currentItem)}
                  currentItemLabel={currentDisplay?.title ?? null}
                  currentItemMetadataParts={currentItemMetadataParts}
                  tuneKey={currentItem ? `${currentItem.id}:${currentSongNr}` : null}
                  tuneShare={tuneShareForItem(shownItem, currentItemCredits, knownSubsongCount, currentDisplay?.title)}
                  stil={stilInfo}
                  onComposerSelected={openSearchForComposer}
                  {...((knownSubsongCount ?? 0) > 1 ? { onTunesSelected: () => setTuneListOpen(true) } : {})}
                  // Which station (or, when none is running, which playlist) is producing this tune
                  // leads the card: it is context for the title, the transport and everything else
                  // below it. Rendered in both states, and the same height in both, so that starting
                  // or stopping a station never shifts the controls underneath.
                  stationIndicator={
                    sidRadioFlags.sidRadioEnabled ? (
                      <SidRadioChip
                        station={sidRadio.station}
                        whyThisTune={sidRadioWhyThisTune}
                        collectionProgress={sidRadio.collectionProgress}
                        preparingCollection={sidRadio.preparingCollection}
                        onStop={stationHandover.requestStop}
                      />
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
                                void Promise.resolve(handleNext()).finally(() =>
                                  recordSkip(performance.now() - started),
                                );
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
                  isPaused={pauseShown}
                  hasPlaylist={hasPlaylist}
                  isPlaylistLoading={isPlaylistLoading}
                  canPause={canPause}
                  onPrevious={() => void handlePrevious()}
                  onPlay={() => void handlePlay()}
                  onStop={stopPlayback}
                  stopPending={stopPending}
                  stopping={stopping}
                  onPauseResume={() => void handlePauseResume()}
                  onNext={() => void handleNext()}
                  {...(remoteSeek.handlers ?? {
                    onSeek:
                      localEngineActive && currentItem?.category === "sid" && localPlaybackRunning
                        ? (deltaSeconds: number) => void handleSeekBy(deltaSeconds)
                        : undefined,
                    onScrubStart:
                      localEngineActive && currentItem?.category === "sid" && localPlaybackRunning
                        ? () => beginScrub(currentDurationMs)
                        : undefined,
                    onScrubStep: scrubBy,
                    onScrubEnd: () => void endScrub(),
                  })}
                  onSeekToFraction={onSeekToFraction}
                  isScrubbing={isScrubbing}
                  timeline={timeline}
                  seekDurationMs={currentDurationMs}
                  renderedPercent={renderedPercent}
                  pendingSeek={pendingSeek}
                  elapsedFollowsDeviceClock={remoteSeek.followsClock}
                  outputSelector={
                    playbackEngine.localEngineEnabled && currentItem?.category === "sid" ? (
                      <PlaybackEngineToggle />
                    ) : null
                  }
                  volumeControls={
                    <VolumeControls
                      {...volumeBinding}
                      previewIntervalMs={volumeSliderPreviewIntervalMs}
                      useNativeRangeInput={isAndroid}
                    />
                  }
                  shuffleSeed={shuffleSeed}
                  shuffleEnabled={shuffleEnabled}
                  onShuffleChange={(value) => {
                    if (value && sidRadio.active) stationHandover.requestShuffleQueue(() => setShuffleEnabled(true));
                    else setShuffleEnabled(Boolean(value));
                  }}
                  repeatOneEnabled={repeatOneEnabled}
                  onRepeatOneChange={setRepeatOneEnabled}
                  repeatEnabled={repeatEnabled}
                  onRepeatChange={(value) => setRepeatEnabled(Boolean(value))}
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
                      {/*
                       * First in the row, because it acts on the tune you are listening to rather than
                       * on what plays next. Shown only when the file actually holds more than one, so
                       * it never appears offering to do nothing.
                       */}
                      {canPlayAllTunes ? (
                        <Button
                          variant="outline"
                          size="sm"
                          data-testid="play-all-tunes"
                          title={`Add all ${subsongCount} tunes in this file to the playlist`}
                          onClick={() => void playAllTunes()}
                        >
                          <ListMusic className="mr-1.5 h-4 w-4" /> Play all {subsongCount} tunes
                        </Button>
                      ) : null}
                      {/*
                       * Offered whenever a SID is playing, including while a station is already
                       * running — which is exactly when people want it. Hearing something you like is
                       * what makes you want more of it, and a station is what produces that; requiring
                       * the listener to stop the station first, and so throw away the one tune that
                       * prompted them, made the obvious move the awkward one. Re-seeding is a single
                       * tap and needs no confirmation: the thing it replaces is a station, and starting
                       * another is the whole point of the control.
                       */}
                      {sidRadioFlags.sidRadioEnabled && currentSeedMd548 && currentItem?.category === "sid" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className={SHEET_OPENER_CLASS}
                          aria-label="More like this"
                          data-testid="sid-radio-start"
                          disabled={!sidRadioSeedIsHvscTune}
                          title={
                            sidRadioSeedIsHvscTune
                              ? `Start a station from ${currentDisplay?.title ?? "this tune"}`
                              : "Not available: this tune is not in the HVSC library."
                          }
                          onClick={() =>
                            void sidRadio.startSongRadio(currentSeedMd548, currentItem?.label ?? "this tune")
                          }
                        >
                          <RadioIcon className="mr-1.5 h-4 w-4" /> Similar
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
                            id="sid-radio-launcher"
                            className={SHEET_OPENER_CLASS}
                            aria-label="SID Radio"
                            data-testid="sid-radio-launcher"
                            onClick={() => {
                              void sidRadio.ensureStylePopulations();
                              setSidRadioLauncherOpen(true);
                            }}
                          >
                            <RadioIcon className="mr-1.5 h-4 w-4" /> Radio
                          </Button>
                          {/* A station chooses for you, which is the point of it right up until you
                            want one specific tune. Without this the only way to hear it was to stop
                            the station, drill through the composer folders in the picker to a tune
                            you could already name, and lose the station. */}
                          <Button
                            variant="outline"
                            size="sm"
                            id="hvsc-search-open"
                            className={SHEET_OPENER_CLASS}
                            aria-label="Find a tune"
                            data-testid="hvsc-search-open"
                            onClick={() => setHvscSearchOpen(true)}
                          >
                            <Search className="mr-1.5 h-4 w-4" /> Find
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            id="sid-radio-liked-tunes-open"
                            className={SHEET_OPENER_CLASS}
                            aria-label="Liked tunes"
                            data-testid="sid-radio-liked-tunes-open"
                            onClick={() => likedTunesSheet.set(true)}
                          >
                            <Heart className="mr-1.5 h-4 w-4" /> Liked
                          </Button>
                        </>
                      ) : null}
                      {/* A running program, cartridge or disk image is overwhelmingly likely to be
                        a game, so Game Mode leads the row there; a running tune is not, so it
                        follows Remote Input instead. */}
                      {remoteInputEnabled && isPlaying ? (
                        gameModeLeadsTransportRow ? (
                          <>
                            {gameModeAvailable ? playGameModeButton : null}
                            {playRemoteInputButton}
                          </>
                        ) : (
                          <>
                            {playRemoteInputButton}
                            {gameModeAvailable ? playGameModeButton : null}
                          </>
                        )
                      ) : null}
                    </div>
                    {sidRadioFlags.sidRadioEnabled && sidRadio.notice ? (
                      <p className="text-xs text-muted-foreground" data-testid="sid-radio-notice">
                        {SID_RADIO_NOTICE_TEXT[sidRadio.notice]}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {/* Above the panel's own settings rather than inside it: this is a decision about the
                  listening session, not about how a file is played, and it is the one control here
                  that has to be findable in the dark. */}
                <SleepTimerControl
                  mode={sleepTimer.mode}
                  onChange={sleepTimer.setMode}
                  nowMs={sleepTimer.nowMs}
                  isPlaying={isPlaying}
                />
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
                />
              </div>
              {lightingStudioEnabled && lightingResolved.sourceCue ? (
                <LightingAutomationCue
                  label={lightingResolved.sourceCue.label}
                  onOpenStudio={openStudio}
                  onOpenContextLens={openContextLens}
                />
              ) : null}
              <PlaybackSpectrumCard paused={isPaused} />
              <PlaybackSoundCard />
            </div>

            <div data-section-label="Playlist" data-testid="play-section-playlist">
              <PlaylistPanel
                previewItems={playlistPreviewListItems}
                viewAllItems={playlistViewAllListItems}
                totalItemCount={queryFilteredPlaylist.totalMatchCount}
                hiddenItemCount={queryFilteredPlaylist.hiddenByFilterCount}
                selectedCount={selectedPlaylistCount}
                allSelected={allPlaylistSelected}
                onToggleSelectAll={toggleSelectAllPlaylist}
                onRemoveSelected={handleRemoveSelectedPlaylist}
                maxVisible={listPreviewLimit}
                playlistTypeFilters={playlistTypeFilters}
                onToggleFilter={togglePlaylistTypeFilter}
                hasPlaylist={hasPlaylist}
                playlistLoading={!playlistHydrated}
                playlistItemCount={playlistIds.length}
                onAddItems={handleOpenAddItems}
                onClearPlaylist={() => {
                  // A running station tops the playlist up as it empties, so clearing it would
                  // be undone at once: clearing the playlist ends the station too.
                  sidRadio.stop();
                  removePlaylistItemsById(new Set(playlistIds));
                }}
                playlistFilterText={playlistFilterInputText}
                onPlaylistFilterTextChange={handlePlaylistFilterTextChange}
                hasMoreViewAllItems={queryFilteredPlaylist.hasMoreViewAllResults}
                onViewAllEndReached={queryFilteredPlaylist.loadMoreViewAllResults}
                letterIndexSource={playlistLetterIndexSource}
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
            confirmLabel={(selections) => resolvePickerConfirm(selections).label}
            initialSourceId={browserInitialSourceId}
            sourceGroups={sourceGroups}
            archiveConfigs={archiveConfigs}
            onAddLocalSource={async () => (await addSourceFromPicker(localSourceInputRef.current))?.id ?? null}
            onConfirm={handlePickerConfirm}
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
              <label className="flex min-h-11 items-center gap-2 text-xs">
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
            onOpenChange={(open) => {
              setHvscPreparationOpen(open);
              if (!open) setHvscPreparationForRadio(false);
            }}
            state={hvsc.hvscPreparationState}
            statusLabel={hvsc.hvscPreparationStatusLabel}
            failedPhase={hvsc.hvscPreparationFailedPhase}
            stage={hvsc.hvscStage}
            step={hvsc.hvscStageStep}
            stagePercent={hvsc.hvscStagePercent}
            stageDone={hvsc.hvscStageDone}
            stageTotal={hvsc.hvscStageTotal}
            throughputLabel={hvsc.hvscPreparationThroughputLabel}
            analyzing={hvsc.hvscAnalyzing}
            readySongCount={hvsc.hvscReadySongCount}
            errorReason={hvsc.hvscPreparationErrorReason}
            onBrowse={handleBrowsePreparedHvsc}
            browseLabel={hvscPreparationForRadio ? "Open SID Radio" : undefined}
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

          <LikedTunesSheetHost
            state={likedTunesSheet}
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
            collectionCounts={sidRadio.collectionCounts}
            onLoadCollectionCounts={sidRadio.ensureCollectionCounts}
            onStartCollection={(id) => void sidRadio.startCollectionRadio(id)}
            songSeedLabel={sidRadioSongSeedLabel}
            songStyleBit={sidRadio.station?.seedKind === "song" ? sidRadio.station.styleBit : null}
            songSeedInHvsc={sidRadio.station?.seedKind === "song" || sidRadioSeedIsHvscTune}
            onStartSong={startSidRadioSongMood}
            hvscMissing={!hvsc.hvscInstalled}
            onInstallHvsc={
              hvscControlsEnabled
                ? () => {
                    setHvscPreparationForRadio(true);
                    setHvscPreparationOpen(true);
                  }
                : undefined
            }
          />
          <TuneListSheet
            open={tuneListOpen}
            onOpenChange={setTuneListOpen}
            fileLabel={currentDisplay?.title ?? currentItem?.label ?? ""}
            virtualPath={currentItem?.request.source === "hvsc" ? currentItem.path : null}
            tuneCount={knownSubsongCount ?? 0}
            currentSongNr={clampedSongNr ?? 1}
            onSelectTune={(songNr) => {
              setTuneListOpen(false);
              void handleSongSelection(songNr);
            }}
          />

          <PlaySearchSheet
            open={hvscSearchOpen}
            onOpenChange={(open) => {
              setHvscSearchOpen(open);
              if (!open) setHvscSearchSeed(null);
            }}
            initialQuery={hvscSearchSeed}
            playlist={playlist}
            currentIndex={currentIndex}
            startPlaylist={startPlaylist}
            startSongRadio={sidRadio.startSongRadio}
            stationActive={sidRadio.active}
          />

          <PlaylistConfigDialogs
            pendingConfigChange={pendingConfigChange}
            onPendingConfigChangeConfirmed={(change) =>
              updatePlaylistItemConfigRef(change.itemId, change.configRef, {
                origin: change.origin,
                candidates: change.candidates,
                overrides: null,
              })
            }
            onPendingConfigChangeClosed={() => setPendingConfigChange(null)}
            unavailableConfigPrompt={unavailableConfigPrompt}
            onUnavailableConfigPromptClosed={() => setUnavailableConfigPrompt(null)}
          />

          <StationQueueEditedDialog {...stationHandover.editedPrompt} />

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
            <div data-testid="play-section-hvsc">
              <HvscManager hvscControlsEnabled={true} hvsc={hvsc} />
            </div>
          )}
        </PageStack>
      </PageContainer>
    </div>
  );
}
