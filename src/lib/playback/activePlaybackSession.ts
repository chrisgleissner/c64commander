/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { getC64API } from "@/lib/c64api";
import { getSharedLocalSidPlaybackController } from "./localSidPlaybackController";

/**
 * App-wide handle on whatever is currently making sound, so a *switchover* can
 * silence the old source before the new one starts.
 *
 * Two switchovers need this and neither could reach the playback controller
 * before:
 *
 *  - **Device → device.** `useSavedDeviceSwitching` already stops the A/V mirror
 *    and releases Remote Input before retargeting the API, but nothing stopped
 *    the *tune*. Switching from one Ultimate to another while a SID played left
 *    the old machine playing it, with the app now pointing elsewhere and no
 *    control over it short of walking to the C64.
 *  - **Engine → engine.** Local ↔ C64 is handled inside the controller, but it
 *    has to be able to stop the side it is leaving even when that side is the
 *    remote one.
 *
 * This is deliberately a tiny registration seam rather than shared state: the
 * controller owns playback, and this only lets an unrelated part of the app ask
 * it to stop first. The stop is bounded by the caller — a dead old device must
 * never stall a device switch.
 */
/**
 * Whether the app currently has a tune running on the REMOTE machine.
 *
 * Deliberately not derived from React state. The first two attempts at this
 * were, and both failed on hardware for the same underlying reason: the state
 * belonged to a `PlayFilesPage` instance, and by the time a device switch runs
 * (from **Settings**) that page has unmounted — and a transient replacement
 * page re-registers with a freshly-initialised `isPlaying: false`. Whichever
 * instance happened to register last decided the answer, and it was the wrong
 * one: the old Ultimate kept playing (its player clock ran on past the switch)
 * while the app had already retargeted.
 *
 * This flag is set where playback actually starts and cleared where it actually
 * stops, so it survives any amount of mounting and unmounting.
 */
let remotePlaybackActive = false;

export const markRemotePlaybackStarted = (): void => {
  remotePlaybackActive = true;
  addLog("info", "Playback: tune launched on the C64", { service: "playback" });
};

export const markRemotePlaybackStopped = (): void => {
  remotePlaybackActive = false;
};

/** Test seam. */
export const __isRemotePlaybackActive = (): boolean => remotePlaybackActive;

/**
 * Silence whatever is playing before a device retarget.
 *
 * Runs while `getC64API()` still points at the OLD device, so the reset lands
 * on the machine that is actually playing. Bounded — a device that has gone
 * away must never hold the switch open.
 */
export const stopActivePlaybackBeforeDeviceSwitch = async (timeoutMs = 2000): Promise<void> => {
  // On-device audio is not tied to the C64 being left behind, but a switchover
  // should still begin from silence rather than layer the new source over it.
  try {
    getSharedLocalSidPlaybackController().stop();
  } catch (error) {
    addLog("warn", "Playback: failed to stop on-device audio before a device switch", {
      service: "playback",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  addLog("info", "Playback: device switch — evaluating the old source", {
    service: "playback",
    remotePlaybackActive,
  });
  if (!remotePlaybackActive) return;
  try {
    // A reset is what the app's own stop does, and it verifiably silences the
    // Ultimate's SID player.
    await Promise.race([getC64API().machineReset(), new Promise((resolve) => setTimeout(resolve, timeoutMs))]);
    markRemotePlaybackStopped();
    addLog("info", "Playback: old device reset before switch", { service: "playback" });
  } catch (error) {
    addLog("warn", "Playback: failed to stop the old device before a device switch", {
      service: "playback",
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
