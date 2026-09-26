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

type SavedEntry = { id: string; host: string; httpPort?: number; uniqueId: string | null };

const saveDevices = (entries: SavedEntry[], selectedDeviceId = entries[0]?.id) => {
  const devices = entries.map(({ id, host, httpPort = 80, uniqueId }) => ({
    id,
    name: id,
    host,
    httpPort,
    ftpPort: 21,
    telnetPort: 23,
    lastKnownProduct: null,
    lastKnownHostname: null,
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

    expect(resolveDiskDeviceIdentity("ultimate.example")).toEqual({ host: "ultimate.example", uniqueId: null });
  });

  it("compares by unique id when both are known and by address otherwise", () => {
    const ethernet = { host: "198.51.100.10", uniqueId: "uid-dual" };
    const wifi = { host: "203.0.113.10", uniqueId: "uid-dual" };
    const unverifiedWifi = { host: "203.0.113.10", uniqueId: null };

    expect(isSameDiskDevice(ethernet, wifi)).toBe(true);
    expect(isSameDiskDevice(ethernet, unverifiedWifi)).toBe(false);
    expect(isSameDiskDevice(unverifiedWifi, { host: "203.0.113.10:80", uniqueId: null })).toBe(true);
    expect(areKnownDifferentDiskDevices(ethernet, unverifiedWifi)).toBe(false);
    expect(areKnownDifferentDiskDevices(ethernet, { host: "192.0.2.30", uniqueId: "uid-other" })).toBe(true);
  });

  it("keys per-device records by unique id when known and by address otherwise", () => {
    saveDevices([
      { id: "ethernet", host: "198.51.100.10", uniqueId: "UID-DUAL" },
      { id: "wifi", host: "203.0.113.10", uniqueId: "UID-DUAL" },
    ]);

    expect(diskDeviceKey("198.51.100.10")).toBe(diskDeviceKey("203.0.113.10"));
    expect(diskDeviceKey("192.0.2.30")).toBe("192.0.2.30");
  });
});
