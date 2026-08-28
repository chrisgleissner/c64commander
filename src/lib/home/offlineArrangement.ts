/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { DEFAULT_SAVED_DEVICE_HOST } from "@/lib/savedDevices/host";
import type { SavedDevice } from "@/lib/savedDevices/store";

/**
 * When Home draws its offline arrangement (spec.md section 7.2).
 *
 * This app's connection state is noisy: discovery runs at startup and on resume, handovers abort
 * in-flight reads, and the hardware drops out under load. A plain `isConnected ? A : B` reorders the
 * landing page on every network hiccup, so becoming less useful has to be settled while becoming
 * useful again is instant.
 */

/** How long the selected device must be continuously unreachable before Home rearranges. */
export const OFFLINE_SETTLE_MS = 8_000;

/**
 * True while the selected device is the untouched bootstrap default: never edited, never
 * successfully connected. There is always at least one saved device — a default is bootstrapped on
 * first launch and deleting the last one immediately replaces it — so "no saved device" is not a
 * state that exists, and this is what the true first-run case looks like instead.
 */
export const isUntouchedBootstrapDefault = (device: SavedDevice | null | undefined): boolean => {
  if (!device) return false;
  if (device.lastSuccessfulConnectionAt !== null) return false;
  if (device.nameSource === "USER" || device.typeSource === "USER") return false;
  return device.host === DEFAULT_SAVED_DEVICE_HOST;
};

export interface OfflineArrangementInput {
  readonly isConnected: boolean;
  readonly selectedDevice: SavedDevice | null | undefined;
  /** When the current unreachable run started, or null while connected. */
  readonly unreachableSinceMs: number | null;
  readonly nowMs: number;
  /** True while a dialog, sheet, the search overlay or the tour is on screen. */
  readonly pinned: boolean;
  /** What is drawn right now, so a pinned change is deferred rather than dropped. */
  readonly current: boolean;
}

/**
 * The arrangement to draw. Deliberately asymmetric: it returns to the connected arrangement the
 * moment a connection succeeds, but only goes offline once the device has been unreachable for
 * OFFLINE_SETTLE_MS. Becoming useful again should be instant; becoming less useful should require
 * the app to be sure.
 */
export const resolveOfflineArrangement = (input: OfflineArrangementInput): boolean => {
  // The pin is checked before anything else, including a reconnection. Section 7.3 is about the
  // page not reflowing under whatever is on top of it, and reflowing it because the machine came
  // back is the same defect as reflowing it because the machine went away.
  if (input.pinned) return input.current;
  if (input.isConnected) return false;
  return (
    isUntouchedBootstrapDefault(input.selectedDevice) ||
    (input.unreachableSinceMs !== null && input.nowMs - input.unreachableSinceMs >= OFFLINE_SETTLE_MS)
  );
};
