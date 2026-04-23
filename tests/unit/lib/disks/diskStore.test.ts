/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { loadDiskLibrary, saveDiskLibrary, SHARED_DISK_LIBRARY_ID } from "@/lib/disks/diskStore";
import { createDiskEntry } from "@/lib/disks/diskTypes";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildLocalStorageKey } from "@/generated/variant";

const DISK_LIBRARY_PREFIX = `${buildLocalStorageKey("disk_library")}:`;

describe("diskStore", () => {
  const mockId = "test-library";
  const mockDisk = createDiskEntry({ path: "/disk.d64", location: "local" });

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns empty disks if nothing stored", () => {
    const loaded = loadDiskLibrary(mockId);
    expect(loaded.disks).toEqual([]);
  });

  it("saves and loads library", () => {
    const state = { disks: [mockDisk] };
    saveDiskLibrary(mockId, state);

    const loaded = loadDiskLibrary(mockId);
    expect(loaded.disks).toHaveLength(1);
    expect(loaded.disks[0].id).toBe(mockDisk.id);
  });

  it("handles invalid JSON gracefully", () => {
    localStorage.setItem(`${DISK_LIBRARY_PREFIX}${mockId}`, "invalid json");
    const loaded = loadDiskLibrary(mockId);
    expect(loaded.disks).toEqual([]);
  });

  it("handles valid JSON with invalid structure gracefully", () => {
    localStorage.setItem(`${DISK_LIBRARY_PREFIX}${mockId}`, JSON.stringify({ disks: "not an array" }));
    const loaded = loadDiskLibrary(mockId);
    expect(loaded.disks).toEqual([]);
  });

  it("merges legacy per-device libraries into the shared disk library", () => {
    const diskA = createDiskEntry({ path: "/device-a/demo.d64", location: "local" });
    const diskB = createDiskEntry({ path: "/device-b/demo.d81", location: "local" });
    localStorage.setItem(`${DISK_LIBRARY_PREFIX}device-a`, JSON.stringify({ disks: [diskA] }));
    localStorage.setItem(`${DISK_LIBRARY_PREFIX}device-b`, JSON.stringify({ disks: [diskB] }));

    const loaded = loadDiskLibrary(SHARED_DISK_LIBRARY_ID);

    expect(loaded.disks).toHaveLength(2);
    expect(loaded.disks.map((disk) => disk.path)).toEqual(["/device-a/demo.d64", "/device-b/demo.d81"]);
  });

  it("keeps same-path ultimate disks from different devices distinct when merging legacy libraries", () => {
    const originA = {
      sourceKind: "ultimate" as const,
      originDeviceId: "device-a",
      originDeviceLastKnownUniqueId: "uid-a",
      originPath: "/Usb0/demo.d64",
      importedAt: "2024-01-01T00:00:00Z",
    };
    const originB = {
      ...originA,
      originDeviceId: "device-b",
      originDeviceLastKnownUniqueId: "uid-b",
    };
    const diskA = createDiskEntry({ path: "/Usb0/demo.d64", location: "ultimate", origin: originA });
    const diskB = createDiskEntry({ path: "/Usb0/demo.d64", location: "ultimate", origin: originB });

    localStorage.setItem(`${DISK_LIBRARY_PREFIX}device-a`, JSON.stringify({ disks: [diskA] }));
    localStorage.setItem(`${DISK_LIBRARY_PREFIX}device-b`, JSON.stringify({ disks: [diskB] }));

    const loaded = loadDiskLibrary(SHARED_DISK_LIBRARY_ID);

    expect(loaded.disks).toHaveLength(2);
    expect(new Set(loaded.disks.map((disk) => disk.id)).size).toBe(2);
  });
});
