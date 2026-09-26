/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

import type { C64API } from "@/lib/c64api";
import { bindCallsToDevice } from "@/lib/disks/deviceBoundCalls";
import { mountDiskToDrive, resetMaterializedMountsForTests } from "@/lib/disks/diskMount";
import { getSavedDevicesStorageKey, resetSavedDevicesCacheForTests } from "@/lib/savedDevices/store";

// One Ultimate on Ethernet and Wi-Fi, saved once per address; a second, different Ultimate elsewhere.
const ETHERNET_HOST = "198.51.100.10";
const WIFI_HOST = "203.0.113.10";
const OTHER_DEVICE_HOST = "192.0.2.30";

// A machine's hostname defaults to one derived from its unique id; a test overrides it to model two
// machines that share a custom unique id.
const saveDevices = (uniqueIdByHost: Record<string, string | null>, hostnameByHost: Record<string, string> = {}) => {
  const devices = Object.entries(uniqueIdByHost).map(([host, uniqueId]) => ({
    id: `saved-${host}`,
    name: `Saved ${host}`,
    host,
    httpPort: 80,
    ftpPort: 21,
    telnetPort: 23,
    lastKnownProduct: null,
    lastKnownHostname: hostnameByHost[host] ?? (uniqueId ? `ultimate-${uniqueId.toLowerCase()}` : null),
    lastKnownUniqueId: uniqueId,
    lastSuccessfulConnectionAt: null,
    lastUsedAt: null,
    hasPassword: false,
  }));
  localStorage.setItem(
    getSavedDevicesStorageKey(),
    JSON.stringify({ selectedDeviceId: devices[0]?.id, devices, summaries: {}, runtimeStatuses: {} }),
  );
  resetSavedDevicesCacheForTests();
};

const boundTarget = (startHost: string, currentHost: string) =>
  bindCallsToDevice({ send: vi.fn(() => "sent") }, startHost, () => currentHost, "mounting Game.d64");

// Starts on the Ethernet address; every later host read reports the address the app has since switched to.
const switchingApi = (switchedTo: string) => {
  let reads = 0;
  return {
    mountDrive: vi.fn(async () => undefined),
    mountDriveUpload: vi.fn(async () => undefined),
    getBaseUrl: () => "http://ultimate.example",
    getDeviceHost: () => (reads++ === 0 ? ETHERNET_HOST : switchedTo),
  };
};

const game = { id: "game", name: "Game.d64", path: "/Game.d64", location: "local" } as const;

describe("device-bound disk calls across a switch between saved entries", () => {
  beforeEach(() => {
    localStorage.clear();
    resetSavedDevicesCacheForTests();
    resetMaterializedMountsForTests();
  });

  afterEach(() => {
    localStorage.clear();
    resetSavedDevicesCacheForTests();
  });

  it("keeps sending after a switch to the same Ultimate's other address", () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [WIFI_HOST]: "UID-DUAL" });
    expect(boundTarget(ETHERNET_HOST, WIFI_HOST).send()).toBe("sent");
  });

  it("stops sending after a switch to a different Ultimate", () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [OTHER_DEVICE_HOST]: "UID-OTHER" });
    expect(() => boundTarget(ETHERNET_HOST, OTHER_DEVICE_HOST).send()).toThrow(
      `The connected device changed from ${ETHERNET_HOST} to ${OTHER_DEVICE_HOST} while mounting Game.d64`,
    );
  });

  it("stops sending after a switch to a different Ultimate that shares the custom unique id but not the hostname", () => {
    saveDevices(
      { [ETHERNET_HOST]: "UID-DUAL", [OTHER_DEVICE_HOST]: "UID-DUAL" },
      { [OTHER_DEVICE_HOST]: "ultimate-b" },
    );
    expect(() => boundTarget(ETHERNET_HOST, OTHER_DEVICE_HOST).send()).toThrow("The connected device changed");
  });

  it("stops sending between two addresses while neither has reported a unique id", () => {
    saveDevices({ [ETHERNET_HOST]: null, [WIFI_HOST]: null });
    expect(() => boundTarget(ETHERNET_HOST, WIFI_HOST).send()).toThrow("The connected device changed");
  });

  it("finishes a mount when the app switches to the same Ultimate's other saved address mid-mount", async () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [WIFI_HOST]: "UID-DUAL" });
    const api = switchingApi(WIFI_HOST);

    const outcome = await mountDiskToDrive(api as unknown as C64API, "a", game as never, new File(["x"], "Game.d64"));

    expect(outcome.persistence).toBe("transient");
    expect(api.mountDriveUpload).toHaveBeenCalledTimes(1);
  });

  it("sends nothing when the app switches to a different Ultimate mid-mount", async () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [OTHER_DEVICE_HOST]: "UID-OTHER" });
    const api = switchingApi(OTHER_DEVICE_HOST);

    await expect(
      mountDiskToDrive(api as unknown as C64API, "a", game as never, new File(["x"], "Game.d64")),
    ).rejects.toThrow(`The connected device changed from ${ETHERNET_HOST} to ${OTHER_DEVICE_HOST}`);
    expect(api.mountDriveUpload).not.toHaveBeenCalled();
  });
});
