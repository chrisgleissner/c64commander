/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { createArchiveClient } from "@/lib/archive/client";
import { getCachedArchivePlayback, setCachedArchivePlayback } from "@/lib/archive/archivePlaybackCache";
import { buildArchivePlayPlan } from "@/lib/archive/execution";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import { getC64API } from "@/lib/c64api";
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
import { isAbortLikeError } from "@/lib/c64api/requestRuntime";
import { reportUserError } from "@/lib/uiErrors";
import { toast } from "@/hooks/use-toast";
import {
  buildPlayPlan,
  executePlayPlan,
  tryFetchUltimateSidBlob,
  type LocalPlayFile,
  type PlayRequest,
} from "@/lib/playback/playbackRouter";
import { getHvscDurationsByMd5Seconds } from "@/lib/hvsc";
import {
  getLocalFilePath,
  isSongCategory,
  resolvePlayTargetIndex,
  tryAcquireSingleFlight,
  releaseSingleFlight,
} from "@/pages/playFiles/playFilesUtils";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";

import { buildLocalPlayFileFromUri, buildLocalPlayFileFromTree } from "@/lib/playback/fileLibraryUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { resolveSidMutedVolumeOption } from "@/lib/config/sidVolumeControl";
import {
  applyConfigFileReference,
  ensureConfigFileReferenceAccessible,
  isConfigReferenceUnavailableError,
} from "@/lib/config/applyConfigFileReference";
import { buildPlaybackConfigSignature, resolveStoredConfigOrigin } from "@/lib/config/playbackConfig";
import {
  resolveNextPlaylistIndex,
  resolvePreviousPlaylistIndex,
  type AudioMixerItem,
} from "@/pages/playFiles/playFilesUtils";
import type { VolumeAction } from "@/pages/playFiles/volumeState";
import type { SidEnablement } from "@/lib/config/sidVolumeControl";

type HandledUiError = Error & { c64uHandled?: boolean };

const markHandledUiError = (error: unknown) => {
  if (error instanceof Error) {
    (error as HandledUiError).c64uHandled = true;
  }
};

const isHandledUiError = (error: unknown): error is HandledUiError =>
  error instanceof Error && Boolean((error as HandledUiError).c64uHandled);

/**
 * The md5-fallback duration lookup is per-subsong (HVSC durations are indexed
 * songNr - 1, mirroring the local songlengths backend), so a bare
 * `getHvscDurationByMd5Seconds` call silently returns subsong 1's length for
 * any other songNr. See HARD11-004 (related facet).
 */
const resolveHvscDurationSecondsForSongNr = async (md5: string, songNr?: number | null): Promise<number | null> => {
  const durations = await getHvscDurationsByMd5Seconds(md5);
  if (!durations?.length) return null;
  const index = songNr && songNr > 0 ? songNr - 1 : 0;
  if (index < 0 || index >= durations.length) return null;
  return durations[index] ?? null;
};

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

type PendingUserSkip = {
  timer: number | null;
  originIndex: number;
  originTrackInstanceId: number;
  targetIndex: number | null;
  stopAtEnd: boolean;
  operation: "PLAYBACK_NEXT" | "PLAYBACK_PREVIOUS";
  title: "Playback next failed" | "Playback previous failed";
  resolvers: Array<{
    resolve: () => void;
  }>;
};

type RuntimePlaybackRequest = {
  request: PlayRequest;
  path: string;
};

