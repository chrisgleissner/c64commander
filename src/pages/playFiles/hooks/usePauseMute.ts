/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, type MutableRefObject } from "react";
import { addErrorLog, addLog } from "@/lib/logging";
import { getC64API } from "@/lib/c64api";
import { extractAudioMixerItems } from "@/lib/config/audioMixerItems";
import {
  buildEnabledSidUnmuteUpdates,
  buildPauseMuteRestoreUpdates,
  type SidEnablement,
} from "@/lib/config/sidVolumeControl";
import type { AudioMixerItem } from "@/pages/playFiles/playFilesUtils";
import type { VolumeAction } from "@/pages/playFiles/volumeState";

export type SidMuteSnapshot = {
  volumes: Record<string, string | number>;
  enablement: SidEnablement;
};

type PauseMuteOptions = {
  enabledSidVolumeItems: AudioMixerItem[];
  sidEnablement: SidEnablement;
  captureSidMuteSnapshot: (items: AudioMixerItem[], enablement: SidEnablement) => SidMuteSnapshot;
  buildEnabledSidMuteUpdates: (items: AudioMixerItem[], enablement: SidEnablement) => Record<string, string | number>;
  snapshotToUpdates: (
    snapshot: SidMuteSnapshot | null | undefined,
    currentItems?: AudioMixerItem[],
  ) => Record<string, string | number>;
  applyAudioMixerUpdates: (updates: Record<string, string | number>, reason: string) => Promise<void>;
  ensureUnmuted: (options?: { force?: boolean; refreshItems?: boolean }) => Promise<void>;
  isManualMuteHeld: () => boolean;
  dispatchVolume: React.Dispatch<VolumeAction>;
  pauseMuteSnapshotRef: MutableRefObject<SidMuteSnapshot | null>;
  pausingFromPauseRef: MutableRefObject<boolean>;
  resumingFromPauseRef: MutableRefObject<boolean>;
};

/**
 * The levels to put back on resume, read against the device rather than the cache, since another app
 * may have changed them during the pause. When the mixer cannot be read, the stored levels go back
 * as before, so a resume never leaves the C64 silent.
 */
const buildResumeUpdates = async (snapshot: SidMuteSnapshot) => {
  const names = Object.keys(snapshot.volumes);
  try {
    const data = await getC64API().getConfigItems("Audio Mixer", names, {
      __c64uIntent: "user",
      __c64uBypassCache: true,
    });
    return buildPauseMuteRestoreUpdates(snapshot.volumes, snapshot.enablement, extractAudioMixerItems(data));
  } catch (error) {
    addLog("warn", "Playback resume could not read the SID mixer; restoring the levels from before the pause", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return buildEnabledSidUnmuteUpdates(snapshot.volumes, snapshot.enablement);
  }
};

/** Mutes the C64's SID outputs while a tune is paused on it, and hands back the volume, or the listener's own Mute, on resume. */
export const usePauseMute = ({
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
}: PauseMuteOptions) => {
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

  const keepManualMuteAfterPause = useCallback(() => {
    pauseMuteSnapshotRef.current = null;
    pausingFromPauseRef.current = false;
    dispatchVolume({ type: "mute", reason: "manual" });
  }, [dispatchVolume, pauseMuteSnapshotRef, pausingFromPauseRef]);

  const unmuteAfterMachineResume = useCallback(async () => {
    if (isManualMuteHeld()) {
      keepManualMuteAfterPause();
      resumingFromPauseRef.current = true;
      addLog("info", "Playback resume kept the listener's mute");
      return;
    }
    const snapshot = pauseMuteSnapshotRef.current;
    const updates = snapshot ? await buildResumeUpdates(snapshot) : {};
    if (Object.keys(updates).length) {
      await applyAudioMixerUpdates(updates, "Resume unmute");
    } else if (snapshot) {
      addLog("info", "Playback resume left the SID mixer as it is: its levels were changed after the pause", {
        snapshotItems: Object.keys(snapshot.volumes),
      });
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
    ensureUnmuted,
    isManualMuteHeld,
    keepManualMuteAfterPause,
    pauseMuteSnapshotRef,
    pausingFromPauseRef,
    resumingFromPauseRef,
  ]);

  const rollbackMuteAfterFailedPause = useCallback(
    async (pauseError: unknown) => {
      const snapshot = pauseMuteSnapshotRef.current;
      if (!snapshot && !pausingFromPauseRef.current) return;
      if (isManualMuteHeld()) {
        keepManualMuteAfterPause();
        resumingFromPauseRef.current = false;
        return;
      }
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
      isManualMuteHeld,
      keepManualMuteAfterPause,
      pauseMuteSnapshotRef,
      pausingFromPauseRef,
      resumingFromPauseRef,
      snapshotToUpdates,
    ],
  );

  return { muteBeforeMachinePause, unmuteAfterMachineResume, rollbackMuteAfterFailedPause };
};
