/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const discover = vi.fn();

vi.mock("@/lib/native/deviceDiscovery", () => ({
  DeviceDiscovery: {
    discover,
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  buildErrorLogDetails: vi.fn((error: Error, details: Record<string, unknown> = {}) => ({
    ...details,
    error: { name: error.name, message: error.message, stack: error.stack },
    errorName: error.name,
    errorStack: error.stack ?? null,
  })),
}));

describe("device discovery manager", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    discover.mockReset();
  });

  it("normalizes verified Ultimate candidates and dedupes by unique id", async () => {
    discover.mockResolvedValueOnce({
      candidates: [
        {
          address: "192.168.1.13",
          host: "u64",
          httpPort: 80,
          source: ["hostname"],
          product: "Ultimate 64 Elite",
          firmwareVersion: "3.14e",
          fpgaVersion: "122",
          coreVersion: "1.4B",
          hostname: "u64",
          uniqueId: "38C1BA",
        },
        {
          address: "192.168.1.13",
          httpPort: 80,
          source: ["lan-scan"],
          product: "Ultimate 64 Elite",
          firmwareVersion: "3.14e",
          fpgaVersion: "122",
          coreVersion: "1.4B",
          hostname: "u64",
          uniqueId: "38C1BA",
        },
        {
          address: "192.168.1.20",
          httpPort: 80,
          source: ["lan-scan"],
          product: "Printer",
        },
      ],
      scannedHosts: 254,
      elapsedMs: 120,
      unsupported: false,
    });

    const { getDeviceDiscoveryState, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true, timeoutMs: 10_000 });

    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({
        includeLanScan: true,
        timeoutMs: 10_000,
      }),
    );
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      address: "192.168.1.13",
      product: "Ultimate 64 Elite",
      hostname: "u64",
      uniqueId: "38C1BA",
      requiresPassword: false,
      source: ["hostname", "lan-scan"],
      confidence: "verified",
    });
    expect(getDeviceDiscoveryState()).toMatchObject({
      phase: "complete",
      scannedHosts: 254,
      candidates: result.candidates,
    });
  });

  it("persists a discovered device as a selected saved device with verified identity", async () => {
    const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice } = await import("@/lib/deviceDiscovery/discoveryManager");

    const persisted = persistDiscoveredDevice(
      {
        id: "id:5d4e12",
        address: "192.168.1.167",
        host: null,
        httpPort: 80,
        source: ["lan-scan"],
        product: "C64 Ultimate",
        firmwareVersion: "1.1.0",
        fpgaVersion: "122",
        coreVersion: "1.49",
        hostname: "c64u",
        uniqueId: "5D4E12",
        requiresPassword: false,
        alreadySavedDeviceId: null,
        confidence: "verified",
        lastSeenAt: "2026-06-21T00:00:00.000Z",
      },
      { select: true },
    );

    const snapshot = getSavedDevicesSnapshot();
    const saved = snapshot.devices.find((device) => device.id === persisted.deviceId);

    expect(saved).toMatchObject({
      host: "192.168.1.167",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: "c64u",
      lastKnownUniqueId: "5D4E12",
      hasPassword: false,
    });
    expect(snapshot.selectedDeviceId).toBe(persisted.deviceId);
    expect(snapshot.verifiedByDeviceId[persisted.deviceId]).toEqual({
      product: "C64U",
      hostname: "c64u",
      uniqueId: "5D4E12",
    });
  });

  it("updates a known device's host by unique id instead of creating a duplicate when its IP changes", async () => {
    const { addSavedDevice, getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice } = await import("@/lib/deviceDiscovery/discoveryManager");

    // A previously-saved device last seen at an old IP, with its unique id recorded.
    addSavedDevice({
      id: "known-1",
      name: "My C64U",
      host: "192.168.1.50",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: "c64u",
      lastKnownUniqueId: "5D4E12",
      hasPassword: false,
    });
    const countBefore = getSavedDevicesSnapshot().devices.length;

    // The SAME physical device (same unique id) reappears at a NEW address.
    const persisted = persistDiscoveredDevice(
      {
        id: "id:5d4e12",
        address: "192.168.1.167",
        host: null,
        httpPort: 80,
        source: ["lan-scan"],
        product: "C64 Ultimate",
        firmwareVersion: "1.1.0",
        fpgaVersion: "122",
        coreVersion: "1.49",
        hostname: "c64u-new",
        uniqueId: "5D4E12",
        requiresPassword: false,
        alreadySavedDeviceId: null,
        confidence: "verified",
        lastSeenAt: "2026-06-22T00:00:00.000Z",
      },
      { select: false },
    );

    const snapshot = getSavedDevicesSnapshot();
    // The existing entry is reused (matched by unique id) and its host updated — no duplicate.
    expect(persisted.deviceId).toBe("known-1");
    expect(snapshot.devices).toHaveLength(countBefore);
    expect(snapshot.devices.find((device) => device.id === "known-1")?.host).toBe("192.168.1.167");
    expect(snapshot.devices.find((device) => device.id === "known-1")?.lastKnownUniqueId).toBe("5D4E12");
  });

  it("classifies and persists a discovered Ultimate II (U2) device as a first-class family", async () => {
    discover.mockResolvedValueOnce({
      candidates: [
        {
          address: "192.168.1.42",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          product: "Ultimate II+",
          firmwareVersion: "3.11",
          fpgaVersion: "45",
          hostname: "ultimate-ii",
          uniqueId: "A1B2C3",
        },
      ],
      scannedHosts: 254,
      elapsedMs: 90,
      unsupported: false,
    });

    const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true, timeoutMs: 9_000 });

    // Survives discovery with its raw product string preserved for display.
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      address: "192.168.1.42",
      product: "Ultimate II+",
      hostname: "ultimate-ii",
      uniqueId: "A1B2C3",
      confidence: "verified",
    });

    // Persists with the U2 family (root-cause fix: previously normalized to null).
    const persisted = persistDiscoveredDevice(result.candidates[0], { select: true });
    const saved = getSavedDevicesSnapshot().devices.find((device) => device.id === persisted.deviceId);
    expect(saved).toMatchObject({
      host: "192.168.1.42",
      lastKnownProduct: "U2",
      lastKnownHostname: "ultimate-ii",
      lastKnownUniqueId: "A1B2C3",
    });
    expect(getSavedDevicesSnapshot().verifiedByDeviceId[persisted.deviceId]).toMatchObject({ product: "U2" });
  });

  it("keeps password-required candidates and marks saved devices only when a password is present", async () => {
    discover.mockResolvedValueOnce({
      candidates: [
        {
          address: "192.168.1.14",
          host: null,
          httpPort: 80,
          source: ["lan-scan"],
          product: "C64 Ultimate",
          requiresPassword: true,
        },
      ],
      scannedHosts: 254,
      elapsedMs: 120,
      unsupported: false,
    });

    const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const result = await startDeviceDiscovery({ trigger: "startup", includeLanScan: true, timeoutMs: 8_000 });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      address: "192.168.1.14",
      product: "C64 Ultimate",
      requiresPassword: true,
    });

    const persisted = persistDiscoveredDevice(result.candidates[0], { select: false, passwordPresent: true });
    const saved = getSavedDevicesSnapshot().devices.find((device) => device.id === persisted.deviceId);

    expect(saved).toMatchObject({
      host: "192.168.1.14",
      hasPassword: true,
      lastKnownProduct: "C64U",
    });
  });
});
