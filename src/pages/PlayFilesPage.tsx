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
import { Button } from "@/components/ui/button";
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
import { useActionTrace } from "@/hooks/useActionTrace";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { reportUserError } from "@/lib/uiErrors";
import { getC64API } from "@/lib/c64api";
import type { TraceSourceKind } from "@/lib/tracing/types";
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
import { createArchiveSourceLocation } from "@/lib/sourceNavigation/archiveSourceAdapter";
import { createLocalSourceLocation, resolveLocalRuntimeFile } from "@/lib/sourceNavigation/localSourceAdapter";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { prepareDirectoryInput } from "@/lib/sourceNavigation/localSourcesStore";
import type { SelectedItem, SourceLocation } from "@/lib/sourceNavigation/types";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";

import { buildEnabledSidMuteUpdates } from "@/lib/config/sidVolumeControl";
import { getPlatform, isNativePlatform } from "@/lib/native/platform";
import { FolderPicker } from "@/lib/native/folderPicker";
import { redactTreeUri } from "@/lib/native/safUtils";
import { startBackgroundExecution, stopBackgroundExecution } from "@/lib/native/backgroundExecutionManager";
import { BackgroundExecution, onBackgroundAutoSkipDue } from "@/lib/native/backgroundExecution";

import { AppBar } from "@/components/AppBar";
import { usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";
import { FileOriginIcon } from "@/components/FileOriginIcon";
import { SOURCE_LABELS } from "@/lib/sourceNavigation/sourceTerms";
import { VolumeControls } from "@/pages/playFiles/components/VolumeControls";
import { PlaybackControlsCard } from "@/pages/playFiles/components/PlaybackControlsCard";
import { PlaybackSettingsPanel } from "@/pages/playFiles/components/PlaybackSettingsPanel";
import { PlaylistPanel } from "@/pages/playFiles/components/PlaylistPanel";
import { HvscManager } from "@/pages/playFiles/components/HvscManager";
import { PageContainer, PageStack, ProfileSplitSection } from "@/components/layout/PageContainer";
import { useHvscLibrary } from "@/pages/playFiles/hooks/useHvscLibrary";
import { shouldShowHvscControls } from "@/pages/playFiles/hvscControlsVisibility";
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
import { useArchiveClientSettings } from "@/pages/playFiles/hooks/useArchiveClientSettings";
import { useQueryFilteredPlaylist } from "@/pages/playFiles/hooks/useQueryFilteredPlaylist";
import { setPlaybackTraceSnapshot } from "@/pages/playFiles/playbackTraceStore";
import { createAddFileSelectionsHandler } from "@/pages/playFiles/handlers/addFileSelections";
import { resolveVolumeSyncDecision } from "@/pages/playFiles/playbackGuards";
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
import { useLightingStudio } from "@/hooks/useLightingStudio";
import { LightingAutomationCue } from "@/components/lighting/LightingStudioDialog";
import {
  CATEGORY_OPTIONS,
  DEFAULT_SONG_DURATION_MS,
  DURATION_SLIDER_STEPS,
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
} from "@/pages/playFiles/playFilesUtils";

export default function PlayFilesPage() {
  type AutoAdvanceGuard = {
    trackInstanceId: number;
    dueAtMs: number;
    autoFired: boolean;
    userCancelled: boolean;
  };

  type ConfigPickerState =
    | { itemId: string; sourceType: "ultimate" }
    | { itemId: string; sourceType: "local"; sourceId: string };

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
  const [playlistFilterText, setPlaylistFilterText] = useState("");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playedMs, setPlayedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
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
  const [addItemsProgress, setAddItemsProgress] = useState<AddItemsProgressState>({
    status: "idle",
    count: 0,
    elapsedMs: 0,
    total: null,
    message: null,
  });
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
  const { archiveConfig, commoserveEnabled } = useArchiveClientSettings();

  const {
    volumeSliderPreviewIntervalMs,
    volumeState,
    dispatchVolume,
    volumeSteps,
    sidEnablement,
    enabledSidVolumeItems,
    resolveEnabledSidVolumeItems,
    restoreVolumeOverrides,
    applyAudioMixerUpdates,
    pauseMuteSnapshotRef,
    pausingFromPauseRef,
    volumeSessionActiveRef,
    captureSidMuteSnapshot,
    snapshotToUpdates,
    handleVolumeLocalChange,
    handleVolumeAsyncChange,
    handleVolumeCommit,
    handleToggleMute,
    resumingFromPauseRef,
    ensureUnmuted,
  } = usePlayFilesVolumeBindings({ isPlaying, isPaused });
  const volumeIndex = volumeState.index;
  const volumeMuted = volumeState.muted;

  const { hvscStatus, hvscRoot, hvscLibraryAvailable, buildHvscLocalPlayFile } = useHvscLibrary();

  const { localEntriesBySourceId, localSourceTreeUris } = useLocalEntries(localSources);

  const localSourceInputRef = useRef<HTMLInputElement | null>(null);
  const localConfigInputRef = useRef<HTMLInputElement | null>(null);
  const songlengthsInputRef = useRef<HTMLInputElement | null>(null);
  const trackStartedAtRef = useRef<number | null>(null);
  const playedClockRef = useRef(new PlaybackClock());
  const addItemsStartedAtRef = useRef<number | null>(null);
  const pendingLocalConfigItemIdRef = useRef<string | null>(null);

  const playTransitionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const playStartInFlightRef = useRef(false);
  const trackInstanceIdRef = useRef(0);
  const [trackInstanceId, setTrackInstanceId] = useState(0);
  const autoAdvanceGuardRef = useRef<AutoAdvanceGuard | null>(null);
  const [autoAdvanceDueAtMs, setAutoAdvanceDueAtMs] = useState<number | null>(null);
  const backgroundExecutionActiveRef = useRef(false);
  const [configPickerState, setConfigPickerState] = useState<ConfigPickerState | null>(null);
  const [activeConfigItemId, setActiveConfigItemId] = useState<string | null>(null);
  const [pendingConfigChange, setPendingConfigChange] = useState<PendingConfigChangeState | null>(null);
  const [unavailableConfigPrompt, setUnavailableConfigPrompt] = useState<UnavailableConfigPromptState | null>(null);

  useEffect(() => {
    prepareDirectoryInput(localSourceInputRef.current);
  }, []);

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
    deviceProduct: status.deviceInfo?.product ?? null,
    ensurePlaybackConnection,
    resolveSonglengthDurationMsForPath,
    applySonglengthsToItems,
    archiveConfigs,
    restoreVolumeOverrides,
    applyAudioMixerUpdates,
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
        });
      });
      void BackgroundExecution.setDueAtMs({ dueAtMs: autoAdvanceDueAtMs });
      return;
    }
    if (!backgroundExecutionActiveRef.current) return;
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
      });
    });
    void BackgroundExecution.setDueAtMs({ dueAtMs: null });
  }, [autoAdvanceDueAtMs, isPaused, isPlaying, trackInstanceId]);

  useEffect(
    () => () => {
      if (!backgroundExecutionActiveRef.current) return;
      backgroundExecutionActiveRef.current = false;
      void stopBackgroundExecution({
        source: "playback-controller",
        reason: "cleanup",
        context: { trackInstanceId },
      }).catch((error) => {
        reportUserError({
          operation: "stopBackgroundExecution",
          title: "Background playback cleanup failed",
          description: "Background playback guard could not be fully stopped.",
          error,
          context: { trackInstanceId, reason: "cleanup" },
        });
      });
      void BackgroundExecution.setDueAtMs({ dueAtMs: null });
    },
    [trackInstanceId],
  );

  useEffect(() => {
    if (!backgroundExecutionActiveRef.current) return;
    if (!isNativePlatform() || getPlatform() !== "android") return;
    void BackgroundExecution.setDueAtMs({ dueAtMs: autoAdvanceDueAtMs });
  }, [autoAdvanceDueAtMs]);

  useEffect(() => {
    if (addItemsProgress.status !== "scanning") return undefined;
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

  useImportNavigationGuards(isImportNavigationBlocked);

  const resolvedDeviceId = useResolvedPlaybackDeviceId(deviceInfoId);
  const playlistStorageKey = useMemo(() => buildPlaylistStorageKey(resolvedDeviceId), [resolvedDeviceId]);

  useEffect(() => {
    if (browserOpen) return;
    if (addItemsProgress.status === "scanning") return;
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
    if (hvscLibraryAvailable) {
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
  }, [archiveConfig, commoserveEnabled, hvscLibraryAvailable, hvscRoot.path, localSources]);

  const handleLocalSourceInput = useCallback(
    (files: FileList | File[] | null) => {
      if (!files || (Array.isArray(files) ? files.length === 0 : files.length === 0)) return;
      addSourceFromFiles(files);
    },
    [addSourceFromFiles],
  );

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
        file: entry.file,
        songNr: Number.isNaN(songNrValue) ? undefined : songNrValue,
      };
      const resolvedSourceId = entry.sourceId ?? (entry.source === "hvsc" ? "hvsc-library" : null);
      const idParts = [entry.source, resolvedSourceId ?? ""];
      return {
        id: `${idParts.join(":")}:${entry.path}`,
        request,
        category,
        label: entry.name,
        path: entry.path,
        configRef: entry.configRef ?? null,
        configOrigin: entry.configOrigin ?? resolveStoredConfigOrigin(entry.configRef ?? null, null),
        configOverrides: entry.configOverrides ?? null,
        configCandidates: entry.configCandidates ?? null,
        configPreview: entry.configPreview ?? null,
        archiveRef: entry.archiveRef ?? null,
        durationMs: entry.durationMs,
        subsongCount: entry.subsongCount,
        sourceId: resolvedSourceId,
        sizeBytes: entry.sizeBytes ?? null,
        modifiedAt: entry.modifiedAt ?? null,
        addedAt: addedAtOverride ?? new Date().toISOString(),
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

  const syncPlaybackTimeline = useCallback(() => {
    if (!isPlaying || isPaused || currentIndex < 0) return;
    const now = Date.now();
    if (trackStartedAtRef.current) {
      setElapsedMs(now - trackStartedAtRef.current);
    }
    setPlayedMs(playedClockRef.current.current(now));
    const guard = autoAdvanceGuardRef.current;
    if (guard && !guard.autoFired && !guard.userCancelled && now >= guard.dueAtMs) {
      addLog("debug", "Auto-advance due guard fired on timeline reconciliation", {
        trackInstanceId: guard.trackInstanceId,
        dueAtMs: guard.dueAtMs,
        nowMs: now,
        overdueMs: now - guard.dueAtMs,
      });
      void handleNext("auto", guard.trackInstanceId);
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
    if (!isNativePlatform() || getPlatform() !== "android") return;
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
  const progressPercent = currentDurationMs ? Math.min(100, (elapsedMs / currentDurationMs) * 100) : 0;
  const remainingMs = currentDurationMs !== undefined ? Math.max(0, currentDurationMs - elapsedMs) : undefined;
  const remainingLabel = currentDurationMs !== undefined ? `-${formatTime(remainingMs)}` : "—";
  const canControlVolume = enabledSidVolumeItems.length > 0 && volumeSteps.length > 0;
  const volumeLabel = volumeSteps[volumeIndex]?.label ?? "—";
  const knownSubsongCount =
    currentSubsongCount ?? (typeof currentItem?.subsongCount === "number" ? currentItem.subsongCount : null);
  const subsongCount = knownSubsongCount ?? 1;
  const currentSongNr = currentItem?.request.songNr ?? 1;
  const clampedSongNr = Math.min(Math.max(1, currentSongNr), subsongCount);
  const isSongPlaying = Boolean(currentItem && isSongCategory(currentItem.category) && (isPlaying || isPaused));
  const songSelectorVisible = Boolean(isSongPlaying && knownSubsongCount && knownSubsongCount > 1);

  const handleSongSelection = useCallback(
    async (nextSongNr: number) => {
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
    },
    [currentIndex],
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
    setCurrentSubsongCount,
    shuffleEnabled,
    repeatEnabled,
    activePlaylistQuery: playlistFilterText,
    setActivePlaylistQuery: setPlaylistFilterText,
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

  useEffect(
    () => () => {
      void restoreVolumeOverrides("navigate").catch((error) => {
        addErrorLog("Volume restore failed during navigation", {
          error: (error as Error).message,
        });
      });
    },
    [restoreVolumeOverrides],
  );

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

  const queryFilteredPlaylist = useQueryFilteredPlaylist({
    playlist,
    playlistStorageKey,
    playlistTypeFilters,
    query: playlistFilterText,
    previewLimit: listPreviewLimit,
  });

  const playlistTotals = useMemo(() => {
    const durations = playlist.map((item, index) => playlistItemDuration(item, index));
    return calculatePlaylistTotals(durations, playedMs);
  }, [playlist, playedMs, playlistItemDuration]);

  const previewFilteredPlaylist = queryFilteredPlaylist.previewPlaylist;
  const filteredPlaylist = queryFilteredPlaylist.viewAllPlaylist;
  const currentPlayingItemId =
    (isPlaying || isPaused) && currentIndex >= 0 ? (playlist[currentIndex]?.id ?? null) : null;

  const playlistPreviewListItems = usePlaylistListItems({
    filteredPlaylist: previewFilteredPlaylist,
    playlist,
    selectedPlaylistIds,
    isPlaylistLoading,
    handlePlaylistSelect,
    onAttachLocalConfig: (item) => void handleAttachLocalConfig(item),
    onAttachUltimateConfig: handleAttachUltimateConfig,
    onOpenConfig: (item) => setActiveConfigItemId(item.id),
    onRemoveConfig: handleRemoveConfig,
    startPlaylist,
    playlistItemDuration,
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
    onAttachLocalConfig: (item) => void handleAttachLocalConfig(item),
    onAttachUltimateConfig: handleAttachUltimateConfig,
    onOpenConfig: (item) => setActiveConfigItemId(item.id),
    onRemoveConfig: handleRemoveConfig,
    startPlaylist,
    playlistItemDuration,
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
          {lightingResolved.sourceCue ? (
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
              <PlaybackControlsCard
                hasCurrentItem={Boolean(currentItem)}
                currentItemIcon={
                  currentItem ? (
                    <FileOriginIcon
                      origin={
                        currentItem.request.source === "ultimate"
                          ? "ultimate"
                          : currentItem.request.source === "hvsc"
                            ? "hvsc"
                            : currentItem.request.source === "commoserve"
                              ? "commoserve"
                              : "local"
                      }
                      className="h-3.5 w-3.5 shrink-0 opacity-70"
                    />
                  ) : undefined
                }
                currentItemLabel={currentItem?.label ?? null}
                currentDurationLabel={currentDurationLabel}
                subsongLabel={
                  knownSubsongCount && knownSubsongCount > 1 ? `Subsong ${clampedSongNr}/${subsongCount}` : null
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
                progressPercent={progressPercent}
                elapsedLabel={formatTime(elapsedMs)}
                remainingLabel={remainingLabel}
                totalLabel={formatTime(playlistTotals.total)}
                remainingTotalLabel={formatTime(playlistTotals.remaining)}
                volumeControls={
                  <VolumeControls
                    volumeMuted={volumeMuted}
                    canControlVolume={canControlVolume}
                    isPending={updateConfigBatch.isPending}
                    onToggleMute={() => {
                      void handleToggleMute().catch((error) => {
                        addErrorLog("Mute toggle failed", {
                          error: (error as Error).message,
                        });
                        reportUserError({
                          operation: "PLAYBACK_MUTE_TOGGLE",
                          title: "Mute toggle failed",
                          description: (error as Error).message,
                          error,
                        });
                      });
                    }}
                    volumeStepsCount={volumeSteps.length}
                    volumeIndex={volumeIndex}
                    onVolumeChange={handleVolumeLocalChange}
                    onVolumeChangeAsync={handleVolumeAsyncChange}
                    onVolumeCommit={(value) => void handleVolumeCommit(value)}
                    previewIntervalMs={volumeSliderPreviewIntervalMs}
                    volumeLabel={volumeLabel}
                    volumeValueFormatter={(value) => volumeSteps[Math.round(value)]?.label ?? "—"}
                  />
                }
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
                onAddItems={() => setBrowserOpen(true)}
                onClearPlaylist={() => removePlaylistItemsById(new Set(playlistIds))}
                playlistFilterText={playlistFilterText}
                onPlaylistFilterTextChange={setPlaylistFilterText}
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
                const selected = event.currentTarget.files ? Array.from(event.currentTarget.files) : [];
                handleLocalSourceInput(selected.length ? selected : null);
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
            onOpenChange={setBrowserOpen}
            title="Add items"
            confirmLabel="Add to playlist"
            sourceGroups={sourceGroups}
            archiveConfigs={archiveConfigs}
            onAddLocalSource={async () => (await addSourceFromPicker(localSourceInputRef.current))?.id ?? null}
            onConfirm={handleAddFileSelections}
            filterEntry={(entry) => entry.type === "dir" || isSupportedPlayFile(entry.path)}
            allowFolderSelection
            isConfirming={isAddingItems}
            progress={addItemsProgress}
            showProgressFooter={addItemsSurface === "dialog"}
            autoConfirmCloseBefore={isAndroid}
            onAutoConfirmStart={handleAutoConfirmStart}
            autoConfirmLocalSource
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
            />
          ) : null}

          {hvscControlsEnabled && (
            <div data-section-label="HVSC" data-testid="play-section-hvsc">
              <HvscManager hvscControlsEnabled={true} />
            </div>
          )}
        </PageStack>
      </PageContainer>
    </div>
  );
}
