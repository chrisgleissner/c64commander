/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type {
  DeviceDiscoveryPlugin,
  NativeDeviceDiscoveryOptions,
  NativeDeviceDiscoveryResult,
  NativeNetworkStatus,
} from "@/lib/native/deviceDiscovery";

export class DeviceDiscoveryWeb implements DeviceDiscoveryPlugin {
  // A browser cannot read the interface table, and `navigator.onLine` reports
  // "an interface exists", not "a LAN is reachable" — too weak to route a user
  // into the simulated device on.
  async getNetworkStatus(): Promise<NativeNetworkStatus> {
    // Test seam (E2E specs only), matching `discover` below: an injected answer lets a browser
    // drive the no-network path, which otherwise only a real handset with its radios off can
    // reach. Production web builds never set this global, so the real facade stays `unsupported`.
    const injected = (globalThis as { __c64uMockNetworkStatus?: Partial<NativeNetworkStatus> }).__c64uMockNetworkStatus;
    if (injected) {
      return { online: injected.online !== false, supported: injected.supported === true };
    }
    return { online: true, supported: false };
  }

  async discover(_options: NativeDeviceDiscoveryOptions): Promise<NativeDeviceDiscoveryResult> {
    // Test seam (E2E specs / screenshot capture only): when a mock result is
    // injected on `window`, return it so the discovery flow + interstitial can be
    // driven in a browser. Production web builds never set this global, so the
    // real web facade stays `unsupported` (a browser cannot LAN-scan).
    const injected = (globalThis as { __c64uMockDeviceDiscovery?: Partial<NativeDeviceDiscoveryResult> })
      .__c64uMockDeviceDiscovery;
    if (injected?.candidates) {
      return {
        candidates: injected.candidates,
        scannedHosts: injected.scannedHosts ?? injected.candidates.length,
        elapsedMs: injected.elapsedMs ?? 0,
        unsupported: false,
      };
    }

    return {
      candidates: [],
      scannedHosts: 0,
      elapsedMs: 0,
      unsupported: true,
    };
  }
}
