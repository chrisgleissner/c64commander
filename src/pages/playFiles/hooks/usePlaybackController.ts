/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createArchiveClient } from "@/lib/archive/client";
import { getCachedArchivePlayback, setCachedArchivePlayback } from "@/lib/archive/archivePlaybackCache";
import { buildArchivePlayPlan } from "@/lib/archive/execution";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import { getC64API } from "@/lib/c64api";
import type { PlaybackLaunchOrigin } from "@/lib/remoteInput/gameModeLaunch";
import { beginMachineTransition } from "@/lib/deviceInteraction/deviceActivityGate";
import {
  getMachineExecutionSnapshot,
  setMachineExecutionPaused,
  setMachineExecutionRunning,
  subscribeMachineExecution,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { subscribeMachineTakeover } from "@/lib/deviceInteraction/machineTakeoverEvent";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";
import {
  createMachineTransitionCoordinator,
  SupersededMachineTransitionError,
} from "@/lib/deviceInteraction/machineTransitionCoordinator";
import { addErrorLog, addLog } from "@/lib/logging";
import { DEVICE_NOT_CONNECTED_MESSAGE, reportUserError } from "@/lib/uiErrors";
import { toast } from "@/hooks/use-toast";
import {
  buildPlayPlan,
  executePlayPlan,
  getRememberedUltimateSidBlob,
  PlaybackLaunchOvertakenError,
  type LocalPlayFile,
  type PlayRequest,
} from "@/lib/playback/playbackRouter";
import { isPlaybackErrorReported, markPlaybackErrorReported } from "@/pages/playFiles/playbackErrorReported";
import {
  isLaunchOvertaken,
  isSongCategory,
  resolveLaunchedItemIndex,
  resolvePlayTargetIndex,
  tryAcquireSingleFlight,
  releaseSingleFlight,
} from "@/pages/playFiles/playFilesUtils";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";
import { endPlayLaunchMounts } from "@/lib/playback/playLaunchMounts";
import { buildLocalPlayFileFromUri, buildLocalPlayFileFromTree } from "@/lib/playback/fileLibraryUtils";
import { stopRequiresReboot } from "@/lib/playback/fileTypes";
import { loadMirrorC64Audio, loadPlaybackEngine } from "@/lib/config/appSettings";
import {
  LocalSidPlaybackController,
  getSharedLocalSidPlaybackController,
} from "@/lib/playback/localSidPlaybackController";
import {
  isAnyPlaybackActive,
  isLocalPlaybackActive,
  markRemotePlaybackStarted,
  markRemotePlaybackStopped,
  stopRemoteTuneBeforeLocalPlayback,
} from "@/lib/playback/activePlaybackSession";
import { LocalEngineStatsAccumulator } from "@/lib/playback/localEngineStatsBridge";
import { buildRenderedTuneKey } from "@/lib/playback/renderedTuneCache";
import { playPassingOver, type RomDependencyDecider } from "@/pages/playFiles/resolveLocalRoute";
import { rejectRefusedLaunch } from "@/pages/playFiles/refusedLaunch";
import { reportPlaybackStartFailure } from "@/pages/playFiles/reportPlaybackStartFailure";
import { resolveLaunchRoute } from "@/pages/playFiles/resolveLaunchRoute";
import { probeSidRenderers } from "@/lib/playback/sidRenderer/sidRendererAvailability";
import { toEngineTuneIndex } from "@/lib/playback/sidTuneIndex";
import { seekPlaybackClocks } from "@/lib/playback/playbackClock";
import type { PlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import { cancelRemoteSidSeek, isRemoteSidSeekBusy } from "@/lib/playback/remoteSeek/activeRemoteSidSeek";
import { resolveTraversalOrdering } from "@/pages/playFiles/stationOrdering";
import { updateSidRadioStats } from "@/lib/sidRadio/sidRadioStats";
import { getConnectionSnapshot } from "@/lib/connection/connectionManager";
import { identifiedDeviceStreams } from "@/lib/deviceCapabilities";
import { isNetworkKnownOffline } from "@/lib/connection/networkStatusWatch";
import { ENGINE_FALLBACK_MESSAGES, type EngineFallbackNotice } from "@/lib/playback/playbackEngineRouting";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { resolvePendingSkipIndices, type PendingUserSkip } from "@/pages/playFiles/pendingUserSkip";
import { mergeStartedPlaylist } from "@/pages/playFiles/startPlaylistMerge";
import { useRemotePlaybackHandover } from "@/pages/playFiles/hooks/useRemotePlaybackHandover";
import { usePlaybackEngineSwitch } from "@/pages/playFiles/hooks/usePlaybackEngineSwitch";
import {
  firstPlayableWithoutDevice,
  isDeviceOutOfReach,
  reachableFollowing,
} from "@/pages/playFiles/playableWithoutDevice";
import { noteRestartedPhoneTune, takeRestartedPhoneTune } from "@/lib/playback/playbackSessionStore";
import { useNextTunePrefetch } from "@/pages/playFiles/hooks/useNextTunePrefetch";
import { resolveUltimateSidDurationByMd5 } from "@/pages/playFiles/sidBytesAhead";
import { autoAdvanceDelayMs, crossfadeLeadMs, deferralToTuneEndMs } from "@/pages/playFiles/crossfadeLead";
import { resumedTrackStartedAtMs, usePlaylistEnded } from "@/pages/playFiles/hooks/usePlaylistEnded";
import { resolveLocalSidMetadata } from "@/pages/playFiles/resolveLocalSidMetadata";
import { isChosenTrackLaunching, resolveShownItemDurationMs } from "@/pages/playFiles/shownTrackDuration";
import { firmwareOverridesItemConfig } from "@/lib/config/firmwareConfigLaunch";
import {
  applyConfigFileReference,
  ensureConfigFileReferenceAccessible,
  isConfigReferenceUnavailableError,
} from "@/lib/config/applyConfigFileReference";
import { cancelActiveConfigApply, isConfigApplyCancelledError } from "@/lib/config/configApplyCancellation";
import { buildPlaybackConfigSignature, resolveStoredConfigOrigin } from "@/lib/config/playbackConfig";
import { createPlaylistTraversal, type AudioMixerItem } from "@/pages/playFiles/playFilesUtils";
import type { VolumeAction } from "@/pages/playFiles/volumeState";
import type { SidEnablement } from "@/lib/config/sidVolumeControl";
import { avMirrorSession } from "@/lib/streams/avMirrorSession";
import { featureFlagManager } from "@/lib/config/featureFlags";
import { usePauseMute, type SidMuteSnapshot } from "@/pages/playFiles/hooks/usePauseMute";

type AutoAdvanceGuard = {
  trackInstanceId: number;
  dueAtMs: number;
  autoFired: boolean;
  userCancelled: boolean;
  deferredToEnd?: boolean;
};

type RuntimePlaybackRequest = {
  request: PlayRequest;
  path: string;
};

export const USER_TRANSPORT_COALESCE_MS = 120;

/**
 * How often the on-device engine's stats are mirrored to the SID Radio blob
 * (§12.6). The HIL samples the blob every 2 s, so 1 s keeps it fresh without
 * putting a needless timer on the main thread during local playback.
 */
const LOCAL_ENGINE_STATS_POLL_MS = 1000;

/**
 * How long the scrub release waits for a catch-up seek that is still in flight
 * before landing anyway. Generous next to a normal seek (a pre-rendered tune
 * seeks in well under a second) and short enough that a wedged engine costs the
 * user a moment rather than the rest of the session.
 */
const SCRUB_RELEASE_WAIT_MS = 3000;

/** How long after the last drag movement the bar commits to that position. */
const DRAG_SETTLE_MS = 220;

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

  playbackTime: PlaybackTimeStore;
  durationMs: number | undefined;
  setDurationMs: (v: number | undefined) => void;
  setCurrentSubsongCount: (v: number | null) => void;
  setTrackInstanceId: (v: number) => void;

  repeatOneEnabled?: boolean;
  stationFinishingRef?: { current: boolean };
  repeatEnabled: boolean;
  shuffleEnabled: boolean;
  /**
   * Whether a SID Radio station is choosing the tracks, read at the moment a skip is resolved.
   *
   * A ref rather than a value because the station hook is created after this one and depends on the
   * handlers it returns, so the flag cannot be passed in as a prop without reordering the two.
   */
  stationActiveRef?: { readonly current: boolean };
  shuffleSeed: number | null;
  shuffleAnchorId?: string | null;

  // Dependencies
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
  buildHvscLocalPlayFile?: (path: string, name: string) => LocalPlayFile | null | undefined;
  deviceProduct?: string | null;
  ensurePlaybackConnection: () => Promise<void>;
  resolveUnavailableConfigDecision?: (
    item: PlaylistItem,
    context: { configFileName: string | null; reason: string },
  ) => Promise<"play-without-config" | "cancel">;
  /** Asks the listener about a chosen song that needs the C64 ROMs. Absent: such a song is not played. */
  resolveRomDependencyDecision?: RomDependencyDecider;
  /**
   * A track the USER asked for has actually launched. Never fires for a playlist
   * moving on by itself, and never for a launch that failed.
   */
  onUserLaunchedItem?: (item: PlaylistItem) => void;
  resolveSonglengthDurationMsForPath: (
    path: string,
    file: LocalPlayFile | null,
    songNr: number | null,
  ) => Promise<number | null>;
  applySonglengthsToItems: (items: PlaylistItem[]) => Promise<PlaylistItem[]>;
  archiveConfigs?: Record<string, ArchiveClientConfigInput>;

  // Volume Control
  restoreVolumeOverrides: (reason: string) => Promise<void>;
  applyAudioMixerUpdates: (updates: Record<string, string | number>, reason: string) => Promise<void>;
  enabledSidVolumeItems: AudioMixerItem[];
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
  pausingFromPauseRef: MutableRefObject<boolean>;
  resumingFromPauseRef: MutableRefObject<boolean>;
  ensureUnmuted: (options?: { force?: boolean; refreshItems?: boolean }) => Promise<void>;
  /** Whether the listener's own Mute is on, which a pause must hand back rather than undo. */
  isManualMuteHeld: () => boolean;

  // Refs
  // HARD12-007: the second parameter is `reset` (zero the cumulative base), not `playing`.
  playedClockRef: MutableRefObject<{
    start: (now: number, reset?: boolean) => void;
    stop: (now: number, reset?: boolean) => void;
    pause: (now: number) => void;
    resume: (now: number) => void;
    reset: () => void;
    /** Move the clock to an absolute position; used by seek. */
    hydrate: (baseMs: number, startedAt: number | null) => void;
    current: (now: number) => number;
  }>;
  trackStartedAtRef: MutableRefObject<number | null>;
  soundingTuneRef: MutableRefObject<PlaylistItem | null>;
  soundingTune: PlaylistItem | null;
  setSoundingTune: (tune: PlaylistItem | null) => void;
  trackInstanceIdRef: MutableRefObject<number>;
  autoAdvanceGuardRef: MutableRefObject<AutoAdvanceGuard | null>;
  playStartInFlightRef: MutableRefObject<boolean>;

  cancelAutoAdvance: () => void;
  enqueuePlayTransition: (task: () => Promise<void>) => Promise<void>;
  durationSeconds: number; // for fallback

  setAutoAdvanceDueAtMs: (dueAtMs: number | null) => void;

  trace: any;

  /**
   * Local SID playback engine (Track B / LE2). Injected in tests; created
   * lazily in production. Playback routes here for SID items only when
   * `c64u_local_engine_enabled` is on and the engine is set to `local`.
   */
  localSidPlaybackController?: LocalSidPlaybackController;
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
  playbackTime,
  durationMs,
  setDurationMs,
  setCurrentSubsongCount,
  repeatOneEnabled = false,
  stationFinishingRef,
  repeatEnabled,
  shuffleEnabled,
  stationActiveRef,
  shuffleSeed,
  shuffleAnchorId,
  localEntriesBySourceId,
  localSourceTreeUris,
  buildHvscLocalPlayFile,
  deviceProduct,
  ensurePlaybackConnection,
  resolveUnavailableConfigDecision,
  resolveRomDependencyDecision,
  onUserLaunchedItem,
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
  resumingFromPauseRef,
  ensureUnmuted,
  isManualMuteHeld,
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
  setTrackInstanceId,
  setAutoAdvanceDueAtMs,
  localSidPlaybackController,
}: UsePlaybackControllerProps) {
  const durationFallbackMs = durationSeconds * 1000;
  const machineTransitionCoordinatorRef = useRef(createMachineTransitionCoordinator());
  /** What the latest pause tap asked for while its transition runs; null when none runs. */
  const requestedPauseRef = useRef<boolean | null>(null);
  // Shown on the button from the tap on: the machine takes a second or two to answer, and a button that had
  // not changed by then drew a second tap, which undid the first.
  const [requestedPause, setRequestedPause] = useState<boolean | null>(null);
  const pauseRequestRef = useRef(0);
  const localPauseChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const lastAppliedPlaybackConfigSignatureRef = useRef<string | null>(null);
  const sessionDeclinedPlaybackConfigRef = useRef(new Map<string, string>());
  const playlistRef = useRef(playlist);
  // Held in a ref so the caller can pass an inline arrow without rebuilding playItem,
  // which is memoised over a long dependency list.
  const onUserLaunchRef = useRef(onUserLaunchedItem);
  onUserLaunchRef.current = onUserLaunchedItem;
  const currentIndexRef = useRef(currentIndex);
  const isPlayingRef = useRef(isPlaying);
  const isPausedRef = useRef(isPaused);
  // Track B (LE2): the on-device engine, created lazily on the first SID played on the device.
  const localSidPlaybackRef = useRef<LocalSidPlaybackController | null>(localSidPlaybackController ?? null);
  // True while the current track is playing on the device (no C64 to stop).
  const currentPlaybackIsLocalRef = useRef(false);
  // Mirrors the ref as state so the §12.6 stats poll below can start/stop with
  // on-device playback (a ref alone would never re-run the effect).
  const [localEngineActive, setLocalEngineActive] = useState(false);
  const localEngineStatsRef = useRef(new LocalEngineStatsAccumulator());
  /** Last engine seen, to tell an engine change from any other settings change. */
  const selectedEngineRef = useRef(loadPlaybackEngine());
  /** Keep the ref (read synchronously mid-transition) and the state in sync. */
  const setCurrentPlaybackIsLocal = useCallback((isLocal: boolean) => {
    currentPlaybackIsLocalRef.current = isLocal;
    setLocalEngineActive(isLocal);
  }, []);
  // One-time engine-fallback notices (rom/non-sid/unsupported), shown once each.
  const engineNoticeShownRef = useRef(new Set<EngineFallbackNotice>());
  const getLocalSidPlayback = useCallback(() => {
    // Shared, never per-page: a page-scoped engine kept playing after its page
    // unmounted, so tab-navigating away from Play and back stacked concurrent
    // AudioContexts and layered tunes on top of each other.
    if (!localSidPlaybackRef.current) localSidPlaybackRef.current = getSharedLocalSidPlaybackController();
    return localSidPlaybackRef.current;
  }, []);
  // Track B (LE3, §12.6): mirror the on-device engine's render throughput and
  // underruns into the SID Radio stats blob so the HIL can assert the budgets.
  // Polled (the engine exposes stats by pull) and folded across tunes, because
  // the scheduler's underrun counter restarts on every auto-advance.
  useEffect(() => {
    if (!localEngineActive) return;
    const timer = window.setInterval(() => {
      const stats = getLocalSidPlayback().getStats();
      if (!stats) return;
      updateSidRadioStats(localEngineStatsRef.current.sample(stats));
    }, LOCAL_ENGINE_STATS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [localEngineActive]);

  const emitEngineNotice = useCallback((notice: EngineFallbackNotice) => {
    if (engineNoticeShownRef.current.has(notice)) return;
    engineNoticeShownRef.current.add(notice);
    toast({ title: "Playback engine", description: ENGINE_FALLBACK_MESSAGES[notice] });
  }, []);
  const { playlistEnded, setPlaylistEnded, playlistEndedRef } = usePlaylistEnded();
  const [durationMsItemId, setDurationMsItemId] = useState<string | null>(null);
  const userTransportQueueRef = useRef(Promise.resolve());
  const latestQueuedUserSkipRef = useRef(0);
  const lastLaunchedItemIdRef = useRef<string | null>(null);
  const lastUserSkipTrackInstanceIdRef = useRef<number | null>(null);
  const pendingUserSkipRef = useRef<PendingUserSkip | null>(null);
  const flushPendingUserSkipRef = useRef<() => Promise<void>>(async () => undefined);
  const cancelPendingUserSkip = useCallback(() => {
    const pending = pendingUserSkipRef.current;
    if (!pending) return;
    // HARD20-004: stopping, taking over, or pausing supersedes a queued user skip.
    if (pending.timer !== null) window.clearTimeout(pending.timer);
    pendingUserSkipRef.current = null;
    pending.resolvers.forEach(({ resolve }) => resolve());
  }, []);
  const STOP_MACHINE_TIMEOUT_MS = 6000;
  // HARD18-009 (M5): Stop and playItem each take a fresh generation; the holder of the current one wins.
  const playGenerationRef = useRef(0);
  const stopCountRef = useRef(0);

  playlistRef.current = playlist;
  currentIndexRef.current = currentIndex;
  isPlayingRef.current = isPlaying;
  isPausedRef.current = isPaused;

  // HARD19-009: synced during render so the machine-execution subscription below can re-arm
  // auto-advance on an external resume without re-subscribing for every duration change.
  const durationMsRef = useRef(durationMs);
  durationMsRef.current = durationMs;
  const { setElapsedMs, setPlayedMs } = playbackTime;
  // Set while Play performs its OWN machine-execution write so the subscription
  // ignores it and only mirrors EXTERNAL transitions (e.g. a Home pause).
  const playInitiatedMachineTransitionRef = useRef(false);

  const writeMachineExecutionFromPlay = useCallback(
    (next: "running" | "paused", options?: { pauseMutePending?: boolean }) => {
      playInitiatedMachineTransitionRef.current = true;
      try {
        if (next === "paused") {
          // HARD21-004: closing the Home Ultimate menu must not resume a pause set from Play.
          setMachineExecutionPaused({ ...options, pausedBy: "play" });
        } else {
          setMachineExecutionRunning();
        }
      } finally {
        playInitiatedMachineTransitionRef.current = false;
      }
    },
    [],
  );

  const withTimeout = useCallback(async <T>(promise: Promise<T>, timeoutMs: number, operation: string) => {
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

  const enqueueUserTransport = useCallback(async <T>(task: () => Promise<T>) => {
    const run = userTransportQueueRef.current.then(task, task);
    userTransportQueueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return await run;
  }, []);

  const setVisibleCurrentIndex = useCallback(
    (nextIndex: number) => {
      currentIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
    },
    [setCurrentIndex],
  );

  const resumeMachineWithRetry = useCallback(
    async (api: ReturnType<typeof getC64API>) => {
      try {
        await withTimeout(api.machineResume(), 6000, "Resume");
      } catch (error) {
        addErrorLog("Machine resume first attempt failed", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        await withTimeout(api.machineResume(), 6000, "Resume");
      }
    },
    [withTimeout],
  );

  const { muteBeforeMachinePause, unmuteAfterMachineResume, rollbackMuteAfterFailedPause } = usePauseMute({
    enabledSidVolumeItems,
    sidEnablement,
    captureSidMuteSnapshot,
    buildEnabledSidMuteUpdates,
    snapshotToUpdates,
    applyAudioMixerUpdates,
    ensureUnmuted,
    isManualMuteHeld,
    dispatchVolume,
    pauseMuteSnapshotRef,
    pausingFromPauseRef,
    resumingFromPauseRef,
  });

  const stopMachineWithGracePeriod = useCallback(
    async (api: ReturnType<typeof getC64API>, shouldReboot: boolean) => {
      const endTransition = beginMachineTransition();
      try {
        if (shouldReboot) {
          await withTimeout(api.machineReboot(), STOP_MACHINE_TIMEOUT_MS, "Reboot");
        } else {
          await withTimeout(api.machineReset(), STOP_MACHINE_TIMEOUT_MS, "Reset");
        }
      } finally {
        endTransition();
      }
    },
    [withTimeout],
  );

  /** Stops the tune on the C64. A paused machine ignores a reset, so it is resumed first and Pause's mute restored after. */
  const stopTuneOnC64 = useCallback(
    async (api: ReturnType<typeof getC64API>, shouldReboot: boolean, itemId?: string) => {
      // A pause still under way would otherwise freeze the machine after the reset, muted.
      await machineTransitionCoordinatorRef.current.idle();
      const wasPaused = isPausedRef.current;
      const report = (title: string, error: unknown) =>
        addErrorLog(title, {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          itemId,
        });
      if (wasPaused) await resumeMachineWithRetry(api).catch((error) => report("Resume before stop failed", error));
      await stopMachineWithGracePeriod(api, shouldReboot);
      await endPlayLaunchMounts(api);
      // Kept muted until the reset is done, so the resumed program cannot replay a fragment.
      if (wasPaused && pauseMuteSnapshotRef.current) {
        await unmuteAfterMachineResume().catch((error) => report("Pause mute restore after stop failed", error));
      }
    },
    [addErrorLog, resumeMachineWithRetry, stopMachineWithGracePeriod, unmuteAfterMachineResume],
  );

  const resolveSidMetadata = useCallback(
    (file?: LocalPlayFile, songNr?: number | null) =>
      resolveLocalSidMetadata(file, songNr, durationFallbackMs, resolveSonglengthDurationMsForPath),
    [durationFallbackMs, resolveSonglengthDurationMsForPath],
  );

  const resolveCommoServeRuntimeRequest = useCallback(
    async (item: PlaylistItem): Promise<RuntimePlaybackRequest | null> => {
      if (item.request.source !== "commoserve" || item.request.file) return null;
      const archiveRef = item.archiveRef;
      if (!archiveRef) {
        throw new Error("Archive item metadata is missing. Re-add it to the playlist.");
      }

      const cachedPlayback = getCachedArchivePlayback(archiveRef);
      if (cachedPlayback) {
        return {
          request: { ...item.request, file: cachedPlayback.file, path: cachedPlayback.path },
          path: cachedPlayback.path,
        };
      }

      const archiveConfig = archiveConfigs?.[archiveRef.sourceId];
      if (!archiveConfig) {
        throw new Error(`Archive source configuration unavailable for ${archiveRef.sourceId}.`);
      }

      const archiveClient = createArchiveClient(archiveConfig);
      const binary = await archiveClient.downloadBinary(
        archiveRef.resultId,
        archiveRef.category,
        archiveRef.entryId,
        archiveRef.entryPath,
      );
      const playPlan = buildArchivePlayPlan(binary);
      if (!playPlan.file) {
        throw new Error(`Archive entry ${archiveRef.entryPath} did not resolve to a playable file.`);
      }

      const cached = setCachedArchivePlayback(archiveRef, {
        category: playPlan.category,
        path: playPlan.path,
        file: playPlan.file,
      });
      return {
        request: { ...item.request, file: cached.file, path: cached.path },
        path: cached.path,
      };
    },
    [archiveConfigs],
  );

  const resolveHvscRuntimeRequest = useCallback(
    async (item: PlaylistItem): Promise<RuntimePlaybackRequest | null> => {
      if (item.request.source !== "hvsc" || item.request.file) return null;
      const normalizedPath = normalizeSourcePath(item.path);
      const runtimeFile = buildHvscLocalPlayFile?.(normalizedPath, item.label);
      if (!runtimeFile) {
        throw new Error("HVSC file unavailable. Reinstall or re-add it to the playlist.");
      }
      return {
        request: { ...item.request, file: runtimeFile, path: normalizedPath },
        path: normalizedPath,
      };
    },
    [buildHvscLocalPlayFile],
  );

  const finishPlaylistPlayback = useCallback(
    (reason: "auto-end" | "user-next-end") => {
      const now = Date.now();
      const completedElapsedMs = durationMs ?? playedClockRef.current.current(now);
      playedClockRef.current.pause(now);
      setPlayedMs(playedClockRef.current.current(now));
      setElapsedMs(completedElapsedMs);
      trackStartedAtRef.current = null;
      const currentItem = playlistRef.current[currentIndexRef.current];
      // Songs (sid/mod) keep playing on the C64 past their songlength, so isPlaying stays true and the
      // combined button keeps offering Stop; prg/crt/disk flip it, since a reset would end them. HARD11-003.
      // A tune on the phone is rendered only up to its songlength, so it ends here rather than playing on.
      const endedOnPhone = currentPlaybackIsLocalRef.current;
      if (endedOnPhone) {
        getLocalSidPlayback().stop();
        setSoundingTune(null);
      }
      const deviceStillPlaying = !endedOnPhone && Boolean(currentItem && isSongCategory(currentItem.category));
      if (!deviceStillPlaying) {
        setIsPlaying(false);
        setIsPaused(false);
      }
      autoAdvanceGuardRef.current = null;
      setAutoAdvanceDueAtMs(null);
      setPlaylistEnded(true);
      addLog("info", "Playlist playback ended", {
        reason,
        currentIndex: currentIndexRef.current,
        deviceAction: deviceStillPlaying ? "none-song-still-audible" : "none",
      });
    },
    [
      autoAdvanceGuardRef,
      durationMs,
      getLocalSidPlayback,
      playedClockRef,
      setAutoAdvanceDueAtMs,
      setElapsedMs,
      setIsPaused,
      setIsPlaying,
      setPlayedMs,
      setSoundingTune,
    ],
  );

  const { prefetcher: nextTunePrefetch, warmNeighbours: warmNeighbouringTracks } = useNextTunePrefetch({
    playlistRef,
    currentIndexRef,
    resolveHvscRuntimeRequest,
    getLocalSidPlayback,
  });
  const scheduleNextTunePrefetchRef = useRef<(fromIndex: number, remainingMs: number | null) => void>(() => undefined);

  const playItem = useCallback(
    async (
      item: PlaylistItem,
      options?: {
        rebootBeforePlay?: boolean;
        playlistIndex?: number;
        playlistSize?: number;
        /** `auto` marks a playlist moving on by itself; anything else is the user asking. */
        origin?: PlaybackLaunchOrigin;
        /** With `auto`: the outgoing tune's songlength, which it plays on to on the phone. */
        outgoingSonglengthMs?: number;
        /** The Stop count when the user asked, for a request that waited before reaching here. */
        stopsAtRequest?: number;
        /** Next/Previous: a song that needs the C64 ROMs is passed over (like `auto`), not asked about. */
        passOverRomDependent?: boolean;
        /** The song already playing, started again (repeat, a move between engines): never passed over or asked about. */
        romDependencyAccepted?: boolean;
        /** Called once the launch is going ahead, after any question about the song, before anything playing stops. */
        onCommitted?: () => void;
        /** The play generation when the request was made; a request that a later launch or Stop overtook is dropped. */
        expectedPlayGeneration?: number;
        /** Called when the request got past the checks above and the launch begins. */
        onLaunchStarted?: () => void;
      },
    ) => {
      const stopsAtRequest = options?.stopsAtRequest ?? stopCountRef.current;
      return enqueuePlayTransition(async () => {
        // A play queued behind a launch that Stop then overtook would otherwise start after Stop.
        if (stopCountRef.current !== stopsAtRequest) {
          addLog("info", "Playback request dropped: Stop arrived while it waited", { itemId: item.id });
          return;
        }
        if (isLaunchOvertaken(playGenerationRef.current, options?.expectedPlayGeneration)) {
          addLog("info", "Playback request dropped: a newer tune launched while it waited", { itemId: item.id });
          return;
        }
        options?.onLaunchStarted?.();
        nextTunePrefetch.cancel();
        if (isRemoteSidSeekBusy()) await cancelRemoteSidSeek("another tune");
        // HARD18-009 (M5): Stop or a later Play bumping past this generation mid-flight skips the
        // post-launch state writes below, and the launch is corrected with a follow-up reset.
        const myPlayGeneration = (playGenerationRef.current += 1);
        const userSkipsQueuedAtLaunch = latestQueuedUserSkipRef.current;
        // Starting a track from a paused state bypasses handlePauseResume, the only other place these
        // are cleared; a stale pausingFromPauseRef disables the volume device-sync effect. HARD9-063.
        pauseMuteSnapshotRef.current = null;
        pausingFromPauseRef.current = false;
        resumingFromPauseRef.current = false;
        // HARD12-018: starting a new track invalidates any prior "playlist
        // ended" sentinel so background execution may resume if needed.
        setPlaylistEnded(false);
        let effectiveRequest = item.request;
        let effectivePath = item.path;
        if (effectiveRequest.source === "commoserve" && !effectiveRequest.file) {
          try {
            const resolved = await resolveCommoServeRuntimeRequest(item);
            if (resolved) {
              effectiveRequest = resolved.request;
              effectivePath = resolved.path;
            }
          } catch (error) {
            reportUserError({
              operation: "PLAYBACK_ARCHIVE_RESOLVE",
              title: "Archive playback unavailable",
              description: (error as Error).message,
              error,
              context: {
                item: item.label,
                sourceId: item.sourceId ?? null,
                archivePath: item.archiveRef?.entryPath ?? item.path,
              },
            });
            markPlaybackErrorReported(error);
            throw error;
          }
        }
        if (effectiveRequest.source === "hvsc" && !effectiveRequest.file) {
          try {
            const resolved = await resolveHvscRuntimeRequest(item);
            if (resolved) {
              effectiveRequest = resolved.request;
              effectivePath = resolved.path;
            }
          } catch (error) {
            reportUserError({
              operation: "PLAYBACK_HVSC_RESOLVE",
              title: "HVSC playback unavailable",
              description: (error as Error).message,
              error,
              context: {
                item: item.label,
                sourceId: item.sourceId ?? null,
                path: item.path,
              },
            });
            markPlaybackErrorReported(error);
            throw error;
          }
        }
        if (effectiveRequest.source === "local" && !effectiveRequest.file) {
          const sourceId = item.sourceId;
          const treeUri = sourceId ? localSourceTreeUris.get(sourceId) : null;
          if (treeUri) {
            const normalizedPath = normalizeSourcePath(item.path);
            effectiveRequest = {
              ...effectiveRequest,
              file: buildLocalPlayFileFromTree(item.label, normalizedPath, treeUri),
            };
          }
          const localEntry = sourceId
            ? localEntriesBySourceId.get(sourceId)?.get(normalizeSourcePath(item.path))
            : null;
          if (!effectiveRequest.file && localEntry?.uri) {
            effectiveRequest = {
              ...effectiveRequest,
              file: buildLocalPlayFileFromUri(item.label, normalizeSourcePath(item.path), localEntry.uri),
            };
          }
          if (!effectiveRequest.file) {
            throw new Error("Local file unavailable. Re-add it to the playlist.");
          }
        }
        // A tune kept on the Ultimate is out of reach without a network, or when a playlist moves on while
        // the device is shown offline: end here rather than through failed FTP and REST calls.
        // Written through `isDeviceOutOfReach` rather than repeating it, so the simulated device is
        // exempt here too; the second term keeps its OFFLINE_NO_DEMO half to a playlist moving on.
        const deviceOutOfReach = isDeviceOutOfReach() && (isNetworkKnownOffline() || options?.origin === "auto");
        // Unless it was read before the device went, which is what lets a tune playing there carry on here.
        if (
          effectiveRequest.source === "ultimate" &&
          deviceOutOfReach &&
          !getRememberedUltimateSidBlob(effectivePath, effectiveRequest.origin)
        ) {
          throw new Error(DEVICE_NOT_CONNECTED_MESSAGE);
        }
        let durationOverride: number | undefined = item.durationMs;
        let subsongCount: number | undefined = item.subsongCount ?? undefined;
        if (item.category === "sid" && effectiveRequest.source !== "ultimate") {
          if (durationOverride === undefined || subsongCount === undefined) {
            const metadata = await resolveSidMetadata(effectiveRequest.file, effectiveRequest.songNr ?? null);
            durationOverride ??= metadata.durationMs;
            subsongCount ??= metadata.subsongCount;
            if (!metadata.readable) {
              throw new Error(
                effectiveRequest.source === "hvsc"
                  ? "HVSC file unavailable. Reinstall or re-add it to the playlist."
                  : "Local file unavailable. Re-add it to the playlist.",
              );
            }
          }
        } else if (item.category === "sid" && effectiveRequest.source === "ultimate" && !item.durationMs) {
          try {
            const pathMs = await resolveSonglengthDurationMsForPath(
              effectivePath,
              null,
              effectiveRequest.songNr ?? null,
            );
            if (pathMs !== null) {
              durationOverride = pathMs;
            } else {
              const md5Ms = await resolveUltimateSidDurationByMd5(effectivePath, effectiveRequest.songNr ?? null);
              if (md5Ms !== null) durationOverride = md5Ms;
            }
          } catch (error) {
            addLog("debug", "Ultimate SID duration resolution failed", {
              path: effectivePath,
            });
            addErrorLog("Ultimate SID duration resolution failed", {
              path: effectivePath,
              error: (error as Error).message,
            });
          }
        }
        const passOver = options?.origin === "auto" || options?.passOverRomDependent === true;
        const launchRoute = await resolveLaunchRoute({
          item,
          request: effectiveRequest,
          path: effectivePath,
          deviceOutOfReach,
          takePrefetched: (id) => nextTunePrefetch.take(id),
          passOver,
          accepted: options?.romDependencyAccepted === true,
          ask: resolveRomDependencyDecision && ((question) => resolveRomDependencyDecision(item, question)),
          stillWanted: () =>
            stopCountRef.current === stopsAtRequest &&
            playGenerationRef.current === myPlayGeneration &&
            pendingUserSkipRef.current === null &&
            latestQueuedUserSkipRef.current === userSkipsQueuedAtLaunch,
          notify: emitEngineNotice,
          // The caller held back the playing tune's auto-advance for this launch, which is not happening.
          onDeclined: () => {
            const guard = autoAdvanceGuardRef.current;
            if (!guard?.userCancelled || guard.autoFired) return;
            guard.userCancelled = false;
            setAutoAdvanceDueAtMs(guard.dueAtMs);
          },
        });
        if (!launchRoute) return;
        const { routeToLocal, simulatedDevice } = launchRoute;
        effectiveRequest = launchRoute.request;
        options?.onCommitted?.();
        // Silence any prior on-device tune before the C64 takes over (a local→C64
        // switch); consecutive local plays are handled inside the engine.
        if (!routeToLocal && localSidPlaybackRef.current) {
          if (localSidPlaybackRef.current.isActive()) setSoundingTune(null);
          localSidPlaybackRef.current.stop();
        }
        const api = getC64API();
        const c64PlaysCurrentTune = !currentPlaybackIsLocalRef.current && !isLocalPlaybackActive();
        if (routeToLocal && c64PlaysCurrentTune && !isDeviceOutOfReach()) {
          // Out of reach, the tune left on the C64 is stopped when it returns (see remoteTuneHandover).
          await stopRemoteTuneBeforeLocalPlayback(async () => {
            if (isPausedRef.current) await resumeMachineWithRetry(api);
            await stopMachineWithGracePeriod(api, false);
            // As Stop does: a paused tune muted the C64, and nothing on this path would unmute it.
            writeMachineExecutionFromPlay("running");
            await restoreVolumeOverrides("stop");
          });
        }
        if (!routeToLocal) {
          try {
            await ensurePlaybackConnection();
          } catch (error) {
            reportUserError({
              operation: "PLAYBACK_CONNECT",
              title: "Connection failed",
              description: (error as Error).message,
              error,
              context: {
                item: item.label,
              },
            });
            markPlaybackErrorReported(error);
            throw error;
          }
          await ensureUnmuted({ refreshItems: true });
          if (isPausedRef.current) {
            // The machine is DMA-paused (frozen). Launching a new track without
            // resuming first leaves it frozen while the UI flips to "playing" -
            // no audio, wedged until Stop. See HARD9-029.
            try {
              await resumeMachineWithRetry(api);
            } catch (error) {
              reportUserError({
                operation: "PLAYBACK_RESUME",
                title: "Resume failed",
                description: (error as Error).message,
                error,
                context: {
                  item: item.label,
                },
              });
              markPlaybackErrorReported(error);
              throw error;
            }
          }
        }
        // Cleared by the first step that silences a tune; a launch failing before that leaves it sounding and on record.
        setSoundingTune(null);
        const resolvedDurationBase = durationOverride ?? item.durationMs;
        const request: PlayRequest =
          typeof resolvedDurationBase === "number"
            ? { ...effectiveRequest, durationMs: resolvedDurationBase }
            : effectiveRequest;
        const plan = buildPlayPlan(request, firmwareOverridesItemConfig(item));
        const shouldReboot = options?.rebootBeforePlay ?? item.category === "disk";
        const configOrigin = item.configOrigin ?? resolveStoredConfigOrigin(item.configRef ?? null, null);
        const configOverrides = item.configOverrides ?? null;
        const candidatePlaybackConfigSignature =
          configOrigin !== "manual-none" && Boolean(item.configRef || configOverrides?.length)
            ? buildPlaybackConfigSignature(item.configRef ?? null, configOverrides)
            : null;
        const sessionDeclinedForItem =
          candidatePlaybackConfigSignature !== null &&
          sessionDeclinedPlaybackConfigRef.current.get(item.id) === candidatePlaybackConfigSignature;
        const shouldApplyPlaybackConfig =
          !sessionDeclinedForItem &&
          configOrigin !== "manual-none" &&
          Boolean(item.configRef || configOverrides?.length);
        const nextPlaybackConfigSignature = shouldApplyPlaybackConfig
          ? buildPlaybackConfigSignature(item.configRef ?? null, configOverrides)
          : null;
        const applyPlaybackConfigBeforeLaunch =
          shouldApplyPlaybackConfig && nextPlaybackConfigSignature
            ? async () => {
                if (lastAppliedPlaybackConfigSignatureRef.current === nextPlaybackConfigSignature) {
                  addLog("info", "Skipping redundant playback config application", {
                    itemId: item.id,
                    label: item.label,
                    configFile: item.configRef?.fileName ?? null,
                    overrideCount: configOverrides?.length ?? 0,
                  });
                  return;
                }
                try {
                  toast({
                    title: item.configRef
                      ? `Applying ${item.configRef.fileName}`
                      : `Applying ${configOverrides?.length ?? 0} config override${configOverrides?.length === 1 ? "" : "s"}`,
                  });
                  await ensureConfigFileReferenceAccessible({
                    configRef: item.configRef ?? null,
                    localEntriesBySourceId,
                    localSourceTreeUris,
                  });
                  if (playGenerationRef.current !== myPlayGeneration) throw new PlaybackLaunchOvertakenError();
                  await applyConfigFileReference({
                    configRef: item.configRef ?? null,
                    configOverrides,
                    deviceProduct,
                    localEntriesBySourceId,
                    localSourceTreeUris,
                  });
                  sessionDeclinedPlaybackConfigRef.current.delete(item.id);
                  lastAppliedPlaybackConfigSignatureRef.current = nextPlaybackConfigSignature;
                } catch (error) {
                  if (error instanceof PlaybackLaunchOvertakenError || isConfigApplyCancelledError(error)) {
                    lastAppliedPlaybackConfigSignatureRef.current = null;
                    throw new PlaybackLaunchOvertakenError();
                  }
                  if (isConfigReferenceUnavailableError(error) && resolveUnavailableConfigDecision) {
                    const decision = await resolveUnavailableConfigDecision(item, {
                      configFileName: item.configRef?.fileName ?? null,
                      reason: (error as Error).message,
                    });
                    if (decision === "play-without-config") {
                      sessionDeclinedPlaybackConfigRef.current.set(item.id, nextPlaybackConfigSignature);
                      addLog("warn", "Playback config unavailable; continuing without config", {
                        itemId: item.id,
                        label: item.label,
                        configFile: item.configRef?.fileName ?? null,
                      });
                      return;
                    }
                    markPlaybackErrorReported(error);
                    throw error;
                  }
                  reportUserError({
                    operation: "PLAYBACK_CONFIG_APPLY",
                    title: "Config application failed",
                    description: (error as Error).message,
                    error,
                    context: {
                      item: item.label,
                      configFile: item.configRef?.fileName ?? null,
                      configOrigin,
                      overrideCount: configOverrides?.length ?? 0,
                    },
                  });
                  markPlaybackErrorReported(error);
                  throw error;
                }
              }
            : null;
        if (item.category === "disk") {
          lastAppliedPlaybackConfigSignatureRef.current = null;
        }
        const executionOptions = {
          ...(shouldReboot ? { rebootBeforeMount: true } : {}),
          ...(applyPlaybackConfigBeforeLaunch
            ? {
                // A .cfg apply takes ~20 s; a Stop during it must keep the program from starting at all.
                beforeLaunch: async () => {
                  await applyPlaybackConfigBeforeLaunch();
                  if (playGenerationRef.current !== myPlayGeneration) {
                    lastAppliedPlaybackConfigSignatureRef.current = null;
                    throw new PlaybackLaunchOvertakenError();
                  }
                },
              }
            : {}),
          benchmarkMetadata: {
            feedbackKind: "result",
            ...(typeof options?.playlistSize === "number" ? { playlistSize: options.playlistSize } : {}),
          },
          notify: toast,
        };
        const resolvedDuration = resolvedDurationBase ?? durationFallbackMs;
        addLog("info", "Playback request started", {
          itemId: item.id,
          label: item.label,
          category: item.category,
          source: request.source,
          sourceId: item.sourceId,
          path: request.path,
          songNr: request.songNr ?? null,
          durationMs: request.durationMs ?? null,
          rebootBeforePlay: Boolean(executionOptions?.rebootBeforeMount),
        });
        if (routeToLocal) {
          // Tell the simulated device what is playing, so its Live View screen names the tune the
          // way a real machine's screen would. Fire and forget: the sound is already coming from
          // this phone, and a failed REST call must not delay or fail the first note.
          if (simulatedDevice && effectivePath) {
            void getC64API()
              .playSid(effectivePath, effectiveRequest.songNr)
              .catch((error: unknown) =>
                addLog("debug", "Simulated device did not accept the now-playing screen", {
                  error: error instanceof Error ? error.message : String(error),
                }),
              );
          }
          // On-device engine: render the SID here, no C64 (spec §12). The
          // songlength clock + auto-advance below run identically to the C64
          // path, so playlist/SID-Radio behaviour is engine-agnostic.
          // The pre-render key names the renderer, so it waits for the probe: keyed before it answered,
          // the first tune after a launch was pre-rendered under reSIDfp's key and never found again.
          await probeSidRenderers();
          const launched = await getLocalSidPlayback().play(
            effectiveRequest.file!,
            // `songNr` is one-based everywhere it is stored, shown or looked up; the engine's
            // `songIndex` is zero-based. Handing one straight to the other played the tune after
            // the one asked for — see `sidTuneIndex`.
            toEngineTuneIndex(effectiveRequest.songNr),
            {
              onError: (playbackError) =>
                addErrorLog("Local SID playback failed", {
                  error: playbackError.message,
                  item: item.label,
                }),
              // The engine has given up on this tune: it stalled and could not be restarted, so it
              // will produce nothing for the rest of its length. Bring the auto-advance forward
              // instead of leaving the listener with a track that is playing silence until its
              // songlength runs out. Deliberately routed through the existing due-time rather than
              // calling next directly, so every guard already on that path still applies — it will
              // not fire onto a paused machine, past a user cancel, or onto a different track.
              onUnrecoverable: () => {
                addErrorLog("Local SID playback gave up; advancing", { item: item.label });
                rescheduleAutoAdvance(durationMsRef.current ?? 0);
              },
            },
            // Render the whole tune in the background so scrubbing inside it is
            // instant. See buildRenderedTuneKey for what the key has to separate.
            {
              prerenderKey: buildRenderedTuneKey(item.id, toEngineTuneIndex(effectiveRequest.songNr)),
              durationSeconds: resolvedDuration ? resolvedDuration / 1000 : undefined,
              outgoingEndsAtSeconds: options?.outgoingSonglengthMs ? options.outgoingSonglengthMs / 1000 : undefined,
            },
          );
          if (launched.romRequired) return rejectRefusedLaunch(item, passOver, resolveRomDependencyDecision);
          // Warm the tracks either side of this one. A track started from a warmed opening plays out
          // of memory while the renderer catches up, instead of having to out-run the speaker from a
          // standing start — which it only just manages, and audibly failed to a second or two in.
          void warmNeighbouringTracks();
          scheduleNextTunePrefetchRef.current(
            resolveLaunchedItemIndex(playlistRef.current, item.id, options?.playlistIndex ?? -1),
            resolvedDuration ?? null,
          );
        } else {
          await executePlayPlan(api, plan, executionOptions).catch((error) => {
            if (!(error instanceof PlaybackLaunchOvertakenError)) throw error;
          });
        }
        const launchSuperseded = playGenerationRef.current !== myPlayGeneration;
        if (!routeToLocal && !launchSuperseded) {
          // The tune is now running on the Ultimate. Recorded here, at the real
          // launch, so a device switch can stop it no matter which page is
          // mounted (see activePlaybackSession).
          markRemotePlaybackStarted(stopRequiresReboot(item.category));
          // Bring the tune to this device's speakers too, unless the listener chose otherwise: the preference
          // check is what makes "Listen on: <device>" mean anything. Best-effort, as a device that will not
          // stream must not stop the tune from playing.
          // Queued, not judged from `audioLive`: a stop still queued read as live, and Both played on the C64 alone.
          if (
            featureFlagManager.getSnapshot().flags.audio_mirror_enabled &&
            loadMirrorC64Audio() &&
            // An Ultimate II+L has no /v1/streams: asking it answered 404, logged twice as an error.
            identifiedDeviceStreams(getConnectionSnapshot().deviceInfo)
          ) {
            void avMirrorSession.setAudioWanted(true).catch((error) => {
              addLog("warn", "Playback: could not start Live View audio for C64 playback", {
                service: "playback",
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
        }
        setCurrentPlaybackIsLocal(routeToLocal);

        if (launchSuperseded) {
          // HARD18-009 (M5): Stop or a later Play overtook a launch that already reached the device.
          // Reset it, and skip every state write below, which would re-assert playback over Stop's.
          addLog("info", "Playback launch superseded by Stop; issuing follow-up reset", {
            itemId: item.id,
            label: item.label,
          });
          if (routeToLocal) {
            getLocalSidPlayback().stop();
            setCurrentPlaybackIsLocal(false);
          } else {
            try {
              await stopMachineWithGracePeriod(api, stopRequiresReboot(item.category));
              await endPlayLaunchMounts(api);
            } catch (error) {
              addErrorLog("Follow-up reset after superseded playback launch failed", {
                itemId: item.id,
                label: item.label,
                error: (error as Error).message,
                stack: (error as Error).stack,
              });
            }
          }
          return;
        }

        lastLaunchedItemIdRef.current = item.id;
        // Skipped past while it launched: the listener's choice stays visible and later skips count from it.
        const skippedPastDuringLaunch =
          pendingUserSkipRef.current !== null || latestQueuedUserSkipRef.current !== userSkipsQueuedAtLaunch;
        if (!skippedPastDuringLaunch) setSoundingTune({ ...item, request: effectiveRequest, path: effectivePath });
        const now = Date.now();
        const nextTrackInstanceId = trackInstanceIdRef.current + 1;
        trackInstanceIdRef.current = nextTrackInstanceId;
        setTrackInstanceId(nextTrackInstanceId);
        setElapsedMs(0);
        setDurationMs(resolvedDuration);
        setDurationMsItemId(item.id);
        if (isSongCategory(item.category)) {
          setCurrentSubsongCount(subsongCount ?? item.subsongCount ?? null);
        } else {
          setCurrentSubsongCount(null);
        }
        if (typeof options?.playlistIndex === "number" && options.playlistIndex >= 0 && !skippedPastDuringLaunch) {
          setVisibleCurrentIndex(resolveLaunchedItemIndex(playlistRef.current, item.id, options.playlistIndex));
        }
        trackStartedAtRef.current = now;
        // HARD12-007: do NOT pass reset=true here — `startPlaylist`'s explicit
        // .reset() already handles the playlist-start case, and resetting per
        // track is the bug that made "Remaining" snap to 0 on every auto-advance.
        playedClockRef.current.start(now);
        setPlayedMs(playedClockRef.current.current(now));
        if (typeof resolvedDuration === "number") {
          autoAdvanceGuardRef.current = {
            trackInstanceId: nextTrackInstanceId,
            dueAtMs: now + autoAdvanceDelayMs(resolvedDuration, 0, routeToLocal),
            autoFired: false,
            userCancelled: false,
          };
          setAutoAdvanceDueAtMs(autoAdvanceGuardRef.current.dueAtMs);
        } else {
          autoAdvanceGuardRef.current = null;
          setAutoAdvanceDueAtMs(null);
        }
        // HARD19-021: a fallback duration must carry durationSource "default" so applySonglengthsToItems
        // can re-resolve it later (HARD9-008); without it the fallback pins the item forever. A resolved
        // duration leaves the marker alone, so a manual Default duration override survives playback.
        const bakedFallbackDuration = resolvedDurationBase === undefined;
        if (
          resolvedDuration !== item.durationMs ||
          (bakedFallbackDuration && item.durationSource !== "default") ||
          subsongCount !== item.subsongCount ||
          effectiveRequest !== item.request ||
          effectivePath !== item.path
        ) {
          setPlaylist((prev) =>
            prev.map((entry) =>
              entry.id === item.id
                ? {
                    ...entry,
                    request,
                    path: effectivePath,
                    durationMs: resolvedDuration,
                    ...(bakedFallbackDuration ? { durationSource: "default" as const } : {}),
                    subsongCount: subsongCount ?? entry.subsongCount,
                  }
                : entry,
            ),
          );
        }
        // HARD23-004: a Next/Previous from a paused session reaches the device only through playItem, and
        // left the shared store "paused" while audio played: Home mislabelled Pause/Resume and auto-advance
        // stayed gated, so every track overran. This is the one point where a track has launched.
        writeMachineExecutionFromPlay("running");
        setIsPlaying(true);
        setIsPaused(false);
        // The single point at which a track has actually launched, so it is also the
        // only honest place to report a launch that succeeded.
        if ((options?.origin ?? "user") === "user") onUserLaunchRef.current?.(item);
      });
    },
    [
      durationFallbackMs,
      deviceProduct,
      enqueuePlayTransition,
      ensurePlaybackConnection,
      resolveUnavailableConfigDecision,
      resolveRomDependencyDecision,
      ensureUnmuted,
      buildHvscLocalPlayFile,
      localEntriesBySourceId,
      localSourceTreeUris,
      resolveCommoServeRuntimeRequest,
      resolveHvscRuntimeRequest,
      resolveSidMetadata,
      resolveSonglengthDurationMsForPath,
      resolveUltimateSidDurationByMd5,
      resumeMachineWithRetry,
      stopMachineWithGracePeriod,
      pauseMuteSnapshotRef,
      pausingFromPauseRef,
      resumingFromPauseRef,
      setVisibleCurrentIndex,
      setCurrentSubsongCount,
      setDurationMs,
      setElapsedMs,
      setIsPaused,
      setIsPlaying,
      setPlayedMs,
      setPlaylist,
      setTrackInstanceId,
      setAutoAdvanceDueAtMs,
      writeMachineExecutionFromPlay,
      autoAdvanceGuardRef,
      isPausedRef,
      playedClockRef,
      trackInstanceIdRef,
      trackStartedAtRef,
      playGenerationRef,
      withTimeout,
    ],
  );

  usePlaybackEngineSwitch({
    selectedEngineRef,
    stopCountRef,
    playGenerationRef,
    currentPlaybackIsLocalRef,
    currentIndexRef,
    playlistRef,
    isPlayingRef,
    getLocalSidPlayback,
    setCurrentPlaybackIsLocal,
    enqueuePlayTransition,
    playItem,
    stopOnC64: async (item) => {
      try {
        // A tune paused on the C64 and then moved here left the machine frozen and muted: a reset does not unpause it.
        await stopTuneOnC64(getC64API(), false, item.id);
        markRemotePlaybackStopped();
      } catch (error) {
        addErrorLog("Stopping the C64 for a playback-engine switch failed", {
          error: (error as Error).message,
          item: item.label,
        });
      }
    },
    onRestartFailed: (error, item) => {
      reportPlaybackStartFailure({
        operation: "PLAYBACK_START",
        title: "Playback failed",
        error,
        context: { item: item.label },
      });
      setIsPlaying(false);
      setIsPaused(false);
      trackStartedAtRef.current = null;
      autoAdvanceGuardRef.current = null;
      setAutoAdvanceDueAtMs(null);
    },
  });

  // Resolve the live station and repeat state when a transition actually runs.
  const playlistTraversal = useCallback(
    (items: PlaylistItem[]) =>
      createPlaylistTraversal(
        items,
        resolveTraversalOrdering(
          { repeatEnabled, shuffleEnabled },
          stationActiveRef?.current === true,
          stationFinishingRef?.current === true,
        ),
        shuffleSeed,
        shuffleAnchorId,
      ),
    [repeatEnabled, shuffleEnabled, stationActiveRef, stationFinishingRef, shuffleSeed, shuffleAnchorId],
  );

  const startPlaylist = useCallback(
    async (
      items: PlaylistItem[],
      startIndex = 0,
      options?: { replaceQueue?: boolean; passOver?: boolean },
    ): Promise<boolean> => {
      if (!items.length) return false;
      // Playlist row/title taps call this directly, so it needs the same
      // duplicate-start drop as handlePlay, and it must invalidate the
      // previous track's auto-advance guard before isPaused flips false —
      // a stale overdue guard otherwise fires on timeline reconciliation
      // and starts the previous playlist's next item over this fresh start.
      if (!tryAcquireSingleFlight(playStartInFlightRef)) return false;
      const stopsAtStart = stopCountRef.current;
      setIsPlaylistLoading(true);
      try {
        cancelAutoAdvance();
        setPlaylistEnded(false);
        const resolvedItems = await applySonglengthsToItems(items);
        setPlaylist((prev) => mergeStartedPlaylist(prev, resolvedItems, options));
        // Not before: a song that needs the C64 ROMs is asked about first, and Cancel leaves what plays as it was.
        const commitStart = () => {
          playedClockRef.current.reset();
          setPlayedMs(0);
          writeMachineExecutionFromPlay("running");
          setIsPaused(false);
        };
        // A station, or Play with nothing chosen yet: the first song was not picked, so it is passed over like the rest.
        const following = reachableFollowing(resolvedItems, playlistTraversal(resolvedItems).next);
        try {
          const played = await playPassingOver(
            startIndex,
            (index) =>
              playItem(resolvedItems[index], {
                playlistIndex: index,
                playlistSize: resolvedItems.length,
                stopsAtRequest: stopsAtStart,
                passOverRomDependent: options?.passOver === true,
                onCommitted: commitStart,
              }),
            (index) => (options?.passOver ? following(index) : null),
          );
          if (!played) finishPlaylistPlayback("auto-end");
        } catch (error) {
          commitStart();
          reportPlaybackStartFailure({
            operation: "PLAYBACK_START",
            title: "Playback failed",
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
        }
      } finally {
        releaseSingleFlight(playStartInFlightRef);
        setIsPlaylistLoading(false);
      }
      return true;
    },
    [
      applySonglengthsToItems,
      cancelAutoAdvance,
      finishPlaylistPlayback,
      playItem,
      playlistTraversal,
      playStartInFlightRef,
      playedClockRef,
      setAutoAdvanceDueAtMs,
      setIsPaused,
      setIsPlaying,
      setIsPlaylistLoading,
      setPlayedMs,
      setPlaylist,
      trackStartedAtRef,
      autoAdvanceGuardRef,
    ],
  );

  const handlePlay = useCallback(
    trace(async function handlePlay() {
      const targetIndex = resolvePlayTargetIndex(playlist.length, currentIndex);
      if (targetIndex === null) return;
      if (currentIndex < 0) {
        // startPlaylist handles its own single-flight and guard cancellation.
        await startPlaylist(playlist, targetIndex, { passOver: true });
        return;
      }
      if (!tryAcquireSingleFlight(playStartInFlightRef)) return;
      setIsPlaylistLoading(true);
      try {
        cancelAutoAdvance();
        await playItem(playlist[targetIndex], { playlistIndex: targetIndex, playlistSize: playlist.length });
      } catch (error) {
        reportPlaybackStartFailure({
          operation: "PLAYBACK_START",
          title: "Playback failed",
          error,
          context: {
            item: playlist[targetIndex]?.label,
          },
        });
      } finally {
        releaseSingleFlight(playStartInFlightRef);
        setIsPlaylistLoading(false);
      }
    }),
    [
      cancelAutoAdvance,
      currentIndex,
      playItem,
      playlist,
      startPlaylist,
      trace,
      playStartInFlightRef,
      setIsPlaylistLoading,
    ],
  );

  const handleStop = useCallback(
    trace(async function handleStop() {
      // Same reason as handlePauseResume: a page that did not start the tune
      // must still be able to stop it.
      if (!isPlaying && !isPaused && !isAnyPlaybackActive() && !playStartInFlightRef.current) return;
      // HARD18-009 (M5): Stop always runs immediately (never queued behind
      // enqueuePlayTransition) and claims the play-generation counter so any
      // in-flight playItem transition (auto-advance, Next/Previous, a
      // row-tap) sees itself superseded once its own async work resolves.
      playGenerationRef.current += 1;
      stopCountRef.current += 1;
      nextTunePrefetch.clear();
      cancelPendingUserSkip();
      setSoundingTune(null);
      const currentItem = playlist[currentIndex];
      const shouldReboot = stopRequiresReboot(currentItem?.category);
      // Silence an on-device tune through the shared controller; a local track involves no C64 to stop.
      getLocalSidPlayback().stop();
      if (isRemoteSidSeekBusy()) await cancelRemoteSidSeek("stop");
      // A .cfg apply walks the device menu over Telnet; it backs out and closes before the reset goes out.
      await cancelActiveConfigApply();
      if (currentPlaybackIsLocalRef.current) {
        setCurrentPlaybackIsLocal(false);
      } else {
        try {
          await stopTuneOnC64(getC64API(), shouldReboot, currentItem?.id);
          markRemotePlaybackStopped();
        } catch (error) {
          reportUserError({
            operation: "PLAYBACK_STOP",
            title: "Stop failed",
            description: (error as Error).message,
            error,
            context: {
              currentIndex,
              category: currentItem?.category,
            },
          });
        }
      }
      const now = Date.now();
      playedClockRef.current.stop(now, true);
      setPlayedMs(0);
      setIsPlaying(false);
      setIsPaused(false);
      setElapsedMs(0);
      setDurationMs(undefined);
      setCurrentSubsongCount(null);
      trackStartedAtRef.current = null;
      lastAppliedPlaybackConfigSignatureRef.current = null;
      autoAdvanceGuardRef.current = null;
      setAutoAdvanceDueAtMs(null);
      // HARD12-020: stopping clears any shared pause state so Home does not
      // keep showing "paused" or attempt a stale pause-mute restore.
      writeMachineExecutionFromPlay("running");
      try {
        await restoreVolumeOverrides("stop");
      } catch (error) {
        addErrorLog("Playback stop volume restore failed", {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          currentIndex,
          category: currentItem?.category,
        });
      }
    }),
    [
      currentIndex,
      isPaused,
      isPlaying,
      playlist,
      restoreVolumeOverrides,
      resumeMachineWithRetry,
      unmuteAfterMachineResume,
      pauseMuteSnapshotRef,
      stopMachineWithGracePeriod,
      trace,
      playedClockRef,
      setAutoAdvanceDueAtMs,
      setPlayedMs,
      setIsPlaying,
      setIsPaused,
      setElapsedMs,
      setDurationMs,
      setCurrentSubsongCount,
      trackStartedAtRef,
      lastAppliedPlaybackConfigSignatureRef,
      autoAdvanceGuardRef,
      playGenerationRef,
      playStartInFlightRef,
      cancelPendingUserSkip,
    ],
  );

  // HARD18-022/023 (M3): a whole-machine reset from Home or an out-of-playlist launch takes the C64
  // from an armed session. Stop in place without further machine-control REST calls (more writes
  // right after a reset compound HARD18-012's boot-window churn), keeping the playlist position.
  useEffect(() => {
    return subscribeMachineTakeover((event) => {
      if (!isPlayingRef.current && !isPausedRef.current) return;
      cancelPendingUserSkip();
      setSoundingTune(null);
      const now = Date.now();
      playedClockRef.current.stop(now, true);
      setPlayedMs(0);
      autoAdvanceGuardRef.current = null;
      setAutoAdvanceDueAtMs(null);
      setIsPlaying(false);
      setIsPaused(false);
      toast({
        title: event.reason === "home-reset" ? "Playback stopped" : "Playlist stopped",
        description:
          event.reason === "home-reset" ? "The machine was reset from Home." : `You launched ${event.label}.`,
      });
    });
  }, [
    playedClockRef,
    setPlayedMs,
    autoAdvanceGuardRef,
    setAutoAdvanceDueAtMs,
    setIsPlaying,
    setIsPaused,
    cancelPendingUserSkip,
  ]);

  // A Play page mounted over a paused tune restores it without a guard, so a resume has none to re-date.
  const rearmAutoAdvanceOnResume = useCallback(
    (now: number, currentDurationMs: number | undefined, elapsedMs: number) => {
      if (typeof currentDurationMs !== "number") return;
      if (!autoAdvanceGuardRef.current && playlistEndedRef.current) return;
      const dueAtMs = now + autoAdvanceDelayMs(currentDurationMs, elapsedMs, currentPlaybackIsLocalRef.current);
      const guard = autoAdvanceGuardRef.current ?? {
        trackInstanceId: trackInstanceIdRef.current,
        dueAtMs,
        autoFired: false,
        userCancelled: false,
      };
      guard.dueAtMs = dueAtMs;
      guard.autoFired = false;
      guard.deferredToEnd = false;
      guard.userCancelled = false;
      autoAdvanceGuardRef.current = guard;
      setAutoAdvanceDueAtMs(dueAtMs);
    },
    [autoAdvanceGuardRef, playlistEndedRef, trackInstanceIdRef, setAutoAdvanceDueAtMs],
  );

  // HARD19-009: mirror pause and resume applied from elsewhere (Home), or auto-advance would launch
  // the next track on a machine the user paused. Play's own writes are skipped through
  // playInitiatedMachineTransitionRef, and a value-equality bail prevents a re-render loop.
  useEffect(() => {
    return subscribeMachineExecution(() => {
      if (playInitiatedMachineTransitionRef.current) return;
      if (!isPlayingRef.current) return;
      const machinePaused = getMachineExecutionSnapshot().state === "paused";
      if (machinePaused === isPausedRef.current) return;
      const now = Date.now();
      if (machinePaused) {
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        setIsPaused(true);
        setAutoAdvanceDueAtMs(null);
      } else {
        setIsPaused(false);
        const currentElapsedMs = playbackTime.read().elapsedMs;
        trackStartedAtRef.current = resumedTrackStartedAtMs(playlistEndedRef.current, now, currentElapsedMs);
        playedClockRef.current.resume(now);
        setPlayedMs(playedClockRef.current.current(now));
        rearmAutoAdvanceOnResume(now, durationMsRef.current, currentElapsedMs);
      }
    });
  }, [
    playedClockRef,
    setPlayedMs,
    setIsPaused,
    setAutoAdvanceDueAtMs,
    trackStartedAtRef,
    durationMsRef,
    playbackTime,
    rearmAutoAdvanceOnResume,
  ]);

  // Defined below; read by Resume after a restart, which starts the tune again where it was.
  const seekByRef = useRef<(deltaSeconds: number) => Promise<void>>(async () => undefined);
  const handlePauseResume = useCallback(
    trace(async function handlePauseResume() {
      // App-wide, not this page's own state: `isPlaying` starts false on a Play page mounted mid-tune,
      // and Pause did nothing at all on a button the UI had (correctly) enabled.
      if (!isPlaying && !isAnyPlaybackActive()) return;
      nextTunePrefetch.cancel();
      if (isRemoteSidSeekBusy()) await cancelRemoteSidSeek("pause or resume");
      const restartedItemId = isPaused && !isAnyPlaybackActive() ? takeRestartedPhoneTune() : null;
      const item = playlistRef.current[currentIndexRef.current];
      if (restartedItemId && item?.id === restartedItemId) {
        // Resumed the machine before, which was not playing it, and the page showed a tune playing in silence.
        const resumeAtSeconds = playbackTime.read().elapsedMs / 1000;
        try {
          await playItem(item, { playlistIndex: currentIndexRef.current });
        } catch (error) {
          // A tune kept on the Ultimate cannot start while it is out of reach; a later Resume starts it then.
          noteRestartedPhoneTune(restartedItemId);
          reportPlaybackStartFailure({ operation: "PLAYBACK_RESUME", title: "Resume failed", error });
          return;
        }
        if (currentPlaybackIsLocalRef.current && resumeAtSeconds >= 1) {
          await seekByRef.current(resumeAtSeconds - getLocalSidPlayback().positionSeconds());
        }
        return;
      }
      // Track B (LE2): a tune playing on the device has no C64 to pause (the calls below would hang with
      // no Ultimate connected); suspend the engine's audio clock instead. The ref is per page and starts
      // false, so a remounted page would otherwise pause a machine that is not playing.
      const toggleLocalPause = async (resume: boolean) => {
        const local = getLocalSidPlayback();
        const now = Date.now();
        if (resume) {
          await local.resume();
          setIsPaused(false);
          writeMachineExecutionFromPlay("running");
          const { elapsedMs } = playbackTime.read();
          scheduleNextTunePrefetchRef.current(
            currentIndexRef.current,
            typeof durationMs === "number" ? durationMs - elapsedMs : null,
          );
          trackStartedAtRef.current = now - elapsedMs;
          playedClockRef.current.resume(now);
          setPlayedMs(playedClockRef.current.current(now));
          rearmAutoAdvanceOnResume(now, durationMs, elapsedMs);
        } else {
          cancelPendingUserSkip();
          await local.pause();
          playedClockRef.current.pause(now);
          setPlayedMs(playedClockRef.current.current(now));
          setIsPaused(true);
          setAutoAdvanceDueAtMs(null);
          writeMachineExecutionFromPlay("paused");
        }
      };
      // From what was last asked for: a second tap read from a pause still under way repeated it.
      const target = (requestedPauseRef.current ?? isPaused) ? "running" : "paused";
      requestedPauseRef.current = target === "paused";
      setRequestedPause(target === "paused");
      const request = ++pauseRequestRef.current;
      const settled = () => {
        if (pauseRequestRef.current !== request) return;
        requestedPauseRef.current = null;
        setRequestedPause(null);
      };
      if (currentPlaybackIsLocalRef.current || isLocalPlaybackActive()) {
        // In order: a resume finishing before the pause it follows would leave the tune paused.
        const transition = localPauseChainRef.current.then(() => toggleLocalPause(target === "running"));
        localPauseChainRef.current = transition.catch((error) =>
          addLog("debug", "Local pause or resume failed; reported to the tap that asked for it", {
            error: String(error),
          }),
        );
        await transition.finally(settled);
        return;
      }
      const pollingPauseHandle = pollingPauseRegistry.acquirePause();
      try {
        if (target === "paused") cancelPendingUserSkip();
        await machineTransitionCoordinatorRef.current.request(target, async () => {
          const endTransition = beginMachineTransition();
          const api = getC64API();
          try {
            if (target === "running") {
              pausingFromPauseRef.current = false;
              resumingFromPauseRef.current = false;
              await resumeMachineWithRetry(api);
              endTransition(); // The unmute waits for transitions to settle: held, this one delayed it 20 s.
              await unmuteAfterMachineResume();
              isPausedRef.current = false;
              setIsPaused(false);
              // HARD12-020: publish the resumed state so Home's pause/resume converges with Play.
              writeMachineExecutionFromPlay("running");
              const now = Date.now();
              const { elapsedMs } = playbackTime.read();
              trackStartedAtRef.current = resumedTrackStartedAtMs(playlistEndedRef.current, now, elapsedMs);
              playedClockRef.current.resume(now);
              setPlayedMs(playedClockRef.current.current(now));
              rearmAutoAdvanceOnResume(now, durationMs, elapsedMs);
              return;
            }

            await muteBeforeMachinePause();
            try {
              await withTimeout(api.machinePause(), 3000, "Pause");
            } catch (pauseError) {
              await rollbackMuteAfterFailedPause(pauseError);
              throw pauseError;
            }
            const now = Date.now();
            playedClockRef.current.pause(now);
            setPlayedMs(playedClockRef.current.current(now));
            // Set now, not on the next render: a stop waiting for this pause to finish reads it straight after.
            isPausedRef.current = true;
            setIsPaused(true);
            setAutoAdvanceDueAtMs(null);
            // HARD12-020: publish the paused state and any SID pause-mute snapshot, so Home can label
            // and restore it (Play may be an unmounted placeholder when Home resumes).
            writeMachineExecutionFromPlay("paused", { pauseMutePending: pauseMuteSnapshotRef.current !== null });
          } finally {
            endTransition();
          }
        });
      } catch (error) {
        if (error instanceof SupersededMachineTransitionError) {
          return;
        }
        reportUserError({
          operation: "PLAYBACK_CONTROL",
          title: "Playback control failed",
          description: (error as Error).message,
          error,
          context: {
            isPaused,
            isPlaying,
          },
        });
      } finally {
        settled();
        pollingPauseHandle.release();
      }
    }),
    [
      durationMs,
      playbackTime,
      isPaused,
      isPlaying,
      trace,
      pauseMuteSnapshotRef,
      pausingFromPauseRef,
      resumingFromPauseRef,
      playedClockRef,
      muteBeforeMachinePause,
      rollbackMuteAfterFailedPause,
      resumeMachineWithRetry,
      unmuteAfterMachineResume,
      setAutoAdvanceDueAtMs,
      setPlayedMs,
      setIsPaused,
      trackStartedAtRef,
      rearmAutoAdvanceOnResume,
      cancelPendingUserSkip,
      playItem,
    ],
  );

  const flushPendingUserSkip = useCallback(async () => {
    const pending = pendingUserSkipRef.current;
    if (!pending) return;
    pendingUserSkipRef.current = null;
    const settle = () => {
      pending.resolvers.forEach(({ resolve }) => resolve());
    };
    const queuedSkip = (latestQueuedUserSkipRef.current += 1);
    const stopsAtSkip = stopCountRef.current;

    try {
      await enqueueUserTransport(async () => {
        // Overtaken while it waited behind a running launch: the listener has already skipped past it.
        if (queuedSkip !== latestQueuedUserSkipRef.current || stopCountRef.current !== stopsAtSkip) {
          addLog("info", "Playback skip superseded by a later skip or a Stop", { targetIndex: pending.targetIndex });
          return;
        }
        const activePlaylist = playlistRef.current;
        if (!activePlaylist.length || (!isPlayingRef.current && !isPausedRef.current)) return;
        const launchedIndex = activePlaylist.findIndex((item) => item.id === lastLaunchedItemIdRef.current);
        const activeIndex = launchedIndex >= 0 ? launchedIndex : currentIndexRef.current;
        const { originIndex, targetIndex } = resolvePendingSkipIndices(activePlaylist, pending);
        const advancedByAnotherTransition =
          trackInstanceIdRef.current !== pending.originTrackInstanceId &&
          trackInstanceIdRef.current !== lastUserSkipTrackInstanceIdRef.current;
        const anotherTransitionAdvanced =
          activeIndex !== originIndex &&
          (advancedByAnotherTransition || Boolean(autoAdvanceGuardRef.current?.autoFired));
        let resolvedTargetIndex = targetIndex;
        let resolvedStopAtEnd = pending.stopAtEnd;
        if (anotherTransitionAdvanced || targetIndex === -1) {
          const traversal = playlistTraversal(activePlaylist);
          if (pending.operation === "PLAYBACK_NEXT") {
            resolvedTargetIndex = traversal.next(activeIndex);
            resolvedStopAtEnd = resolvedTargetIndex === null;
          } else {
            resolvedTargetIndex = traversal.previous(activeIndex);
            resolvedStopAtEnd = false;
          }
        }
        if (resolvedStopAtEnd || resolvedTargetIndex === null) {
          finishPlaylistPlayback("user-next-end");
          return;
        }
        const currentItem = activePlaylist[anotherTransitionAdvanced ? activeIndex : originIndex];
        const targetItem = activePlaylist[resolvedTargetIndex];
        if (!targetItem) return;
        // Next and Previous choose no song in particular: one that needs the C64 ROMs is passed over, not asked about.
        const traversal = playlistTraversal(activePlaylist);
        const played = await playPassingOver(
          resolvedTargetIndex,
          (index) =>
            playItem(activePlaylist[index], {
              rebootBeforePlay: currentItem?.category === "disk" || activePlaylist[index]?.category === "disk",
              playlistIndex: index,
              stopsAtRequest: stopsAtSkip,
              passOverRomDependent: true,
            }),
          reachableFollowing(
            activePlaylist,
            pending.operation === "PLAYBACK_NEXT" ? traversal.next : traversal.previous,
          ),
        );
        if (!played) return finishPlaylistPlayback("user-next-end");
        lastUserSkipTrackInstanceIdRef.current = trackInstanceIdRef.current;
        setIsPaused(false);
      });
      settle();
    } catch (error) {
      reportPlaybackStartFailure({
        operation: pending.operation,
        title: pending.title,
        error,
        context: {
          originIndex: pending.originIndex,
          targetIndex: pending.targetIndex,
        },
      });
      setIsPlaying(false);
      setIsPaused(false);
      trackStartedAtRef.current = null;
      autoAdvanceGuardRef.current = null;
      setAutoAdvanceDueAtMs(null);
      settle();
    }
  }, [
    enqueueUserTransport,
    finishPlaylistPlayback,
    playItem,
    playedClockRef,
    playlistTraversal,
    setAutoAdvanceDueAtMs,
    setIsPaused,
    setIsPlaying,
    trackStartedAtRef,
    autoAdvanceGuardRef,
    trackInstanceIdRef,
  ]);

  flushPendingUserSkipRef.current = flushPendingUserSkip;

  const scheduleUserSkip = useCallback(
    (
      targetIndex: number | null,
      stopAtEnd: boolean,
      originIndex: number,
      operation: PendingUserSkip["operation"],
      title: PendingUserSkip["title"],
    ) =>
      new Promise<void>((resolve) => {
        setSoundingTune(null);
        const pending = pendingUserSkipRef.current;
        if (pending?.timer !== null && pending?.timer !== undefined) {
          window.clearTimeout(pending.timer);
        }
        const resolvers = pending?.resolvers ?? [];
        resolvers.push({ resolve });
        pendingUserSkipRef.current = {
          timer: window.setTimeout(() => {
            const currentPending = pendingUserSkipRef.current;
            if (currentPending) {
              currentPending.timer = null;
            }
            void flushPendingUserSkip();
          }, USER_TRANSPORT_COALESCE_MS),
          originIndex: pending?.originIndex ?? originIndex,
          originItemId: pending?.originItemId ?? playlistRef.current[originIndex]?.id,
          targetItemId: targetIndex === null ? undefined : playlistRef.current[targetIndex]?.id,
          originTrackInstanceId: pending?.originTrackInstanceId ?? trackInstanceIdRef.current,
          targetIndex,
          stopAtEnd,
          operation,
          title,
          resolvers,
        };
      }),
    [flushPendingUserSkip, trackInstanceIdRef],
  );

  useEffect(
    () => () => {
      const pending = pendingUserSkipRef.current;
      if (!pending) return;
      if (pending.timer !== null) {
        window.clearTimeout(pending.timer);
      }
      if (isPlayingRef.current || isPausedRef.current) {
        pending.timer = null;
        void flushPendingUserSkipRef.current();
        return;
      }
      pendingUserSkipRef.current = null;
      pending.resolvers.forEach(({ resolve }) => resolve());
    },
    [],
  );

  /** The next track in playing order and, with the device out of reach, the first from there that can play without it. */
  const resolveReachableNextIndex = useCallback(
    (activePlaylist: PlaylistItem[], fromIndex: number, automatic = false) => {
      const traversal = playlistTraversal(activePlaylist);
      const following = traversal.next;
      const nextIndex =
        automatic && repeatOneEnabled && !stationFinishingRef?.current ? fromIndex : following(fromIndex);
      const reachableIndex =
        nextIndex === null || !isDeviceOutOfReach()
          ? nextIndex
          : firstPlayableWithoutDevice(activePlaylist, nextIndex, following);
      return { nextIndex, reachableIndex };
    },
    [playlistTraversal, repeatOneEnabled, stationFinishingRef],
  );

  scheduleNextTunePrefetchRef.current = (fromIndex, remainingMs) => {
    const reachableIndex =
      fromIndex < 0 ? null : resolveReachableNextIndex(playlistRef.current, fromIndex, true).reachableIndex;
    nextTunePrefetch.schedule(reachableIndex === null ? null : playlistRef.current[reachableIndex], remainingMs);
  };

  // With nothing playing a skip only chooses the track, which showed the last tune's length and a full bar.
  const showChosenTrackWhileStopped = useCallback(
    (index: number) => {
      if (isPlayingRef.current || isPausedRef.current) return;
      setElapsedMs(0);
      setDurationMs(playlistRef.current[index]?.durationMs);
    },
    [setDurationMs, setElapsedMs],
  );

  const handleNext = useCallback(
    async (source: "auto" | "user" = "user", expectedTrackInstanceId?: number) => {
      if (source === "user") {
        const activePlaylist = playlistRef.current;
        if (!activePlaylist.length) return;
        cancelAutoAdvance();
        const activeIndex = currentIndexRef.current;
        const next = resolveReachableNextIndex(activePlaylist, activeIndex);
        const nextIndex = next.reachableIndex ?? next.nextIndex;
        const now = Date.now();
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        if (nextIndex === null) {
          await scheduleUserSkip(null, true, activeIndex, "PLAYBACK_NEXT", "Playback next failed");
          return;
        }
        setVisibleCurrentIndex(nextIndex);
        showChosenTrackWhileStopped(nextIndex);
        await scheduleUserSkip(nextIndex, false, activeIndex, "PLAYBACK_NEXT", "Playback next failed");
        return;
      }

      const runTransition = async () => {
        const activePlaylist = playlistRef.current;
        if (!activePlaylist.length) return;
        const guard = autoAdvanceGuardRef.current;
        if (!guard || guard.autoFired || guard.userCancelled) return;
        if (typeof expectedTrackInstanceId === "number" && guard.trackInstanceId !== expectedTrackInstanceId) return;
        // HARD19-009: never auto-advance onto a machine that is currently paused
        // (e.g. paused from Home). The store subscription normally clears the
        // due-time on an external pause, but this also covers the native
        // background-execution watchdog, which can fire handleNext("auto")
        // independently of the JS timer.
        if (getMachineExecutionSnapshot().state === "paused") return;
        guard.autoFired = true;

        const activeIndex = currentIndexRef.current;
        const { nextIndex, reachableIndex } = resolveReachableNextIndex(activePlaylist, activeIndex, true);
        const now = Date.now();
        // Advanced early to crossfade into a next tune that does not exist: let this one play to its end.
        const durationNowMs = durationMsRef.current ?? 0;
        const endsAtMs = (trackStartedAtRef.current ?? now) + durationNowMs;
        const deferredDueAtMs =
          nextIndex === null && crossfadeLeadMs(durationNowMs, currentPlaybackIsLocalRef.current) > 0
            ? deferralToTuneEndMs(guard.deferredToEnd === true, now, endsAtMs)
            : null;
        if (deferredDueAtMs !== null) {
          guard.autoFired = false;
          guard.deferredToEnd = true;
          guard.dueAtMs = deferredDueAtMs;
          setAutoAdvanceDueAtMs(deferredDueAtMs);
          return;
        }
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        const currentItem = activePlaylist[activeIndex];
        if (nextIndex === null) {
          finishPlaylistPlayback("auto-end");
          return;
        }

        try {
          if (reachableIndex === null) {
            // Away from the device, with nothing left that plays without it: stop here, without an error.
            addLog("info", "Playback stopped: the tracks that follow need the C64", { currentIndex: activeIndex });
            const unreachable = new Error(DEVICE_NOT_CONNECTED_MESSAGE);
            markPlaybackErrorReported(unreachable);
            throw unreachable;
          }
          const played = await playPassingOver(
            reachableIndex,
            (index) =>
              playItem(activePlaylist[index], {
                rebootBeforePlay: currentItem?.category === "disk" || activePlaylist[index]?.category === "disk",
                playlistIndex: index,
                origin: "auto",
                outgoingSonglengthMs: durationNowMs,
                romDependencyAccepted: index === activeIndex,
              }),
            (index) => resolveReachableNextIndex(activePlaylist, index).reachableIndex,
          );
          if (!played) return finishPlaylistPlayback("auto-end");
          setIsPaused(false);
        } catch (error) {
          if (!isPlaybackErrorReported(error)) {
            reportUserError({
              operation: "PLAYBACK_NEXT",
              title: "Playback next failed",
              description: (error as Error).message,
              error,
              context: {
                currentIndex: activeIndex,
                nextIndex,
                source,
              },
            });
          }
          // The finished tune must not stay open on the phone once the playlist has stopped here.
          if (currentPlaybackIsLocalRef.current) {
            getLocalSidPlayback().stop();
            setCurrentPlaybackIsLocal(false);
          }
          setIsPlaying(false);
          setIsPaused(false);
          trackStartedAtRef.current = null;
          autoAdvanceGuardRef.current = null;
          setAutoAdvanceDueAtMs(null);
        }
      };

      await runTransition();
    },
    [
      cancelAutoAdvance,
      finishPlaylistPlayback,
      getLocalSidPlayback,
      setCurrentPlaybackIsLocal,
      playItem,
      resolveReachableNextIndex,
      playedClockRef,
      scheduleUserSkip,
      setVisibleCurrentIndex,
      showChosenTrackWhileStopped,
      setAutoAdvanceDueAtMs,
      setPlayedMs,
      setIsPlaying,
      setIsPaused,
      autoAdvanceGuardRef,
      trackStartedAtRef,
    ],
  );

  const handlePrevious = useCallback(async () => {
    const activePlaylist = playlistRef.current;
    if (!activePlaylist.length) return;
    const activeIndex = currentIndexRef.current;
    const traversal = playlistTraversal(activePlaylist);
    const preceding = traversal.previous;
    const previousIndex = preceding(activeIndex);
    const prevIndex =
      previousIndex !== null && isDeviceOutOfReach()
        ? (firstPlayableWithoutDevice(activePlaylist, previousIndex, preceding) ?? previousIndex)
        : previousIndex;
    cancelAutoAdvance();
    const now = Date.now();
    playedClockRef.current.pause(now);
    setPlayedMs(playedClockRef.current.current(now));
    setVisibleCurrentIndex(prevIndex);
    showChosenTrackWhileStopped(prevIndex);
    await scheduleUserSkip(prevIndex, false, activeIndex, "PLAYBACK_PREVIOUS", "Playback previous failed");
  }, [
    cancelAutoAdvance,
    playlistTraversal,
    playedClockRef,
    setPlayedMs,
    scheduleUserSkip,
    setVisibleCurrentIndex,
    showChosenTrackWhileStopped,
  ]);

  const shownDuration = useMemo(
    () => ({ currentIndex, durationMs, durationMsItemId, isPlaying, isPaused, fallbackMs: durationFallbackMs }),
    [currentIndex, durationFallbackMs, durationMs, durationMsItemId, isPlaying, isPaused],
  );
  const playlistItemDuration = useCallback(
    (item: PlaylistItem, index: number) => resolveShownItemDurationMs(item, index, shownDuration),
    [shownDuration],
  );
  const chosenTrackLaunching = isChosenTrackLaunching(playlist[currentIndex], shownDuration);

  /**
   * Scrub the locally-played tune. Returns undefined when nothing is playing
   * on-device, so the Play page can hide the gesture entirely rather than
   * offering a control that silently does nothing — the C64 plays the SID
   * itself and cannot be scrubbed.
   */
  /**
   * Move the auto-advance deadline to match a new playback position.
   *
   * The deadline is set once, at launch, as "now + the tune's remaining
   * duration". Seeking rebases the clocks but used to leave that deadline
   * alone, so a tune scrubbed forward kept playing well past its end — jumping
   * to 95% of a 4:28 tune left it still playing at 4:57, because the original
   * schedule had not expired yet. Every seek has to reschedule it.
   */
  const rescheduleAutoAdvance = useCallback(
    (positionMs: number) => {
      const guard = autoAdvanceGuardRef.current;
      const durationMs = durationMsRef.current;
      if (!guard || !durationMs) return;
      const dueAtMs = Date.now() + autoAdvanceDelayMs(durationMs, positionMs, currentPlaybackIsLocalRef.current);
      guard.dueAtMs = dueAtMs;
      guard.autoFired = false;
      setAutoAdvanceDueAtMs(dueAtMs);
    },
    [autoAdvanceGuardRef, durationMsRef, setAutoAdvanceDueAtMs],
  );

  // Neither wall clock behind the progress display knows the engine; a seek that skips this looks like it did nothing.
  const rebasePlaybackPosition = useCallback(
    (positionMs: number) => {
      const { elapsedMs } = playbackTime.read();
      const clockTarget = { positionMs, elapsedMs, paused: isPausedRef.current, now: Date.now() };
      setPlayedMs(seekPlaybackClocks(playedClockRef.current, trackStartedAtRef, clockTarget));
      setElapsedMs(positionMs);
      rescheduleAutoAdvance(positionMs);
    },
    [playbackTime, playedClockRef, setPlayedMs, setElapsedMs, trackStartedAtRef, rescheduleAutoAdvance],
  );

  /**
   * Scrubbing (hold-to-seek) state.
   *
   * The engine is deliberately NOT driven once per repeat tick. Seeking
   * backwards reloads the tune and re-renders up to the target, so issuing one
   * seek every 200 ms queues work far faster than it completes and the UI ends
   * up chasing a seek from seconds ago. Instead the *target* moves instantly —
   * that is what the progress bar follows, so the feedback is immediate — and
   * the engine is sent to wherever the finger is NOW, at most one seek in
   * flight at a time.
   *
   * Letting the engine play between those seeks is what produces the
   * CD-player-style preview: each catch-up lands at a new position and a short
   * burst of the tune is heard there before the next one.
   */
  const scrubTargetMsRef = useRef<number | null>(null);
  const [scrubTargetMs, setScrubTargetMs] = useState<number | null>(null);
  const scrubTimerRef = useRef<number | null>(null);
  const scrubDurationMsRef = useRef<number | undefined>(undefined);
  const scrubEndingRef = useRef(false);
  const dragSettleRef = useRef<number | null>(null);

  const beginScrub = useCallback(
    (durationMs?: number) => {
      const controller = getLocalSidPlayback();
      if (!controller) return;
      scrubDurationMsRef.current = durationMs;
      const startMs = Math.max(0, controller.positionSeconds() * 1000);
      scrubTargetMsRef.current = startMs;
      setScrubTargetMs(startMs);
      if (scrubTimerRef.current === null) {
        // No repeating seek while the gesture is held, for the same reason the drag does not: each one
        // re-renders the tune from the start, so a held gesture queued far more work than it completed
        // and playback stayed silent. The release seeks once, to where the listener actually stopped.
        scrubTimerRef.current = null;
      }
    },
    [getLocalSidPlayback],
  );

  const scrubBy = useCallback((deltaSeconds: number) => {
    if (scrubTargetMsRef.current === null) return;
    const max = scrubDurationMsRef.current;
    const next = Math.max(0, Math.min(max ?? Number.MAX_SAFE_INTEGER, scrubTargetMsRef.current + deltaSeconds * 1000));
    scrubTargetMsRef.current = next;
    setScrubTargetMs(next);
  }, []);

  const endScrub = useCallback(async () => {
    // The gesture ends on pointerup, pointerleave AND pointercancel, so this can
    // be called more than once for one release. Without this guard the second
    // call found the target already taken and cleared the display immediately,
    // showing the pre-scrub position for as long as the real seek took to land
    // (~1.4 s on a rewind) before jumping to where the user actually let go.
    if (scrubEndingRef.current) return;
    scrubEndingRef.current = true;
    if (scrubTimerRef.current !== null) {
      window.clearInterval(scrubTimerRef.current);
      scrubTimerRef.current = null;
    }
    const controller = getLocalSidPlayback();
    const target = scrubTargetMsRef.current;
    scrubTargetMsRef.current = null;
    if (!controller || target === null) {
      setScrubTargetMs(null);
      scrubEndingRef.current = false;
      return;
    }
    // Rebase the clocks to the TARGET before awaiting the seek: a read-back after seekTo is stale, and
    // clearing after the await showed the drifted position (1:25 after scrubbing to 0:33) for a rewind.
    const positionMs = Math.max(0, target);
    rebasePlaybackPosition(positionMs);
    try {
      // Raced, not just guarded. A `try/finally` only covers a seek that *rejects*; one that never
      // settles never returns from the await, so the `finally` would not run either and the scrub
      // would latch exactly as before. The release has to be able to happen without the engine.
      await Promise.race([
        controller.seekTo(target / 1000),
        new Promise<void>((resolve) => setTimeout(resolve, SCRUB_RELEASE_WAIT_MS)),
      ]);
    } catch (error) {
      addLog("warn", "Local SID scrub seek failed on release", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        toSeconds: positionMs / 1000,
        itemId: playlistRef.current[currentIndexRef.current]?.id,
      });
    } finally {
      // Always leave the scrub, whatever the seek did.
      //
      // These two lines used to sit after a bare await, so a seek that rejected —
      // or never settled — left `scrubEndingRef` latched true and the scrub
      // target on screen. That is not one lost gesture: the latch makes
      // every later `endScrub` return at its re-entry guard, so hold-to-seek is
      // dead for the rest of the session and the timer keeps showing a position
      // playback has left. Releasing the gesture must not depend on the engine.
      //
      // Clearing the target last is still deliberate: releasing it before the
      // engine lands makes the timer snap back to the pre-scrub position for a
      // frame (0:15 after scrubbing to 1:09) before jumping forward, which reads
      // as the seek having failed and corrected itself.
      setScrubTargetMs(null);
      scrubEndingRef.current = false;
    }
    addLog("debug", "Local SID scrub ended", { toSeconds: positionMs / 1000 });
  }, [rebasePlaybackPosition]);

  /**
   * Jump to a fraction of the tune (tapping/dragging the progress bar).
   *
   * Coalesced through the same one-in-flight path as a scrub, because dragging
   * emits a position per pointermove and seeking backwards re-renders the tune
   * from the start — issuing one seek per move would queue work far faster than
   * it completes.
   */
  const seekToFraction = useCallback(
    (fraction: number, durationMs?: number) => {
      const controller = getLocalSidPlayback();
      if (!controller || !durationMs) return;
      const target = Math.max(0, Math.min(durationMs, fraction * durationMs));
      scrubDurationMsRef.current = durationMs;
      scrubTargetMsRef.current = target;
      setScrubTargetMs(target);
      // NO seek while the finger is down — only the bar moves. Every seek costs a full re-render from
      // the start of the tune, because libsidplayfp cannot rewind: on a Pixel 4 that is ten to twenty
      // seconds for a position deep into a tune. Issuing one per settle interval queued minutes of work
      // for positions the listener had already dragged past, and playback stayed silent throughout —
      // reproduced on the device as a drag that never resumed. Only where the finger is lifted matters.
      // Land shortly after the finger stops moving; another move restarts it.
      if (dragSettleRef.current !== null) window.clearTimeout(dragSettleRef.current);
      dragSettleRef.current = window.setTimeout(() => {
        dragSettleRef.current = null;
        void endScrub();
      }, DRAG_SETTLE_MS);
    },
    [endScrub, getLocalSidPlayback],
  );

  const handleSeekBy = useCallback(
    async (deltaSeconds: number) => {
      const controller = getLocalSidPlayback();
      if (!controller) {
        addLog("debug", "Local SID seek ignored: no on-device controller", { deltaSeconds });
        return;
      }
      const fromSeconds = controller.positionSeconds();
      await controller.seekBy(deltaSeconds);
      const positionMs = Math.max(0, controller.positionSeconds() * 1000);
      rebasePlaybackPosition(positionMs);
      addLog("debug", "Local SID seek", { deltaSeconds, fromSeconds, toSeconds: positionMs / 1000 });
    },
    [rebasePlaybackPosition],
  );
  seekByRef.current = handleSeekBy;

  useRemotePlaybackHandover({
    playlistRef,
    soundingTuneRef,
    soundingTune,
    isPlayingRef,
    isPausedRef,
    currentPlaybackIsLocalRef,
    trackStartedAtRef,
    durationMsRef,
    isPlaying,
    isPaused,
    localEngineActive,
    durationMs,
    getLocalSidPlayback,
    setCurrentPlaybackIsLocal,
    resolveHvscRuntimeRequest,
    resolveNextIndex: (from) => resolveReachableNextIndex(playlistRef.current, from).reachableIndex,
    playItem,
    seekBy: handleSeekBy,
    playGenerationRef,
  });

  return {
    pauseShown: requestedPause ?? isPaused,
    beginScrub,
    scrubBy,
    endScrub,
    seekToFraction,
    scrubTargetMs,
    playItem,
    startPlaylist,
    handlePlay,
    handleStop,
    handlePauseResume,
    handleNext,
    handlePrevious,
    handleSeekBy,
    rebasePlaybackPosition,
    playlistEnded,
    setPlaylistEnded,
    resolveSidMetadata,
    resolveUltimateSidDurationByMd5,
    playlistItemDuration,
    chosenTrackLaunching,
    setDurationMsItemId,
    withTimeout,
  };
}
