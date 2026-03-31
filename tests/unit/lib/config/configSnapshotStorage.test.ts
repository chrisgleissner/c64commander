/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Directory } from "@capacitor/filesystem";
import { persistConfigSnapshotFile, pickConfigSnapshotFile } from "@/lib/config/configSnapshotStorage";

const mkdirMock = vi.fn();
const writeFileMock = vi.fn();
const pickFileMock = vi.fn();
const readFileMock = vi.fn();
const getPlatformMock = vi.fn(() => "web");
const isNativePlatformMock = vi.fn(() => false);
const ensureRamDumpFolderMock = vi.fn();
const deriveRamDumpFolderDisplayPathMock = vi.fn(() => "Downloads/C64");

vi.mock("@capacitor/filesystem", () => ({
  Directory: {
    Data: "DATA",
  },
  Filesystem: {
    mkdir: (...args: unknown[]) => mkdirMock(...args),
    writeFile: (...args: unknown[]) => writeFileMock(...args),
  },
}));

vi.mock("@/lib/native/folderPicker", () => ({
  FolderPicker: {
    writeFileToTree: vi.fn(async (...args: unknown[]) => undefined),
    pickFile: (...args: unknown[]) => pickFileMock(...args),
    readFile: (...args: unknown[]) => readFileMock(...args),
  },
}));

vi.mock("@/lib/native/platform", () => ({
  getPlatform: () => getPlatformMock(),
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock("@/lib/config/ramDumpFolderStore", () => ({
  deriveRamDumpFolderDisplayPath: (...args: unknown[]) => deriveRamDumpFolderDisplayPathMock(...args),
}));

vi.mock("@/lib/machine/ramDumpStorage", () => ({
  ensureRamDumpFolder: (...args: unknown[]) => ensureRamDumpFolderMock(...args),
}));

describe("configSnapshotStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPlatformMock.mockReturnValue("web");
    isNativePlatformMock.mockReturnValue(false);
    mkdirMock.mockResolvedValue(undefined);
    writeFileMock.mockResolvedValue(undefined);
    pickFileMock.mockResolvedValue(undefined);
    readFileMock.mockResolvedValue({ data: "" });
  });

  it("persists sanitized config snapshot files into the Android tree location", async () => {
    getPlatformMock.mockReturnValue("android");
    isNativePlatformMock.mockReturnValue(true);
    ensureRamDumpFolderMock.mockResolvedValue({
      treeUri: "content://tree/configs",
      rootName: "Configs",
      displayPath: null,
    });

    const { FolderPicker } = await import("@/lib/native/folderPicker");
    const writeFileToTreeMock = vi.mocked(FolderPicker.writeFileToTree);

    const location = await persistConfigSnapshotFile("  My Snapshot  ", new Uint8Array([1, 2, 3]));

    expect(writeFileToTreeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        treeUri: "content://tree/configs",
        path: "/My-Snapshot.cfg",
        mimeType: "text/plain",
        overwrite: true,
      }),
    );
    expect(location).toEqual({
      kind: "android-tree",
      treeUri: "content://tree/configs",
      path: "/My-Snapshot.cfg",
      rootName: "Configs",
      displayPath: "Downloads/C64",
    });
  });

  it("writes native-data snapshots on native non-Android platforms and rejects invalid picked files", async () => {
    getPlatformMock.mockReturnValue("ios");
    isNativePlatformMock.mockReturnValue(true);

    const location = await persistConfigSnapshotFile("snapshot", new Uint8Array([4, 5]));

    expect(mkdirMock).toHaveBeenCalledWith({ directory: Directory.Data, path: "config-snapshots", recursive: true });
    expect(writeFileMock).toHaveBeenCalledWith(
      expect.objectContaining({ directory: Directory.Data, path: "config-snapshots/snapshot.cfg", recursive: true }),
    );
    expect(location).toEqual({ kind: "native-data", path: "config-snapshots/snapshot.cfg" });

    getPlatformMock.mockReturnValue("android");
    pickFileMock.mockResolvedValue({
      uri: "content://picked/file",
      permissionPersisted: true,
      name: "not-a-config.txt",
    });

    await expect(pickConfigSnapshotFile()).rejects.toThrow("Select a .cfg file.");
  });

  it("throws when persistConfigSnapshotFile is called on a non-native platform", async () => {
    // isNativePlatformMock returns false (default from beforeEach)
    await expect(persistConfigSnapshotFile("backup", new Uint8Array([1, 2]))).rejects.toThrow(
      "Config snapshots are only supported on native builds.",
    );
  });

  it("throws when pickConfigSnapshotFile is called on a non-Android platform", async () => {
    // getPlatformMock returns "web" (default from beforeEach), so isAndroidNative() = false
    await expect(pickConfigSnapshotFile()).rejects.toThrow(
      "Config snapshots are only supported on native builds.",
    );
  });

  it("throws when pickConfigSnapshotFile returns no URI or no persisted permission", async () => {
    getPlatformMock.mockReturnValue("android");
    isNativePlatformMock.mockReturnValue(true);
    pickFileMock.mockResolvedValue({ uri: null, permissionPersisted: true, name: "config.cfg" });

    await expect(pickConfigSnapshotFile()).rejects.toThrow("Config file access was not granted.");

    pickFileMock.mockResolvedValue({ uri: "content://file", permissionPersisted: false, name: "config.cfg" });
    await expect(pickConfigSnapshotFile()).rejects.toThrow("Config file access was not granted.");
  });

  it("returns parsed bytes when pickConfigSnapshotFile succeeds", async () => {
    getPlatformMock.mockReturnValue("android");
    isNativePlatformMock.mockReturnValue(true);
    pickFileMock.mockResolvedValue({
      uri: "content://picked/valid.cfg",
      permissionPersisted: true,
      name: "my-config.cfg",
      sizeBytes: 3,
      modifiedAt: "2026-01-01T00:00:00Z",
    });
    // btoa([1,2,3]) = 'AQID'
    readFileMock.mockResolvedValue({ data: btoa(String.fromCharCode(1, 2, 3)) });

    const result = await pickConfigSnapshotFile();

    expect(result.name).toBe("my-config.cfg");
    expect(result.sizeBytes).toBe(3);
    expect(result.bytes).toBeInstanceOf(Uint8Array);
  });
});
