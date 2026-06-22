/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from "@capacitor/core";

export type NativeDeviceDiscoverySource = "hostname" | "lan-scan";

export type NativeDeviceDiscoveryCandidate = {
  address: string;
  host?: string;
  httpPort: number;
  source: NativeDeviceDiscoverySource[];
  product?: string;
  firmwareVersion?: string;
  fpgaVersion?: string;
  coreVersion?: string;
  hostname?: string;
  uniqueId?: string;
  requiresPassword?: boolean;
};

export type NativeDeviceDiscoveryOptions = {
  knownHosts?: string[];
  includeLanScan?: boolean;
  timeoutMs?: number;
  connectTimeoutMs?: number;
  maxConcurrency?: number;
};

export type NativeDeviceDiscoveryResult = {
  candidates: NativeDeviceDiscoveryCandidate[];
  scannedHosts: number;
  elapsedMs: number;
  unsupported?: boolean;
};

export type DeviceDiscoveryPlugin = {
  discover(options: NativeDeviceDiscoveryOptions): Promise<NativeDeviceDiscoveryResult>;
};

export const DeviceDiscovery = registerPlugin<DeviceDiscoveryPlugin>("DeviceDiscovery", {
  web: () => import("./deviceDiscovery.web").then((module) => new module.DeviceDiscoveryWeb()),
});
