/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { NativeDeviceDiscoverySource } from "@/lib/native/deviceDiscovery";

export type DeviceDiscoveryTrigger = "startup" | "settings" | "manual" | "resume";

export type DeviceDiscoveryCandidate = {
  id: string;
  address: string;
  host: string | null;
  httpPort: number;
  source: NativeDeviceDiscoverySource[];
  product: string;
  firmwareVersion: string | null;
  fpgaVersion: string | null;
  coreVersion: string | null;
  hostname: string | null;
  uniqueId: string | null;
  requiresPassword: boolean;
  alreadySavedDeviceId: string | null;
  confidence: "verified";
  lastSeenAt: string;
};

export type DeviceDiscoveryPhase = "idle" | "scanning" | "complete" | "error";

export type DeviceDiscoveryState = {
  phase: DeviceDiscoveryPhase;
  trigger: DeviceDiscoveryTrigger | null;
  startedAt: string | null;
  completedAt: string | null;
  candidates: DeviceDiscoveryCandidate[];
  scannedHosts: number;
  elapsedMs: number | null;
  error: string | null;
  unsupported: boolean;
  // HARD19-028: the user dismissed this completed discovery result ("Not now" /
  // Open Settings). Reset to false whenever a fresh scan starts, so background
  // reconnection resumes for this result set but a *new* result re-arms the
  // picker gate.
  acknowledged: boolean;
};

export type DeviceDiscoveryResult = {
  candidates: DeviceDiscoveryCandidate[];
  scannedHosts: number;
  elapsedMs: number;
  unsupported: boolean;
};

export type PersistedDiscoveredDevice = {
  deviceId: string;
  deviceHost: string;
  host: string;
  httpPort: number;
};