export const USER_TRANSPORT_COALESCE_MS = 120;

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
  shuffleEnabled: boolean;
  shuffleSeed: number | null;

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

  // Refs
  // HARD12-007: the second parameter is `reset` (whether to zero the cumulative
  // base), not `playing`. The earlier `playing: boolean` typing invited the
  // regression where every track start passed `true`, resetting the cumulative
  // "Remaining" clock each track.
  playedClockRef: MutableRefObject<{
    start: (now: number, reset?: boolean) => void;
    stop: (now: number, reset?: boolean) => void;
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
  shuffleEnabled,
  shuffleSeed,
  localEntriesBySourceId,
  localSourceTreeUris,
  buildHvscLocalPlayFile,
  deviceProduct,
  ensurePlaybackConnection,
  resolveUnavailableConfigDecision,
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
  const machineTransitionCoordinatorRef = useRef(createMachineTransitionCoordinator());
  const lastAppliedPlaybackConfigSignatureRef = useRef<string | null>(null);
  const sessionDeclinedPlaybackConfigRef = useRef(new Map<string, string>());
  const playlistRef = useRef(playlist);
  const currentIndexRef = useRef(currentIndex);
  const isPlayingRef = useRef(isPlaying);
  const isPausedRef = useRef(isPaused);
  // HARD12-018: tracks that the last song in the playlist auto-ended so that
  // background execution can stop even though `isPlaying` stays true (the Stop
  // affordance must remain available). Reset whenever a new track starts.
  const [playlistEnded, setPlaylistEnded] = useState(false);
  const userTransportQueueRef = useRef(Promise.resolve());
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
  // HARD18-009 (M5): monotonic play-generation counter, mirroring the
  // machineTransitionCoordinator supersede pattern. Both handleStop and
  // playItem bump it on entry to a fresh, uniquely-owned value; whichever
  // holds the current value when an in-flight transition's async work
  // resolves is authoritative. Stop always bumps immediately (never queued);
  // playItem bumps its own too, so a rapid Play right after a Stop is never
  // mistaken for the transition the Stop just superseded.
  const playGenerationRef = useRef(0);

  playlistRef.current = playlist;
  currentIndexRef.current = currentIndex;
  isPlayingRef.current = isPlaying;
  isPausedRef.current = isPaused;

  // HARD19-009: refs synced during render so the machine-execution subscription
  // below can re-arm auto-advance on an external resume without depending on
  // (and re-subscribing for) every elapsed/duration change.
  const durationMsRef = useRef(durationMs);
  durationMsRef.current = durationMs;
  const elapsedMsRef = useRef(elapsedMs);
  elapsedMsRef.current = elapsedMs;
  // Set while Play performs its OWN machine-execution write so the subscription
  // ignores it and only mirrors EXTERNAL transitions (e.g. a Home pause).
  const playInitiatedMachineTransitionRef = useRef(false);

  const writeMachineExecutionFromPlay = useCallback(
    (next: "running" | "paused", options?: { pauseMutePending?: boolean }) => {
      playInitiatedMachineTransitionRef.current = true;
      try {
        if (next === "paused") {
          // HARD21-004: tag Play's own pause with source "play" so opening then
          // closing the Home Ultimate menu never resumes a pause the user set
          // from Play (the menu-close resume only re-runs a pausedBy === "menu").
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
          error: (error as Error).message,
        });
        await withTimeout(api.machineResume(), 6000, "Resume");
      }
    },
    [withTimeout],
  );

  const muteBeforeMachinePause = useCallback(async () => {
    if (!enabledSidVolumeItems.length) {
      pauseMuteSnapshotRef.current = null;
      pausingFromPauseRef.current = false;
      resumingFromPauseRef.current = false;
      addLog("warn", "Playback pause mute skipped because no cached SID mixer items are available");
      return;
    }
    const items = enabledSidVolumeItems;
    const snapshot = captureSidMuteSnapshot(items, sidEnablement);
    const updates = buildEnabledSidMuteUpdates(items, sidEnablement);
    pauseMuteSnapshotRef.current = snapshot;
    pausingFromPauseRef.current = true;
    resumingFromPauseRef.current = false;
    dispatchVolume({ type: "mute", reason: "pause" });
    if (Object.keys(updates).length) {
      await applyAudioMixerUpdates(updates, "Pause mute");
    }
    addLog("info", "Playback pause mute applied", {
      sidOutputCount: items.length,
      updateCount: Object.keys(updates).length,
    });
  }, [
    applyAudioMixerUpdates,
    buildEnabledSidMuteUpdates,
    captureSidMuteSnapshot,
    dispatchVolume,
    enabledSidVolumeItems,
    pauseMuteSnapshotRef,
    pausingFromPauseRef,
    resumingFromPauseRef,
    sidEnablement,
  ]);

  const unmuteAfterMachineResume = useCallback(async () => {
    const snapshot = pauseMuteSnapshotRef.current;
    const currentItems = enabledSidVolumeItems.length ? enabledSidVolumeItems : undefined;
    let updates = snapshotToUpdates(snapshot, currentItems);
    if (!Object.keys(updates).length && snapshot) {
      updates = snapshotToUpdates(snapshot);
    }
    if (Object.keys(updates).length) {
      await applyAudioMixerUpdates(updates, "Resume unmute");
    } else {
      await ensureUnmuted({ force: true, refreshItems: true });
    }
    pauseMuteSnapshotRef.current = null;
    pausingFromPauseRef.current = false;
    resumingFromPauseRef.current = true;
    dispatchVolume({ type: "unmute", reason: "pause" });
    addLog("info", "Playback resume unmute applied", {
      updateCount: Object.keys(updates).length,
    });
  }, [
    applyAudioMixerUpdates,
    dispatchVolume,
    enabledSidVolumeItems,
    ensureUnmuted,
    pauseMuteSnapshotRef,
    pausingFromPauseRef,
    resumingFromPauseRef,
    snapshotToUpdates,
  ]);

  const rollbackMuteAfterFailedPause = useCallback(
    async (pauseError: unknown) => {
      const snapshot = pauseMuteSnapshotRef.current;
      if (!snapshot && !pausingFromPauseRef.current) return;
      try {
        const currentItems = enabledSidVolumeItems.length ? enabledSidVolumeItems : undefined;
        let updates = snapshotToUpdates(snapshot, currentItems);
        if (!Object.keys(updates).length && snapshot) {
          updates = snapshotToUpdates(snapshot);
        }
        if (Object.keys(updates).length) {
          await applyAudioMixerUpdates(updates, "Pause mute rollback");
        } else {
          await ensureUnmuted({ force: true, refreshItems: true });
        }
        dispatchVolume({ type: "unmute", reason: "pause" });
        addLog("warn", "Playback pause mute rolled back after machine pause failed", {
          updateCount: Object.keys(updates).length,
          pauseError: pauseError instanceof Error ? pauseError.message : String(pauseError),
        });
      } catch (rollbackError) {
        addErrorLog("Playback pause mute rollback failed", {
          error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          pauseError: pauseError instanceof Error ? pauseError.message : String(pauseError),
        });
      } finally {
        pauseMuteSnapshotRef.current = null;
        pausingFromPauseRef.current = false;
        resumingFromPauseRef.current = false;
      }
    },
    [
      applyAudioMixerUpdates,
      dispatchVolume,
      enabledSidVolumeItems,
      ensureUnmuted,
      pauseMuteSnapshotRef,
      pausingFromPauseRef,
      resumingFromPauseRef,
      snapshotToUpdates,
    ],
  );

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

  const resolveSidMetadata = useCallback(
    async (file?: LocalPlayFile, songNr?: number | null) => {
      if (!file)
        return {
          durationMs: undefined,
          subsongCount: undefined,
          readable: false,
        } as const;
      let buffer: ArrayBuffer;
      try {
        buffer = await file.arrayBuffer();
      } catch (error) {
        addErrorLog("Failed to read local SID file", {
          error: (error as Error).message,
        });
        return {
          durationMs: durationFallbackMs,
          subsongCount: undefined,
          readable: false,
        } as const;
      }
      const { getSidSongCount } = await import("@/lib/sid/sidUtils");
      const subsongCount = getSidSongCount(buffer);

      try {
        const filePath = getLocalFilePath(file);
        const localDurationMs = await resolveSonglengthDurationMsForPath(filePath, file, songNr ?? null);
        if (localDurationMs !== null) {
          return {
            durationMs: localDurationMs,
            subsongCount,
            readable: true,
          } as const;
        }

        const { computeSidMd5 } = await import("@/lib/sid/sidUtils");
        const md5 = await computeSidMd5(buffer);
        const seconds = await resolveHvscDurationSecondsForSongNr(md5, songNr);
        const durationMs = seconds !== undefined && seconds !== null ? seconds * 1000 : durationFallbackMs;
        return { durationMs, subsongCount, readable: true } as const;
      } catch (error) {
        addErrorLog("Failed to resolve SID metadata", {
          error: (error as Error).message,
          file: file.name,
        });
        return {
          durationMs: durationFallbackMs,
          subsongCount,
          readable: true,
        } as const;
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
        const { computeSidMd5 } = await import("@/lib/sid/sidUtils");
        const md5 = await computeSidMd5(buffer);
        const seconds = await resolveHvscDurationSecondsForSongNr(md5, songNr);
        if (seconds === undefined || seconds === null) return null;
        return seconds * 1000;
      } catch (error) {
        addLog("debug", "Ultimate SID MD5 duration lookup failed", { path });
        addErrorLog("Ultimate SID MD5 duration lookup failed", {
          path,
          error: (error as Error).message,
        });
        return null;
      }
    },
    [],
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
      // Song categories (sid/mod) do not self-stop: the C64 keeps the tune
      // playing audibly past its resolved songlength. Flipping isPlaying to
      // false here (as prg/crt/disk correctly do, since a reset would destroy
      // their running session) would leave the device playing with no Stop
      // affordance - the combined Play/Stop button derives its label from
      // isPlaying. Keep isPlaying true so Stop stays reachable and issues its
      // normal silence/reset through handleStop(). See HARD11-003.
      const deviceStillPlaying = Boolean(currentItem && isSongCategory(currentItem.category));
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
      playedClockRef,
      setAutoAdvanceDueAtMs,
      setElapsedMs,
      setIsPaused,
      setIsPlaying,
      setPlayedMs,
    ],
  );

  const playItem = useCallback(
    async (
      item: PlaylistItem,
      options?: { rebootBeforePlay?: boolean; playlistIndex?: number; playlistSize?: number },
    ) => {
      return enqueuePlayTransition(async () => {
        // HARD18-009 (M5): claim a fresh generation for this transition. If
        // Stop (or a later Play) bumps past it while we are mid-flight, our
        // post-launch state writes below are skipped and the launch is
        // corrected with a follow-up reset instead.
        const myPlayGeneration = (playGenerationRef.current += 1);
        // Starting a track (Next/Previous/row-tap) from a paused state bypasses
        // handlePauseResume, which is the only other place these pause-mute
        // bookkeeping refs are cleared. Left stale, pausingFromPauseRef alone
        // permanently disables the volume device-sync effect. See HARD9-063.
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
            markHandledUiError(error);
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
            markHandledUiError(error);
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
          throw error;
        }
        await ensureUnmuted({ refreshItems: true });
        const api = getC64API();
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
            throw error;
          }
        }
        const resolvedDurationBase = durationOverride ?? item.durationMs;
        const request: PlayRequest =
          typeof resolvedDurationBase === "number"
            ? { ...effectiveRequest, durationMs: resolvedDurationBase }
            : effectiveRequest;
        const plan = buildPlayPlan(request);
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
                    markHandledUiError(error);
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
                  markHandledUiError(error);
                  throw error;
                }
              }
            : null;
        if (item.category === "disk") {
          lastAppliedPlaybackConfigSignatureRef.current = null;
        }
        const executionOptions = {
          ...(shouldReboot ? { rebootBeforeMount: true } : {}),
          ...(applyPlaybackConfigBeforeLaunch ? { beforeLaunch: applyPlaybackConfigBeforeLaunch } : {}),
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
        await executePlayPlan(api, plan, executionOptions);

        if (playGenerationRef.current !== myPlayGeneration) {
          // HARD18-009 (M5): Stop (or a later Play) superseded this
          // transition while the launch was in flight. The launch already
          // reached the device (executePlayPlan resolved), so correct it
          // with a follow-up reset instead of leaving the just-launched
          // track running on a machine the user told to stop - and skip
          // every state write below, which would otherwise silently
          // re-assert isPlaying/auto-advance over Stop's own state.
          addLog("info", "Playback launch superseded by Stop; issuing follow-up reset", {
            itemId: item.id,
            label: item.label,
          });
          try {
            await withTimeout(api.machineReset(), STOP_MACHINE_TIMEOUT_MS, "Reset");
          } catch (error) {
            addErrorLog("Follow-up reset after superseded playback launch failed", {
              itemId: item.id,
              label: item.label,
              error: (error as Error).message,
            });
          }
          return;
        }

        const now = Date.now();
        const nextTrackInstanceId = trackInstanceIdRef.current + 1;
        trackInstanceIdRef.current = nextTrackInstanceId;
        setTrackInstanceId(nextTrackInstanceId);
        setElapsedMs(0);
        setDurationMs(resolvedDuration);
        if (isSongCategory(item.category)) {
          setCurrentSubsongCount(subsongCount ?? item.subsongCount ?? null);
        } else {
          setCurrentSubsongCount(null);
        }
        if (typeof options?.playlistIndex === "number" && options.playlistIndex >= 0) {
          setVisibleCurrentIndex(options.playlistIndex);
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
            dueAtMs: now + resolvedDuration,
            autoFired: false,
            userCancelled: false,
          };
          setAutoAdvanceDueAtMs(autoAdvanceGuardRef.current.dueAtMs);
        } else {
          autoAdvanceGuardRef.current = null;
          setAutoAdvanceDueAtMs(null);
        }
        // HARD19-021: a written duration that came from the default fallback
        // (nothing resolved: resolvedDurationBase === undefined) MUST carry the
        // `durationSource: "default"` marker so applySonglengthsToItems can
        // re-resolve it once songlengths become available. Without the marker
        // the fallback 3:00 is indistinguishable from a genuinely resolved
        // songlength and pins the item forever (HARD9-008 introduced the marker
        // for exactly this reason). A genuinely resolved duration leaves the
        // existing marker untouched (a user's manual "Default duration" slider
        // override must survive playback).
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
        // HARD23-004: playItem is the shared launch primitive for Play, Next,
        // Previous, and auto-advance. startPlaylist/resume assert the shared
        // machine-execution store as "running", but a user Next/Previous skip
        // reaches the device only through playItem — so skipping from a paused
        // session (a restored/paused queue, or pause-then-Next) left the store
        // stuck "paused" while audio actually played. That stale "paused" both
        // mislabelled Home's Pause/Resume control AND permanently gated
        // auto-advance (handleNext "auto" returns early when the store reads
        // paused), so every track overran its songlength forever. Assert
        // "running" here — the single point where a track has actually launched.
        writeMachineExecutionFromPlay("running");
        setIsPlaying(true);
        setIsPaused(false);
      });
    },
    [
      durationFallbackMs,
      deviceProduct,
      enqueuePlayTransition,
      ensurePlaybackConnection,
      resolveUnavailableConfigDecision,
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

  // A foreground play start that is superseded/aborted by a routing change must
  // still give the user feedback, but as a notice rather than a destructive
  // error: the device target changed mid-start, so "press Play again" is the
  // correct recovery, not an alarm (ERROR_POLICY §2 vs §3 boundary).
  const reportPlaybackStartFailure = useCallback(
    (report: { operation: string; title: string; error: unknown; context?: Record<string, unknown> }) => {
      if (isAbortLikeError(report.error)) {
        reportUserError({
          operation: report.operation,
          title: "Playback interrupted",
          description: "The connection changed while starting playback. Press Play again.",
          error: report.error,
          context: report.context,
          severity: "S2",
        });
        return;
      }
      reportUserError({
        operation: report.operation,
        title: report.title,
        description: (report.error as Error).message,
        error: report.error,
        context: report.context,
      });
    },
    [],
  );

  const startPlaylist = useCallback(
    async (items: PlaylistItem[], startIndex = 0) => {
      if (!items.length) return;
      // Playlist row/title taps call this directly, so it needs the same
      // duplicate-start drop as handlePlay, and it must invalidate the
      // previous track's auto-advance guard before isPaused flips false —
      // a stale overdue guard otherwise fires on timeline reconciliation
      // and starts the previous playlist's next item over this fresh start.
      if (!tryAcquireSingleFlight(playStartInFlightRef)) return;
      setIsPlaylistLoading(true);
      try {
        cancelAutoAdvance();
        playedClockRef.current.reset();
        setPlayedMs(0);
        setPlaylistEnded(false);
        writeMachineExecutionFromPlay("running");
        const resolvedItems = await applySonglengthsToItems(items);
        setPlaylist((prev) => {
          if (!prev.length) return resolvedItems;
          const baseIds = new Set(resolvedItems.map((item) => item.id));
          const extras = prev.filter((item) => !baseIds.has(item.id));
          return extras.length ? [...resolvedItems, ...extras] : resolvedItems;
        });
        setIsPaused(false);
        try {
          await playItem(resolvedItems[startIndex], {
            playlistIndex: startIndex,
            playlistSize: resolvedItems.length,
          });
        } catch (error) {
          if (!isHandledUiError(error)) {
            reportPlaybackStartFailure({
              operation: "PLAYBACK_START",
              title: "Playback failed",
              error,
              context: {
                item: resolvedItems[startIndex]?.label,
              },
            });
          }
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
    },
    [
      applySonglengthsToItems,
      cancelAutoAdvance,
      playItem,
      playStartInFlightRef,
      reportPlaybackStartFailure,
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
        await startPlaylist(playlist, targetIndex);
        return;
      }
      if (!tryAcquireSingleFlight(playStartInFlightRef)) return;
      setIsPlaylistLoading(true);
      try {
        cancelAutoAdvance();
        await playItem(playlist[targetIndex], { playlistIndex: targetIndex, playlistSize: playlist.length });
      } catch (error) {
        if (!isHandledUiError(error)) {
          reportPlaybackStartFailure({
            operation: "PLAYBACK_START",
            title: "Playback failed",
            error,
            context: {
              item: playlist[targetIndex]?.label,
            },
          });
        }
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
      reportPlaybackStartFailure,
      startPlaylist,
      trace,
      playStartInFlightRef,
      setIsPlaylistLoading,
    ],
  );

  const handleStop = useCallback(
    trace(async function handleStop() {
      if (!isPlaying && !isPaused) return;
      // HARD18-009 (M5): Stop always runs immediately (never queued behind
      // enqueuePlayTransition) and claims the play-generation counter so any
      // in-flight playItem transition (auto-advance, Next/Previous, a
      // row-tap) sees itself superseded once its own async work resolves.
      playGenerationRef.current += 1;
      cancelPendingUserSkip();
      const currentItem = playlist[currentIndex];
      const shouldReboot = currentItem?.category === "disk";
      try {
        const api = getC64API();
        if (isPaused) {
          try {
            await resumeMachineWithRetry(api);
          } catch (error) {
            addErrorLog("Resume before stop failed", {
              error: (error as Error).message,
            });
          }
        }
        await stopMachineWithGracePeriod(api, shouldReboot);
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
          error: (error as Error).message,
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
      cancelPendingUserSkip,
    ],
  );

  // HARD18-022/023 (M3): a user-initiated whole-machine reset (Home
  // reboot/reboot-clear-memory/power-cycle) or an out-of-playlist launch
  // (CommoServe Run/Mount & run) resets or repurposes the C64 out from under
  // an armed session. Stop in place - cancel auto-advance and mark the
  // session stopped - WITHOUT issuing any further machine-control REST
  // calls (the device was already reset by the takeover itself; adding more
  // writes right after a reset/boot would only compound HARD18-012's
  // boot-window churn). Keeps the playlist position; the existing
  // isPlaying/autoAdvanceDueAtMs effects in PlayFilesPage already clear the
  // native due-time and stop background execution reactively.
  useEffect(() => {
    return subscribeMachineTakeover((event) => {
      if (!isPlayingRef.current && !isPausedRef.current) return;
      cancelPendingUserSkip();
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

  // HARD19-009: Play writes the shared machine-execution store but never
  // subscribed, so a pause applied from HOME (or any external source) left Play's
  // timeline running and auto-advance armed — the next track would launch on the
  // machine the user just paused. Subscribe and mirror EXTERNAL transitions:
  // suspend the clock + clear the auto-advance due-time on pause, re-arm on
  // resume. Play's own pause/resume writes are ignored via
  // playInitiatedMachineTransitionRef; a value-equality bail (machinePaused ===
  // isPausedRef) prevents any redundant setState (no effect re-render loop).
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
        const currentElapsedMs = elapsedMsRef.current;
        trackStartedAtRef.current = now - currentElapsedMs;
        playedClockRef.current.resume(now);
        setPlayedMs(playedClockRef.current.current(now));
        const currentDurationMs = durationMsRef.current;
        if (autoAdvanceGuardRef.current && typeof currentDurationMs === "number") {
          autoAdvanceGuardRef.current.dueAtMs = now + Math.max(0, currentDurationMs - currentElapsedMs);
          autoAdvanceGuardRef.current.autoFired = false;
          autoAdvanceGuardRef.current.userCancelled = false;
          setAutoAdvanceDueAtMs(autoAdvanceGuardRef.current.dueAtMs);
        }
      }
    });
  }, [
    playedClockRef,
    setPlayedMs,
    setIsPaused,
    setAutoAdvanceDueAtMs,
    autoAdvanceGuardRef,
    trackStartedAtRef,
    durationMsRef,
    elapsedMsRef,
  ]);

  const handlePauseResume = useCallback(
    trace(async function handlePauseResume() {
      if (!isPlaying) return;
      const pollingPauseHandle = pollingPauseRegistry.acquirePause();
      try {
        const target = isPaused ? "running" : "paused";
        if (target === "paused") cancelPendingUserSkip();
        await machineTransitionCoordinatorRef.current.request(target, async () => {
          const endTransition = beginMachineTransition();
          const api = getC64API();
          try {
            if (target === "running") {
              pausingFromPauseRef.current = false;
              resumingFromPauseRef.current = false;
              await resumeMachineWithRetry(api);
              await unmuteAfterMachineResume();
              setIsPaused(false);
              // HARD12-020: publish the resumed state so Home's pause/resume
              // control converges with Play instead of assuming "running".
              writeMachineExecutionFromPlay("running");
              const now = Date.now();
              trackStartedAtRef.current = now - elapsedMs;
              playedClockRef.current.resume(now);
              setPlayedMs(playedClockRef.current.current(now));
              if (autoAdvanceGuardRef.current && typeof durationMs === "number") {
                autoAdvanceGuardRef.current.dueAtMs = now + Math.max(0, durationMs - elapsedMs);
                autoAdvanceGuardRef.current.autoFired = false;
                autoAdvanceGuardRef.current.userCancelled = false;
                setAutoAdvanceDueAtMs(autoAdvanceGuardRef.current.dueAtMs);
              }
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
            setIsPaused(true);
            setAutoAdvanceDueAtMs(null);
            // HARD12-020: publish the paused state and whether a SID pause-mute
            // snapshot was captured so Home can show the correct label and
            // restore the mixer on a Home-initiated resume (Play may be an
            // unmounted placeholder when the user resumes from Home).
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
        pollingPauseHandle.release();
      }
    }),
    [
      durationMs,
      elapsedMs,
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
      autoAdvanceGuardRef,
      cancelPendingUserSkip,
    ],
  );

  const flushPendingUserSkip = useCallback(async () => {
    const pending = pendingUserSkipRef.current;
    if (!pending) return;
    pendingUserSkipRef.current = null;
    const settle = () => {
      pending.resolvers.forEach(({ resolve }) => resolve());
    };

    try {
      await enqueueUserTransport(async () => {
        const activePlaylist = playlistRef.current;
        if (!activePlaylist.length || (!isPlayingRef.current && !isPausedRef.current)) return;
        const activeIndex = currentIndexRef.current;
        const anotherTransitionAdvanced =
          activeIndex !== pending.originIndex &&
          (trackInstanceIdRef.current !== pending.originTrackInstanceId ||
            Boolean(autoAdvanceGuardRef.current?.autoFired));
        let resolvedTargetIndex = pending.targetIndex;
        let resolvedStopAtEnd = pending.stopAtEnd;
        if (anotherTransitionAdvanced) {
          if (pending.operation === "PLAYBACK_NEXT") {
            resolvedTargetIndex = resolveNextPlaylistIndex(
              activePlaylist,
              activeIndex,
              repeatEnabled,
              shuffleEnabled,
              shuffleSeed,
            );
            resolvedStopAtEnd = resolvedTargetIndex === null;
          } else {
            resolvedTargetIndex = resolvePreviousPlaylistIndex(
              activePlaylist,
              activeIndex,
              repeatEnabled,
              shuffleEnabled,
              shuffleSeed,
            );
            resolvedStopAtEnd = false;
          }
        }
        if (resolvedStopAtEnd || resolvedTargetIndex === null) {
          finishPlaylistPlayback("user-next-end");
          return;
        }
        const currentItem = activePlaylist[anotherTransitionAdvanced ? activeIndex : pending.originIndex];
        const targetItem = activePlaylist[resolvedTargetIndex];
        if (!targetItem) return;
        const shouldReboot = currentItem?.category === "disk" || targetItem.category === "disk";
        await playItem(targetItem, {
          rebootBeforePlay: shouldReboot,
          playlistIndex: resolvedTargetIndex,
        });
        setIsPaused(false);
      });
      settle();
    } catch (error) {
      if (!isHandledUiError(error)) {
        reportPlaybackStartFailure({
          operation: pending.operation,
          title: pending.title,
          error,
          context: {
            originIndex: pending.originIndex,
            targetIndex: pending.targetIndex,
          },
        });
      }
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
    reportPlaybackStartFailure,
    repeatEnabled,
    shuffleEnabled,
    shuffleSeed,
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

  const handleNext = useCallback(
    async (source: "auto" | "user" = "user", expectedTrackInstanceId?: number) => {
      if (source === "user") {
        const activePlaylist = playlistRef.current;
        if (!activePlaylist.length) return;
        cancelAutoAdvance();
        const activeIndex = currentIndexRef.current;
        const nextIndex = resolveNextPlaylistIndex(
          activePlaylist,
          activeIndex,
          repeatEnabled,
          shuffleEnabled,
          shuffleSeed,
        );
        const now = Date.now();
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        if (nextIndex === null) {
          await scheduleUserSkip(null, true, activeIndex, "PLAYBACK_NEXT", "Playback next failed");
          return;
        }
        setVisibleCurrentIndex(nextIndex);
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
        const nextIndex = resolveNextPlaylistIndex(
          activePlaylist,
          activeIndex,
          repeatEnabled,
          shuffleEnabled,
          shuffleSeed,
        );
        const now = Date.now();
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        const currentItem = activePlaylist[activeIndex];
        if (nextIndex === null) {
          finishPlaylistPlayback("auto-end");
          return;
        }

        const nextItem = activePlaylist[nextIndex];
        const shouldReboot = currentItem?.category === "disk" || nextItem?.category === "disk";
        try {
          await playItem(nextItem, {
            rebootBeforePlay: shouldReboot,
            playlistIndex: nextIndex,
          });
          setIsPaused(false);
        } catch (error) {
          if (!isHandledUiError(error)) {
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
      playItem,
      repeatEnabled,
      shuffleEnabled,
      shuffleSeed,
      playedClockRef,
      scheduleUserSkip,
      setVisibleCurrentIndex,
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
    const prevIndex = resolvePreviousPlaylistIndex(
      activePlaylist,
      activeIndex,
      repeatEnabled,
      shuffleEnabled,
      shuffleSeed,
    );
    cancelAutoAdvance();
    const now = Date.now();
    playedClockRef.current.pause(now);
    setPlayedMs(playedClockRef.current.current(now));
    setVisibleCurrentIndex(prevIndex);
    await scheduleUserSkip(prevIndex, false, activeIndex, "PLAYBACK_PREVIOUS", "Playback previous failed");
  }, [
    cancelAutoAdvance,
    repeatEnabled,
    shuffleEnabled,
    shuffleSeed,
    playedClockRef,
    setPlayedMs,
    scheduleUserSkip,
    setVisibleCurrentIndex,
  ]);

  const playlistItemDuration = useCallback(
    (item: PlaylistItem, index: number) => {
      const base = index === currentIndex ? (durationMs ?? item.durationMs) : item.durationMs;
      return base ?? durationFallbackMs;
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
    playlistEnded,
    resolveSidMetadata,
    resolveUltimateSidDurationByMd5,
    playlistItemDuration,
    withTimeout,
  };
}
