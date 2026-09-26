/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

vi.mock("@/lib/native/folderPicker", () => ({
  FolderPicker: {
    readFile: vi.fn(),
    readFileFromTree: vi.fn(),
    writeFileToTree: vi.fn(async () => ({ uri: "tree://written", sizeBytes: 0 })),
    pickDirectory: vi.fn(),
  },
}));

import type { C64API } from "@/lib/c64api";
import { addLog } from "@/lib/logging";
import { FolderPicker } from "@/lib/native/folderPicker";
import {
  finalizeDiskWriteBack,
  getMaterializedDiskId,
  getMaterializedWorkPath,
  mountDiskToDrive,
  resetMaterializedMountsForTests,
  type DiskMountWriteBackDependencies,
} from "@/lib/disks/diskMount";
import { getSavedDevicesStorageKey, resetSavedDevicesCacheForTests } from "@/lib/savedDevices/store";
import { uint8ToBase64 } from "@/lib/sid/sidUtils";

// One Ultimate on Ethernet and Wi-Fi, saved once per address; a second, different Ultimate elsewhere.
const ETHERNET_HOST = "198.51.100.10";
const WIFI_HOST = "203.0.113.10";
const OTHER_DEVICE_HOST = "192.0.2.30";
// A third, separate Ultimate whose user gave it the dual-homed one's custom unique id, but not its hostname.
const IMPOSTOR_HOST = "192.0.2.40";
const WORK_PATH = "/Usb0/c64commander-disk-work-a.d64";

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

// The work files each physical machine holds; both addresses of the dual-homed Ultimate reach the same files.
const machineFiles = new Map<string, Map<string, Uint8Array>>();
const machineOf = (host: string) =>
  host === OTHER_DEVICE_HOST ? "other" : host === IMPOSTOR_HOST ? "impostor" : "dual-homed";
const filesOn = (host: string) => {
  const machine = machineOf(host);
  if (!machineFiles.has(machine)) machineFiles.set(machine, new Map());
  return machineFiles.get(machine)!;
};

const ftpFor = (host: string): DiskMountWriteBackDependencies => ({
  listRemoteStorageRoots: async () => ["Usb0"],
  writeRemoteFile: async (path, bytes) => {
    filesOn(host).set(path, new Uint8Array(bytes));
  },
  readRemoteFile: async (path) => {
    const bytes = filesOn(host).get(path);
    if (!bytes) throw new Error(`550 ${path} not found on ${host}`);
    return new Uint8Array(bytes);
  },
});

const apiFor = (host: string) =>
  ({
    mountDrive: vi.fn(async () => undefined),
    mountDriveUpload: vi.fn(async () => undefined),
    getBaseUrl: () => `http://${host}`,
    getDeviceHost: () => host,
  }) as unknown as C64API;

const localDisk = (id: string) => ({
  id,
  name: `${id}.d64`,
  path: `/${id}.d64`,
  location: "local" as const,
  localTreeUri: `tree://${id}`,
  group: null,
  importOrder: 0,
  importedAt: "2026-01-01T00:00:00.000Z",
});

const mountVia = (host: string, id: string, bytes: number[]) =>
  mountDiskToDrive(apiFor(host), "a", localDisk(id), new File([new Uint8Array(bytes)], `${id}.d64`), {
    writeBack: ftpFor(host),
  });

const playerSavesOn = (host: string, bytes: number[]) => filesOn(host).set(WORK_PATH, new Uint8Array(bytes));

const writesTo = (id: string) =>
  vi
    .mocked(FolderPicker.writeFileToTree)
    .mock.calls.map(([call]) => call)
    .filter((call) => call.treeUri === `tree://${id}`)
    .map((call) => call.data);

