/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const nativePlugin = vi.hoisted(() => ({
  ingestHvsc: vi.fn(),
  cancelIngestion: vi.fn(),
  getIngestionStats: vi.fn(),
  getStorageBudget: vi.fn(),
  readArchiveChunk: vi.fn(),
  downloadArchive: vi.fn(),
  addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => true),
    isPluginAvailable: vi.fn(() => true),
  },
  registerPlugin: vi.fn(() => nativePlugin),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    stat: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    downloadFile: vi.fn(),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  },
}));

vi.mock("@/lib/hvsc/hvscFilesystem", () => ({
  MAX_BRIDGE_READ_BYTES: 5 * 1024 * 1024,
  getHvscCacheDir: vi.fn(() => "hvsc/cache"),
  writeCachedArchive: vi.fn(async () => undefined),
  deleteCachedArchive: vi.fn(async () => undefined),
  deleteCachedArchivePart: vi.fn(async () => undefined),
  writeCachedArchiveMarker: vi.fn(async () => undefined),
  readCachedArchiveMarker: vi.fn(async () => null),
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

vi.mock("@/lib/sid/sidUtils", () => ({
  base64ToUint8: vi.fn(() => new Uint8Array()),
}));

import { downloadArchive, __resetNativeDownloadStateForTests } from "@/lib/hvsc/hvscDownload";
import { resetResumableDownloadSupportForTests } from "@/lib/hvsc/hvscResumableDownload";
import { deleteCachedArchivePart } from "@/lib/hvsc/hvscFilesystem";
import { Filesystem } from "@capacitor/filesystem";

const ARCHIVE_BYTES = 81_000;

const makeOptions = (emitProgress = vi.fn()) => ({
  plan: { type: "baseline" as const, version: 85 },
  archiveName: "hvsc-baseline-85.7z",
  archivePath: "hvsc-baseline-85.7z",
  downloadUrl: "https://example.com/hvsc-baseline-85.7z",
  cancelToken: "token-1",
  cancelTokens: new Map([["token-1", { cancelled: false }]]),
  emitProgress,
});

/**
 * The Android install path. `Filesystem.downloadFile` truncates its destination, so a download it
 * has started cannot be continued; these cases pin the resumable native method in its place and
 * pin the fallback that keeps iOS and the web working. See HARD27-028.
 */
describe("downloadArchive on the native path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetNativeDownloadStateForTests();
    resetResumableDownloadSupportForTests();
    delete process.env.VITE_ENABLE_TEST_PROBES;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (name: string) => (name === "content-length" ? String(ARCHIVE_BYTES) : null) },
    }) as unknown as typeof fetch;
    vi.mocked(Filesystem.stat).mockResolvedValue({ size: ARCHIVE_BYTES, type: "file" } as never);
    nativePlugin.addListener.mockResolvedValue({ remove: vi.fn(async () => undefined) });
  });

  it("downloads through the resumable native method rather than the truncating plugin download", async () => {
    nativePlugin.downloadArchive.mockResolvedValue({
      totalBytes: ARCHIVE_BYTES,
      resumedFromBytes: 0,
      transferredBytes: ARCHIVE_BYTES,
    });

    await downloadArchive(makeOptions());

    expect(nativePlugin.downloadArchive).toHaveBeenCalledWith(
      expect.objectContaining({
        relativeArchivePath: "hvsc/cache/hvsc-baseline-85.7z",
        url: "https://example.com/hvsc-baseline-85.7z",
        expectedTotalBytes: ARCHIVE_BYTES,
      }),
    );
    expect(Filesystem.downloadFile).not.toHaveBeenCalled();
  });

  it("continues an interrupted transfer and reports progress against the whole archive", async () => {
    const emitProgress = vi.fn();
    nativePlugin.downloadArchive.mockImplementation(async () => {
      const listener = nativePlugin.addListener.mock.calls.at(-1)?.[1] as (event: unknown) => void;
      listener({
        relativeArchivePath: "hvsc/cache/hvsc-baseline-85.7z",
        downloadedBytes: 60_000,
        totalBytes: ARCHIVE_BYTES,
      });
      return { totalBytes: ARCHIVE_BYTES, resumedFromBytes: 55_000, transferredBytes: 26_000 };
    });

    await downloadArchive(makeOptions(emitProgress));

    expect(nativePlugin.addListener).toHaveBeenCalledWith("hvscDownloadProgress", expect.any(Function));
    expect(emitProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "download",
        downloadedBytes: 60_000,
        totalBytes: ARCHIVE_BYTES,
        percent: 74,
      }),
    );
  });

  it("removes the resume sidecar once the archive is on disk", async () => {
    nativePlugin.downloadArchive.mockResolvedValue({
      totalBytes: ARCHIVE_BYTES,
      resumedFromBytes: 0,
      transferredBytes: ARCHIVE_BYTES,
    });

    await downloadArchive(makeOptions());

    expect(deleteCachedArchivePart).toHaveBeenCalledWith("hvsc-baseline-85.7z");
  });

  it("falls back to the whole-file plugin download where the native method is unimplemented", async () => {
    nativePlugin.downloadArchive.mockRejectedValue(
      Object.assign(new Error("not implemented on ios"), { code: "UNIMPLEMENTED" }),
    );
    vi.mocked(Filesystem.downloadFile).mockResolvedValue({} as never);

    await downloadArchive(makeOptions());

    expect(Filesystem.downloadFile).toHaveBeenCalledTimes(1);
  });

  it("surfaces a real download failure instead of restarting through the fallback", async () => {
    nativePlugin.downloadArchive.mockRejectedValue(
      new Error("HVSC download is incomplete: 25000 of 81000 bytes; a retry will resume"),
    );

    await expect(downloadArchive(makeOptions())).rejects.toThrow("a retry will resume");
    expect(Filesystem.downloadFile).not.toHaveBeenCalled();
  });
});
