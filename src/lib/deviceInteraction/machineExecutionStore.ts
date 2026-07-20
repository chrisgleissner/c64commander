/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog, buildErrorLogDetails } from "@/lib/logging";
import { buildEnabledSidUnmuteUpdates } from "@/lib/config/sidVolumeControl";
import { clearPersistedPauseMute, hydratePlaybackSnapshot } from "@/lib/playback/playbackSessionPersistence";

// HARD12-020: the C64's machine pause/resume state has no device-side read
// endpoint, so Home and Play cannot converge by polling. Home previously
// assumed "running" on every mount and never unmuted a pause-applied SID
// mixer when the user resumed from Home (Play's mute/unmute bracket lived
// only inside Play's own pause path). This module-singleton (modelled on
// deviceActivityGate.ts) is the shared client-side source of truth for the
// machine execution state and the "a pause-mute snapshot still needs
// restoring on resume" flag, written by BOTH pages' pause/resume paths and
// reset on device switch / stop so it never carries device A's pause state
// onto device B (HARD11-002 wrong-device class).

export type MachineExecutionState = "running" | "paused";

// HARD21-004: who put the machine into "paused". The Ultimate menu freezes the
// running machine, so opening it mirrors a transient pause into this store and
// closing it resumes — but a user Pause (from Play or Home) funnels through the
// SAME single flag, so an unconditional menu-close resume used to clobber a
// pause the user deliberately set. Tagging the pause source lets the menu-close
// resume ignore any pause it did not itself induce. "user" is the default for
// callers that do not name a source (e.g. Home's Pause button), so they are
// never treated as menu-resumable.
export type MachineExecutionPauseSource = "user" | "play" | "menu";

export type MachineExecutionSnapshot = Readonly<{
  state: MachineExecutionState;
  pauseMutePending: boolean;
  pausedBy: MachineExecutionPauseSource | null;
}>;

type ResumeUnmuteApi = {
  updateConfigBatch: (payload: Record<string, Record<string, string | number>>) => Promise<{ errors?: string[] }>;
};

const initialState: MachineExecutionState = "running";
let state: MachineExecutionState = initialState;
let pauseMutePending = false;
let pausedBy: MachineExecutionPauseSource | null = null;
let snapshot: MachineExecutionSnapshot = Object.freeze({ state, pauseMutePending, pausedBy });

const listeners = new Set<() => void>();

const emit = () => {
  listeners.forEach((listener) => listener());
};

const commit = () => {
  snapshot = Object.freeze({ state, pauseMutePending, pausedBy });
  emit();
};

export const getMachineExecutionSnapshot = (): MachineExecutionSnapshot => snapshot;

export const subscribeMachineExecution = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setMachineExecutionPaused = (
  options: { pauseMutePending?: boolean; pausedBy?: MachineExecutionPauseSource } = {},
): void => {
  state = "paused";
  pauseMutePending = Boolean(options.pauseMutePending);
  // HARD21-004: default to "user" so any caller that does not name a source
  // (Home's Pause button) is a user pause the menu-close resume must not touch.
  pausedBy = options.pausedBy ?? "user";
  commit();
};

export const setMachineExecutionRunning = (): void => {
  state = "running";
  pauseMutePending = false;
  pausedBy = null;
  commit();
};

// HARD21-004: source-gated resume. Closing the Home Ultimate menu must resume
// ONLY a pause the menu itself induced (`pausedBy === "menu"`); a user pause
// from Play ("play") or Home ("user") must survive an open+close of the menu, so
// this is a no-op unless the current pause matches `source`. Hard interrupts
// (publishMachineInterrupt, resetMachineExecution) deliberately keep using the
// unconditional setMachineExecutionRunning above and never route through here.
export const resumeMachineExecutionIfPausedBy = (source: MachineExecutionPauseSource): void => {
  if (state !== "paused" || pausedBy !== source) return;
  state = "running";
  pauseMutePending = false;
  pausedBy = null;
  commit();
};

export const resetMachineExecution = (): void => {
  state = initialState;
  pauseMutePending = false;
  pausedBy = null;
  commit();
};

/**
 * Restore the SID mixer from the persisted pause-mute snapshot (captured by
 * Play's pause path and stored device-scoped by HARD12-006). Used by Home's
 * resume because Play may be unmounted (idle placeholder) when the user
 * resumes from Home, so Play's own unmute path is not wired up. Returns true
 * when a restore was applied.
 */
export const restorePauseMuteFromPersistedSnapshot = async (
  api: ResumeUnmuteApi,
  deviceId: string | null | undefined,
): Promise<boolean> => {
  if (!deviceId) return false;
  const persisted = hydratePlaybackSnapshot(deviceId);
  if (!persisted || !persisted.pauseMuteSnapshot || !persisted.pauseMuteEnablement) {
    return false;
  }
  const updates = buildEnabledSidUnmuteUpdates(persisted.pauseMuteSnapshot, persisted.pauseMuteEnablement);
  if (!Object.keys(updates).length) {
    clearPersistedPauseMute(deviceId);
    return false;
  }
  try {
    const result = await api.updateConfigBatch({ "Audio Mixer": updates });
    const firmwareErrors = Array.isArray(result?.errors)
      ? result.errors.filter((entry) => entry.trim().length > 0)
      : [];
    if (firmwareErrors.length) {
      addErrorLog("Home resume pause-mute restore rejected by firmware", {
        errors: firmwareErrors,
        deviceId,
        updateCount: Object.keys(updates).length,
      });
      return false;
    }
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    addLog(
      "error",
      "Home resume pause-mute restore failed",
      buildErrorLogDetails(normalizedError, {
        deviceId,
        updateCount: Object.keys(updates).length,
      }),
    );
    return false;
  }
  clearPersistedPauseMute(deviceId);
  addLog("info", "Restored SID mixer from pause-mute snapshot via Home resume", {
    deviceId,
    updateCount: Object.keys(updates).length,
  });
  return true;
};
