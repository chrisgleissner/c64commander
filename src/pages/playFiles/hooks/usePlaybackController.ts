/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { createArchiveClient } from "@/lib/archive/client";
import { getCachedArchivePlayback, setCachedArchivePlayback } from "@/lib/archive/archivePlaybackCache";
import { buildArchivePlayPlan } from "@/lib/archive/execution";
import type { ArchiveClientConfigInput } from "@/lib/archive/types";
import { getC64API } from "@/lib/c64api";
import { beginMachineTransition } from "@/lib/deviceInteraction/deviceActivityGate";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";
import {
  createMachineTransitionCoordinator,
  SupersededMachineTransitionError,
} from "@/lib/deviceInteraction/machineTransitionCoordinator";
import { addErrorLog, addLog } from "@/lib/logging";
import { getSelectedSavedDeviceProductFamilySync } from "@/lib/savedDevices/store";
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
import { getHvscDurationByMd5Seconds } from "@/lib/hvsc";
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
import type { AudioMixerItem } from "@/pages/playFiles/playFilesUtils";
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
  const userTransportQueueRef = useRef(Promise.resolve());
  const pendingUserSkipRef = useRef<PendingUserSkip | null>(null);
  const flushPendingUserSkipRef = useRef<() => Promise<void>>(async () => undefined);
  const STOP_MACHINE_TIMEOUT_MS = 6000;

  playlistRef.current = playlist;
  currentIndexRef.current = currentIndex;
  isPlayingRef.current = isPlaying;
  isPausedRef.current = isPaused;

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
        const seconds = await getHvscDurationByMd5Seconds(md5);
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
        const seconds = await getHvscDurationByMd5Seconds(md5);
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
      playedClockRef.current.pause(now);
      setIsPlaying(false);
      setIsPaused(false);
      autoAdvanceGuardRef.current = null;
      setAutoAdvanceDueAtMs(null);
      addLog("info", "Playlist playback ended without device stop", {
        reason,
        currentIndex: currentIndexRef.current,
        deviceAction: "none",
      });
    },
    [autoAdvanceGuardRef, playedClockRef, setAutoAdvanceDueAtMs, setIsPaused, setIsPlaying],
  );

  const playItem = useCallback(
    async (
      item: PlaylistItem,
      options?: { rebootBeforePlay?: boolean; playlistIndex?: number; playlistSize?: number },
    ) => {
      return enqueuePlayTransition(async () => {
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
        playedClockRef.current.start(now, true);
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
        if (
          resolvedDuration !== item.durationMs ||
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
                    subsongCount: subsongCount ?? entry.subsongCount,
                  }
                : entry,
            ),
          );
        }
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
      autoAdvanceGuardRef,
      playedClockRef,
      trackInstanceIdRef,
      trackStartedAtRef,
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
      const currentItem = playlist[currentIndex];
      const shouldReboot = currentItem?.category === "disk";
      // BUG-017 safety guard: on a C64U, a non-disk (e.g. SID) Stop maps to
      // PUT /v1/machine:reset, which silently resets the machine to BASIC. The Stop
      // control is disabled in the UI for this case (PlaybackControlsCard), so reaching
      // here for C64U non-disk means a programmatic/unexpected call — refuse it: do not
      // reset the machine and do not run the volume restore. Users pause non-disk
      // playback on a C64U instead of stopping it.
      if (!shouldReboot && getSelectedSavedDeviceProductFamilySync() === "C64U") {
        addLog("warn", "Blocked C64U non-disk Stop to avoid a silent machine reset (BUG-017)", {
          currentIndex,
          category: currentItem?.category ?? null,
        });
        return;
      }
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
    ],
  );

  const handlePauseResume = useCallback(
    trace(async function handlePauseResume() {
      if (!isPlaying) return;
      const pollingPauseHandle = pollingPauseRegistry.acquirePause();
      try {
        const target = isPaused ? "running" : "paused";
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
        if (!activePlaylist.length) return;
        const activeIndex = currentIndexRef.current;
        const anotherTransitionAdvanced =
          activeIndex !== pending.originIndex &&
          (trackInstanceIdRef.current !== pending.originTrackInstanceId ||
            Boolean(autoAdvanceGuardRef.current?.autoFired));
        let resolvedTargetIndex = pending.targetIndex;
        let resolvedStopAtEnd = pending.stopAtEnd;
        if (anotherTransitionAdvanced) {
          if (pending.operation === "PLAYBACK_NEXT") {
            resolvedTargetIndex = activeIndex + 1;
            if (resolvedTargetIndex >= activePlaylist.length) {
              if (repeatEnabled) {
                resolvedTargetIndex = 0;
              } else {
                resolvedTargetIndex = null;
                resolvedStopAtEnd = true;
              }
            }
          } else {
            resolvedTargetIndex =
              activeIndex > 0
                ? activeIndex - 1
                : repeatEnabled && activePlaylist.length > 1
                  ? activePlaylist.length - 1
                  : 0;
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
        let nextIndex = activeIndex + 1;
        const now = Date.now();
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        if (nextIndex >= activePlaylist.length) {
          if (!repeatEnabled) {
            await scheduleUserSkip(null, true, activeIndex, "PLAYBACK_NEXT", "Playback next failed");
            return;
          }
          nextIndex = 0;
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
        guard.autoFired = true;

        const activeIndex = currentIndexRef.current;
        let nextIndex = activeIndex + 1;
        const now = Date.now();
        playedClockRef.current.pause(now);
        setPlayedMs(playedClockRef.current.current(now));
        const currentItem = activePlaylist[activeIndex];
        if (nextIndex >= activePlaylist.length) {
          if (!repeatEnabled) {
            finishPlaylistPlayback("auto-end");
            return;
          }
          nextIndex = 0;
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
    const prevIndex =
      activeIndex > 0 ? activeIndex - 1 : repeatEnabled && activePlaylist.length > 1 ? activePlaylist.length - 1 : 0;
    cancelAutoAdvance();
    const now = Date.now();
    playedClockRef.current.pause(now);
    setPlayedMs(playedClockRef.current.current(now));
    setVisibleCurrentIndex(prevIndex);
    await scheduleUserSkip(prevIndex, false, activeIndex, "PLAYBACK_PREVIOUS", "Playback previous failed");
  }, [cancelAutoAdvance, repeatEnabled, playedClockRef, setPlayedMs, scheduleUserSkip, setVisibleCurrentIndex]);

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
    resolveSidMetadata,
    resolveUltimateSidDurationByMd5,
    playlistItemDuration,
    withTimeout,
  };
}
