/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import {
  getMachineExecutionSnapshot,
  restorePauseMuteFromPersistedSnapshot,
  setMachineExecutionPaused,
  setMachineExecutionRunning,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { capturePauseMuteToPersistedSnapshot } from "@/lib/deviceInteraction/pauseMuteCapture";
import { hydratePlaybackSnapshot } from "@/lib/playback/playbackSessionPersistence";

/**
 * A pause the app took and never resumed, for instance because it was force-stopped in between, still
 * has its mixer snapshot persisted. Without honouring it a second pause found the SIDs already muted,
 * recorded nothing to restore, and the resume after it left them at the mute level for good.
 */
const hasPersistedPauseMute = (deviceId: string | null) =>
  Boolean(deviceId && hydratePlaybackSnapshot(deviceId)?.pauseMuteSnapshot);

export type PauseResumeMachineInput = {
  api: C64API;
  /** The saved device the mute snapshot is scoped to; null when nothing is selected. */
  deviceId: string | null;
  pause: () => Promise<unknown>;
  resume: () => Promise<unknown>;
};

// A running CPU changes these pages every frame: the KERNAL jiffy clock, and the return address
// any interrupt pushes. A program that replaces the KERNAL interrupt stops the clock but still pushes.
const readZeroPageAndStack = (api: C64API) => api.readMemory("0000", 0x200);

/**
 * Show a pause the app took before it was stopped as a pause. The execution store starts as running,
 * so after a relaunch Home offered Pause for a machine that was halted with its SIDs muted. Two reads
 * of zero page and the stack say whether that pause still holds: if they differ, something has resumed
 * the machine since, and only the muted levels are left to put back.
 */
export const adoptInterruptedPause = async (api: C64API, deviceId: string | null): Promise<boolean> => {
  if (getMachineExecutionSnapshot().state !== "running" || !hasPersistedPauseMute(deviceId)) return false;
  try {
    const before = await readZeroPageAndStack(api);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const after = await readZeroPageAndStack(api);
    if (inFlight || getMachineExecutionSnapshot().state !== "running") return false;
    if (before.some((byte, index) => byte !== after[index])) {
      await restorePauseMuteFromPersistedSnapshot(api, deviceId);
      addLog("info", "Machine: restored the SID levels of a pause that has since ended", { deviceId });
      return false;
    }
  } catch (error) {
    addLog("warn", "Machine: could not tell whether a pause from a previous session still holds", {
      deviceId,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  }
  setMachineExecutionPaused({ pauseMutePending: true });
  addLog("info", "Machine: showing a pause left by a previous session", { deviceId });
  return true;
};

let inFlight: Promise<"paused" | "running"> | null = null;

/**
 * Pause or resume the machine, whichever the shared execution store says is next.
 *
 * It lives here rather than in Home's actions because the keypad's own shortcut has to do exactly
 * the same thing from any page, and a second copy would be a second set of rules about the SID
 * mixer. Returns the state it moved to, so a caller can word its own message.
 *
 * A call made while one is running joins it rather than starting another: two overlapping pauses
 * made the second capture the mixer the first had already muted, record that no mute was pending,
 * and so leave the SID silent after the resume.
 */
export const pauseResumeMachine = (input: PauseResumeMachineInput): Promise<"paused" | "running"> => {
  if (!inFlight) {
    inFlight = runPauseResume(input).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
};

const runPauseResume = async (input: PauseResumeMachineInput): Promise<"paused" | "running"> => {
  const target = getMachineExecutionSnapshot().state === "running" ? "paused" : "running";
  // Read before the store is written below: a pause taken on another page may have muted the SID
  // mixer and left a snapshot that only this resume can put back.
  const pauseMutePending = getMachineExecutionSnapshot().pauseMutePending;

  if (target === "paused") {
    // HARD19-010: mute the SID mixer before pausing, so a paused SID does not hold a drone.
    const interruptedPauseMute = hasPersistedPauseMute(input.deviceId);
    const muteApplied = await capturePauseMuteToPersistedSnapshot(input.api, input.deviceId);
    try {
      await input.pause();
    } catch (error) {
      // Roll back the mute, so a pause that failed does not leave a running machine silent.
      if (muteApplied) await restorePauseMuteFromPersistedSnapshot(input.api, input.deviceId);
      throw error;
    }
    setMachineExecutionPaused({ pauseMutePending: muteApplied || interruptedPauseMute });
    return "paused";
  }

  await input.resume();
  if (pauseMutePending || hasPersistedPauseMute(input.deviceId)) {
    await restorePauseMuteFromPersistedSnapshot(input.api, input.deviceId);
  }
  setMachineExecutionRunning();
  return "running";
};
