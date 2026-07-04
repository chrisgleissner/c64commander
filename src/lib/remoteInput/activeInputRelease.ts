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

let activeRelease: ActiveInputReleaseCallback | null = null;

/**
 * HARD13-001 residual (E1): a saved-device switch performed while the Remote
 * Input sheet holds a relayed input must release it on the OLD device before
 * `executeSavedDeviceSwitch` retargets the API — otherwise the eventual
 * release-all hits the NEW device and the old one keeps the input pressed
 * forever. `useRemoteInputSession` registers exactly one release callback
 * (module-level; at most one sheet instance exists at a time) while mounted,
 * and the switch calls {@link releaseActiveRemoteInput} as its very first
 * step, while `getC64API()` still targets the device being switched away
 * from.
 */
export const registerActiveInputRelease = (callback: ActiveInputReleaseCallback): void => {
  activeRelease = callback;
};

export const unregisterActiveInputRelease = (callback: ActiveInputReleaseCallback): void => {
  if (activeRelease === callback) activeRelease = null;
};

/**
 * Lets a caller skip the `await` entirely when no Remote Input session is
 * mounted, instead of always paying an unconditional microtask suspension
 * for a release that can never do anything.
 */
export const hasActiveInputRelease = (): boolean => activeRelease !== null;

/**
 * No-op when nothing is registered. Internally caught and time-bounded so a
 * dead or slow old device can never stall a device switch: the failure is
 * logged at WARN, never rethrown.
 */
export const releaseActiveRemoteInput = async (): Promise<void> => {
  const release = activeRelease;
  if (!release) return;
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

export const resetActiveInputReleaseForTests = (): void => {
  activeRelease = null;
};
