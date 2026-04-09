/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    isPluginAvailable: vi.fn(() => false),
  },
  registerPlugin: vi.fn(() => ({
    ingestHvsc: vi.fn(),
    cancelIngestion: vi.fn(),
    getIngestionStats: vi.fn(),
    readArchiveChunk: vi.fn(),
    addListener: vi.fn(async () => ({
      remove: vi.fn(async () => undefined),
    })),
  })),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    stat: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    downloadFile: vi.fn(),
  },
}));

vi.mock("@/lib/hvsc/hvscFilesystem", () => ({
  MAX_BRIDGE_READ_BYTES: 5 * 1024 * 1024,
  getHvscCacheDir: vi.fn(() => "hvsc/cache"),
  writeCachedArchive: vi.fn(async () => undefined),
  deleteCachedArchive: vi.fn(async () => undefined),
  writeCachedArchiveMarker: vi.fn(async () => undefined),
  readCachedArchiveMarker: vi.fn(async () => null),
  createLibraryStagingDir: vi.fn(async () => undefined),
  writeStagingFile: vi.fn(),
  promoteLibraryStagingDir: vi.fn(async () => undefined),
  cleanupStaleStagingDir: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/sid/sidUtils", () => ({
  base64ToUint8: vi.fn((str: string) => new TextEncoder().encode(atob(str))),
}));

import {
  getErrorMessage,
  isExistsError,
  shouldUseNativeDownload,
  normalizeEntryName,
  normalizeVirtualPath,
  normalizeLibraryPath,
  normalizeUpdateVirtualPath,
  normalizeUpdateLibraryPath,
  isDeletionList,
  parseDeletionList,
  concatChunks,
  parseContentLength,
  fetchContentLength,
  emitDownloadProgress,
  ensureNotCancelledWith,
  downloadArchive,
  readArchiveBuffer,
  resolveCachedArchive,
  getCacheStatusInternal,
  computeArchiveChecksumMd5,
} from "@/lib/hvsc/hvscDownload";
import { Filesystem } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";

import { addLog } from "@/lib/logging";
import { HvscIngestion } from "@/lib/native/hvscIngestion";