describe("disk write-back on an Ultimate saved under two addresses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    resetSavedDevicesCacheForTests();
    resetMaterializedMountsForTests();
    machineFiles.clear();
  });

  it("saves disk 1's changes into disk 1 and never writes disk 2's image over it after an address switch and back", async () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [WIFI_HOST]: "UID-DUAL" });
    await mountVia(ETHERNET_HOST, "disk-1", [1, 1, 1]);
    playerSavesOn(ETHERNET_HOST, [1, 1, 9]);

    await mountVia(WIFI_HOST, "disk-2", [2, 2, 2]);
    const eject = await finalizeDiskWriteBack("a", ftpFor(ETHERNET_HOST), ETHERNET_HOST);

    expect(writesTo("disk-1")).toEqual([uint8ToBase64(new Uint8Array([1, 1, 9]))]);
    expect(writesTo("disk-2")).toEqual([uint8ToBase64(new Uint8Array([2, 2, 2]))]);
    expect(eject).toEqual({ attempted: true, success: true });
  });

  it("refuses to write back a parked entry whose work file a later mount replaced when the addresses cannot be told apart", async () => {
    saveDevices({ [ETHERNET_HOST]: null, [WIFI_HOST]: null });
    await mountVia(ETHERNET_HOST, "disk-1", [1, 1, 1]);
    playerSavesOn(ETHERNET_HOST, [1, 1, 9]);
    await mountVia(WIFI_HOST, "disk-2", [2, 2, 2]);

    const eject = await finalizeDiskWriteBack("a", ftpFor(ETHERNET_HOST), ETHERNET_HOST);

    expect(writesTo("disk-1")).toEqual([]);
    expect(eject).toMatchObject({ attempted: true, success: false });
    expect((eject as { error: Error }).error.message).toBe(
      "A later mount replaced disk-1.d64 on the device, so its changes could not be saved back.",
    );
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Refused disk write-back: a later mount replaced the work file on the device",
      expect.objectContaining({ path: "/disk-1.d64", materializedOn: ETHERNET_HOST, replacedFrom: WIFI_HOST }),
    );
  });

  it("refuses the write-back when a later mount replaced the work file but then failed to path-mount it", async () => {
    saveDevices({ [ETHERNET_HOST]: null, [WIFI_HOST]: null });
    await mountVia(ETHERNET_HOST, "disk-1", [1, 1, 1]);
    const wifiApi = apiFor(WIFI_HOST);
    vi.mocked(wifiApi.mountDrive).mockRejectedValueOnce(new Error("HTTP 500"));
    await mountDiskToDrive(wifiApi, "a", localDisk("disk-2"), new File([new Uint8Array([2, 2, 2])], "disk-2.d64"), {
      writeBack: ftpFor(WIFI_HOST),
    });

    const eject = await finalizeDiskWriteBack("a", ftpFor(ETHERNET_HOST), ETHERNET_HOST);

    expect(writesTo("disk-1")).toEqual([]);
    expect(eject).toMatchObject({ attempted: true, success: false });
  });

  it("still refuses that stale write-back after the app process restarts", async () => {
    saveDevices({ [ETHERNET_HOST]: null, [WIFI_HOST]: null });
    await mountVia(ETHERNET_HOST, "disk-1", [1, 1, 1]);
    await mountVia(WIFI_HOST, "disk-2", [2, 2, 2]);

    vi.resetModules();
    const restarted = await import("@/lib/disks/diskMount");
    const eject = await restarted.finalizeDiskWriteBack("a", ftpFor(ETHERNET_HOST), ETHERNET_HOST);

    expect(eject).toMatchObject({ attempted: true, success: false });
    restarted.resetMaterializedMountsForTests();
  });

  it("finalizes a parked entry before its own device's work file is reused by the next mount there", async () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [OTHER_DEVICE_HOST]: "UID-OTHER" });
    await mountVia(ETHERNET_HOST, "disk-1", [1, 1, 1]);
    playerSavesOn(ETHERNET_HOST, [1, 1, 9]);
    await mountVia(OTHER_DEVICE_HOST, "disk-2", [2, 2, 2]);

    await mountVia(ETHERNET_HOST, "disk-3", [3, 3, 3]);
    await finalizeDiskWriteBack("a", ftpFor(ETHERNET_HOST), ETHERNET_HOST);

    expect(writesTo("disk-1")).toEqual([uint8ToBase64(new Uint8Array([1, 1, 9]))]);
    expect(writesTo("disk-3")).toEqual([uint8ToBase64(new Uint8Array([3, 3, 3]))]);
    expect(writesTo("disk-2")).toEqual([]);
  });

  it("never writes another machine's work image into disk 1 when that machine shares its custom unique id but not its hostname", async () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [IMPOSTOR_HOST]: "UID-DUAL" }, { [IMPOSTOR_HOST]: "ultimate-impostor" });
    await mountVia(ETHERNET_HOST, "disk-1", [1, 1, 1]);
    playerSavesOn(ETHERNET_HOST, [1, 1, 9]);
    playerSavesOn(IMPOSTOR_HOST, [6, 6, 6]);

    const impostorEject = await finalizeDiskWriteBack("a", ftpFor(IMPOSTOR_HOST), IMPOSTOR_HOST);
    await finalizeDiskWriteBack("a", ftpFor(ETHERNET_HOST), ETHERNET_HOST);

    expect(impostorEject).toEqual({ attempted: false, reason: "device-mismatch" });
    expect(writesTo("disk-1")).toEqual([uint8ToBase64(new Uint8Array([1, 1, 9]))]);
    expect(getMaterializedWorkPath("a", IMPOSTOR_HOST)).toBeNull();
  });

  it("names the materialized disk in a drive polled through the other address, but not on a different device", async () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [WIFI_HOST]: "UID-DUAL", [OTHER_DEVICE_HOST]: "UID-OTHER" });
    await mountVia(ETHERNET_HOST, "disk-1", [1, 1, 1]);

    expect(getMaterializedWorkPath("a", WIFI_HOST)).toBe(WORK_PATH);
    expect(getMaterializedDiskId("a", WIFI_HOST)).toBe("disk-1");
    expect(getMaterializedWorkPath("a", OTHER_DEVICE_HOST)).toBeNull();
    expect(getMaterializedDiskId("a", OTHER_DEVICE_HOST)).toBeNull();
  });
});
