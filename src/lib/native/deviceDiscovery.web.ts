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
} from "@/lib/native/deviceDiscovery";

export class DeviceDiscoveryWeb implements DeviceDiscoveryPlugin {
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