describe("hvscDownload", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
    delete process.env.VITE_ENABLE_TEST_PROBES;
  });

  it("returns false when native platform detection throws", () => {
    vi.mocked(Capacitor.isNativePlatform).mockImplementation(() => {
      throw new Error("native probe failed");
    });

    expect(shouldUseNativeDownload()).toBe(false);
    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "warn",
      "Failed to detect native platform for HVSC download",
      expect.objectContaining({ error: "native probe failed" }),
    );
  });

  it("logs when content length fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));

    const length = await fetchContentLength("http://example.com/archive.7z");

    expect(length).toBeNull();
    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "warn",
      "Failed to read HVSC content length",
      expect.objectContaining({
        url: "http://example.com/archive.7z",
      }),
    );
  });

  // ── getErrorMessage ──

  describe("getErrorMessage", () => {
    it("extracts string errors", () => {
      expect(getErrorMessage("boom")).toBe("boom");
    });

    it("extracts message from Error objects", () => {
      expect(getErrorMessage(new Error("fail"))).toBe("fail");
    });

    it("extracts nested error.error.message", () => {
      expect(getErrorMessage({ error: { message: "nested" } })).toBe("nested");
    });

    it("extracts error.error as string", () => {
      expect(getErrorMessage({ error: "flat-nested" })).toBe("flat-nested");
    });

    it("stringifies null/undefined", () => {
      expect(getErrorMessage(null)).toBe("");
      expect(getErrorMessage(undefined)).toBe("");
    });

    it("stringifies number errors", () => {
      expect(getErrorMessage(42)).toBe("42");
    });
  });

  // ── isExistsError ──

  describe("isExistsError", () => {
    it('detects "already exists" errors', () => {
      expect(isExistsError(new Error("File already exists"))).toBe(true);
    });

    it('detects "exists" errors', () => {
      expect(isExistsError("Path exists")).toBe(true);
    });

    it("rejects unrelated errors", () => {
      expect(isExistsError(new Error("permission denied"))).toBe(false);
    });
  });

  // ── normalizeEntryName ──

  describe("normalizeEntryName", () => {
    it("replaces backslashes with forward slashes", () => {
      expect(normalizeEntryName("HVSC\\DEMOS\\test.sid")).toBe("HVSC/DEMOS/test.sid");
    });

    it("strips leading slashes", () => {
      expect(normalizeEntryName("///HVSC/test.sid")).toBe("HVSC/test.sid");
    });
  });

  // ── normalizeVirtualPath ──

  describe("normalizeVirtualPath", () => {
    it("strips HVSC/ prefix and adds leading slash for .sid", () => {
      expect(normalizeVirtualPath("HVSC/DEMOS/test.sid")).toBe("/DEMOS/test.sid");
    });

    it("strips C64Music/ prefix", () => {
      expect(normalizeVirtualPath("C64Music/MUSICIANS/Rob_Hubbard/Commando.sid")).toBe(
        "/MUSICIANS/Rob_Hubbard/Commando.sid",
      );
    });

    it("returns null for non-.sid entries", () => {
      expect(normalizeVirtualPath("HVSC/DOCUMENTS/readme.txt")).toBeNull();
    });

    it("handles backslashes", () => {
      expect(normalizeVirtualPath("HVSC\\DEMOS\\test.sid")).toBe("/DEMOS/test.sid");
    });
  });

  // ── normalizeLibraryPath ──

  describe("normalizeLibraryPath", () => {
    it("normalizes HVSC library path for .sid files", () => {
      expect(normalizeLibraryPath("HVSC/DEMOS/test.sid")).toBe("/DEMOS/test.sid");
    });

    it("normalizes non-.sid entries too", () => {
      expect(normalizeLibraryPath("HVSC/DOCUMENTS/Songlengths.md5")).toBe("/DOCUMENTS/Songlengths.md5");
    });

    it("returns null for empty path after stripping", () => {
      expect(normalizeLibraryPath("HVSC/")).toBeNull();
    });
  });

  // ── normalizeUpdateVirtualPath ──

  describe("normalizeUpdateVirtualPath", () => {
    it("strips new/ prefix from update entries", () => {
      expect(normalizeUpdateVirtualPath("new/DEMOS/test.sid")).toBe("/DEMOS/test.sid");
    });

    it("strips update/ prefix", () => {
      expect(normalizeUpdateVirtualPath("update/MUSICIANS/test.sid")).toBe("/MUSICIANS/test.sid");
    });

    it("strips updated/ prefix", () => {
      expect(normalizeUpdateVirtualPath("updated/DEMOS/test.sid")).toBe("/DEMOS/test.sid");
    });

    it("strips HVSC/ then new/ prefix", () => {
      expect(normalizeUpdateVirtualPath("HVSC/new/DEMOS/test.sid")).toBe("/DEMOS/test.sid");
    });

    it("returns null for non-.sid", () => {
      expect(normalizeUpdateVirtualPath("new/DOCUMENTS/readme.txt")).toBeNull();
    });
  });

  // ── normalizeUpdateLibraryPath ──

  describe("normalizeUpdateLibraryPath", () => {
    it("strips new/ prefix for library paths", () => {
      expect(normalizeUpdateLibraryPath("new/DOCUMENTS/Songlengths.md5")).toBe("/DOCUMENTS/Songlengths.md5");
    });

    it("strips update/ prefix for library paths", () => {
      expect(normalizeUpdateLibraryPath("update/DOCUMENTS/Songlengths.md5")).toBe("/DOCUMENTS/Songlengths.md5");
    });

    it("strips updated/ prefix for library paths (BRDA:226)", () => {
      expect(normalizeUpdateLibraryPath("updated/DOCUMENTS/Songlengths.md5")).toBe("/DOCUMENTS/Songlengths.md5");
    });
  });

  // ── isDeletionList ──

  describe("isDeletionList", () => {
    it("detects deletion list files", () => {
      expect(isDeletionList("delete_files.txt")).toBe(true);
      expect(isDeletionList("REMOVE_LIST.txt")).toBe(true);
    });

    it("rejects non-deletion files", () => {
      expect(isDeletionList("songlengths.md5")).toBe(false);
      expect(isDeletionList("readme.txt")).toBe(false);
    });

    it("rejects non-.txt extension", () => {
      expect(isDeletionList("deleted_songs.sid")).toBe(false);
    });
  });

  // ── parseDeletionList ──

  describe("parseDeletionList", () => {
    it("parses newline-separated .sid paths", () => {
      const input = "DEMOS/foo.sid\nMUSICIANS/bar.sid\n";
      expect(parseDeletionList(input)).toEqual(["/DEMOS/foo.sid", "/MUSICIANS/bar.sid"]);
    });

    it("adds leading slash if missing", () => {
      expect(parseDeletionList("test.sid")).toEqual(["/test.sid"]);
    });

    it("preserves existing leading slash", () => {
      expect(parseDeletionList("/test.sid")).toEqual(["/test.sid"]);
    });

    it("filters out non-.sid lines", () => {
      expect(parseDeletionList("readme.txt\ntest.sid")).toEqual(["/test.sid"]);
    });

    it("handles CRLF", () => {
      expect(parseDeletionList("a.sid\r\nb.sid")).toEqual(["/a.sid", "/b.sid"]);
    });

    it("ignores blank lines", () => {
      expect(parseDeletionList("\n\ntest.sid\n\n")).toEqual(["/test.sid"]);
    });
  });

  // ── concatChunks ──

  describe("concatChunks", () => {
    it("concatenates chunks into single buffer", () => {
      const a = new Uint8Array([1, 2]);
      const b = new Uint8Array([3, 4, 5]);
      const result = concatChunks([a, b]);
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
      expect(result.length).toBe(5);
    });

    it("uses totalLength when provided", () => {
      const a = new Uint8Array([1, 2]);
      const result = concatChunks([a], 5);
      expect(result.length).toBe(5);
      expect(result[0]).toBe(1);
      expect(result[1]).toBe(2);
    });

    it("handles empty array", () => {
      expect(concatChunks([])).toEqual(new Uint8Array([]));
    });
  });

  // ── parseContentLength ──

  describe("parseContentLength", () => {
    it("parses valid content-length", () => {
      expect(parseContentLength("12345")).toBe(12345);
    });

    it("returns null for null input", () => {
      expect(parseContentLength(null)).toBeNull();
    });

    it("returns null for non-finite values", () => {
      expect(parseContentLength("NaN")).toBeNull();
      expect(parseContentLength("Infinity")).toBeNull();
    });

    it("returns null for zero or negative", () => {
      expect(parseContentLength("0")).toBeNull();
      expect(parseContentLength("-1")).toBeNull();
    });
  });

  // ── emitDownloadProgress ──

  describe("emitDownloadProgress", () => {
    it("emits download progress with percent", () => {
      const emitProgress = vi.fn();
      emitDownloadProgress(emitProgress, "test.7z", 50, 100);
      expect(emitProgress).toHaveBeenCalledWith({
        stage: "download",
        message: "Downloading test.7z…",
        archiveName: "test.7z",
        downloadedBytes: 50,
        totalBytes: 100,
        percent: 50,
      });
    });

    it("emits without percent when totalBytes is null", () => {
      const emitProgress = vi.fn();
      emitDownloadProgress(emitProgress, "test.7z", 50, null);
      expect(emitProgress).toHaveBeenCalledWith({
        stage: "download",
        message: "Downloading test.7z…",
        archiveName: "test.7z",
        downloadedBytes: 50,
        totalBytes: undefined,
        percent: undefined,
      });
    });

    it("emits with undefined downloadedBytes when null (BRDA:261,263)", () => {
      const emitProgress = vi.fn();
      emitDownloadProgress(emitProgress, "test.7z", null, 100);
      expect(emitProgress).toHaveBeenCalledWith({
        stage: "download",
        message: "Downloading test.7z…",
        archiveName: "test.7z",
        downloadedBytes: undefined,
        totalBytes: 100,
        percent: 0,
      });
    });
  });

  // ── ensureNotCancelledWith ──

  describe("ensureNotCancelledWith", () => {
    it("does nothing when token is not cancelled", () => {
      const tokens = new Map([["t1", { cancelled: false }]]);
      expect(() => ensureNotCancelledWith(tokens, "t1")).not.toThrow();
    });

    it("throws when token is cancelled", () => {
      const tokens = new Map([["t1", { cancelled: true }]]);
      expect(() => ensureNotCancelledWith(tokens, "t1")).toThrow("HVSC update cancelled");
    });

    it("calls stateUpdater when token is cancelled", () => {
      const tokens = new Map([["t1", { cancelled: true }]]);
      const updater = vi.fn();
      expect(() => ensureNotCancelledWith(tokens, "t1", updater)).toThrow();
      expect(updater).toHaveBeenCalledWith({
        ingestionState: "idle",
        ingestionError: "Cancelled",
      });
    });

    it("does nothing when token is undefined", () => {
      const tokens = new Map<string, { cancelled: boolean }>();
      expect(() => ensureNotCancelledWith(tokens, undefined)).not.toThrow();
    });
  });

  // ── downloadArchive ──

  describe("readArchiveBuffer", () => {
    it("decodes archive base64 payload through guarded chunked decode", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({ size: 4 } as any);
      vi.mocked(Filesystem.readFile).mockResolvedValue({
        data: "AQIDBA==",
      } as any);

      const decoded = await readArchiveBuffer("hvsc-baseline-84.7z");

      expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it("proceeds when stat.size is undefined (BRDA:333)", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({} as any);
      vi.mocked(Filesystem.readFile).mockResolvedValue({
        data: "AQIDBA==",
      } as any);
      const decoded = await readArchiveBuffer("hvsc-baseline-84.7z");
      expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it("allows large non-native archive reads through the dedicated HVSC path", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({
        size: 10 * 1024 * 1024,
      } as any);
      vi.mocked(Filesystem.readFile).mockResolvedValue({
        data: "AQIDBA==",
      } as any);

      const decoded = await readArchiveBuffer("hvsc-baseline-84.7z");

      expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4]));
      expect(Filesystem.readFile).toHaveBeenCalled();
    });

    it("continues when stat throws during size check (BRDA:334)", async () => {
      vi.mocked(Filesystem.stat).mockRejectedValue(new Error("stat failed"));
      vi.mocked(Filesystem.readFile).mockResolvedValue({
        data: "AQIDBA==",
      } as any);
      const decoded = await readArchiveBuffer("hvsc-baseline-84.7z");
      expect(decoded).toEqual(new Uint8Array([1, 2, 3, 4]));
    });

    it("decodes empty base64 string returning empty Uint8Array (BRDA:107)", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({ size: 0 } as any);
      vi.mocked(Filesystem.readFile).mockResolvedValue({ data: "" } as any);
      const decoded = await readArchiveBuffer("hvsc-baseline-84.7z");
      expect(decoded).toEqual(new Uint8Array(0));
    });

    it("keeps hvsc-baseline-84.7z off the guarded whole-file bridge read by assembling native chunks on Android", async () => {
      const firstChunk = new Uint8Array(3 * 1024 * 1024).fill(1);
      const secondChunk = new Uint8Array(3 * 1024 * 1024).fill(2);

      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Filesystem.stat).mockResolvedValue({ size: firstChunk.byteLength + secondChunk.byteLength } as any);
      vi.spyOn(HvscIngestion, "readArchiveChunk")
        .mockResolvedValueOnce({
          data: Buffer.from(firstChunk).toString("base64"),
          sizeBytes: firstChunk.byteLength,
          eof: false,
        })
        .mockResolvedValueOnce({
          data: Buffer.from(secondChunk).toString("base64"),
          sizeBytes: secondChunk.byteLength,
          eof: true,
        });

      const decoded = await readArchiveBuffer("hvsc-baseline-84.7z");

      expect(decoded).toHaveLength(firstChunk.byteLength + secondChunk.byteLength);
      expect(decoded[0]).toBe(1);
      expect(decoded[firstChunk.byteLength - 1]).toBe(1);
      expect(decoded[firstChunk.byteLength]).toBe(2);
      expect(decoded[decoded.length - 1]).toBe(2);
      expect(HvscIngestion.readArchiveChunk).toHaveBeenCalledTimes(2);
      expect(Filesystem.readFile).not.toHaveBeenCalled();
    });

    it("fails loudly when hvsc-baseline-84.7z native chunk reads stop before the full archive length", async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Filesystem.stat).mockResolvedValue({ size: 6 * 1024 * 1024 } as any);
      vi.spyOn(HvscIngestion, "readArchiveChunk").mockResolvedValue({
        data: "AQID",
        sizeBytes: 3,
        eof: true,
      });

      await expect(readArchiveBuffer("hvsc-baseline-84.7z")).rejects.toThrow("HVSC native chunk read incomplete");
    });
  });

  describe("resolveCachedArchive", () => {
    it("returns null when stat finds file type but marker is null (BRDA:279,281)", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({ type: "file" } as any);
      const result = await resolveCachedArchive("hvsc-baseline", 84);
      expect(result).toBeNull();
    });

    it("returns null when all stat calls throw", async () => {
      vi.mocked(Filesystem.stat).mockRejectedValue(new Error("not found"));
      const result = await resolveCachedArchive("hvsc-baseline", 84);
      expect(result).toBeNull();
    });

    it("returns name when stat finds directory type and marker is set (BRDA:279)", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({
        type: "directory",
        size: 1234,
      } as any);
      const { readCachedArchiveMarker } = await import("@/lib/hvsc/hvscFilesystem");
      vi.mocked(readCachedArchiveMarker).mockResolvedValue({
        version: 84,
        sizeBytes: 1234,
      } as any);
      const result = await resolveCachedArchive("hvsc-baseline", 84);
      expect(result).toBe("hvsc-baseline-84");
    });

    it("deletes cached archives when the marker size no longer matches the file size", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({
        type: "file",
        size: 512,
      } as any);
      const { readCachedArchiveMarker, deleteCachedArchive } = await import("@/lib/hvsc/hvscFilesystem");
      vi.mocked(readCachedArchiveMarker).mockResolvedValue({
        version: 84,
        sizeBytes: 1024,
      } as any);

      const result = await resolveCachedArchive("hvsc-baseline", 84);

      expect(result).toBeNull();
      expect(vi.mocked(deleteCachedArchive)).toHaveBeenCalledWith("hvsc-baseline-84");
    });

    it("deletes cached archives when the marker checksum no longer matches the file bytes", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({
        type: "file",
        size: 3,
      } as any);
      vi.mocked(Filesystem.readFile).mockResolvedValue({
        data: Buffer.from(new Uint8Array([1, 2, 3])).toString("base64"),
      } as any);
      const { readCachedArchiveMarker, deleteCachedArchive } = await import("@/lib/hvsc/hvscFilesystem");
      vi.mocked(readCachedArchiveMarker).mockResolvedValue({
        version: 84,
        sizeBytes: 3,
        checksumMd5: "wrong-checksum",
      } as any);

      const result = await resolveCachedArchive("hvsc-baseline", 84);

      expect(result).toBeNull();
      expect(vi.mocked(deleteCachedArchive)).toHaveBeenCalledWith("hvsc-baseline-84");
    });

    it("deletes cached archives when file size is below 99% of expected size", async () => {
      vi.mocked(Filesystem.stat).mockResolvedValue({
        type: "file",
        size: 50000,
      } as any);
      const { readCachedArchiveMarker, deleteCachedArchive } = await import("@/lib/hvsc/hvscFilesystem");
      vi.mocked(readCachedArchiveMarker).mockResolvedValue({
        version: 84,
        sizeBytes: 50000,
        expectedSizeBytes: 1000000,
      } as any);

      const result = await resolveCachedArchive("hvsc-baseline", 84);

      expect(result).toBeNull();
      expect(vi.mocked(deleteCachedArchive)).toHaveBeenCalledWith("hvsc-baseline-84");
    });
  });

  describe("getCacheStatusInternal", () => {
    it("parses baseline and update versions from readdir (BRDA:299,307)", async () => {
      vi.mocked(Filesystem.readdir).mockResolvedValue({
        files: ["hvsc-baseline-84.complete.json", "hvsc-update-85.complete.json"],
      } as any);
      const status = await getCacheStatusInternal();
      expect(status.baselineVersion).toBe(84);
      expect(status.updateVersions).toEqual([85]);
    });

    it("returns empty status when readdir throws", async () => {
      vi.mocked(Filesystem.readdir).mockRejectedValue(new Error("no dir"));
      const status = await getCacheStatusInternal();
      expect(status.baselineVersion).toBeNull();
      expect(status.updateVersions).toEqual([]);
    });

    it("handles object entries with undefined name (BRDA:307)", async () => {
      vi.mocked(Filesystem.readdir).mockResolvedValue({
        files: [{ name: "hvsc-baseline-84.complete.json" }, { name: undefined }],
      } as any);
      const status = await getCacheStatusInternal();
      expect(status.baselineVersion).toBe(84);
    });

    it("handles files undefined in readdir result (BRDA:299)", async () => {
      vi.mocked(Filesystem.readdir).mockResolvedValue({} as any);
      const status = await getCacheStatusInternal();
      expect(status.baselineVersion).toBeNull();
    });
  });

  describe("downloadArchive", () => {
    const makeOptions = (overrides: Partial<Parameters<typeof downloadArchive>[0]> = {}) => ({
      plan: { type: "baseline" as const, version: 84 },
      archiveName: "hvsc-baseline-84.7z",
      archivePath: "hvsc-baseline-84.7z",
      downloadUrl: "https://example.com/hvsc.7z",
      cancelToken: "token-1",
      cancelTokens: new Map([["token-1", { cancelled: false }]]),
      emitProgress: vi.fn(),
      ...overrides,
    });

    beforeEach(() => {
      vi.clearAllMocks();
      globalThis.fetch = vi.fn();
    });

    it("streams download progress and writes archive", async () => {
      const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5, 6])];
      let index = 0;
      vi.mocked(Filesystem.stat).mockResolvedValue({ size: 6 } as any);
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        headers: { get: () => "6" },
        body: {
          getReader: () => ({
            read: async () => {
              if (index >= chunks.length) return { done: true, value: undefined };
              const value = chunks[index];
              index += 1;
              return { done: false, value };
            },
          }),
        },
      });

      const options = makeOptions();
      const inMemory = await downloadArchive(options);

      const { writeCachedArchive, writeCachedArchiveMarker } = await import("@/lib/hvsc/hvscFilesystem");
      expect(writeCachedArchive).toHaveBeenCalledWith("hvsc-baseline-84.7z", expect.any(Uint8Array));
      expect(writeCachedArchiveMarker).toHaveBeenCalledWith(
        "hvsc-baseline-84.7z",
        expect.objectContaining({
          version: 84,
          type: "baseline",
          expectedSizeBytes: 6,
          checksumMd5: computeArchiveChecksumMd5(new Uint8Array([1, 2, 3, 4, 5, 6])),
          sourceUrl: "https://example.com/hvsc.7z",
        }),
      );
      const progressStages = (options.emitProgress as any).mock.calls.map((call: any[]) => call[0]?.stage);
      expect(progressStages).toContain("download");
      expect(inMemory).toBeNull();
    });

    it("retains in-memory buffer when requested", async () => {
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        headers: { get: () => "2" },
        body: null,
        arrayBuffer: async () => new Uint8Array([7, 8]).buffer,
      });

      const buffer = await downloadArchive(makeOptions({ retainInMemoryBuffer: true }));

      expect(buffer).toEqual(new Uint8Array([7, 8]));
    });

    it("throws on content-length mismatch (streaming)", async () => {
      let readCalls = 0;
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        headers: { get: () => "5" },
        body: {
          getReader: () => ({
            read: async () => {
              readCalls += 1;
              if (readCalls === 1) return { done: false, value: new Uint8Array([1, 2]) };
              return { done: true, value: undefined };
            },
          }),
        },
      });

      await expect(downloadArchive(makeOptions())).rejects.toThrow("Download size mismatch");
    });

    it("throws on content-length mismatch (buffered)", async () => {
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        headers: { get: () => "4" },
        body: null,
        arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
      });

      await expect(downloadArchive(makeOptions())).rejects.toThrow("Download size mismatch");
    });

    it("cancels mid-download when token flips", async () => {
      const tokens = new Map([["token-1", { cancelled: false }]]);
      let index = 0;
      (globalThis.fetch as any).mockResolvedValue({
        ok: true,
        headers: { get: () => "4" },
        body: {
          getReader: () => ({
            read: async () => {
              if (index === 0) {
                index += 1;
                return { done: false, value: new Uint8Array([1, 2]) };
              }
              tokens.get("token-1")!.cancelled = true;
              return { done: false, value: new Uint8Array([3, 4]) };
            },
          }),
        },
      });

      await expect(downloadArchive(makeOptions({ cancelTokens: tokens }))).rejects.toThrow("HVSC update cancelled");
    });

    it("allows large non-native downloads when the content length exceeds MAX_BRIDGE_READ_BYTES", async () => {
      const payloadSize = 5 * 1024 * 1024 + 1;
      const payload = new Uint8Array(payloadSize).fill(7);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === "content-length" ? String(payloadSize) : null) },
        body: null,
        arrayBuffer: async () => payload.buffer,
      });

      const result = await downloadArchive(makeOptions({ retainInMemoryBuffer: true }));

      expect(result).toBeInstanceOf(Uint8Array);
      expect(result.byteLength).toBe(payloadSize);
      expect(result[0]).toBe(7);
      expect(result[result.length - 1]).toBe(7);
      expect(Filesystem.downloadFile).not.toHaveBeenCalled();
    });

    it("propagates HTTP errors", async () => {
      (globalThis.fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server error",
        headers: { get: () => null },
      });

      await expect(downloadArchive(makeOptions())).rejects.toThrow("Download failed: 500 Server error");
    });

    it("native download: throws corrupt-archive when written size is far below content-length hint", async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === "content-length" ? "1000000" : null) },
      });
      vi.mocked(Filesystem.downloadFile).mockResolvedValue({} as any);
      vi.mocked(Filesystem.stat).mockResolvedValue({ size: 50000, type: "file" } as any);

      const { deleteCachedArchive } = await import("@/lib/hvsc/hvscFilesystem");

      await expect(downloadArchive(makeOptions())).rejects.toThrow("HVSC archive is corrupt or truncated");
      expect(vi.mocked(deleteCachedArchive)).toHaveBeenCalledWith("hvsc-baseline-84.7z");
    });

    it("native download: passes when written size meets 99% threshold", async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: (name: string) => (name === "content-length" ? "1000000" : null) },
      });
      vi.mocked(Filesystem.downloadFile).mockResolvedValue({} as any);
      // 990001 bytes is just above 99% of 1,000,000
      vi.mocked(Filesystem.stat).mockResolvedValue({ size: 990001, type: "file" } as any);

      const result = await downloadArchive(makeOptions());
      expect(result).toBeNull();
    });

    it("native download: skips size check when no Content-Length header", async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
      });
      vi.mocked(Filesystem.downloadFile).mockResolvedValue({} as any);
      // Very small stat — but no hint to compare against, so no error
      vi.mocked(Filesystem.stat).mockResolvedValue({ size: 100, type: "file" } as any);

      const result = await downloadArchive(makeOptions());
      expect(result).toBeNull();
    });

    it("streams download without Content-Length using dynamic growing buffer", async () => {
      const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])];
      let index = 0;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => {
              if (index >= chunks.length) return { done: true, value: undefined };
              const value = chunks[index];
              index += 1;
              return { done: false, value };
            },
          }),
        },
      });

      const { writeCachedArchive } = await import("@/lib/hvsc/hvscFilesystem");
      const result = await downloadArchive(makeOptions());
      expect(writeCachedArchive).toHaveBeenCalledWith("hvsc-baseline-84.7z", expect.any(Uint8Array));
      expect(result).toBeNull();
    });

    it("streams download with null chunk value skipped in dynamic buffer mode", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: { get: () => null },
        body: {
          getReader: () => ({
            read: async () => {
              callCount += 1;
              if (callCount === 1) return { done: false, value: null };
              if (callCount === 2) return { done: false, value: new Uint8Array([7, 8]) };
              return { done: true, value: undefined };
            },
          }),
        },
      });

      const { writeCachedArchive } = await import("@/lib/hvsc/hvscFilesystem");
      await downloadArchive(makeOptions());
      expect(writeCachedArchive).toHaveBeenCalledWith("hvsc-baseline-84.7z", expect.objectContaining({ length: 2 }));
    });
  });
});
