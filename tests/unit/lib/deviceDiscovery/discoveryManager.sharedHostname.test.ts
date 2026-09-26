/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const discover = vi.fn();

vi.mock("@/lib/native/deviceDiscovery", () => ({ DeviceDiscovery: { discover } }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), buildErrorLogDetails: vi.fn(() => ({})) }));

/**
 * Two Ultimates can share a hostname (both renamed "lab-ultimate"). A second machine found by discovery must
 * not take over the saved entry, and with it the stored password, of the first one when both report
 * different unique ids.
 */
describe("discovering a second Ultimate that shares a saved device's hostname", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    discover.mockReset();
  });

  const secondMachine = {
    address: "198.51.100.30",
    host: null,
    httpPort: 80,
    source: ["lan-scan"],
    product: "C64 Ultimate",
    firmwareVersion: "1.2RC",
    hostname: "lab-ultimate",
    uniqueId: "8A7F21",
  };

  it("is saved as a new entry and leaves the first machine's entry and password alone", async () => {
    const { addSavedDevice, getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");
    addSavedDevice({
      id: "first",
      name: "Living room",
      host: "192.0.2.46",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: "lab-ultimate",
      lastKnownUniqueId: "5D0464",
      hasPassword: true,
    });
    discover.mockResolvedValueOnce({
      candidates: [secondMachine],
      scannedHosts: 254,
      elapsedMs: 40,
      unsupported: false,
    });

    const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true });
    expect(result.candidates[0]?.alreadySavedDeviceId).not.toBe("first");
    const persisted = persistDiscoveredDevice(result.candidates[0]!, { select: false });

    const snapshot = getSavedDevicesSnapshot();
    expect(persisted.deviceId).not.toBe("first");
    expect(snapshot.devices.find((device) => device.id === "first")).toMatchObject({
      host: "192.0.2.46",
      lastKnownUniqueId: "5D0464",
      hasPassword: true,
    });
    expect(snapshot.devices.find((device) => device.id === persisted.deviceId)).toMatchObject({
      host: "198.51.100.30",
      lastKnownUniqueId: "8A7F21",
    });
  });

  it("ignores a stale saved-entry marker that names a machine with another unique id", async () => {
    const { addSavedDevice, getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice } = await import("@/lib/deviceDiscovery/discoveryManager");
    addSavedDevice({
      id: "first",
      name: "Living room",
      host: "192.0.2.46",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: "lab-ultimate",
      lastKnownUniqueId: "5D0464",
      hasPassword: true,
    });

    const persisted = persistDiscoveredDevice(
      {
        ...secondMachine,
        id: "id:8a7f21@lab-ultimate",
        confidence: "verified",
        alreadySavedDeviceId: "first",
      } as never,
      { select: false },
    );

    expect(persisted.deviceId).not.toBe("first");
    expect(getSavedDevicesSnapshot().devices.find((device) => device.id === "first")?.host).toBe("192.0.2.46");
  });

  it("does not take over a saved entry whose address was handed by DHCP to a machine with another unique id", async () => {
    const { addSavedDevice, getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { persistDiscoveredDevice } = await import("@/lib/deviceDiscovery/discoveryManager");
    addSavedDevice({
      id: "first",
      name: "Living room",
      host: "198.51.100.30",
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: "C64U",
      lastKnownHostname: "lab-ultimate",
      lastKnownUniqueId: "5D0464",
      hasPassword: true,
    });

    const persisted = persistDiscoveredDevice(
      { ...secondMachine, hostname: "bench-ultimate", id: "id:8a7f21@bench-ultimate", confidence: "verified" } as never,
      { select: false },
    );

    expect(persisted.deviceId).not.toBe("first");
    expect(getSavedDevicesSnapshot().devices.find((device) => device.id === "first")).toMatchObject({
      lastKnownUniqueId: "5D0464",
      hasPassword: true,
    });
  });
});
