/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  areKnownDifferentDiskDevices,
  diskDeviceKey,
  isSameDiskDevice,
  resolveDiskDeviceIdentity,
} from "@/lib/disks/diskDeviceIdentity";
import { getSavedDevicesStorageKey, resetSavedDevicesCacheForTests } from "@/lib/savedDevices/store";

type SavedEntry = { id: string; host: string; httpPort?: number; uniqueId: string | null; hostname?: string | null };

const saveDevices = (entries: SavedEntry[], selectedDeviceId = entries[0]?.id) => {
  const devices = entries.map(({ id, host, httpPort = 80, uniqueId, hostname = null }) => ({
    id,
    name: id,
    host,
    httpPort,
    ftpPort: 21,
    telnetPort: 23,
    lastKnownProduct: null,
    lastKnownHostname: hostname,
    lastKnownUniqueId: uniqueId,
    lastSuccessfulConnectionAt: null,
    lastUsedAt: null,
    hasPassword: false,
  }));
  localStorage.setItem(
    getSavedDevicesStorageKey(),
    JSON.stringify({ selectedDeviceId, devices, summaries: {}, runtimeStatuses: {} }),
  );
  resetSavedDevicesCacheForTests();
};

describe("disk device identity", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSavedDevicesCacheForTests();
  });

  afterEach(() => {
    localStorage.clear();
    resetSavedDevicesCacheForTests();
  });

  it("takes the unique id of the saved entry whose address and HTTP port match", () => {
    saveDevices([
      { id: "web", host: "198.51.100.10", httpPort: 8080, uniqueId: "UID-PORT" },
      { id: "plain", host: "198.51.100.10", uniqueId: "UID-PLAIN" },
    ]);

    expect(resolveDiskDeviceIdentity("198.51.100.10:8080").uniqueId).toBe("uid-port");
    expect(resolveDiskDeviceIdentity("198.51.100.10").uniqueId).toBe("uid-plain");
  });

  it("prefers the selected entry when two entries share an address", () => {
    saveDevices(
      [
        { id: "old", host: "ultimate.example", uniqueId: "UID-OLD" },
        { id: "new", host: "ultimate.example", uniqueId: "UID-NEW" },
      ],
      "new",
    );

    expect(resolveDiskDeviceIdentity("ULTIMATE.example").uniqueId).toBe("uid-new");
  });

  it("reports no unique id when unselected entries at one address disagree about it", () => {
    saveDevices(
      [
        { id: "elsewhere", host: "192.0.2.30", uniqueId: "UID-ELSEWHERE" },
        { id: "old", host: "ultimate.example", uniqueId: "UID-OLD" },
        { id: "new", host: "ultimate.example", uniqueId: "UID-NEW" },
      ],
      "elsewhere",
    );

    expect(resolveDiskDeviceIdentity("ultimate.example")).toEqual({
      host: "ultimate.example",
      uniqueId: null,
      hostname: null,
    });
  });

  it("compares by unique id and hostname when both are known and by address otherwise", () => {
    const ethernet = { host: "198.51.100.10", uniqueId: "uid-dual", hostname: "ultimate-dual" };
    const wifi = { host: "203.0.113.10", uniqueId: "uid-dual", hostname: "ultimate-dual" };
    const unverifiedWifi = { host: "203.0.113.10", uniqueId: null, hostname: null };

    expect(isSameDiskDevice(ethernet, wifi)).toBe(true);
    expect(isSameDiskDevice(ethernet, unverifiedWifi)).toBe(false);
    expect(isSameDiskDevice(unverifiedWifi, { host: "203.0.113.10:80", uniqueId: null, hostname: null })).toBe(true);
    expect(areKnownDifferentDiskDevices(ethernet, unverifiedWifi)).toBe(false);
    expect(
      areKnownDifferentDiskDevices(ethernet, { host: "192.0.2.30", uniqueId: "uid-other", hostname: "ultimate-other" }),
    ).toBe(true);
  });

  it("does not treat two devices that share a custom unique id but not a hostname as one machine", () => {
    const deviceA = { host: "198.51.100.10", uniqueId: "my-ultimate", hostname: "ultimate-a" };
    const deviceB = { host: "192.0.2.30", uniqueId: "my-ultimate", hostname: "ultimate-b" };
    const hostnameUnknown = { host: "192.0.2.31", uniqueId: "my-ultimate", hostname: null };

    expect(isSameDiskDevice(deviceA, deviceB)).toBe(false);
    expect(isSameDiskDevice(deviceA, hostnameUnknown)).toBe(false);
  });

  it("keys per-device records by unique id and hostname when known and by address otherwise", () => {
    saveDevices([
      { id: "ethernet", host: "198.51.100.10", uniqueId: "UID-DUAL", hostname: "Ultimate-Dual" },
      { id: "wifi", host: "203.0.113.10", uniqueId: "UID-DUAL", hostname: "ultimate-dual" },
    ]);

    expect(diskDeviceKey("198.51.100.10")).toBe(diskDeviceKey("203.0.113.10"));
    expect(diskDeviceKey("192.0.2.30")).toBe("192.0.2.30");
  });

  it("keys two devices that share a custom unique id but not a hostname apart", () => {
    saveDevices([
      { id: "device-a", host: "198.51.100.10", uniqueId: "MY-ULTIMATE", hostname: "ultimate-a" },
      { id: "device-b", host: "192.0.2.30", uniqueId: "MY-ULTIMATE", hostname: "ultimate-b" },
      { id: "no-hostname", host: "192.0.2.31", uniqueId: "MY-ULTIMATE", hostname: null },
    ]);

    expect(diskDeviceKey("198.51.100.10")).not.toBe(diskDeviceKey("192.0.2.30"));
    expect(diskDeviceKey("192.0.2.31")).toBe("192.0.2.31");
  });
});
