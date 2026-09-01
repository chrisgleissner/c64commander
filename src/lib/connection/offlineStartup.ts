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

/**
 * Test seam (E2E and hardware-in-the-loop only), the native counterpart of the one in
 * `deviceDiscovery.web.ts`.
 *
 * "A network is up but no C64U answers on it" cannot be staged on the bench handset without
 * putting probe traffic on the Wi-Fi the real devices are on. With the radios off and this
 * override in place, the app takes the whole network-enabled route — saved-host probe, discovery
 * window, LAN-scan fallback, then the Demo Mode offer — while the phone physically cannot reach
 * anything but its own loopback.
 *
 * Gated on the same explicit probe opt-in as every other seam; a release build never sets it.
 */
const readInjectedNetworkStatus = (): NativeNetworkStatus | null => {
  if (typeof window === "undefined") return null;
  const win = window as Window & {
    __c64uTestProbeEnabled?: boolean;
    __c64uMockNetworkStatus?: Partial<NativeNetworkStatus>;
  };
  if (win.__c64uTestProbeEnabled !== true) return null;
  const injected = win.__c64uMockNetworkStatus;
  if (!injected) return null;
  return { online: injected.online !== false, supported: injected.supported === true };
};

export const readNativeNetworkStatus = async (): Promise<NativeNetworkStatus> => {
  const injected = readInjectedNetworkStatus();
  if (injected) {
    addLog("info", "Native network status overridden by a test probe", injected);
    return injected;
  }
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
