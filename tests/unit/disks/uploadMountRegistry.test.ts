/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetUploadMount,
  getUploadMountedDiskId,
  getUploadMountedDiskName,
  learnUploadMountFromPoll,
  noteDiskMountOutcome,
  reconcileUploadMount,
  resetUploadMountsForTests,
  resolveUploadMountedDiskId,
  type UploadMountState,
} from "@/lib/disks/uploadMountRegistry";
import { getSavedDevicesStorageKey, resetSavedDevicesCacheForTests } from "@/lib/savedDevices/store";

const TEMP_PATH = "/Temp/cache/upload/temp0082";
const pending: UploadMountState = {
  [JSON.stringify(["c64u", "a"])]: { diskId: "disk-1", imagePath: null, recordedAt: 1000 },
};

describe("upload mount resolution", () => {
  it("learns the device's temporary image path from the first poll after the mount", () => {
    const learned = reconcileUploadMount(pending, "c64u", "a", TEMP_PATH, 1500);
    expect(resolveUploadMountedDiskId(learned, "c64u", "a", TEMP_PATH, 9000)).toBe("disk-1");
  });

  it("resolves the pending mount on the first poll before the learned path has been stored", () => {
    expect(resolveUploadMountedDiskId(pending, "c64u", "a", TEMP_PATH, 1500)).toBe("disk-1");
  });

  it("ignores a poll taken before the mount completed", () => {
    expect(reconcileUploadMount(pending, "c64u", "a", "/USB0/old.d64", 999)).toBe(pending);
    expect(resolveUploadMountedDiskId(pending, "c64u", "a", "/USB0/old.d64", 999)).toBeNull();
  });

  it("forgets the mount once the drive reports a different image", () => {
    const learned = reconcileUploadMount(pending, "c64u", "a", TEMP_PATH, 1500);
    const replaced = reconcileUploadMount(learned, "c64u", "a", "/Temp/cache/upload/temp0083", 2000);
    expect(replaced).toEqual({});
    expect(resolveUploadMountedDiskId(replaced, "c64u", "a", TEMP_PATH, 3000)).toBeNull();
  });

  it("forgets the mount once the drive reports no image", () => {
    const learned = reconcileUploadMount(pending, "c64u", "a", TEMP_PATH, 1500);
    expect(reconcileUploadMount(learned, "c64u", "a", null, 2000)).toEqual({});
  });

  it("keeps the mount of one device separate from the same drive on another device", () => {
    const learned = reconcileUploadMount(pending, "c64u", "a", TEMP_PATH, 1500);
    expect(resolveUploadMountedDiskId(learned, "u64", "a", TEMP_PATH, 2000)).toBeNull();
    expect(resolveUploadMountedDiskId(learned, "c64u", "b", TEMP_PATH, 2000)).toBeNull();
  });
});

describe("upload mount registry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1000 });
    resetUploadMountsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not take an image mounted some other way for the uploaded disk, and lets the record go", () => {
    noteDiskMountOutcome("c64u", "a", "disk-1", "transient", "MyDisk.d64", 1000);
    learnUploadMountFromPoll("c64u", "a", "/USB2/Games/Other.d64", 2000);
    expect(getUploadMountedDiskName("c64u", "a", "/USB2/Games/Other.d64", 2000)).toBeNull();

    learnUploadMountFromPoll("c64u", "a", "/USB2/Games/Other.d64", 20_000);
    learnUploadMountFromPoll("c64u", "a", TEMP_PATH, 21_000);
    expect(getUploadMountedDiskName("c64u", "a", TEMP_PATH, 21_000)).toBeNull();
  });

  it("records only transient mounts, and does not vouch for a temporary upload path after a reload", async () => {
    noteDiskMountOutcome("c64u", "a", "disk-1", "transient", undefined, 1000);
    noteDiskMountOutcome("c64u", "b", "disk-2", "device-native", undefined, 1000);
    learnUploadMountFromPoll("c64u", "a", TEMP_PATH, 1500);
    learnUploadMountFromPoll("c64u", "b", "/USB0/disk-2.d64", 1500);
    expect(getUploadMountedDiskId("c64u", "a", TEMP_PATH, 5000)).toBe("disk-1");
    expect(getUploadMountedDiskId("c64u", "b", "/USB0/disk-2.d64", 5000)).toBeNull();

    vi.resetModules();
    const reloaded = await import("@/lib/disks/uploadMountRegistry");
    expect(reloaded.getUploadMountedDiskId("c64u", "a", TEMP_PATH, 5000)).toBeNull();
  });

  it("forgets a mount when the drive is ejected", () => {
    noteDiskMountOutcome("c64u", "a", "disk-1", "transient", undefined, 1000);
    learnUploadMountFromPoll("c64u", "a", TEMP_PATH, 1500);
    forgetUploadMount("c64u", "a");
    expect(getUploadMountedDiskId("c64u", "a", TEMP_PATH, 2000)).toBeNull();
  });

  it("drops the record when the drive is remounted by a non-upload mount", () => {
    noteDiskMountOutcome("c64u", "a", "disk-1", "transient", undefined, 1000);
    learnUploadMountFromPoll("c64u", "a", TEMP_PATH, 1500);
    noteDiskMountOutcome("c64u", "a", "disk-3", "materialized", undefined, 2000);
    expect(getUploadMountedDiskId("c64u", "a", TEMP_PATH, 2500)).toBeNull();
  });

  it("does not let a slower, older mount overwrite the record of a newer one", () => {
    noteDiskMountOutcome("c64u", "a", "disk-new", "transient", "New.d64", 2000);
    noteDiskMountOutcome("c64u", "a", "disk-old", "transient", "Old.d64", 1000);

    expect(getUploadMountedDiskName("c64u", "a", "/Temp/cache/upload/temp0001", 3000)).toBe("New.d64");
  });
});

