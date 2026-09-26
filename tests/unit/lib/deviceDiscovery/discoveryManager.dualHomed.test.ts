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
  DeviceDiscovery: { discover },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  buildErrorLogDetails: vi.fn((error: Error, details: Record<string, unknown> = {}) => ({ ...details, error })),
}));

// One Ultimate on Ethernet (192.0.2.0/24) and Wi-Fi (198.51.100.0/24), answering on both.
const ETHERNET = "192.0.2.10";
const WIFI = "198.51.100.20";
// A second, separate Ultimate whose user gave it the first one's custom unique id.
const ATTIC = "203.0.113.40";

const dualHomedNativeCandidate = (address: string) => ({
  address,
  httpPort: 80,
  source: ["lan-scan"],
  product: "Ultimate 64 Elite",
  hostname: "ultimate",
  uniqueId: "DUAL01",
  addresses: [ETHERNET, WIFI],
});

const seedSavedDevice = async (host: string) => {
  const { addSavedDevice } = await import("@/lib/savedDevices/store");
  addSavedDevice({
    id: "saved-1",
    name: "Desk",
    host,
    httpPort: 80,
    ftpPort: 21,
    telnetPort: 23,
    lastKnownProduct: "U64E",
    lastKnownHostname: "ultimate",
    lastKnownUniqueId: "DUAL01",
    hasPassword: false,
  });
};

const discoverAndPersist = async (primaryAddress: string) => {
  discover.mockResolvedValueOnce({
    candidates: [dualHomedNativeCandidate(primaryAddress)],
    scannedHosts: 254,
    elapsedMs: 50,
    unsupported: false,
  });
  const { persistDiscoveredDevice, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");
  const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true });
  return persistDiscoveredDevice(result.candidates[0], { select: false });
};

const savedHost = async () => {
  const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
  return getSavedDevicesSnapshot().devices.find((device) => device.id === "saved-1")?.host;
};

describe("discovery of an Ultimate that answers on two addresses", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    discover.mockReset();
  });

  it("carries every address the device answered on into the candidate", async () => {
    discover.mockResolvedValueOnce({
      candidates: [dualHomedNativeCandidate(WIFI)],
      scannedHosts: 254,
      elapsedMs: 50,
      unsupported: false,
    });
    const { startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].addresses).toEqual([WIFI, ETHERNET]);
  });

  it("keeps the saved address while it still answers, whichever address the scan reached first", async () => {
    await seedSavedDevice(ETHERNET);

    const persisted = await discoverAndPersist(WIFI);

    expect(persisted.deviceId).toBe("saved-1");
    expect(persisted.host).toBe(ETHERNET);
    expect(await savedHost()).toBe(ETHERNET);
  });

  it("never swaps a saved hostname for an address while the device is reachable through it", async () => {
    await seedSavedDevice("ultimate.example");
    const { completeSavedDeviceVerification } = await import("@/lib/savedDevices/store");
    completeSavedDeviceVerification("saved-1", {
      product: "Ultimate 64 Elite",
      hostname: "ultimate",
      unique_id: "DUAL01",
    });

    const persisted = await discoverAndPersist(WIFI);

    expect(persisted.host).toBe("ultimate.example");
    expect(await savedHost()).toBe("ultimate.example");
  });

  it("moves a saved address that no longer answers to the one the device answers on now", async () => {
    await seedSavedDevice("203.0.113.30");

    const persisted = await discoverAndPersist(WIFI);

    expect(persisted.host).toBe(WIFI);
    expect(await savedHost()).toBe(WIFI);
  });

  it("replaces a saved hostname once the app has lost the device through it", async () => {
    await seedSavedDevice("ultimate.example");
    const { completeSavedDeviceVerification, failSavedDeviceVerification } = await import("@/lib/savedDevices/store");
    completeSavedDeviceVerification("saved-1", {
      product: "Ultimate 64 Elite",
      hostname: "ultimate",
      unique_id: "DUAL01",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    failSavedDeviceVerification("saved-1");

    const persisted = await discoverAndPersist(WIFI);

    expect(persisted.host).toBe(WIFI);
  });

  // The unique id is user-configurable, so a second Ultimate can report the same one under its own hostname.
  it("lists two devices that share a custom unique id but not a hostname as two candidates", async () => {
    discover.mockResolvedValueOnce({
      candidates: [
        { ...dualHomedNativeCandidate(ETHERNET), addresses: [ETHERNET] },
        { ...dualHomedNativeCandidate(ATTIC), hostname: "ultimate-attic", addresses: [ATTIC] },
      ],
      scannedHosts: 254,
      elapsedMs: 50,
      unsupported: false,
    });
    const { startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true });

    expect(result.candidates.map((candidate) => candidate.addresses)).toEqual([[ETHERNET], [ATTIC]]);
  });

  it("saves a device that shares the saved device's custom unique id but not its hostname as a new entry", async () => {
    await seedSavedDevice(ETHERNET);
    discover.mockResolvedValueOnce({
      candidates: [{ ...dualHomedNativeCandidate(ATTIC), hostname: "ultimate-attic", addresses: [ATTIC] }],
      scannedHosts: 254,
      elapsedMs: 50,
      unsupported: false,
    });
    const { persistDiscoveredDevice, startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");
    const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true });

    const persisted = persistDiscoveredDevice(result.candidates[0], { select: false });

    expect(result.candidates[0].alreadySavedDeviceId).toBeNull();
    expect(persisted.deviceId).not.toBe("saved-1");
    expect(await savedHost()).toBe(ETHERNET);
  });

  it("recognises a device saved under its other address as already saved", async () => {
    const { addSavedDevice } = await import("@/lib/savedDevices/store");
    addSavedDevice({
      id: "saved-no-id",
      name: "",
      host: ETHERNET,
      httpPort: 80,
      ftpPort: 21,
      telnetPort: 23,
      lastKnownProduct: null,
      lastKnownHostname: null,
      lastKnownUniqueId: null,
      hasPassword: false,
    });
    discover.mockResolvedValueOnce({
      candidates: [{ ...dualHomedNativeCandidate(WIFI), hostname: undefined, uniqueId: undefined }],
      scannedHosts: 254,
      elapsedMs: 50,
      unsupported: false,
    });
    const { startDeviceDiscovery } = await import("@/lib/deviceDiscovery/discoveryManager");

    const result = await startDeviceDiscovery({ trigger: "settings", includeLanScan: true });

    expect(result.candidates[0].alreadySavedDeviceId).toBe("saved-no-id");
  });
});
