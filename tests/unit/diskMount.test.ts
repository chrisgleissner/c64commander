/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { C64API } from "@/lib/c64api";
import {
  mountDiskToDrive,
  resolveLocalDiskBlob,
  finalizeDiskWriteBack,
  hasShownDiskWriteBackAdvisory,
  markDiskWriteBackAdvisoryShown,
  getMaterializedWorkPath,
  resetMaterializedMountsForTests,
  type DiskMountWriteBackDependencies,
} from "@/lib/disks/diskMount";
import { createDiskEntry } from "@/lib/disks/diskTypes";
import { saveLocalSources, setLocalSourceRuntimeFiles } from "@/lib/sourceNavigation/localSourcesStore";

vi.mock("@/lib/native/folderPicker", () => ({
  FolderPicker: {
    readFile: vi.fn(),
    readFileFromTree: vi.fn(),
    writeFileToTree: vi.fn(async () => ({ uri: "content://tree/primary%3ADisks", sizeBytes: 0 })),
  },
}));

const mockFolderPicker = async (data: string) => {
  const { FolderPicker } = await import("@/lib/native/folderPicker");
  (FolderPicker.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({
    data,
  });
};

const mockFolderPickerFromTree = async (data: string) => {
  const { FolderPicker } = await import("@/lib/native/folderPicker");
  (FolderPicker.readFileFromTree as ReturnType<typeof vi.fn>).mockResolvedValue({ data });
};

const readBlobText = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob."));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(blob);
  });

