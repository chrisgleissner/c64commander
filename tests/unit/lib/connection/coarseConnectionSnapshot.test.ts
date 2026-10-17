/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionSnapshot } from "@/lib/connection/connectionManager";
import type { DeviceInfo } from "@/lib/c64api";

let current: ConnectionSnapshot;

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => current,
}));

import { getCoarseConnectionSnapshot } from "@/lib/connection/coarseConnectionSnapshot";

const parsedInfo = (overrides: Partial<DeviceInfo> = {}): DeviceInfo => ({
  product: "C64 Ultimate",
  firmware_version: "1.2.1RC2",
  hostname: "c64u",
  unique_id: "5D0464",
  errors: [],
  ...overrides,
});

const snapshotWith = (deviceInfo: DeviceInfo, lastProbeSucceededAtMs: number): ConnectionSnapshot => ({
  state: "REAL_CONNECTED",
  lastDiscoveryTrigger: "startup",
  lastTransitionAtMs: 1000,
  lastProbeAtMs: lastProbeSucceededAtMs,
  lastProbeSucceededAtMs,
  lastProbeFailedAtMs: null,
  lastProbeError: null,
  deviceInfo,
  demoInterstitialVisible: false,
  demoInterstitialReason: null,
});

describe("getCoarseConnectionSnapshot", () => {
  beforeEach(() => {
    current = snapshotWith(parsedInfo(), 1);
    getCoarseConnectionSnapshot();
  });

  it("keeps its identity when a poll parses the same device info into a fresh errors array", () => {
    const before = getCoarseConnectionSnapshot();

    current = snapshotWith(parsedInfo({ errors: [] }), 61_000);

    expect(getCoarseConnectionSnapshot()).toBe(before);
  });

  it("changes identity when an item of the errors array differs", () => {
    const before = getCoarseConnectionSnapshot();

    current = snapshotWith(parsedInfo({ errors: ["overheated"] }), 61_000);

    expect(getCoarseConnectionSnapshot()).not.toBe(before);
  });

  it("changes identity when the firmware version differs", () => {
    const before = getCoarseConnectionSnapshot();

    current = snapshotWith(parsedInfo({ firmware_version: "1.3.0" }), 61_000);

    expect(getCoarseConnectionSnapshot()).not.toBe(before);
  });
});
