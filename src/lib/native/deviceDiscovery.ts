/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

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
  /** Every address the device answered on this scan, `address` included. */
  addresses?: string[];
};

export type NativeDeviceDiscoveryOptions = {
  /**
   * Hosts to probe ahead of (and in addition to) the LAN sweep. Each entry is a
   * `host:port` pair, or a bare host when the port is the default 80; the native side
   * also sweeps the LAN on every distinct non-default port seen here (HARD27-020).
   */
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

/**
 * `supported` is false wherever the platform cannot answer the question; callers
 * must then treat connectivity as unknown rather than as offline.
 */
export type NativeNetworkStatus = {
  online: boolean;
  supported: boolean;
};

export type DeviceDiscoveryPlugin = {
  discover(options: NativeDeviceDiscoveryOptions): Promise<NativeDeviceDiscoveryResult>;
  getNetworkStatus(): Promise<NativeNetworkStatus>;
  /** Fires when the platform's answer to `getNetworkStatus` changes, so a reconnect need not wait for a poll. */
  addListener(
    eventName: "networkStatusChange",
    listener: (status: NativeNetworkStatus) => void,
  ): Promise<PluginListenerHandle>;
};

export const DeviceDiscovery = registerPlugin<DeviceDiscoveryPlugin>("DeviceDiscovery", {
  web: () => import("./deviceDiscovery.web").then((module) => new module.DeviceDiscoveryWeb()),
});