// One Ultimate on Ethernet and Wi-Fi, saved once per address; a second, different Ultimate elsewhere.
const ETHERNET_HOST = "198.51.100.10";
const WIFI_HOST = "203.0.113.10";
const OTHER_DEVICE_HOST = "192.0.2.30";

const saveDevices = (uniqueIdByHost: Record<string, string | null>) => {
  const devices = Object.entries(uniqueIdByHost).map(([host, uniqueId]) => ({
    id: `saved-${host}`,
    name: `Saved ${host}`,
    host,
    httpPort: 80,
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
    JSON.stringify({ selectedDeviceId: devices[0]?.id, devices, summaries: {}, runtimeStatuses: {} }),
  );
  resetSavedDevicesCacheForTests();
};

describe("upload mounts on an Ultimate saved under two addresses", () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: 1000 });
    localStorage.clear();
    resetSavedDevicesCacheForTests();
    resetUploadMountsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    resetSavedDevicesCacheForTests();
  });

  it("names the uploaded library disk when the drive is polled through the same Ultimate's other address", () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [WIFI_HOST]: "UID-DUAL" });
    noteDiskMountOutcome(ETHERNET_HOST, "a", "disk-1", "transient", "Disk1.d64", 1000);

    learnUploadMountFromPoll(WIFI_HOST, "a", TEMP_PATH, 1500);

    expect(getUploadMountedDiskId(WIFI_HOST, "a", TEMP_PATH, 2000)).toBe("disk-1");
    expect(getUploadMountedDiskName(WIFI_HOST, "a", TEMP_PATH, 2000)).toBe("Disk1.d64");
  });

  it("does not name another Ultimate's upload as this device's library disk", () => {
    saveDevices({ [ETHERNET_HOST]: "UID-DUAL", [OTHER_DEVICE_HOST]: "UID-OTHER" });
    noteDiskMountOutcome(ETHERNET_HOST, "a", "disk-1", "transient", "Disk1.d64", 1000);
    learnUploadMountFromPoll(ETHERNET_HOST, "a", TEMP_PATH, 1500);

    expect(getUploadMountedDiskId(OTHER_DEVICE_HOST, "a", TEMP_PATH, 2000)).toBeNull();
    expect(getUploadMountedDiskId(ETHERNET_HOST, "a", TEMP_PATH, 2000)).toBe("disk-1");
  });

  it("keeps two addresses apart while neither has reported a unique id", () => {
    saveDevices({ [ETHERNET_HOST]: null, [WIFI_HOST]: null });
    noteDiskMountOutcome(ETHERNET_HOST, "a", "disk-1", "transient", "Disk1.d64", 1000);
    learnUploadMountFromPoll(ETHERNET_HOST, "a", TEMP_PATH, 1500);

    expect(getUploadMountedDiskId(WIFI_HOST, "a", TEMP_PATH, 2000)).toBeNull();
  });
});
