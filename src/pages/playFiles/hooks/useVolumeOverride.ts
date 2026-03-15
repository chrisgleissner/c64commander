import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { useC64ConfigItems, useC64Connection, useC64UpdateConfigBatch } from "@/hooks/useC64Connection";
import { toast } from "@/hooks/use-toast";
import { addErrorLog, addLog } from "@/lib/logging";
import { getC64API } from "@/lib/c64api";
import { isSidVolumeName, resolveAudioMixerMuteValue } from "@/lib/config/audioMixerSolo";
import { AUDIO_MIXER_VOLUME_ITEMS, SID_ADDRESSING_ITEMS, SID_SOCKETS_ITEMS } from "@/lib/config/configItems";
import { beginPlaybackWriteBurst, waitForMachineTransitionsToSettle } from "@/lib/deviceInteraction/deviceActivityGate";
import { createLatestIntentWriteLane, type LatestIntentWriteLane } from "@/lib/deviceInteraction/latestIntentWriteLane";
import {
  buildEnabledSidMutedToTargetUpdates,
  buildEnabledSidUnmuteUpdates,
  buildEnabledSidRestoreUpdates,
  buildEnabledSidVolumeSnapshot,
  buildSidEnablement,
  buildSidVolumeSteps,
  filterEnabledSidVolumeItems,
  buildEnabledSidMuteUpdates,
  buildEnabledSidVolumeUpdates,
  isSidVolumeOffValue,
  resolveSidMutedVolumeOption,
  type SidEnablement,
} from "@/lib/config/sidVolumeControl";
import { reduceVolumeState } from "../volumeState";
import { extractAudioMixerItems, parseVolumeOption } from "../playFilesUtils";
import { type PlaybackSyncIntent, type PlaybackSyncState } from "../playbackMixerSync";
import { resolveMutedSyncIndex, resolveMostCommonIndex, shouldHoldManualMuteSync } from "../volumeSync";

type SidMuteSnapshot = {
  volumes: Record<string, string | number>;
  enablement: SidEnablement;
};

type PlaybackMixerWrite = {
  context: string;
  index: number;
  muted: boolean;
  updates: Record<string, string | number>;
  allowKnownDeviceSkip?: boolean;
};

interface UseVolumeOverrideProps {
  isPlaying: boolean;
  isPaused: boolean;
  previewIntervalMs: number;
}

