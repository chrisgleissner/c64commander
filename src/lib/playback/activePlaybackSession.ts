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
import { notifyPlaybackActivityChanged, subscribePlaybackActivity } from "./playbackActivitySignal";

/**
 * Subscribe to playback start/stop. Returns an unsubscribe.
 *
 * The transport buttons need this for the same reason the device switch needed
 * the flag below. They were driven by a `PlayFilesPage` `useState(false)`, so a
 * fresh page instance — one produced by navigating Home → Play while a tune
 * played — rendered its controls as though nothing were playing: **Pause
 * disabled, Rewind and Fast Forward gone**, on a tune the user could hear. The
 * page recovers when its async session restore lands, but "the buttons work a
 * moment later" is not a working transport.
 */
export const subscribeActivePlayback = subscribePlaybackActivity;

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
  notifyPlaybackActivityChanged();
};

export const markRemotePlaybackStopped = (): void => {
  remotePlaybackActive = false;
  notifyPlaybackActivityChanged();
};

/** Test seam. */
export const __isRemotePlaybackActive = (): boolean => remotePlaybackActive;

/** Is a tune playing on the C64 right now? Survives any mount/unmount. */
export const isRemotePlaybackActive = (): boolean => remotePlaybackActive;

/** Is a tune rendering on THIS device right now? */
export const isLocalPlaybackActive = (): boolean => getSharedLocalSidPlaybackController().isActive();

/**
 * Is anything playing at all, wherever it is?
 *
 * This is what a transport control should ask. "Is *my* React state playing" is
 * a different and much weaker question — see the listeners comment above.
 */
export const isAnyPlaybackActive = (): boolean => isRemotePlaybackActive() || isLocalPlaybackActive();

/**
 * Is there anything to stop before a device switch?
 *
 * Synchronous on purpose. The switch path deliberately avoids suspending when
 * there is no work to do — `hasActiveInputRelease` exists for exactly the same
 * reason — so callers can skip the await entirely rather than yielding a
 * microtask on every switch just to discover nothing was playing.
 */
export const hasActivePlaybackToStop = (): boolean =>
  remotePlaybackActive || getSharedLocalSidPlaybackController().isActive();

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