describe("mountDiskToDrive", () => {
  beforeEach(() => {
    localStorage.clear();
    if (typeof sessionStorage !== "undefined") sessionStorage.clear();
    resetMaterializedMountsForTests();
  });

  it("mounts ultimate disks via mountDrive", async () => {
    const api = {
      mountDrive: vi.fn().mockResolvedValue(undefined),
      mountDriveUpload: vi.fn(),
      getBaseUrl: vi.fn().mockReturnValue("http://c64u"),
      getDeviceHost: vi.fn().mockReturnValue("c64u"),
    } as unknown as C64API;

    const disk = createDiskEntry({
      location: "ultimate",
      path: "/Usb0/Games/Turrican II/Disk 1.d64",
    });

    await mountDiskToDrive(api, "a", disk);

    expect(api.mountDrive).toHaveBeenCalledWith("a", disk.path, "d64", "readwrite");
    expect(api.mountDriveUpload).not.toHaveBeenCalled();
  });

  it("mounts local disks via upload when runtime file is provided", async () => {
    const api = {
      mountDrive: vi.fn(),
      mountDriveUpload: vi.fn().mockResolvedValue(undefined),
      getBaseUrl: vi.fn().mockReturnValue("http://c64u"),
      getDeviceHost: vi.fn().mockReturnValue("c64u"),
    } as unknown as C64API;

    const disk = createDiskEntry({
      location: "local",
      path: "/Local/Disk 1.d64",
    });

    const runtimeFile = new File([new Uint8Array([1, 2, 3])], "Disk 1.d64", {
      type: "application/octet-stream",
    });

    await mountDiskToDrive(api, "b", disk, runtimeFile);

    expect(api.mountDriveUpload).toHaveBeenCalled();
    const [drive, blob, mountType, access] = (api.mountDriveUpload as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(drive).toBe("b");
    expect(blob).toBeInstanceOf(Blob);
    expect(mountType).toBe("d64");
    expect(access).toBe("readwrite");
    expect(api.mountDrive).not.toHaveBeenCalled();
  });

  it("resolves local disk blobs from FolderPicker data", async () => {
    await mockFolderPicker(btoa("demo"));
    const disk = createDiskEntry({
      location: "local",
      path: "/Local/Disk 2.d64",
      localUri: "content://demo/disk2",
    });

    const blob = await resolveLocalDiskBlob(disk);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob."));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(blob);
    });

    expect(text).toBe("demo");
  });

  it("resolves local disk blobs from SAF tree URIs", async () => {
    await mockFolderPickerFromTree(btoa("tree-data"));
    const disk = createDiskEntry({
      location: "local",
      path: "/Local/Disk 2.d64",
      localTreeUri: "content://tree/primary%3ADisks",
    });

    const blob = await resolveLocalDiskBlob(disk);
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read blob."));
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.readAsText(blob);
    });

    expect(text).toBe("tree-data");
  });

  it("throws when local disks are missing a URI", async () => {
    const disk = createDiskEntry({
      location: "local",
      path: "/Local/Disk 3.d64",
    });

    await expect(resolveLocalDiskBlob(disk)).rejects.toThrow("Local disk access is missing.");
  });

  it("resolves local disk blobs via source runtime files", async () => {
    const sourceId = "source-runtime";
    saveLocalSources([
      {
        id: sourceId,
        name: "Local Source",
        rootName: "Local Source",
        rootPath: "/",
        createdAt: new Date().toISOString(),
        entries: [],
      },
    ]);

    const runtimeFile = new File([new Uint8Array([100, 101, 102])], "Disk 4.d64", {
      type: "application/octet-stream",
    });
    setLocalSourceRuntimeFiles(sourceId, {
      "/Local/Disk 4.d64": runtimeFile,
    });

    const disk = createDiskEntry({
      location: "local",
      path: "/Local/Disk 4.d64",
      sourceId,
    });

    const blob = await resolveLocalDiskBlob(disk);
    const text = await readBlobText(blob);
    expect(text).toBe("def");
  });

  it("resolves local disk blobs via source SAF tree URIs", async () => {
    await mockFolderPickerFromTree(btoa("saf-data"));
    const sourceId = "source-saf";
    saveLocalSources([
      {
        id: sourceId,
        name: "Android SAF",
        rootName: "Android SAF",
        rootPath: "/",
        createdAt: new Date().toISOString(),
        android: {
          treeUri: "content://tree/primary%3ADisks",
          rootName: "Disks",
          permissionGrantedAt: new Date().toISOString(),
        },
      },
    ]);

    const disk = createDiskEntry({
      location: "local",
      path: "/Local/Disk 5.d64",
      sourceId,
    });

    const blob = await resolveLocalDiskBlob(disk);
    const text = await readBlobText(blob);
    expect(text).toBe("saf-data");
  });

  describe("HARD18-025 write-back materialization", () => {
    const buildWriteBack = (
      overrides: Partial<DiskMountWriteBackDependencies> = {},
    ): DiskMountWriteBackDependencies => ({
      listRemoteStorageRoots: vi.fn(async () => ["Usb0", "Temp"]),
      writeRemoteFile: vi.fn(async () => undefined),
      readRemoteFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      ...overrides,
    });

    it("path-mounts a local-library disk resolved via a real SAF tree source, then writes the eject read-back to that same source", async () => {
      const sourceId = "source-writeback";
      saveLocalSources([
        {
          id: sourceId,
          name: "Android SAF",
          rootName: "Android SAF",
          rootPath: "/",
          createdAt: new Date().toISOString(),
          android: {
            treeUri: "content://tree/primary%3ADisks",
            rootName: "Disks",
            permissionGrantedAt: new Date().toISOString(),
          },
        },
      ]);

      const api = {
        mountDrive: vi.fn().mockResolvedValue(undefined),
        mountDriveUpload: vi.fn().mockResolvedValue(undefined),
        getBaseUrl: vi.fn().mockReturnValue("http://c64u"),
        getDeviceHost: vi.fn().mockReturnValue("c64u"),
      } as unknown as C64API;

      const disk = createDiskEntry({
        location: "local",
        path: "/Local/Save Game.d64",
        sourceId,
      });
      const runtimeFile = new File([new Uint8Array([1, 2, 3])], "Save Game.d64");
      const writeBack = buildWriteBack();

      const outcome = await mountDiskToDrive(api, "a", disk, runtimeFile, { writeBack });

      expect(outcome.persistence).toBe("materialized");
      expect(api.mountDriveUpload).not.toHaveBeenCalled();
      expect(api.mountDrive).toHaveBeenCalledWith("a", "/Usb0/c64commander-disk-work-a.d64", "d64", "readwrite");

      const { FolderPicker } = await import("@/lib/native/folderPicker");
      const result = await finalizeDiskWriteBack("a", writeBack);

      expect(result).toEqual({ attempted: true, success: true });
      expect(FolderPicker.writeFileToTree).toHaveBeenCalledWith({
        treeUri: "content://tree/primary%3ADisks",
        path: "/Local/Save Game.d64",
        data: btoa(String.fromCharCode(1, 2, 3)),
        overwrite: true,
      });
    });

    const materializeOnDevice = async (deviceHost: string, drive: "a" | "b" = "a") => {
      const sourceId = `source-${deviceHost}-${drive}`;
      saveLocalSources([
        {
          id: sourceId,
          name: "Android SAF",
          rootName: "Android SAF",
          rootPath: "/",
          createdAt: new Date().toISOString(),
          android: {
            treeUri: "content://tree/primary%3ADisks",
            rootName: "Disks",
            permissionGrantedAt: new Date().toISOString(),
          },
        },
      ]);
      const api = {
        mountDrive: vi.fn().mockResolvedValue(undefined),
        mountDriveUpload: vi.fn().mockResolvedValue(undefined),
        getBaseUrl: vi.fn().mockReturnValue(`http://${deviceHost}`),
        getDeviceHost: vi.fn().mockReturnValue(deviceHost),
      } as unknown as C64API;
      const disk = createDiskEntry({ location: "local", path: "/Local/Save Game.d64", sourceId });
      const runtimeFile = new File([new Uint8Array([1, 2, 3])], "Save Game.d64");
      const writeBack = buildWriteBack();
      const outcome = await mountDiskToDrive(api, drive, disk, runtimeFile, { writeBack });
      expect(outcome.persistence).toBe("materialized");
      return { api, writeBack };
    };

    it("skips the write-back when the disk was materialized on a different device (HARD19-005)", async () => {
      const { writeBack } = await materializeOnDevice("device-a", "a");
      const { FolderPicker } = await import("@/lib/native/folderPicker");
      (FolderPicker.writeFileToTree as ReturnType<typeof vi.fn>).mockClear();
      (writeBack.readRemoteFile as ReturnType<typeof vi.fn>).mockClear();

      // Eject while a DIFFERENT device is selected.
      const result = await finalizeDiskWriteBack("a", writeBack, "device-b");

      expect(result).toEqual({ attempted: false, reason: "device-mismatch" });
      // Crucially: no read of the other device's work file, no overwrite of the source.
      expect(writeBack.readRemoteFile).not.toHaveBeenCalled();
      expect(FolderPicker.writeFileToTree).not.toHaveBeenCalled();
    });

    it("still finalizes when ejecting on the same device the disk was materialized on (HARD19-005)", async () => {
      const { writeBack } = await materializeOnDevice("device-a", "a");

      const result = await finalizeDiskWriteBack("a", writeBack, "device-a");

      expect(result).toEqual({ attempted: true, success: true });
      expect(writeBack.readRemoteFile).toHaveBeenCalled();
    });

    it("exposes the materialized work path so the drive card can keep the disk identity (HARD19-007)", async () => {
      await materializeOnDevice("device-a", "a");
      expect(getMaterializedWorkPath("a")).toBe("/Usb0/c64commander-disk-work-a.d64");
      expect(getMaterializedWorkPath("b")).toBeNull();
    });

    it("rehydrates the materialized mount from sessionStorage across a process restart (HARD19-006)", async () => {
      await materializeOnDevice("device-a", "a");
      // The entry was persisted to sessionStorage on materialization.
      expect(sessionStorage.getItem("c64u.materializedDiskMounts.v1")).toBeTruthy();

      // Simulate Android process death + app reload: a FRESH module instance
      // rehydrates from sessionStorage (the in-memory singleton was lost).
      vi.resetModules();
      const fresh = await import("@/lib/disks/diskMount");
      expect(fresh.getMaterializedWorkPath("a")).toBe("/Usb0/c64commander-disk-work-a.d64");
      fresh.resetMaterializedMountsForTests();
    });

    it("shows the write-back advisory only once (localStorage-backed)", () => {
      expect(hasShownDiskWriteBackAdvisory()).toBe(false);
      markDiskWriteBackAdvisoryShown();
      expect(hasShownDiskWriteBackAdvisory()).toBe(true);
    });
  });
});
