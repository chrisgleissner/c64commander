/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { C64API } from "@/lib/c64api";
import {
  getMachineExecutionSnapshot,
  restorePauseMuteFromPersistedSnapshot,
  setMachineExecutionPaused,
  setMachineExecutionRunning,
} from "@/lib/deviceInteraction/machineExecutionStore";
import { capturePauseMuteToPersistedSnapshot } from "@/lib/deviceInteraction/pauseMuteCapture";

export type PauseResumeMachineInput = {
  api: C64API;
  /** The saved device the mute snapshot is scoped to; null when nothing is selected. */
  deviceId: string | null;
  pause: () => Promise<unknown>;
  resume: () => Promise<unknown>;
};

/**
 * Pause or resume the machine, whichever the shared execution store says is next.
 *
 * It lives here rather than in Home's actions because the keypad's own shortcut has to do exactly
 * the same thing from any page, and a second copy would be a second set of rules about the SID
 * mixer. Returns the state it moved to, so a caller can word its own message.
 */
export const pauseResumeMachine = async (input: PauseResumeMachineInput): Promise<"paused" | "running"> => {
  const target = getMachineExecutionSnapshot().state === "running" ? "paused" : "running";
  // Read before the store is written below: a pause taken on another page may have muted the SID
  // mixer and left a snapshot that only this resume can put back.
  const pauseMutePending = getMachineExecutionSnapshot().pauseMutePending;

  if (target === "paused") {
    // HARD19-010: mute the SID mixer before pausing, so a paused SID does not hold a drone.
    const muteApplied = await capturePauseMuteToPersistedSnapshot(input.api, input.deviceId);
    try {
      await input.pause();
    } catch (error) {
      // Roll back the mute, so a pause that failed does not leave a running machine silent.
      if (muteApplied) await restorePauseMuteFromPersistedSnapshot(input.api, input.deviceId);
      throw error;
    }
    setMachineExecutionPaused({ pauseMutePending: muteApplied });
    return "paused";
  }

  await input.resume();
  if (pauseMutePending) await restorePauseMuteFromPersistedSnapshot(input.api, input.deviceId);
  setMachineExecutionRunning();
  return "running";
};
