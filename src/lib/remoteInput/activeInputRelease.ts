/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog, buildErrorLogDetails } from "@/lib/logging";

export type ActiveInputReleaseCallback = () => Promise<void>;

/** Bounds how long a saved-device switch waits on an unresponsive old device. */
const RELEASE_TIMEOUT_MS = 1500;

const activeReleases = new Set<ActiveInputReleaseCallback>();

/**
 * HARD13-001 residual (E1): a saved-device switch performed while the Remote
 * Input sheet holds a relayed input must release it on the OLD device before
 * `executeSavedDeviceSwitch` retargets the API — otherwise the eventual
 * release-all hits the NEW device and the old one keeps the input pressed
 * forever. The switch calls {@link releaseActiveRemoteInput} as its very
 * first step, while `getC64API()` still targets the device being switched
 * away from.
 *
 * HARD16-010: TWO pages (Home and Play) each mount a `RemoteInputSheet`, and
 * the swipe runway transiently mounts an adjacent page during a gesture — so
 * more than one `useRemoteInputSession` can be registered at once. A single
 * last-write-wins slot let a transient adjacent-page mount displace the
 * active page's registration and then null it on unmount, silently disabling
 * the safety net. The registry is therefore a set: every mounted session
 * registers, and the switch releases them all. A closed sheet's callback is a
 * cheap no-op (its held-set is empty), so releasing every registrant is safe.
 */
export const registerActiveInputRelease = (callback: ActiveInputReleaseCallback): void => {
  activeReleases.add(callback);
};

export const unregisterActiveInputRelease = (callback: ActiveInputReleaseCallback): void => {
  activeReleases.delete(callback);
};

/**
 * Lets a caller skip the `await` entirely when no Remote Input session is
 * mounted, instead of always paying an unconditional microtask suspension
 * for a release that can never do anything.
 */
export const hasActiveInputRelease = (): boolean => activeReleases.size > 0;

const runBoundedRelease = async (release: ActiveInputReleaseCallback): Promise<void> => {
  try {
    await Promise.race([release(), new Promise<void>((resolve) => setTimeout(resolve, RELEASE_TIMEOUT_MS))]);
  } catch (error) {
    addLog(
      "warn",
      "Pre-switch active remote input release failed",
      buildErrorLogDetails(error instanceof Error ? error : new Error(String(error)), {}),
    );
  }
};

/**
 * No-op when nothing is registered. Every registered callback runs
 * concurrently, each individually caught and time-bounded, so a dead or slow
 * old device — or one rejecting callback — can never stall the switch or
 * prevent the other registrants from releasing. Failures are logged at WARN,
 * never rethrown.
 */
export const releaseActiveRemoteInput = async (): Promise<void> => {
  if (activeReleases.size === 0) return;
  await Promise.all([...activeReleases].map(runBoundedRelease));
};

export const resetActiveInputReleaseForTests = (): void => {
  activeReleases.clear();
};
