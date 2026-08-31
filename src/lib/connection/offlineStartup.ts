/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";
import { DeviceDiscovery, type NativeNetworkStatus } from "@/lib/native/deviceDiscovery";

const UNKNOWN_NETWORK_STATUS: NativeNetworkStatus = { online: true, supported: false };

const NETWORK_STATUS_TIMEOUT_MS = 1500;

export type OfflineDemoDecisionInput = {
  networkStatus: NativeNetworkStatus;
  nativePlatform: boolean;
  realDeviceSessionActive: boolean;
};

/**
 * The simulated device may start on its own only when the platform positively
 * reports that there is no network at all. An unknown or online answer keeps the
 * normal discovery flow, so a reachable device always wins and an unreachable one
 * is still reported as a failure rather than masked as a healthy simulated device.
 */
export const shouldStartDemoModeForOfflineDevice = (input: OfflineDemoDecisionInput): boolean =>
  input.nativePlatform &&
  input.networkStatus.supported &&
  !input.networkStatus.online &&
  !input.realDeviceSessionActive;

const withTimeout = async (
  read: Promise<NativeNetworkStatus>,
  timeoutMs: number,
): Promise<NativeNetworkStatus | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const readNativeNetworkStatus = async (): Promise<NativeNetworkStatus> => {
  if (!isNativePlatform()) return UNKNOWN_NETWORK_STATUS;
  try {
    const status = await withTimeout(DeviceDiscovery.getNetworkStatus(), NETWORK_STATUS_TIMEOUT_MS);
    if (!status) {
      addLog("warn", "Native network status timed out; treating connectivity as unknown", {
        timeoutMs: NETWORK_STATUS_TIMEOUT_MS,
      });
      return UNKNOWN_NETWORK_STATUS;
    }
    return { online: status.online !== false, supported: status.supported === true };
  } catch (error) {
    addLog("info", "Native network status unavailable; treating connectivity as unknown", {
      error: error instanceof Error ? error.message : String(error ?? "unknown error"),
    });
    return UNKNOWN_NETWORK_STATUS;
  }
};

export const isDeviceConfirmedOffline = async (): Promise<boolean> => {
  const status = await readNativeNetworkStatus();
  return status.supported && !status.online;
};
