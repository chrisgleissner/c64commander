/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const nativeMock = vi.hoisted(() => ({
  downloadArchive: vi.fn(),
  addDownloadProgressListener: vi.fn(),
}));

vi.mock("@/lib/native/hvscIngestion", () => ({ HvscIngestion: nativeMock }));

const addLogMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/logging", () => ({ addLog: addLogMock, addErrorLog: vi.fn() }));

import {
  downloadArchiveWithResume,
  isPluginMethodUnimplemented,
  resetResumableDownloadSupportForTests,
} from "@/lib/hvsc/hvscResumableDownload";

const baseOptions = {
  relativeArchivePath: "hvsc/cache/HVSC_85.zip",
  archiveName: "HVSC_85.zip",
  downloadUrl: "https://example.test/HVSC_85.zip",
  expectedTotalBytes: 1_000,
  onProgress: () => {},
};

describe("hvscResumableDownload", () => {
  let removeListener: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    resetResumableDownloadSupportForTests();
    removeListener = vi.fn(async () => undefined);
    nativeMock.addDownloadProgressListener.mockResolvedValue({ remove: removeListener });
  });

  describe("isPluginMethodUnimplemented", () => {
    it("recognises the Capacitor UNIMPLEMENTED code", () => {
      expect(isPluginMethodUnimplemented(Object.assign(new Error("nope"), { code: "UNIMPLEMENTED" }))).toBe(true);
    });

    it("recognises the not-implemented message the web bridge produces", () => {
      expect(isPluginMethodUnimplemented(new Error("downloadArchive is not implemented on web"))).toBe(true);
    });

    it("recognises a proxy that does not define the method at all", () => {
      expect(isPluginMethodUnimplemented(new TypeError("plugin.downloadArchive is not a function"))).toBe(true);
    });

    it("does not treat a real transport failure as unimplemented", () => {
      expect(isPluginMethodUnimplemented(new Error("HVSC download failed: HTTP 503 Service Unavailable"))).toBe(false);
    });
  });

  it("passes the archive path, url and expected size to the native downloader", async () => {
    nativeMock.downloadArchive.mockResolvedValue({ totalBytes: 1_000, resumedFromBytes: 400, transferredBytes: 600 });

    const result = await downloadArchiveWithResume(baseOptions);

    expect(nativeMock.downloadArchive).toHaveBeenCalledWith({
      relativeArchivePath: "hvsc/cache/HVSC_85.zip",
      url: "https://example.test/HVSC_85.zip",
      expectedTotalBytes: 1_000,
    });
    expect(result).toEqual({ totalBytes: 1_000, resumedFromBytes: 400, transferredBytes: 600 });
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("omits an unknown expected size rather than sending zero", async () => {
    nativeMock.downloadArchive.mockResolvedValue({ totalBytes: 1_000, resumedFromBytes: 0, transferredBytes: 1_000 });

    await downloadArchiveWithResume({ ...baseOptions, expectedTotalBytes: null });

    expect(nativeMock.downloadArchive).toHaveBeenCalledWith({
      relativeArchivePath: "hvsc/cache/HVSC_85.zip",
      url: "https://example.test/HVSC_85.zip",
    });
  });

  it("forwards native progress for this archive and ignores progress for another one", async () => {
    const samples: Array<[number, number | null]> = [];
    nativeMock.downloadArchive.mockImplementation(async () => {
      const listener = nativeMock.addDownloadProgressListener.mock.calls[0][0] as (event: unknown) => void;
      listener({ relativeArchivePath: "hvsc/cache/HVSC_85.zip", downloadedBytes: 400, totalBytes: 1_000 });
      listener({ relativeArchivePath: "hvsc/cache/other.zip", downloadedBytes: 999, totalBytes: 999 });
      listener({ relativeArchivePath: "hvsc/cache/HVSC_85.zip", downloadedBytes: 1_000, totalBytes: 0 });
      return { totalBytes: 1_000, resumedFromBytes: 0, transferredBytes: 1_000 };
    });

    await downloadArchiveWithResume({
      ...baseOptions,
      onProgress: (downloadedBytes, totalBytes) => samples.push([downloadedBytes, totalBytes]),
    });

    expect(samples).toEqual([
      [400, 1_000],
      [1_000, null],
    ]);
  });

  it("returns null so the caller falls back when the platform has no such method", async () => {
    nativeMock.downloadArchive.mockRejectedValue(Object.assign(new Error("nope"), { code: "UNIMPLEMENTED" }));

    await expect(downloadArchiveWithResume(baseOptions)).resolves.toBeNull();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("stops calling the native method once it has answered unimplemented", async () => {
    nativeMock.downloadArchive.mockRejectedValue(Object.assign(new Error("nope"), { code: "UNIMPLEMENTED" }));
    await downloadArchiveWithResume(baseOptions);
    nativeMock.downloadArchive.mockClear();

    await expect(downloadArchiveWithResume(baseOptions)).resolves.toBeNull();
    expect(nativeMock.downloadArchive).not.toHaveBeenCalled();
  });

  it("propagates a real download failure instead of silently falling back", async () => {
    nativeMock.downloadArchive.mockRejectedValue(new Error("HVSC download is incomplete: 25000 of 81000 bytes"));

    await expect(downloadArchiveWithResume(baseOptions)).rejects.toThrow("HVSC download is incomplete");
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it("still downloads when the progress listener cannot be attached", async () => {
    nativeMock.addDownloadProgressListener.mockRejectedValue(new Error("listener registration failed"));
    nativeMock.downloadArchive.mockResolvedValue({ totalBytes: 1_000, resumedFromBytes: 0, transferredBytes: 1_000 });

    await expect(downloadArchiveWithResume(baseOptions)).resolves.toEqual({
      totalBytes: 1_000,
      resumedFromBytes: 0,
      transferredBytes: 1_000,
    });
  });

  // The listener is removed in a finally, so a remove that rejects would otherwise become an
  // unhandled rejection on the way out of an otherwise successful download.
  it("logs a listener that cannot be removed rather than failing the download", async () => {
    removeListener.mockRejectedValue(new Error("listener already gone"));
    nativeMock.downloadArchive.mockResolvedValue({ totalBytes: 1_000, resumedFromBytes: 0, transferredBytes: 1_000 });

    await expect(downloadArchiveWithResume(baseOptions)).resolves.toEqual({
      totalBytes: 1_000,
      resumedFromBytes: 0,
      transferredBytes: 1_000,
    });

    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Failed to remove the HVSC resumable download progress listener",
      expect.objectContaining({ archiveName: "HVSC_85.zip" }),
    );
  });
});
