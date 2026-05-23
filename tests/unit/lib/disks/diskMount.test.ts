/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

vi.mock("@/lib/native/folderPicker", () => ({
  FolderPicker: {
    readFile: vi.fn(),
    readFileFromTree: vi.fn(),
  },
}));

vi.mock("@/lib/sourceNavigation/paths", () => ({
  normalizeSourcePath: vi.fn((p: string) => p),
}));

vi.mock("@/lib/sourceNavigation/localSourcesStore", () => ({
  getLocalSourceListingMode: vi.fn(() => "tree"),
  getLocalSourceRuntimeFile: vi.fn(() => null),
  loadLocalSources: vi.fn(() => []),
  requireLocalSourceEntries: vi.fn(() => []),
}));

const { mockFetchUltimateOriginBlob, mockIsOriginOnSelectedDevice } = vi.hoisted(() => ({
  mockFetchUltimateOriginBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])])),
  mockIsOriginOnSelectedDevice: vi.fn(() => true),
}));

vi.mock("@/lib/savedDevices/deviceBoundOrigin", () => ({
  fetchUltimateOriginBlob: mockFetchUltimateOriginBlob,
  isOriginOnSelectedDevice: mockIsOriginOnSelectedDevice,
}));

import { FolderPicker } from "@/lib/native/folderPicker";
import {
  loadLocalSources,
  getLocalSourceListingMode,
  getLocalSourceRuntimeFile,
  requireLocalSourceEntries,
} from "@/lib/sourceNavigation/localSourcesStore";
import { addErrorLog } from "@/lib/logging";
import { buildDiskMountType, resolveLocalDiskBlob, mountDiskToDrive } from "@/lib/disks/diskMount";