export function useVolumeOverride({ isPlaying, isPaused, previewIntervalMs }: UseVolumeOverrideProps) {
  const { status } = useC64Connection();
  const updateConfigBatch = useC64UpdateConfigBatch();

  const { data: audioMixerCategory, refetch: refetchAudioMixerCategory } = useC64ConfigItems(
    "Audio Mixer",
    AUDIO_MIXER_VOLUME_ITEMS,
    status.isConnected || status.isConnecting,
  );
  const { data: sidSocketsCategory, refetch: refetchSidSocketsCategory } = useC64ConfigItems(
    "SID Sockets Configuration",
    SID_SOCKETS_ITEMS,
    status.isConnected || status.isConnecting,
  );
  const { data: sidAddressingCategory, refetch: refetchSidAddressingCategory } = useC64ConfigItems(
    "SID Addressing",
    SID_ADDRESSING_ITEMS,
    status.isConnected || status.isConnecting,
  );

  const audioMixerItems = useMemo(
    () => extractAudioMixerItems(audioMixerCategory as Record<string, unknown> | undefined),
    [audioMixerCategory],
  );
  const sidVolumeItems = useMemo(() => audioMixerItems.filter((item) => isSidVolumeName(item.name)), [audioMixerItems]);
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
    const baseOptions =
      sidVolumeItems.find((item) => Array.isArray(item.options) && item.options.length)?.options ?? [];
    return buildSidVolumeSteps(baseOptions);
  }, [sidVolumeItems]);

  const [volumeState, dispatchVolume] = useReducer(reduceVolumeState, {
    index: 0,
    muted: false,
    reason: null,
  });

  const manualMuteSnapshotRef = useRef<SidMuteSnapshot | null>(null);
  const pauseMuteSnapshotRef = useRef<SidMuteSnapshot | null>(null);
  const volumeSessionSnapshotRef = useRef<Record<string, string | number> | null>(null);
  const volumeSessionActiveRef = useRef(false);
  const previousVolumeIndexRef = useRef<number | null>(null);
  const volumeUpdateTimerRef = useRef<number | null>(null);
  const volumeUpdateSeqRef = useRef(0);
  const volumeUiTargetRef = useRef<{ index: number; setAtMs: number } | null>(null);
  const playbackSyncIntentRef = useRef<PlaybackSyncIntent | null>(null);
  const pendingVolumeWriteRef = useRef<PlaybackSyncIntent | null>(null);
  const lastKnownDeviceVolumeRef = useRef<PlaybackSyncState | null>(null);
  const lastManualWriteRef = useRef<{ index: number; muted: boolean; setAtMs: number } | null>(null);
  const manualMuteIntentRef = useRef(false);
  const isDraggingVolumeRef = useRef(false);
  const lastPreviewSentAtRef = useRef<number | null>(null);
  const playbackReconcileTimerRef = useRef<number | null>(null);
  const playbackWriteLaneRef = useRef<LatestIntentWriteLane<PlaybackMixerWrite> | null>(null);
  // Set to true during the pause-to-mute transition to prevent stale query
  // data from immediately flipping the UI back to the pre-pause unmuted state
  // before the hardware mute write is observed.
  const pausingFromPauseRef = useRef(false);
  // Set to true during the resume-from-pause window to prevent the hardware
  // sync effect from re-asserting the muted state while the unmute API call
  // result propagates back through the React Query cache.
  const resumingFromPauseRef = useRef(false);

  const defaultVolumeIndex = useMemo(() => {
    const zeroIndex = volumeSteps.findIndex((option) => option.numeric === 0);
    return zeroIndex >= 0 ? zeroIndex : 0;
  }, [volumeSteps]);

  const volumeIndex = volumeState.index;
  const volumeMuted = volumeState.muted;

  const resolveVolumeIndex = useCallback(
    (value: string | number) => {
      if (!volumeSteps.length) return defaultVolumeIndex;
      const stringValue = typeof value === "string" ? value.trim() : value.toString();
      const directIndex = volumeSteps.findIndex((option) => option.option.trim() === stringValue);
      if (directIndex >= 0) return directIndex;
      const numeric = typeof value === "number" ? value : parseVolumeOption(value);
      if (numeric !== undefined) {
        const numericIndex = volumeSteps.findIndex((option) => option.numeric === numeric);
        if (numericIndex >= 0) return numericIndex;
      }
      return defaultVolumeIndex;
    },
    [defaultVolumeIndex, volumeSteps],
  );

  const resolveMutedVolumeIndex = useCallback(
    (items: typeof sidVolumeItems) => {
      const options = items.find((item) => Array.isArray(item.options) && item.options.length)?.options;
      return resolveVolumeIndex(resolveSidMutedVolumeOption(options));
    },
    [resolveVolumeIndex],
  );

  const captureSidMuteSnapshot = useCallback(
    (items: typeof sidVolumeItems, enablement: SidEnablement) => ({
      volumes: buildEnabledSidVolumeSnapshot(items, enablement),
      enablement: { ...enablement },
    }),
    [buildEnabledSidVolumeSnapshot],
  );

  const snapshotToUpdates = useCallback(
    (snapshot: SidMuteSnapshot | null | undefined, currentItems?: typeof sidVolumeItems) => {
      if (!snapshot) return {};
      const updates = buildEnabledSidUnmuteUpdates(snapshot.volumes, sidEnablement);
      if (!currentItems?.length) return updates;
      const allowedNames = new Set(currentItems.map((item) => item.name));
      return Object.fromEntries(Object.entries(updates).filter(([name]) => allowedNames.has(name)));
    },
    [buildEnabledSidUnmuteUpdates, sidEnablement],
  );

  const reserveVolumeUiTarget = useCallback((index: number) => {
    volumeUiTargetRef.current = {
      index,
      setAtMs: Date.now(),
    };
  }, []);

  const setPlaybackSyncIntent = useCallback((index: number, muted: boolean) => {
    playbackSyncIntentRef.current = {
      index,
      muted,
      setAtMs: Date.now(),
    };
  }, []);

  const clearPendingVolumeWrite = useCallback(() => {
    pendingVolumeWriteRef.current = null;
    playbackSyncIntentRef.current = null;
    volumeUiTargetRef.current = null;
  }, []);

  const markPendingVolumeWrite = useCallback(
    (index: number, muted: boolean) => {
      const nextIntent = {
        index,
        muted,
        setAtMs: Date.now(),
      };
      pendingVolumeWriteRef.current = nextIntent;
      setPlaybackSyncIntent(index, muted);
      volumeUiTargetRef.current = muted
        ? null
        : {
            index,
            setAtMs: nextIntent.setAtMs,
          };
    },
    [setPlaybackSyncIntent],
  );

  const withTimeout = useCallback(async <T>(promise: Promise<T>, timeoutMs: number, operation: string) => {
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

  if (!playbackWriteLaneRef.current) {
    playbackWriteLaneRef.current = createLatestIntentWriteLane<PlaybackMixerWrite>({
      beforeRun: waitForMachineTransitionsToSettle,
      run: async (write) => {
        const endWriteBurst = beginPlaybackWriteBurst();
        try {
          await withTimeout(
            updateConfigBatch.mutateAsync({
              category: "Audio Mixer",
              updates: write.updates,
              immediate: true,
              skipInvalidation: true,
            }),
            4000,
            `${write.context} audio mixer update`,
          );
        } finally {
          endWriteBurst();
        }
      },
    });
  }

  const schedulePlaybackReconciliation = useCallback(() => {
    if (playbackReconcileTimerRef.current) {
      window.clearTimeout(playbackReconcileTimerRef.current);
    }
    playbackReconcileTimerRef.current = window.setTimeout(() => {
      playbackReconcileTimerRef.current = null;
      void Promise.all([refetchAudioMixerCategory(), refetchSidSocketsCategory(), refetchSidAddressingCategory()]);
    }, 250);
  }, [refetchAudioMixerCategory, refetchSidAddressingCategory, refetchSidSocketsCategory]);

  const applyAudioMixerUpdates = useCallback(
    async (updates: Record<string, string | number>, context: string) => {
      if (!Object.keys(updates).length) return;
      try {
        await withTimeout(
          updateConfigBatch.mutateAsync({
            category: "Audio Mixer",
            updates,
            immediate: true,
            skipInvalidation: true,
          }),
          4000,
          `${context} audio mixer update`,
        );
        schedulePlaybackReconciliation();
      } catch (error) {
        if (context.startsWith("Restore")) {
          addErrorLog("Audio mixer restore failed", {
            error: (error as Error).message,
            context,
          });
          toast({
            variant: "destructive",
            title: "Could not restore volume settings",
            description: "Your current volume may be different than before playback.",
          });
          return;
        }
        // Non-Restore contexts: rethrow so callers can gate UI state on confirmed writes.
        throw error;
      }
    },
    [schedulePlaybackReconciliation, updateConfigBatch, withTimeout],
  );

  const queuePlaybackMixerWrite = useCallback(
    async (write: PlaybackMixerWrite) => {
      const pending = pendingVolumeWriteRef.current;
      const pendingMatchesRequestedState = !pending || (pending.index === write.index && pending.muted === write.muted);
      if (pending && pending.index === write.index && pending.muted === write.muted) {
        addLog("debug", "Play volume write skipped while identical write is pending", {
          context: write.context,
          index: write.index,
          muted: write.muted,
        });
        return false;
      }

      const knownDevice = lastKnownDeviceVolumeRef.current;
      if (
        write.allowKnownDeviceSkip !== false &&
        !isDraggingVolumeRef.current &&
        knownDevice &&
        knownDevice.index === write.index &&
        knownDevice.muted === write.muted &&
        pendingMatchesRequestedState
      ) {
        clearPendingVolumeWrite();
        addLog("debug", "Play volume write skipped because device already reflects requested state", {
          context: write.context,
          index: write.index,
          muted: write.muted,
        });
        return false;
      }

      markPendingVolumeWrite(write.index, write.muted);
      try {
        await playbackWriteLaneRef.current?.schedule(write);
        schedulePlaybackReconciliation();
        return true;
      } catch (error) {
        const activePending = pendingVolumeWriteRef.current;
        if (activePending?.index === write.index && activePending.muted === write.muted) {
          clearPendingVolumeWrite();
        }
        throw error;
      }
    },
    [clearPendingVolumeWrite, markPendingVolumeWrite, schedulePlaybackReconciliation],
  );

  const resolveSidVolumeItems = useCallback(
    async (forceRefresh = false) => {
      if (sidVolumeItems.length && !forceRefresh) return sidVolumeItems;
      const readOptions = forceRefresh
        ? { __c64uIntent: "background" as const, __c64uBypassCache: true }
        : { __c64uIntent: "background" as const };
      try {
        const data = await getC64API().getConfigItems("Audio Mixer", AUDIO_MIXER_VOLUME_ITEMS, readOptions);
        return extractAudioMixerItems(data as Record<string, unknown>).filter((item) => isSidVolumeName(item.name));
      } catch (error) {
        addErrorLog("Audio mixer lookup failed", {
          error: (error as Error).message,
        });
        return [];
      }
    },
    [sidVolumeItems],
  );

  const resolveSidEnablement = useCallback(
    async (forceRefresh = false) => {
      if (!forceRefresh && sidSocketsCategory && sidAddressingCategory) {
        return buildSidEnablement(
          sidSocketsCategory as Record<string, unknown>,
          sidAddressingCategory as Record<string, unknown>,
        );
      }
      const readOptions = forceRefresh
        ? { __c64uIntent: "background" as const, __c64uBypassCache: true }
        : { __c64uIntent: "background" as const };
      try {
        const api = getC64API();
        const [sockets, addressing] = await Promise.all([
          api.getConfigItems("SID Sockets Configuration", SID_SOCKETS_ITEMS, readOptions),
          api.getConfigItems("SID Addressing", SID_ADDRESSING_ITEMS, readOptions),
        ]);
        return buildSidEnablement(sockets as Record<string, unknown>, addressing as Record<string, unknown>);
      } catch (error) {
        addErrorLog("SID enablement lookup failed", {
          error: (error as Error).message,
        });
        return sidEnablement;
      }
    },
    [sidAddressingCategory, sidEnablement, sidSocketsCategory],
  );

  const resolveEnabledSidVolumeItems = useCallback(
    async (forceRefresh = false) => {
      const items = await resolveSidVolumeItems(forceRefresh);
      const enablement = forceRefresh ? await resolveSidEnablement(true) : sidEnablement;
      return filterEnabledSidVolumeItems(items, enablement);
    },
    [resolveSidEnablement, resolveSidVolumeItems, sidEnablement],
  );

  const ensureVolumeSessionSnapshot = useCallback(async () => {
    if (!isPlaying && !isPaused) return null;
    if (volumeSessionSnapshotRef.current) return volumeSessionSnapshotRef.current;
    const items = enabledSidVolumeItems.length ? enabledSidVolumeItems : await resolveEnabledSidVolumeItems();
    if (!items.length) return null;
    const snapshot = buildEnabledSidVolumeSnapshot(items, sidEnablement);
    volumeSessionSnapshotRef.current = snapshot;
    volumeSessionActiveRef.current = true;
    return snapshot;
  }, [
    buildEnabledSidVolumeSnapshot,
    enabledSidVolumeItems,
    isPaused,
    isPlaying,
    resolveEnabledSidVolumeItems,
    sidEnablement,
  ]);

  const restoreVolumeOverrides = useCallback(
    async (reason: string) => {
      if (!volumeSessionActiveRef.current) return;
      const snapshot = volumeSessionSnapshotRef.current;
      if (!snapshot) return;
      if (status.state === "DEMO_ACTIVE" || (!status.isConnected && !status.isConnecting)) {
        volumeSessionSnapshotRef.current = null;
        volumeSessionActiveRef.current = false;
        manualMuteSnapshotRef.current = null;
        pauseMuteSnapshotRef.current = null;
        dispatchVolume({ type: "reset", index: defaultVolumeIndex });
        playbackSyncIntentRef.current = null;
        volumeUiTargetRef.current = null;
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
      dispatchVolume({ type: "reset", index: defaultVolumeIndex });
      playbackSyncIntentRef.current = null;
      volumeUiTargetRef.current = null;
    },
    [
      applyAudioMixerUpdates,
      buildEnabledSidRestoreUpdates,
      defaultVolumeIndex,
      resolveEnabledSidVolumeItems,
      sidEnablement,
      status.isConnected,
      status.isConnecting,
      status.state,
    ],
  );

  const sendVolumeWrite = useCallback(
    async (nextIndex: number, phase: "preview" | "commit") => {
      if (manualMuteIntentRef.current) {
        addLog("debug", "Play volume write ignored while manual mute intent is active", {
          index: nextIndex,
          phase,
        });
        return;
      }
      if (!volumeSteps.length || !sidVolumeItems.length) return;
      const target = volumeSteps[nextIndex]?.option;
      if (!target) return;

      const knownDevice = lastKnownDeviceVolumeRef.current;
      const pending = pendingVolumeWriteRef.current;
      const pendingMatchesRequestedState = !pending || (pending.index === nextIndex && pending.muted === false);
      if (
        knownDevice &&
        knownDevice.index === nextIndex &&
        knownDevice.muted === false &&
        pendingMatchesRequestedState
      ) {
        clearPendingVolumeWrite();
        return;
      }

      const updates = buildEnabledSidVolumeUpdates(sidVolumeItems, sidEnablement, target);
      manualMuteSnapshotRef.current = null;
      manualMuteIntentRef.current = false;
      previousVolumeIndexRef.current = nextIndex;
      volumeUpdateSeqRef.current += 1;
      reserveVolumeUiTarget(nextIndex);
      void ensureVolumeSessionSnapshot();

      addLog(
        phase === "preview" ? "debug" : "info",
        phase === "preview" ? "Play volume preview send" : "Play volume commit send",
        {
          index: nextIndex,
          target,
        },
      );

      try {
        lastManualWriteRef.current = {
          index: nextIndex,
          muted: false,
          setAtMs: Date.now(),
        };
        await queuePlaybackMixerWrite({
          updates,
          context: phase === "preview" ? "Volume preview" : "Volume commit",
          index: nextIndex,
          muted: false,
          allowKnownDeviceSkip: true,
        });
        dispatchVolume({ type: "unmute", reason: "manual", index: nextIndex });
      } catch (error) {
        addErrorLog("Volume update failed", {
          error: (error as Error).message,
          phase,
          index: nextIndex,
        });
      }
    },
    [
      buildEnabledSidVolumeUpdates,
      clearPendingVolumeWrite,
      ensureVolumeSessionSnapshot,
      queuePlaybackMixerWrite,
      reserveVolumeUiTarget,
      sidEnablement,
      sidVolumeItems,
      volumeSteps,
    ],
  );

  const handleVolumeLocalChange = useCallback(
    (value: number[]) => {
      const nextIndex = value[0] ?? 0;
      isDraggingVolumeRef.current = true;
      dispatchVolume({ type: "set-index", index: nextIndex });
      reserveVolumeUiTarget(nextIndex);
      if (!volumeMuted) return;
      previousVolumeIndexRef.current = nextIndex;
      const snapshot = manualMuteSnapshotRef.current;
      const target = volumeSteps[nextIndex]?.option;
      if (snapshot && target) {
        manualMuteSnapshotRef.current = {
          ...snapshot,
          volumes: Object.fromEntries(Object.keys(snapshot.volumes).map((key) => [key, target])),
        };
      }
    },
    [reserveVolumeUiTarget, volumeMuted, volumeSteps],
  );

  const handleVolumeAsyncChange = useCallback(
    (nextIndex: number) => {
      if (volumeMuted) return;
      const now = Date.now();
      const lastSentAt = lastPreviewSentAtRef.current;
      if (lastSentAt !== null && now - lastSentAt < previewIntervalMs) {
        addLog("debug", "Play volume preview suppressed by configured rate limit", {
          index: nextIndex,
          elapsedMs: now - lastSentAt,
          previewIntervalMs,
        });
        return;
      }
      lastPreviewSentAtRef.current = now;
      void sendVolumeWrite(nextIndex, "preview");
    },
    [previewIntervalMs, sendVolumeWrite, volumeMuted],
  );

  const handleVolumeCommit = useCallback(
    async (nextIndex: number) => {
      isDraggingVolumeRef.current = false;
      dispatchVolume({ type: "set-index", index: nextIndex });
      reserveVolumeUiTarget(nextIndex);
      if (volumeMuted) {
        previousVolumeIndexRef.current = nextIndex;
        const snapshot = manualMuteSnapshotRef.current;
        const target = volumeSteps[nextIndex]?.option;
        if (snapshot && target) {
          manualMuteSnapshotRef.current = {
            ...snapshot,
            volumes: Object.fromEntries(Object.keys(snapshot.volumes).map((key) => [key, target])),
          };
        }
        return;
      }
      lastPreviewSentAtRef.current = null;
      await sendVolumeWrite(nextIndex, "commit");
    },
    [reserveVolumeUiTarget, sendVolumeWrite, volumeMuted, volumeSteps],
  );

  const handleToggleMute = useCallback(async () => {
    const items = enabledSidVolumeItems.length ? enabledSidVolumeItems : await resolveEnabledSidVolumeItems();
    if (!items.length) return;
    isDraggingVolumeRef.current = false;
    lastPreviewSentAtRef.current = null;
    const muteIndex = resolveMutedVolumeIndex(items);
    if (!volumeMuted) {
      previousVolumeIndexRef.current = volumeIndex;
      await ensureVolumeSessionSnapshot();
      manualMuteSnapshotRef.current = captureSidMuteSnapshot(items, sidEnablement);
      manualMuteIntentRef.current = true;
      dispatchVolume({ type: "mute", reason: "manual", index: muteIndex });
      addLog("info", "Play volume mute requested", {
        previousIndex: volumeIndex,
        muteIndex,
      });
      lastManualWriteRef.current = {
        index: muteIndex,
        muted: true,
        setAtMs: Date.now(),
      };
      try {
        await queuePlaybackMixerWrite({
          updates: buildEnabledSidMuteUpdates(items, sidEnablement),
          context: "Mute",
          index: muteIndex,
          muted: true,
          allowKnownDeviceSkip: false,
        });
      } catch (error) {
        manualMuteIntentRef.current = false;
        dispatchVolume({ type: "unmute", reason: "manual", index: previousVolumeIndexRef.current ?? volumeIndex });
        throw error;
      }
      addLog("info", "Play volume mute sent", {
        index: muteIndex,
      });
      return;
    }
    const fallbackIndex = previousVolumeIndexRef.current ?? volumeIndex;
    const target = volumeSteps[fallbackIndex]?.option;
    let updates = target ? buildEnabledSidMutedToTargetUpdates(items, sidEnablement, target) : {};
    if (!Object.keys(updates).length && target) {
      updates = buildEnabledSidVolumeUpdates(items, sidEnablement, target);
    }
    manualMuteIntentRef.current = false;
    dispatchVolume({ type: "unmute", reason: "manual", index: fallbackIndex });
    manualMuteSnapshotRef.current = null;
    addLog("info", "Play volume unmute requested", {
      index: fallbackIndex,
    });
    try {
      if (Object.keys(updates).length) {
        lastManualWriteRef.current = {
          index: fallbackIndex,
          muted: false,
          setAtMs: Date.now(),
        };
        await queuePlaybackMixerWrite({
          updates,
          context: "Unmute",
          index: fallbackIndex,
          muted: false,
          allowKnownDeviceSkip: false,
        });
        addLog("info", "Play volume unmute sent", {
          index: fallbackIndex,
        });
      }
    } catch (error) {
      manualMuteIntentRef.current = true;
      dispatchVolume({ type: "mute", reason: "manual", index: muteIndex });
      throw error;
    }
    clearPendingVolumeWrite();
  }, [
    buildEnabledSidMutedToTargetUpdates,
    captureSidMuteSnapshot,
    clearPendingVolumeWrite,
    ensureVolumeSessionSnapshot,
    enabledSidVolumeItems,
    queuePlaybackMixerWrite,
    resolveMutedVolumeIndex,
    resolveEnabledSidVolumeItems,
    sidEnablement,
    volumeIndex,
    volumeMuted,
    volumeSteps,
  ]);

  useEffect(() => {
    if (updateConfigBatch.isPending) return;
    if (!enabledSidVolumeItems.length || !volumeSteps.length) {
      lastKnownDeviceVolumeRef.current = null;
      manualMuteIntentRef.current = false;
      dispatchVolume({ type: "reset", index: defaultVolumeIndex });
      clearPendingVolumeWrite();
      isDraggingVolumeRef.current = false;
      return;
    }
    if (isDraggingVolumeRef.current) {
      return;
    }
    const muteValues = enabledSidVolumeItems.map((item) => resolveSidMutedVolumeOption(item.options));
    const activeIndices: number[] = [];
    enabledSidVolumeItems.forEach((item, index) => {
      if (isSidVolumeOffValue(item.value)) return;
      if (item.value === muteValues[index]) return;
      activeIndices.push(resolveVolumeIndex(item.value));
    });
    const muteIndex = resolveMutedVolumeIndex(enabledSidVolumeItems);
    const lastManualWrite = lastManualWriteRef.current;
    if (lastManualWrite && Date.now() - lastManualWrite.setAtMs < 1500) {
      const deviceMuted = activeIndices.length === 0;
      if (deviceMuted === lastManualWrite.muted) {
        if (!deviceMuted) {
          const counts = new Map<number, number>();
          activeIndices.forEach((index) => counts.set(index, (counts.get(index) ?? 0) + 1));
          const activeIndex = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? defaultVolumeIndex;
          if (activeIndex !== lastManualWrite.index) {
            return;
          }
        }
      } else {
        return;
      }
    }
    if (shouldHoldManualMuteSync(manualMuteIntentRef.current, activeIndices)) {
      addLog("debug", "Play volume sync held while manual mute intent remains authoritative", {
        activeIndices,
      });
      return;
    }
    if (manualMuteSnapshotRef.current && volumeMuted && activeIndices.length) {
      return;
    }
    if (pausingFromPauseRef.current && activeIndices.length) {
      return;
    }
    if (!activeIndices.length) {
      // During the resume-from-pause transition the hardware-side audio mixer
      // may still report muted values until the React Query refetch picks up
      // the unmute that was just written.  Skip the muted sync until the
      // hardware confirms the unmuted state (activeIndices will be non-empty),
      // at which point we clear the flag and fall through to the sync below.
      if (resumingFromPauseRef.current) return;
      pausingFromPauseRef.current = false;
      const snapshot = manualMuteSnapshotRef.current;
      const snapshotIndices = snapshot ? Object.values(snapshot.volumes).map((value) => resolveVolumeIndex(value)) : [];
      const nextIndex = resolveMutedSyncIndex({
        manualMuteIntentActive: manualMuteIntentRef.current,
        muteIndex,
        snapshotIndices,
        defaultVolumeIndex,
      });
      lastKnownDeviceVolumeRef.current = {
        index: nextIndex,
        muted: true,
      };
      const pendingWrite = pendingVolumeWriteRef.current;
      if (pendingWrite) {
        if (pendingWrite.index === nextIndex && pendingWrite.muted) {
          clearPendingVolumeWrite();
        } else {
          addLog("debug", "Play volume sync deferred while muted write confirmation is pending", {
            pendingIndex: pendingWrite.index,
            deviceIndex: nextIndex,
          });
          return;
        }
      }
      if (!volumeMuted || volumeIndex !== nextIndex || volumeState.reason !== "sync") {
        dispatchVolume({ type: "sync", index: nextIndex, muted: true });
      }
      lastManualWriteRef.current = null;
      return;
    }
    const nextIndex = resolveMostCommonIndex(activeIndices, defaultVolumeIndex);
    lastKnownDeviceVolumeRef.current = {
      index: nextIndex,
      muted: false,
    };
    const pendingWrite = pendingVolumeWriteRef.current;
    if (pendingWrite) {
      if (pendingWrite.index === nextIndex && pendingWrite.muted === false) {
        clearPendingVolumeWrite();
      } else {
        addLog("debug", "Play volume sync deferred while unmuted write confirmation is pending", {
          pendingIndex: pendingWrite.index,
          deviceIndex: nextIndex,
        });
        return;
      }
    }
    // Hardware has confirmed the unmuted state – clear the resume guard.
    resumingFromPauseRef.current = false;
    manualMuteIntentRef.current = false;
    dispatchVolume({ type: "sync", index: nextIndex, muted: false });
    lastManualWriteRef.current = null;
  }, [
    clearPendingVolumeWrite,
    defaultVolumeIndex,
    resolveMutedVolumeIndex,
    volumeIndex,
    volumeState.reason,
    enabledSidVolumeItems,
    resolveVolumeIndex,
    resolveSidMutedVolumeOption,
    updateConfigBatch.isPending,
    volumeSteps,
    volumeMuted,
  ]);

  useEffect(() => {
    return () => {
      if (playbackReconcileTimerRef.current) {
        window.clearTimeout(playbackReconcileTimerRef.current);
        playbackReconcileTimerRef.current = null;
      }
    };
  }, []);

  const ensureUnmuted = useCallback(async () => {
    if (!volumeMuted || manualMuteIntentRef.current) return;
    const items = enabledSidVolumeItems.length ? enabledSidVolumeItems : await resolveEnabledSidVolumeItems();
    if (!items.length) return;
    const fallbackIndex = previousVolumeIndexRef.current ?? volumeIndex;
    const target = volumeSteps[fallbackIndex]?.option;
    let updates = target ? buildEnabledSidMutedToTargetUpdates(items, sidEnablement, target) : {};
    if (!Object.keys(updates).length && target) {
      updates = buildEnabledSidVolumeUpdates(items, sidEnablement, target);
    }
    if (Object.keys(updates).length) {
      lastManualWriteRef.current = {
        index: fallbackIndex,
        muted: false,
        setAtMs: Date.now(),
      };
      const queued = await queuePlaybackMixerWrite({
        updates,
        context: "Unmute on playback start",
        index: fallbackIndex,
        muted: false,
        allowKnownDeviceSkip: false,
      });
      if (queued) {
        addLog("info", "Play volume unmute sent on playback start", {
          index: fallbackIndex,
        });
      }
    }
    dispatchVolume({ type: "unmute", reason: "manual", index: fallbackIndex });
    manualMuteSnapshotRef.current = null;
    clearPendingVolumeWrite();
  }, [
    buildEnabledSidMutedToTargetUpdates,
    buildEnabledSidVolumeUpdates,
    clearPendingVolumeWrite,
    dispatchVolume,
    queuePlaybackMixerWrite,
    resolveEnabledSidVolumeItems,
    sidEnablement,
    volumeIndex,
    volumeMuted,
    volumeSteps,
    enabledSidVolumeItems,
  ]);

  return {
    volumeState,
    dispatchVolume,
    volumeSteps,
    sidVolumeItems,
    sidEnablement,
    enabledSidVolumeItems,
    resolveVolumeIndex,
    resolveEnabledSidVolumeItems,
    restoreVolumeOverrides,
    ensureVolumeSessionSnapshot,
    reserveVolumeUiTarget,
    applyAudioMixerUpdates,
    manualMuteSnapshotRef,
    pauseMuteSnapshotRef,
    pausingFromPauseRef,
    resumingFromPauseRef,
    volumeSessionSnapshotRef,
    volumeSessionActiveRef,
    volumeUpdateTimerRef,
    volumeUpdateSeqRef,
    captureSidMuteSnapshot,
    snapshotToUpdates,
    handleVolumeLocalChange,
    handleVolumeAsyncChange,
    handleVolumeCommit,
    handleToggleMute,
    ensureUnmuted,
  };
}
