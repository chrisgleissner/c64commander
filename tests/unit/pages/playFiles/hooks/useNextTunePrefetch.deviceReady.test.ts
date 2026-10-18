/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const snapshots = vi.hoisted(() => ({
  connection: { state: "REAL_CONNECTED" },
  device: { state: "READY", busyCount: 0, lastSuccessAtMs: 0 as number | null },
  activity: { restInFlight: 0, ftpInFlight: 0 },
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  getConnectionSnapshot: () => snapshots.connection,
}));
vi.mock("@/lib/deviceInteraction/deviceStateStore", () => ({
  getDeviceStateSnapshot: () => snapshots.device,
}));
vi.mock("@/lib/diagnostics/diagnosticsActivity", () => ({
  getDiagnosticsActivitySnapshot: () => snapshots.activity,
}));

import { DEVICE_ANSWERED_RECENTLY_MS, isDeviceReadyForPrefetch } from "@/pages/playFiles/hooks/useNextTunePrefetch";

const NOW = 1_000_000_000;

describe("isDeviceReadyForPrefetch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    snapshots.connection = { state: "REAL_CONNECTED" };
    snapshots.device = { state: "READY", busyCount: 0, lastSuccessAtMs: NOW - 1000 };
    snapshots.activity = { restInFlight: 0, ftpInFlight: 0 };
  });

  afterEach(() => vi.useRealTimers());

  it("is ready when the real device answered recently and nothing else is using it", () => {
    expect(isDeviceReadyForPrefetch()).toBe(true);
  });

  it.each(["DEMO_ACTIVE", "OFFLINE_NO_DEMO", "DISCOVERING"])(
    "is not ready while the connection state is %s",
    (state) => {
      snapshots.connection = { state };

      expect(isDeviceReadyForPrefetch()).toBe(false);
    },
  );

  it("is not ready when the device has never answered", () => {
    snapshots.device.lastSuccessAtMs = null;

    expect(isDeviceReadyForPrefetch()).toBe(false);
  });

  it("is not ready when the last answer is older than the recency window", () => {
    snapshots.device.lastSuccessAtMs = NOW - DEVICE_ANSWERED_RECENTLY_MS;

    expect(isDeviceReadyForPrefetch()).toBe(false);
  });

  it.each([
    ["the device is busy", () => (snapshots.device.busyCount = 1)],
    ["a REST request is in flight", () => (snapshots.activity.restInFlight = 1)],
    ["an FTP transfer is in flight", () => (snapshots.activity.ftpInFlight = 1)],
    ["the device is not in the READY state", () => (snapshots.device.state = "BUSY")],
  ])("is not ready when %s", (_name, makeBusy) => {
    makeBusy();

    expect(isDeviceReadyForPrefetch()).toBe(false);
  });
});