describe("diskMount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOriginOnSelectedDevice.mockReturnValue(true);
  });

  describe("buildDiskMountType", () => {
    it("returns extension for .d64 file", () => {
      expect(buildDiskMountType("/path/to/disk.d64")).toBe("d64");
    });

    it("returns extension for .g64 file", () => {
      expect(buildDiskMountType("/path/to/disk.g64")).toBe("g64");
    });

    it("returns undefined for file without extension", () => {
      expect(buildDiskMountType("/path/to/disk")).toBeUndefined();
    });
  });

  describe("resolveLocalDiskBlob", () => {
    it("returns runtimeFile when provided", async () => {
      const file = new File(["test"], "test.d64");
      const blob = await resolveLocalDiskBlob({ path: "/test.d64", location: "local" } as any, file);
      expect(blob).toBe(file);
    });

    it("reads from localUri when available", async () => {
      vi.mocked(FolderPicker.readFile).mockResolvedValue({
        data: btoa("test data"),
      });
      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        localUri: "content://uri",
        location: "local",
      } as any);
      expect(blob).toBeInstanceOf(Blob);
      expect(FolderPicker.readFile).toHaveBeenCalledWith({
        uri: "content://uri",
      });
    });

    it("reads from localTreeUri when available", async () => {
      vi.mocked(FolderPicker.readFileFromTree).mockResolvedValue({
        data: btoa("tree data"),
      });
      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        localTreeUri: "tree://uri",
        location: "local",
      } as any);
      expect(blob).toBeInstanceOf(Blob);
      expect(FolderPicker.readFileFromTree).toHaveBeenCalledWith({
        treeUri: "tree://uri",
        path: "/test.d64",
      });
    });

    it("falls back to local sources when no direct uri", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1", android: { treeUri: "tree://source" } } as any]);
      vi.mocked(FolderPicker.readFileFromTree).mockResolvedValue({
        data: btoa("source data"),
      });

      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        location: "local",
      } as any);
      expect(blob).toBeInstanceOf(Blob);
    });

    it("falls back to runtimeFile from source", async () => {
      const runtimeFile = new File(["runtime"], "runtime.d64");
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any]);
      vi.mocked(getLocalSourceRuntimeFile).mockReturnValue(runtimeFile as any);

      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        location: "local",
      } as any);
      expect(blob).toBe(runtimeFile);
    });

    it("resolves from source entries in entries mode", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any]);
      vi.mocked(getLocalSourceListingMode).mockReturnValue("entries" as any);
      vi.mocked(requireLocalSourceEntries).mockReturnValue([
        { relativePath: "/test.d64", uri: "content://entry-uri" } as any,
      ]);
      vi.mocked(FolderPicker.readFile).mockResolvedValue({
        data: btoa("entry data"),
      });

      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        location: "local",
      } as any);
      expect(blob).toBeInstanceOf(Blob);
    });

    it("throws when no source can resolve the file", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([]);
      await expect(resolveLocalDiskBlob({ path: "/test.d64", location: "local" } as any)).rejects.toThrow(
        "Local disk access is missing",
      );
    });

    it("rejects oversized runtime disk files before reading them into memory", async () => {
      const oversizedFile = {
        size: 64 * 1024 * 1024 + 1,
        arrayBuffer: vi.fn(),
      } as unknown as File;

      await expect(
        resolveLocalDiskBlob({ path: "/huge.d64", location: "local" } as any, oversizedFile),
      ).rejects.toThrow("too large to mount");
      expect(oversizedFile.arrayBuffer).not.toHaveBeenCalled();
    });

    it("cancels before reading runtime disk file bytes", async () => {
      const controller = new AbortController();
      controller.abort();
      const file = {
        size: 4,
        arrayBuffer: vi.fn(),
      } as unknown as File;

      await expect(
        resolveLocalDiskBlob({ path: "/test.d64", location: "local" } as any, file, {
          signal: controller.signal,
        }),
      ).rejects.toThrow(/cancelled|aborted/i);
      expect(file.arrayBuffer).not.toHaveBeenCalled();
    });

    it("cancels pending native localUri reads without returning late blobs", async () => {
      const controller = new AbortController();
      let resolveRead: ((value: { data: string }) => void) | null = null;
      vi.mocked(FolderPicker.readFile).mockReturnValue(
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      );

      const pending = resolveLocalDiskBlob(
        {
          path: "/test.d64",
          localUri: "content://uri",
          location: "local",
        } as any,
        undefined,
        { signal: controller.signal },
      );

      await vi.waitFor(() => expect(FolderPicker.readFile).toHaveBeenCalledWith({ uri: "content://uri" }));
      controller.abort();
      await expect(pending).rejects.toThrow(/cancelled|aborted/i);
      resolveRead?.({ data: btoa("late data") });
    });

    it("cancels pending native localTreeUri reads without decoding late payloads", async () => {
      const controller = new AbortController();
      let resolveRead: ((value: { data: string }) => void) | null = null;
      vi.mocked(FolderPicker.readFileFromTree).mockReturnValue(
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      );

      const pending = resolveLocalDiskBlob(
        {
          path: "/test.d64",
          localTreeUri: "tree://uri",
          location: "local",
        } as any,
        undefined,
        { signal: controller.signal },
      );

      await vi.waitFor(() =>
        expect(FolderPicker.readFileFromTree).toHaveBeenCalledWith({
          treeUri: "tree://uri",
          path: "/test.d64",
        }),
      );
      controller.abort();
      await expect(pending).rejects.toThrow(/cancelled|aborted/i);
      resolveRead?.({ data: btoa("late tree data") });
    });

    it("tries matching source by sourceId first", async () => {
      const runtimeFile = new File(["data"], "test.d64");
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any, { id: "src2" } as any]);
      vi.mocked(getLocalSourceRuntimeFile).mockImplementation((id: string) =>
        id === "src2" ? (runtimeFile as any) : null,
      );

      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        location: "local",
        sourceId: "src2",
      } as any);
      expect(blob).toBe(runtimeFile);
      expect(getLocalSourceRuntimeFile).toHaveBeenCalledWith("src2", "/test.d64");
    });

    it("handles tree read error gracefully and tries next source", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([
        { id: "src1", android: { treeUri: "tree://fail" } } as any,
        { id: "src2", android: { treeUri: "tree://ok" } } as any,
      ]);
      vi.mocked(FolderPicker.readFileFromTree)
        .mockRejectedValueOnce(new Error("access denied"))
        .mockResolvedValueOnce({ data: btoa("ok") });

      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        location: "local",
      } as any);
      expect(blob).toBeInstanceOf(Blob);
    });

    it("skips sourceId-targeted lookup and iterates all sources when sourceId not found", async () => {
      const runtimeFile = new File(["data"], "test.d64");
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any]);
      vi.mocked(getLocalSourceRuntimeFile).mockReturnValue(runtimeFile as any);

      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        location: "local",
        sourceId: "nonexistent",
      } as any);
      // Falls through to all-sources loop, picks up src1
      expect(blob).toBe(runtimeFile);
    });

    it("falls through to all-sources loop when sourceId match yields null", async () => {
      const runtimeFile = new File(["data"], "test.d64");
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any, { id: "src2" } as any]);
      vi.mocked(getLocalSourceListingMode).mockReturnValue("tree" as any);
      vi.mocked(getLocalSourceRuntimeFile)
        .mockReturnValueOnce(null) // src1 in sourceId-targeted call
        .mockReturnValueOnce(null) // src1 in all-sources loop
        .mockReturnValueOnce(runtimeFile as any); // src2 in all-sources loop

      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        location: "local",
        sourceId: "src1",
      } as any);
      expect(blob).toBe(runtimeFile);
    });

    it("logs source entry resolution failures before trying other sources", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any]);
      vi.mocked(getLocalSourceRuntimeFile).mockReturnValue(null);
      vi.mocked(getLocalSourceListingMode).mockReturnValue("entries" as any);
      vi.mocked(requireLocalSourceEntries).mockImplementation(() => {
        throw new Error("entries unavailable");
      });

      await expect(resolveLocalDiskBlob({ path: "/test.d64", location: "local" } as any)).rejects.toThrow(
        "Local disk access is missing",
      );
      expect(addErrorLog).toHaveBeenCalledWith(
        "Local source entries resolve failed",
        expect.objectContaining({
          sourceId: "src1",
          normalizedPath: "/test.d64",
          error: "entries unavailable",
        }),
      );
    });
  });

  describe("mountDiskToDrive", () => {
    const mockApi = {
      mountDrive: vi.fn(async () => undefined),
      mountDriveUpload: vi.fn(async () => undefined),
      getBaseUrl: vi.fn(() => "http://localhost"),
      getDeviceHost: vi.fn(() => "localhost"),
    };

    it("mounts ultimate disk via API", async () => {
      await mountDiskToDrive(mockApi as any, "a", {
        path: "/disk.d64",
        location: "ultimate",
      } as any);
      expect(mockApi.mountDrive).toHaveBeenCalledWith("a", "/disk.d64", "d64", "readwrite");
    });

    it("uploads bytes when an ultimate disk belongs to a different saved device", async () => {
      mockIsOriginOnSelectedDevice.mockReturnValue(false);
      await mountDiskToDrive(mockApi as any, "a", {
        path: "/disk.d64",
        location: "ultimate",
        origin: {
          sourceKind: "ultimate",
          originDeviceId: "device-a",
          originDeviceLastKnownUniqueId: "UID-A",
          originPath: "/disk.d64",
          importedAt: "2026-04-09T00:00:00.000Z",
        },
      } as any);
      expect(mockFetchUltimateOriginBlob).toHaveBeenCalledWith(
        expect.objectContaining({ originDeviceId: "device-a", originPath: "/disk.d64" }),
      );
      expect(mockApi.mountDriveUpload).toHaveBeenCalledWith("a", expect.any(Blob), "d64", "readwrite", {
        filename: "/disk.d64",
      });
      expect(mockApi.mountDrive).not.toHaveBeenCalled();
    });

    it("throws for unsupported disk type", async () => {
      await expect(
        mountDiskToDrive(mockApi as any, "a", {
          path: "/disk",
          location: "ultimate",
        } as any),
      ).rejects.toThrow("Unsupported");
    });

    it("uploads local disk blob via API", async () => {
      const file = new File(["test"], "disk.d64");
      await mountDiskToDrive(mockApi as any, "b", { path: "/disk.d64", location: "local" } as any, file);
      expect(mockApi.mountDriveUpload).toHaveBeenCalledWith("b", file, "d64", "readwrite", {
        filename: "/disk.d64",
      });
    });

    it("logs and rethrows on mount failure", async () => {
      mockApi.mountDrive.mockRejectedValueOnce(new Error("mount error"));
      await expect(
        mountDiskToDrive(mockApi as any, "a", {
          path: "/disk.d64",
          location: "ultimate",
        } as any),
      ).rejects.toThrow("mount error");
    });
  });
});
