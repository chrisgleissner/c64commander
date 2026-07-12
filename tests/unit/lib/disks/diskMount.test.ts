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
    writeFileToTree: vi.fn(async () => ({ uri: "tree://uri", sizeBytes: 0 })),
    pickDirectory: vi.fn(async () => ({ treeUri: "tree://picked" })),
  },
}));

const { mockResolvePersistentReuStorageRoot } = vi.hoisted(() => ({
  mockResolvePersistentReuStorageRoot: vi.fn(
    (names: string[]) => names.find((n) => n.toLowerCase() !== "temp") ?? null,
  ),
}));

// HARD18-025 reuses HARD18-014's persistent-root ranking as-is; stubbed here
// so these tests don't also need reuWorkflow.ts's full dependency graph
// (snapshot storage/store) just to exercise a pure ranking helper.
vi.mock("@/lib/reu/reuWorkflow", () => ({
  resolvePersistentReuStorageRoot: mockResolvePersistentReuStorageRoot,
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

vi.mock("@/lib/config/appSettings", () => ({
  loadDebugLoggingEnabled: vi.fn(() => false),
  saveDebugLoggingEnabled: vi.fn(),
}));

const { mockFetchUltimateOriginBlob, mockIsOriginOnSelectedDevice } = vi.hoisted(() => ({
  mockFetchUltimateOriginBlob: vi.fn(async () => new Blob([new Uint8Array([1, 2, 3])])),
  mockIsOriginOnSelectedDevice: vi.fn(() => true),
}));

vi.mock("@/lib/savedDevices/deviceBoundOrigin", () => ({
  fetchUltimateOriginBlob: mockFetchUltimateOriginBlob,
  isOriginOnSelectedDevice: mockIsOriginOnSelectedDevice,
}));

const { mockDownloadBinary, mockCreateArchiveClient } = vi.hoisted(() => {
  const download = vi.fn();
  return {
    mockDownloadBinary: download,
    mockCreateArchiveClient: vi.fn(() => ({ downloadBinary: download })),
  };
});

vi.mock("@/lib/archive/client", () => ({
  createArchiveClient: mockCreateArchiveClient,
}));

import { FolderPicker } from "@/lib/native/folderPicker";
import {
  loadLocalSources,
  getLocalSourceListingMode,
  getLocalSourceRuntimeFile,
  requireLocalSourceEntries,
} from "@/lib/sourceNavigation/localSourcesStore";
import { addErrorLog } from "@/lib/logging";
import {
  buildDiskMountType,
  resolveLocalDiskBlob,
  mountDiskToDrive,
  resolveDiskWriteBackTarget,
  finalizeDiskWriteBack,
  discardDiskWriteBack,
  saveArchiveDiskCopyToLocalFolder,
  type DiskMountWriteBackDependencies,
} from "@/lib/disks/diskMount";
import {
  getCachedArchiveDiskBlob,
  setCachedArchiveDiskBlob,
  clearArchiveDiskCacheForTests,
} from "@/lib/archive/archiveDiskCache";

const ARCHIVE_CONFIG = {
  id: "commoserve-1",
  name: "CommoServe",
  baseUrl: "http://commoserve.example",
  enabled: true,
};

const buildArchiveDisk = () =>
  ({
    path: "/archive-game.d64",
    location: "local",
    sourceId: "commoserve-1",
    sourceKind: "commoserve",
    archiveRef: {
      sourceId: "commoserve-1",
      resultId: "123",
      category: 42,
      entryId: 7,
      entryPath: "archive-game.d64",
    },
  }) as any;

describe("diskMount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsOriginOnSelectedDevice.mockReturnValue(true);
    clearArchiveDiskCacheForTests();
    // materializedMounts is a module singleton (by design - drive occupancy
    // outlives any one test's mountDiskToDrive call); drop any leftovers so
    // tests don't see a prior test's pending write-back entry.
    discardDiskWriteBack("a");
    discardDiskWriteBack("b");
    mockResolvePersistentReuStorageRoot.mockImplementation(
      (names: string[]) => names.find((n) => n.toLowerCase() !== "temp") ?? null,
    );
    mockCreateArchiveClient.mockReturnValue({ downloadBinary: mockDownloadBinary });
    mockDownloadBinary.mockResolvedValue({
      fileName: "archive-game.d64",
      bytes: new Uint8Array([1, 2, 3, 4]),
      contentType: "application/octet-stream",
      url: "http://commoserve.example/leet/search/bin/123/42/7",
    });
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

    it("HARD12-013: does not call arrayBuffer() on the runtime file when debug logging is disabled", async () => {
      // The runtimeFile branch must not materialise the bytes purely to feed
      // the diagnostic fingerprint log when debug logging is off.
      const { loadDebugLoggingEnabled } = await import("@/lib/config/appSettings");
      vi.mocked(loadDebugLoggingEnabled).mockReturnValue(false);
      const arrayBufferSpy = vi.fn();
      const runtimeFile = new File(["runtime"], "runtime.d64");
      Object.defineProperty(runtimeFile, "arrayBuffer", {
        configurable: true,
        value: arrayBufferSpy,
      });
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any]);
      vi.mocked(getLocalSourceRuntimeFile).mockReturnValue(runtimeFile as any);

      const blob = await resolveLocalDiskBlob({
        path: "/test.d64",
        location: "local",
      } as any);
      expect(blob).toBe(runtimeFile);
      expect(arrayBufferSpy).not.toHaveBeenCalled();
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

    it("throws an accurate re-import message for a commoserve disk with no runtime bytes and no archiveRef (HARD9-011)", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([]);
      await expect(
        resolveLocalDiskBlob({
          path: "/archive-disk.d64",
          location: "local",
          sourceId: "commoserve-1",
          sourceKind: "commoserve",
        } as any),
      ).rejects.toThrow("Re-import it from CommoServe");
      // Legacy entries (imported before HARD10-002) have no archiveRef, so
      // there is nothing to re-download - the terminal fallback still applies.
      expect(mockCreateArchiveClient).not.toHaveBeenCalled();
    });

    it("re-downloads an archiveRef commoserve disk on mount after runtime bytes are cleared (HARD10-002)", async () => {
      // No runtimeFile and no local sources: the in-memory bytes are gone
      // (device switch / restart). The archiveRef must drive a fresh download.
      vi.mocked(loadLocalSources).mockReturnValue([]);
      const blob = await resolveLocalDiskBlob(buildArchiveDisk(), undefined, {
        archiveConfigs: { "commoserve-1": ARCHIVE_CONFIG },
      });

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBe(4);
      expect(mockCreateArchiveClient).toHaveBeenCalledWith(ARCHIVE_CONFIG);
      expect(mockDownloadBinary).toHaveBeenCalledWith("123", 42, 7, "archive-game.d64", {
        signal: undefined,
      });
      // A local-source scan must never happen for an archive-backed disk.
      expect(getLocalSourceRuntimeFile).not.toHaveBeenCalled();
    });

    it("serves a second archiveRef mount from the cache without re-downloading (HARD10-002)", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([]);
      await resolveLocalDiskBlob(buildArchiveDisk(), undefined, {
        archiveConfigs: { "commoserve-1": ARCHIVE_CONFIG },
      });
      const second = await resolveLocalDiskBlob(buildArchiveDisk(), undefined, {
        archiveConfigs: { "commoserve-1": ARCHIVE_CONFIG },
      });

      expect(second).toBeInstanceOf(Blob);
      expect(mockDownloadBinary).toHaveBeenCalledTimes(1);
    });

    it("rejects an oversized archiveRef re-download before mounting (HARD10-002)", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([]);
      mockDownloadBinary.mockResolvedValue({
        fileName: "archive-game.d64",
        bytes: new Uint8Array(64 * 1024 * 1024 + 1),
        contentType: "application/octet-stream",
        url: "http://commoserve.example/leet/search/bin/123/42/7",
      });

      await expect(
        resolveLocalDiskBlob(buildArchiveDisk(), undefined, {
          archiveConfigs: { "commoserve-1": ARCHIVE_CONFIG },
        }),
      ).rejects.toThrow("too large to mount");
    });

    it("aborts an archiveRef re-download when the signal is already aborted (HARD10-002)", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([]);
      const controller = new AbortController();
      controller.abort();

      await expect(
        resolveLocalDiskBlob(buildArchiveDisk(), undefined, {
          archiveConfigs: { "commoserve-1": ARCHIVE_CONFIG },
          signal: controller.signal,
        }),
      ).rejects.toThrow(/cancelled|aborted/i);
      expect(mockDownloadBinary).not.toHaveBeenCalled();
    });

    it("throws when the archive source config is unavailable for an archiveRef disk (HARD10-002)", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([]);
      await expect(resolveLocalDiskBlob(buildArchiveDisk(), undefined, { archiveConfigs: {} })).rejects.toThrow(
        "Archive source configuration unavailable for commoserve-1",
      );
      expect(mockDownloadBinary).not.toHaveBeenCalled();
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

    it("rejects oversized localUri payloads before decoding them", async () => {
      vi.mocked(FolderPicker.readFile).mockResolvedValue({
        data: "A".repeat(90 * 1024 * 1024),
      });

      await expect(
        resolveLocalDiskBlob({
          path: "/huge.d64",
          localUri: "content://huge",
          location: "local",
        } as any),
      ).rejects.toThrow("too large to mount");
    });

    it("uses a size-aware timeout instead of the old 2 second local read limit", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(FolderPicker.readFile).mockReturnValue(new Promise(() => undefined));
        const pending = resolveLocalDiskBlob({
          path: "/large.d64",
          localUri: "content://large",
          location: "local",
          sizeBytes: 4 * 1024 * 1024,
        } as any);
        const rejection = vi.fn();
        pending.catch(rejection);

        await vi.advanceTimersByTimeAsync(2000);
        expect(rejection).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(8000);
        await expect(pending).rejects.toThrow("Local disk file read timed out after 10000 ms");
      } finally {
        vi.useRealTimers();
      }
    });

    it("uses an Error abort fallback when DOMException is unavailable", async () => {
      const previousDomException = globalThis.DOMException;
      vi.stubGlobal("DOMException", undefined);
      const controller = new AbortController();
      controller.abort();

      try {
        await expect(
          resolveLocalDiskBlob(
            {
              path: "/test.d64",
              localUri: "content://uri",
              location: "local",
            } as any,
            undefined,
            { signal: controller.signal },
          ),
        ).rejects.toMatchObject({
          name: "AbortError",
          message: "Local disk file read cancelled",
        });
      } finally {
        vi.stubGlobal("DOMException", previousDomException);
      }
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

    it("stops source fallback after a definitive SAF read timeout", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(loadLocalSources).mockReturnValue([
          { id: "src1", android: { treeUri: "tree://timeout" } } as any,
          { id: "src2", android: { treeUri: "tree://ok" } } as any,
        ]);
        vi.mocked(getLocalSourceRuntimeFile).mockReturnValue(null);
        vi.mocked(getLocalSourceListingMode).mockReturnValue("saf" as any);
        vi.mocked(FolderPicker.readFileFromTree).mockReset();
        vi.mocked(FolderPicker.readFileFromTree).mockReturnValue(new Promise(() => undefined));

        const pending = resolveLocalDiskBlob({
          path: "/test.d64",
          location: "local",
        } as any);
        const rejection = expect(pending).rejects.toThrow("Local disk tree read timed out after 15000 ms");

        await vi.advanceTimersByTimeAsync(15000);
        await rejection;
        expect(FolderPicker.readFileFromTree).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("throws instead of scanning other sources when sourceId is set but not found (HARD9-068)", async () => {
      const runtimeFile = new File(["data"], "test.d64");
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any]);
      vi.mocked(getLocalSourceRuntimeFile).mockReturnValue(runtimeFile as any);

      await expect(
        resolveLocalDiskBlob({
          path: "/test.d64",
          location: "local",
          sourceId: "nonexistent",
        } as any),
      ).rejects.toThrow("Local disk access is missing");
      // src1 must never be scanned by path - a disk with a sourceId that
      // doesn't resolve must fail, not silently pick up another source's
      // same-named file. See HARD9-068.
      expect(getLocalSourceRuntimeFile).not.toHaveBeenCalled();
    });

    it("throws instead of scanning other sources when the sourceId-matched source yields null (HARD9-068)", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any, { id: "src2" } as any]);
      vi.mocked(getLocalSourceListingMode).mockReturnValue("tree" as any);
      // src1 (sourceId-targeted) yields null; src2 would yield a file if scanned.
      vi.mocked(getLocalSourceRuntimeFile)
        .mockReturnValueOnce(null)
        .mockReturnValue(new File(["data"], "test.d64") as any);

      await expect(
        resolveLocalDiskBlob({
          path: "/test.d64",
          location: "local",
          sourceId: "src1",
        } as any),
      ).rejects.toThrow("Local disk access is missing");
      // src2 must never be consulted - two libraries can both contain the
      // same relative path, and silently picking up the wrong one is
      // exactly what HARD9-068 closes off.
      expect(getLocalSourceRuntimeFile).toHaveBeenCalledTimes(1);
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

    it("cancels after resolving a matching source entry but before decoding the file payload", async () => {
      const controller = new AbortController();
      vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any]);
      vi.mocked(getLocalSourceRuntimeFile).mockReturnValue(null);
      vi.mocked(getLocalSourceListingMode).mockReturnValue("entries" as any);
      vi.mocked(requireLocalSourceEntries).mockReturnValue([
        { relativePath: "/test.d64", uri: "content://entry-uri" } as any,
      ]);
      vi.mocked(FolderPicker.readFile).mockImplementation(async () => {
        controller.abort();
        return { data: btoa("entry data") };
      });

      await expect(
        resolveLocalDiskBlob({ path: "/test.d64", location: "local" } as any, undefined, {
          signal: controller.signal,
        }),
      ).rejects.toThrow(/cancelled|aborted/i);
      expect(addErrorLog).toHaveBeenCalledWith(
        "Local source entries resolve failed",
        expect.objectContaining({
          sourceId: "src1",
          normalizedPath: "/test.d64",
          error: expect.stringMatching(/cancelled|aborted/i),
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

    it("passes the requested mount mode for safer manual disk mounts", async () => {
      await mountDiskToDrive(
        mockApi as any,
        "a",
        {
          path: "/disk.d64",
          location: "ultimate",
        } as any,
        undefined,
        { mode: "readonly" },
      );
      expect(mockApi.mountDrive).toHaveBeenCalledWith("a", "/disk.d64", "d64", "readonly");
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

    it("threads archiveConfigs so a commoserve disk re-downloads and mounts via upload (HARD10-002)", async () => {
      vi.mocked(loadLocalSources).mockReturnValue([]);
      await mountDiskToDrive(mockApi as any, "a", buildArchiveDisk(), undefined, {
        archiveConfigs: { "commoserve-1": ARCHIVE_CONFIG },
      });

      expect(mockDownloadBinary).toHaveBeenCalledWith("123", 42, 7, "archive-game.d64", {
        signal: undefined,
      });
      expect(mockApi.mountDriveUpload).toHaveBeenCalledWith("a", expect.any(Blob), "d64", "readwrite", {
        filename: "/archive-game.d64",
      });
    });

    it("HARD18-025: reports device-native persistence for an on-device ultimate mount", async () => {
      const outcome = await mountDiskToDrive(mockApi as any, "a", {
        path: "/disk.d64",
        location: "ultimate",
      } as any);
      expect(outcome).toEqual({ persistence: "device-native" });
    });

    it("HARD18-025: reports transient/unavailable persistence for a cross-device ultimate upload", async () => {
      mockIsOriginOnSelectedDevice.mockReturnValue(false);
      const outcome = await mountDiskToDrive(mockApi as any, "a", {
        path: "/disk.d64",
        location: "ultimate",
        origin: { sourceKind: "ultimate", originDeviceId: "device-a", originPath: "/disk.d64" },
      } as any);
      expect(outcome).toEqual({
        persistence: "transient",
        writeBackTarget: { kind: "unavailable" },
      });
    });

    it("HARD18-025: reports device-native persistence for an ultimate disk with no origin at all (not just a same-device origin)", async () => {
      mockIsOriginOnSelectedDevice.mockReturnValue(false);
      const outcome = await mountDiskToDrive(mockApi as any, "a", {
        path: "/disk.d64",
        location: "ultimate",
      } as any);
      expect(mockApi.mountDrive).toHaveBeenCalledWith("a", "/disk.d64", "d64", "readwrite");
      expect(outcome).toEqual({ persistence: "device-native" });
    });

    it("HARD18-025: reports transient persistence (no writeBack deps supplied) for a plain local buffer-mount", async () => {
      const file = new File(["test"], "disk.d64");
      const outcome = await mountDiskToDrive(
        mockApi as any,
        "b",
        { path: "/disk.d64", location: "local" } as any,
        file,
      );
      expect(outcome.persistence).toBe("transient");
      expect(mockApi.mountDriveUpload).toHaveBeenCalled();
    });
  });

  describe("disk write-back materialization (HARD18-025)", () => {
    const mockApi = {
      mountDrive: vi.fn(async () => undefined),
      mountDriveUpload: vi.fn(async () => undefined),
      getBaseUrl: vi.fn(() => "http://localhost"),
      getDeviceHost: vi.fn(() => "localhost"),
    };

    const buildWriteBack = (
      overrides: Partial<DiskMountWriteBackDependencies> = {},
    ): DiskMountWriteBackDependencies => ({
      listRemoteStorageRoots: vi.fn(async () => ["Usb0", "Temp"]),
      writeRemoteFile: vi.fn(async () => undefined),
      readRemoteFile: vi.fn(async () => new Uint8Array([9, 9, 9])),
      ...overrides,
    });

    describe("resolveDiskWriteBackTarget", () => {
      it("resolves a local-tree target from disk.localTreeUri", () => {
        const target = resolveDiskWriteBackTarget({
          path: "/game.d64",
          location: "local",
          localTreeUri: "tree://direct",
        } as any);
        expect(target).toEqual({ kind: "local-tree", treeUri: "tree://direct", path: "/game.d64" });
      });

      it("resolves a local-tree target via sourceId + source.android.treeUri", () => {
        vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1", android: { treeUri: "tree://source" } } as any]);
        const target = resolveDiskWriteBackTarget({
          path: "/game.d64",
          location: "local",
          sourceId: "src1",
        } as any);
        expect(target).toEqual({ kind: "local-tree", treeUri: "tree://source", path: "/game.d64" });
      });

      it("is unavailable for a sourceId source with no tree handle (entries-mode)", () => {
        vi.mocked(loadLocalSources).mockReturnValue([{ id: "src1" } as any]);
        const target = resolveDiskWriteBackTarget({
          path: "/game.d64",
          location: "local",
          sourceId: "src1",
        } as any);
        expect(target).toEqual({ kind: "unavailable" });
      });

      it("resolves an archive-cache target for a commoserve/archive disk", () => {
        const target = resolveDiskWriteBackTarget(buildArchiveDisk());
        expect(target).toEqual({ kind: "archive-cache", archiveRef: buildArchiveDisk().archiveRef });
      });

      it("is unavailable for an ultimate-location disk (already persistent via its own path)", () => {
        const target = resolveDiskWriteBackTarget({ path: "/game.d64", location: "ultimate" } as any);
        expect(target).toEqual({ kind: "unavailable" });
      });

      it("is unavailable with no tree handle, sourceId, or archiveRef", () => {
        vi.mocked(loadLocalSources).mockReturnValue([]);
        const target = resolveDiskWriteBackTarget({ path: "/game.d64", location: "local" } as any);
        expect(target).toEqual({ kind: "unavailable" });
      });
    });

    describe("mountDiskToDrive materialization", () => {
      it("path-mounts to an FTP-uploaded work dir instead of buffer-mounting", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        const writeBack = buildWriteBack();

        const outcome = await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local", localTreeUri: "tree://direct" } as any,
          file,
          { writeBack },
        );

        expect(writeBack.listRemoteStorageRoots).toHaveBeenCalled();
        expect(writeBack.writeRemoteFile).toHaveBeenCalledWith(
          "/Usb0/c64commander-disk-work-a.d64",
          expect.any(Uint8Array),
        );
        expect(mockApi.mountDrive).toHaveBeenCalledWith("a", "/Usb0/c64commander-disk-work-a.d64", "d64", "readwrite");
        expect(mockApi.mountDriveUpload).not.toHaveBeenCalled();
        expect(outcome).toMatchObject({
          persistence: "materialized",
          workPath: "/Usb0/c64commander-disk-work-a.d64",
        });
      });

      it("falls back to a buffer-mount when no persistent storage root is available", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        const writeBack = buildWriteBack({ listRemoteStorageRoots: vi.fn(async () => ["Temp"]) });

        const outcome = await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local", localTreeUri: "tree://direct" } as any,
          file,
          { writeBack },
        );

        expect(writeBack.writeRemoteFile).not.toHaveBeenCalled();
        expect(mockApi.mountDrive).not.toHaveBeenCalled();
        expect(mockApi.mountDriveUpload).toHaveBeenCalledWith("a", file, "d64", "readwrite", { filename: "/game.d64" });
        expect(outcome.persistence).toBe("transient");
      });

      it("falls back to a buffer-mount when persistent storage root discovery itself throws", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        const writeBack = buildWriteBack({
          listRemoteStorageRoots: vi.fn(async () => Promise.reject(new Error("FTP list failed"))),
        });

        const outcome = await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local", localTreeUri: "tree://direct" } as any,
          file,
          { writeBack },
        );

        expect(writeBack.writeRemoteFile).not.toHaveBeenCalled();
        expect(mockApi.mountDrive).not.toHaveBeenCalled();
        expect(mockApi.mountDriveUpload).toHaveBeenCalledWith("a", file, "d64", "readwrite", { filename: "/game.d64" });
        expect(outcome.persistence).toBe("transient");
        expect(addErrorLog).toHaveBeenCalledWith(
          "Disk work-dir storage root discovery failed; falling back to a transient mount",
          expect.objectContaining({ drive: "a" }),
        );
      });

      it("falls back to a buffer-mount when the FTP upload to the work dir fails", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        const writeBack = buildWriteBack({ writeRemoteFile: vi.fn(async () => Promise.reject(new Error("FTP down"))) });

        const outcome = await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local", localTreeUri: "tree://direct" } as any,
          file,
          { writeBack },
        );

        expect(mockApi.mountDrive).not.toHaveBeenCalled();
        expect(mockApi.mountDriveUpload).toHaveBeenCalled();
        expect(outcome.persistence).toBe("transient");
        expect(addErrorLog).toHaveBeenCalledWith(
          "Disk work-dir materialization failed; falling back to a transient mount",
          expect.objectContaining({ drive: "a" }),
        );
      });

      it("never calls listRemoteStorageRoots when the write-back target is unavailable", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        vi.mocked(loadLocalSources).mockReturnValue([]);
        const writeBack = buildWriteBack();

        const outcome = await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local" } as any,
          file,
          { writeBack },
        );

        expect(writeBack.listRemoteStorageRoots).not.toHaveBeenCalled();
        expect(mockApi.mountDriveUpload).toHaveBeenCalled();
        expect(outcome).toMatchObject({ persistence: "transient", writeBackTarget: { kind: "unavailable" } });
      });

      it("does not materialize a readonly mount", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        const writeBack = buildWriteBack();

        const outcome = await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local", localTreeUri: "tree://direct" } as any,
          file,
          { writeBack, mode: "readonly" },
        );

        expect(writeBack.listRemoteStorageRoots).not.toHaveBeenCalled();
        expect(mockApi.mountDriveUpload).toHaveBeenCalledWith("a", file, "d64", "readonly", { filename: "/game.d64" });
        expect(outcome.persistence).toBe("transient");
      });
    });

    describe("finalizeDiskWriteBack (eject)", () => {
      it("reports attempted:false when the drive has no materialized mount", async () => {
        const result = await finalizeDiskWriteBack("a", buildWriteBack());
        expect(result).toMatchObject({ attempted: false });
      });

      it("FTP-downloads the work-dir image back and writes it to a local-tree source", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        const writeBack = buildWriteBack({ readRemoteFile: vi.fn(async () => new Uint8Array([42, 43, 44])) });
        await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local", localTreeUri: "tree://direct" } as any,
          file,
          { writeBack },
        );

        const result = await finalizeDiskWriteBack("a", writeBack);

        expect(writeBack.readRemoteFile).toHaveBeenCalledWith("/Usb0/c64commander-disk-work-a.d64");
        expect(FolderPicker.writeFileToTree).toHaveBeenCalledWith({
          treeUri: "tree://direct",
          path: "/game.d64",
          data: btoa("*+,"), // bytes [42,43,44] -> chars "*+,"
          overwrite: true,
        });
        expect(result).toEqual({ attempted: true, success: true });

        // The entry is consumed - a second finalize on the same drive is a no-op.
        const second = await finalizeDiskWriteBack("a", writeBack);
        expect(second).toMatchObject({ attempted: false });
      });

      it("re-persists an archive/commoserve disk's changes into the in-memory disk cache", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "archive-game.d64");
        const writeBack = buildWriteBack({ readRemoteFile: vi.fn(async () => new Uint8Array([7, 7, 7])) });
        vi.mocked(loadLocalSources).mockReturnValue([]);
        const disk = buildArchiveDisk();

        await mountDiskToDrive(mockApi as any, "a", disk, file, { writeBack });
        const result = await finalizeDiskWriteBack("a", writeBack);

        // HARD19-014 (D2): archive-cache write-back offers a durable local copy.
        expect(result).toMatchObject({
          attempted: true,
          success: true,
          archiveCopyOffer: { archiveRef: disk.archiveRef, fileName: "archive-game.d64" },
        });
        const cached = getCachedArchiveDiskBlob(disk.archiveRef);
        expect(cached).toBeInstanceOf(Blob);
        expect(cached?.size).toBe(3);
      });

      it("HARD19-014 (D2): does NOT offer an archive copy for a plain local-tree write-back", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        const writeBack = buildWriteBack({ readRemoteFile: vi.fn(async () => new Uint8Array([1, 2, 3])) });
        await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local", localTreeUri: "tree://direct" } as any,
          file,
          { writeBack },
        );

        const result = await finalizeDiskWriteBack("a", writeBack);
        expect(result).toEqual({ attempted: true, success: true });
        expect((result as { archiveCopyOffer?: unknown }).archiveCopyOffer).toBeUndefined();
      });

      it("reports success:false without throwing when the FTP read-back fails", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        const writeBack = buildWriteBack();
        await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local", localTreeUri: "tree://direct" } as any,
          file,
          { writeBack },
        );

        const failingReadBack = buildWriteBack({
          readRemoteFile: vi.fn(async () => Promise.reject(new Error("FTP timeout"))),
        });
        const result = await finalizeDiskWriteBack("a", failingReadBack);

        expect(result.attempted).toBe(true);
        expect((result as { success: false; error: Error }).success).toBe(false);
        expect((result as { success: false; error: Error }).error.message).toBe("FTP timeout");
      });
    });

    describe("discardDiskWriteBack", () => {
      it("drops a pending materialized mount without any FTP round trip", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "game.d64");
        const writeBack = buildWriteBack();
        await mountDiskToDrive(
          mockApi as any,
          "a",
          { path: "/game.d64", location: "local", localTreeUri: "tree://direct" } as any,
          file,
          { writeBack },
        );

        discardDiskWriteBack("a");

        const result = await finalizeDiskWriteBack("a", writeBack);
        expect(result).toMatchObject({ attempted: false });
        expect(writeBack.readRemoteFile).not.toHaveBeenCalled();
      });
    });

    describe("saveArchiveDiskCopyToLocalFolder (HARD19-014 / D2)", () => {
      it("writes the cached archive bytes to a user-picked folder and reports the URI", async () => {
        const { archiveRef } = buildArchiveDisk();
        setCachedArchiveDiskBlob(archiveRef, new Blob([new Uint8Array([42, 43, 44])]));
        vi.mocked(FolderPicker.writeFileToTree).mockResolvedValueOnce({ uri: "tree://saved/game.d64", sizeBytes: 3 });

        const result = await saveArchiveDiskCopyToLocalFolder({ archiveRef, fileName: "game.d64" });

        expect(FolderPicker.pickDirectory).toHaveBeenCalled();
        expect(FolderPicker.writeFileToTree).toHaveBeenCalledWith({
          treeUri: "tree://picked",
          path: "game.d64",
          data: btoa("*+,"), // [42,43,44]
          overwrite: true,
        });
        expect(result).toEqual({ saved: true, uri: "tree://saved/game.d64" });
      });

      it("reports 'no-bytes' when the session cache has already dropped the disk", async () => {
        const { archiveRef } = buildArchiveDisk();
        // cache cleared in beforeEach — nothing to save
        const result = await saveArchiveDiskCopyToLocalFolder({ archiveRef, fileName: "game.d64" });
        expect(result).toEqual({ saved: false, reason: "no-bytes" });
        expect(FolderPicker.pickDirectory).not.toHaveBeenCalled();
      });

      it("reports 'cancelled' when the user dismisses the folder picker", async () => {
        const { archiveRef } = buildArchiveDisk();
        setCachedArchiveDiskBlob(archiveRef, new Blob([new Uint8Array([1])]));
        vi.mocked(FolderPicker.pickDirectory).mockResolvedValueOnce({});

        const result = await saveArchiveDiskCopyToLocalFolder({ archiveRef, fileName: "game.d64" });
        expect(result).toEqual({ saved: false, reason: "cancelled" });
        expect(FolderPicker.writeFileToTree).not.toHaveBeenCalled();
      });
    });

    describe("remounting a different disk over a materialized drive", () => {
      it("finalizes the stale entry's write-back before the new mount proceeds", async () => {
        const firstFile = new File([new Uint8Array([1, 2, 3])], "first.d64");
        const writeBack = buildWriteBack({ readRemoteFile: vi.fn(async () => new Uint8Array([5, 6, 7])) });
        await mountDiskToDrive(
          mockApi as any,
          "a",
          { id: "disk-first", path: "/first.d64", location: "local", localTreeUri: "tree://first" } as any,
          firstFile,
          { writeBack },
        );

        const secondFile = new File([new Uint8Array([4, 5, 6])], "second.d64");
        await mountDiskToDrive(
          mockApi as any,
          "a",
          { id: "disk-second", path: "/second.d64", location: "local", localTreeUri: "tree://second" } as any,
          secondFile,
          { writeBack },
        );

        expect(writeBack.readRemoteFile).toHaveBeenCalledWith("/Usb0/c64commander-disk-work-a.d64");
        expect(FolderPicker.writeFileToTree).toHaveBeenCalledWith(
          expect.objectContaining({ treeUri: "tree://first", path: "/first.d64" }),
        );
      });

      it("logs (not throws) when the stale entry's write-back fails during a remount, and the new mount still proceeds", async () => {
        const firstFile = new File([new Uint8Array([1, 2, 3])], "first.d64");
        const writeBack = buildWriteBack({
          readRemoteFile: vi.fn(async () => Promise.reject(new Error("FTP read failed"))),
        });
        await mountDiskToDrive(
          mockApi as any,
          "a",
          { id: "disk-first", path: "/first.d64", location: "local", localTreeUri: "tree://first" } as any,
          firstFile,
          { writeBack },
        );

        const secondFile = new File([new Uint8Array([4, 5, 6])], "second.d64");
        const outcome = await mountDiskToDrive(
          mockApi as any,
          "a",
          { id: "disk-second", path: "/second.d64", location: "local", localTreeUri: "tree://second" } as any,
          secondFile,
          { writeBack },
        );

        expect(addErrorLog).toHaveBeenCalledWith(
          "Disk write-back failed while remounting a different disk",
          expect.objectContaining({ drive: "a", path: "/first.d64" }),
        );
        expect(FolderPicker.writeFileToTree).not.toHaveBeenCalledWith(
          expect.objectContaining({ treeUri: "tree://first" }),
        );
        expect(outcome.persistence).toBe("materialized");
      });

      it("drops (does not misattribute) the stale entry when the new mount has no writeBack deps", async () => {
        const firstFile = new File([new Uint8Array([1, 2, 3])], "first.d64");
        const writeBack = buildWriteBack();
        await mountDiskToDrive(
          mockApi as any,
          "a",
          { id: "disk-first", path: "/first.d64", location: "local", localTreeUri: "tree://first" } as any,
          firstFile,
          { writeBack },
        );

        // Play's mountDiskToDrive call sites never pass writeBack.
        const secondFile = new File([new Uint8Array([4, 5, 6])], "second.d64");
        await mountDiskToDrive(
          mockApi as any,
          "a",
          { id: "disk-second", path: "/second.d64", location: "local" } as any,
          secondFile,
        );

        expect(writeBack.readRemoteFile).not.toHaveBeenCalled();
        // The stale entry must not still be sitting there to be misread later.
        const result = await finalizeDiskWriteBack("a", writeBack);
        expect(result).toMatchObject({ attempted: false });
      });
    });
  });
});
