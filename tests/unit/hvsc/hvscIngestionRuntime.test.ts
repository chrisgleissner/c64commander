/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Filesystem } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import {
  addHvscProgressListener,
  applyIngestionFailureAndThrow,
  applyIngestionSuccess,
  buildIngestionFailureMessage,
  cancelHvscInstall,
  checkForHvscUpdates,
  recoverStaleIngestionState,
  getHvscCacheStatus,
  getHvscFolderListing,
  getHvscSong,
  getHvscDurationByMd5Seconds,
  installOrUpdateHvsc,
  ingestCachedHvsc,
} from "@/lib/hvsc/hvscIngestionRuntime";
import { isUpdateApplied, loadHvscState, updateHvscState } from "@/lib/hvsc/hvscStateStore";
import { fetchLatestHvscVersions } from "@/lib/hvsc/hvscReleaseService";
import { getHvscDurationByMd5, getHvscSongByVirtualPath, listHvscFolder } from "@/lib/hvsc/hvscFilesystem";
import {
  deleteLibraryFile,
  resetLibraryRoot,
  resetSonglengthsCache,
  writeLibraryFile,
  readCachedArchiveMarker,
  createLibraryStagingDir,
  writeStagingFile,
  promoteLibraryStagingDir,
  cleanupStaleStagingDir,
} from "@/lib/hvsc/hvscFilesystem";
import { extractArchiveEntries } from "@/lib/hvsc/hvscArchiveExtraction";
import { addErrorLog, addLog } from "@/lib/logging";
import { getHvscSonglengthsStats, reloadHvscSonglengthsOnConfigChange } from "@/lib/hvsc/hvscSongLengthService";

const nativeProgressListenerRemove = vi.hoisted(() => vi.fn(async () => undefined));
const nativeHvscPlugin = vi.hoisted(() => ({
  ingestHvsc: vi.fn(async () => ({
    totalEntries: 1,
    songsIngested: 1,
    songsDeleted: 0,
    failedSongs: 0,
    failedPaths: [],
    songlengthFilesWritten: 0,
    metadataRows: 1,
    metadataUpserts: 1,
    metadataDeletes: 0,
    archiveBytes: 10,
  })),
  cancelIngestion: vi.fn(async () => undefined),
  addListener: vi.fn(async () => ({ remove: nativeProgressListenerRemove })),
}));

const browseIndexMutable = vi.hoisted(() => ({
  upsertSong: vi.fn(),
  deleteSong: vi.fn(),
  finalize: vi.fn(async () => undefined),
}));

if (!(vi as typeof vi & { mocked?: <T>(value: T) => T }).mocked) {
  (vi as typeof vi & { mocked: <T>(value: T) => T }).mocked = (value) => value;
}

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: {
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    downloadFile: vi.fn(),
  },
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: vi.fn(() => nativeHvscPlugin),
  Capacitor: {
    isNativePlatform: vi.fn(),
    isPluginAvailable: vi.fn(() => false),
  },
}));

vi.mock("@/lib/hvsc/hvscFilesystem", () => ({
  MAX_BRIDGE_READ_BYTES: 5 * 1024 * 1024,
  ensureHvscDirs: vi.fn(async () => undefined),
  getHvscCacheDir: vi.fn(() => "hvsc/cache"),
  listHvscFolder: vi.fn(),
  getHvscSongByVirtualPath: vi.fn(),
  getHvscDurationByMd5: vi.fn(),
  resetLibraryRoot: vi.fn(),
  writeLibraryFile: vi.fn(),
  deleteLibraryFile: vi.fn(),
  resetSonglengthsCache: vi.fn(),
  writeCachedArchive: vi.fn(),
  deleteCachedArchive: vi.fn(),
  readCachedArchiveMarker: vi.fn(async () => ({
    version: 5,
    type: "baseline",
  })),
  writeCachedArchiveMarker: vi.fn(),
  createLibraryStagingDir: vi.fn(async () => undefined),
  writeStagingFile: vi.fn(),
  promoteLibraryStagingDir: vi.fn(async () => undefined),
  cleanupStaleStagingDir: vi.fn(async () => undefined),
}));

vi.mock("@/lib/hvsc/hvscStateStore", () => ({
  loadHvscState: vi.fn(),
  markUpdateApplied: vi.fn(),
  updateHvscState: vi.fn((patch) => patch),
  isUpdateApplied: vi.fn(() => false),
}));

vi.mock("@/lib/hvsc/hvscStatusStore", () => ({
  loadHvscStatusSummary: vi.fn(() => ({
    download: { status: "idle" },
    extraction: { status: "idle" },
    lastUpdatedAt: new Date(0).toISOString(),
  })),
  saveHvscStatusSummary: vi.fn(),
  updateHvscStatusSummaryFromEvent: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscArchiveExtraction", () => ({
  extractArchiveEntries: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscSongLengthService", () => ({
  reloadHvscSonglengthsOnConfigChange: vi.fn(async () => undefined),
  getHvscSonglengthsStats: vi.fn(() => ({
    backendStats: { rejectedLines: 0 },
  })),
}));

vi.mock("@/lib/hvsc/hvscReleaseService", () => ({
  buildHvscBaselineUrl: vi.fn(),
  buildHvscUpdateUrl: vi.fn(),
  fetchLatestHvscVersions: vi.fn(),
}));

vi.mock("@/lib/sid/sidUtils", () => ({
  base64ToUint8: vi.fn(() => new Uint8Array()),
  parseSidHeaderMetadata: vi.fn(() => ({
    magicId: "PSID",
    version: 2,
    songs: 1,
    startSong: 1,
    clock: "unknown",
    sid1Model: "unknown",
    sid2Model: null,
    sid3Model: null,
    sid2Adress: null,
    sid2Address: null,
    name: "demo",
    author: "unknown",
    released: "",
    rsidValid: null,
    parserWarnings: [],
  })),
  buildSidTrackSubsongs: vi.fn(() => [{ songNr: 1, isDefault: true }]),
}));

vi.mock("@/lib/hvsc/hvscBrowseIndexStore", () => ({
  createHvscBrowseIndexMutable: vi.fn(async () => browseIndexMutable),
  clearHvscBrowseIndexSnapshot: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

describe("hvscIngestionRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ["hvsc-baseline-5.complete.json"],
    });
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: "AA==" } as any);
    vi.mocked(Filesystem.stat).mockResolvedValue({
      size: 123,
      type: "file",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    });
    vi.mocked(updateHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(readCachedArchiveMarker).mockResolvedValue({
      version: 5,
      type: "baseline",
    } as any);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(deleteLibraryFile).mockResolvedValue(undefined as any);
    if (!globalThis.crypto) {
      (globalThis as typeof globalThis & { crypto?: Crypto }).crypto = {
        randomUUID: () => "uuid",
      } as Crypto;
    }
  });

  afterEach(() => {
    // vitest environment cleanup handled by reset/restore calls above.
  });

  it("skips cached ingest when no newer archives exist", async () => {
    const events: Array<{ message?: string }> = [];
    const listener = await addHvscProgressListener((event) => {
      events.push(event);
    });

    const status = await ingestCachedHvsc("token");
    await listener.remove();

    expect(status.installedVersion).toBe(5);
    expect(events.some((event) => event.message === "No new HVSC archives to ingest")).toBe(true);
  });

  it("summarizes cached archive versions", async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: [
        "hvsc-baseline-84.complete.json",
        "hvsc-update-85.complete.json",
        { name: "hvsc-update-86.complete.json" },
      ],
    } as any);

    const status = await getHvscCacheStatus();

    expect(status.baselineVersion).toBe(84);
    expect(status.updateVersions).toEqual([85, 86]);
  });

  it("returns empty cache status when cache directory is missing", async () => {
    vi.mocked(Filesystem.readdir).mockRejectedValue(new Error("no dir"));

    const status = await getHvscCacheStatus();

    expect(status).toEqual({ baselineVersion: null, updateVersions: [] });
  });

  it("calculates required update versions", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 84,
      updateVersion: 86,
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({ installedVersion: 84 } as any);

    const result = await checkForHvscUpdates();

    expect(result.requiredUpdates).toEqual([85, 86]);
  });

  it("returns folder listings from the HVSC filesystem", async () => {
    vi.mocked(listHvscFolder).mockResolvedValue({
      path: "/ROOT",
      folders: [{ path: "/ROOT/DEMOS", name: "DEMOS" }],
      songs: [],
    } as any);

    const listing = await getHvscFolderListing("/ROOT");

    expect(listing.folders).toHaveLength(1);
  });

  it("resolves HVSC songs by virtual path", async () => {
    vi.mocked(getHvscSongByVirtualPath).mockResolvedValue({
      id: 1,
      title: "Demo",
      path: "/demo.sid",
      data: new Uint8Array([1, 2, 3]),
    } as any);

    const song = await getHvscSong({ virtualPath: "/demo.sid" });

    expect(song.title).toBe("Demo");
  });

  it("throws when HVSC song is missing", async () => {
    vi.mocked(getHvscSongByVirtualPath).mockResolvedValue(null as any);

    await expect(getHvscSong({ virtualPath: "/missing.sid" })).rejects.toThrow("Song not found");
    await expect(getHvscSong({})).rejects.toThrow("Song not found");
  });

  it("passes through duration lookups", async () => {
    vi.mocked(getHvscDurationByMd5).mockResolvedValue(120);

    await expect(getHvscDurationByMd5Seconds("abc")).resolves.toBe(120);
  });

  it("allows cancellation tokens to be reused", async () => {
    await expect(cancelHvscInstall("token-1")).resolves.toBeUndefined();
    await expect(cancelHvscInstall("token-1")).resolves.toBeUndefined();
  });

  it("installs baseline from cached archive without downloading", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({
      ingestionState: "ready",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEnumerate, onProgress, onEntry }) => {
      onEnumerate?.(3);
      onProgress?.(1, 3);
      await onEntry?.("HVSC/DELETE.TXT", new TextEncoder().encode("demo.sid\n"));
      await onEntry?.("HVSC/C64Music/songlengths.txt", new TextEncoder().encode("demo.sid=0:30"));
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    await installOrUpdateHvsc("token-install");

    expect(createLibraryStagingDir).toHaveBeenCalled();
    expect(writeStagingFile).toHaveBeenCalled();
    expect(promoteLibraryStagingDir).toHaveBeenCalled();
    expect(resetLibraryRoot).not.toHaveBeenCalled();
    expect(deleteLibraryFile).toHaveBeenCalledWith("/demo.sid");
    expect(resetSonglengthsCache).toHaveBeenCalled();
    const transitions = vi
      .mocked(addLog)
      .mock.calls.filter((call) => call[1] === "HVSC pipeline transition")
      .map((call) => (call[2] as { toState?: string })?.toState);
    expect(transitions).toEqual(["DOWNLOADING", "DOWNLOADED", "EXTRACTING", "EXTRACTED", "INGESTING", "READY"]);
    const summaryPatch = vi
      .mocked(updateHvscState)
      .mock.calls.find((call) => (call[0] as any)?.ingestionSummary)?.[0] as any;
    expect(summaryPatch?.ingestionSummary?.ingestedSongs).toBe(1);
    expect(summaryPatch?.ingestionSummary?.failedSongs).toBe(0);
    expect(browseIndexMutable.upsertSong).toHaveBeenCalled();
    expect(browseIndexMutable.finalize).toHaveBeenCalled();
  });

  it("fails ingestion when a SID cannot be written", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/ok.sid", new Uint8Array([1, 2, 3]));
      await onEntry?.("HVSC/C64Music/Demo/fail.sid", new Uint8Array([4, 5, 6]));
    });
    vi.mocked(writeStagingFile).mockImplementation(async (path: string) => {
      if (path.toLowerCase().endsWith("/demo/fail.sid")) {
        throw new Error("disk full");
      }
    });

    await expect(installOrUpdateHvsc("token-fail-write")).rejects.toThrow(/could not be ingested/i);
    const patchWithSummary = vi
      .mocked(updateHvscState)
      .mock.calls.map((call) => call[0] as any)
      .find((patch) => patch?.ingestionSummary?.failedSongs === 1);
    expect(patchWithSummary?.ingestionState).toBe("error");
    expect(patchWithSummary?.ingestionSummary?.ingestedSongs).toBe(1);
    expect(patchWithSummary?.ingestionSummary?.totalSongs).toBe(2);
  });

  it("keeps ingestion ready when only songlength syntax errors occur", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/ok.sid", new Uint8Array([1, 2, 3]));
    });
    vi.mocked(getHvscSonglengthsStats).mockReturnValue({
      backendStats: { rejectedLines: 3 },
    } as any);

    await installOrUpdateHvsc("token-syntax");

    const summaryPatch = vi
      .mocked(updateHvscState)
      .mock.calls.map((call) => call[0] as any)
      .find((patch) => patch?.ingestionSummary?.songlengthSyntaxErrors === 3);
    expect(summaryPatch?.ingestionState).toBe("ready");
    expect(summaryPatch?.ingestionSummary?.failedSongs).toBe(0);
  });

  it("fails ingestion when songlength reload fails", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/ok.sid", new Uint8Array([1, 2, 3]));
    });
    vi.mocked(reloadHvscSonglengthsOnConfigChange).mockRejectedValueOnce(new Error("reload failed"));

    await expect(installOrUpdateHvsc("token-reload-fail")).rejects.toThrow("reload failed");
  });

  it("records full deletion failure manifest and throws summarized error", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    const deletionList = Array.from({ length: 11 }, (_, index) => `demo-${index + 1}.sid`).join("\n");
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/DELETE.TXT", new TextEncoder().encode(deletionList));
    });
    vi.mocked(deleteLibraryFile).mockRejectedValue(new Error("cannot delete"));

    await expect(installOrUpdateHvsc("token-deletion-fail")).rejects.toThrow(/cleanup failed/i);
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      "HVSC deletion manifest",
      expect.objectContaining({
        failureCount: 11,
        failedPaths: expect.arrayContaining(["/demo-1.sid", "/demo-11.sid"]),
      }),
    );
  });

  it("escalates repeated cached archive stat failures to diagnostics", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ["hvsc-baseline-5.complete.json"],
    } as any);
    vi.mocked(readCachedArchiveMarker).mockResolvedValue({
      version: 5,
      type: "baseline",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    let statCall = 0;
    vi.mocked(Filesystem.stat).mockImplementation(async () => {
      statCall += 1;
      if (statCall % 2 === 0) {
        throw new Error("cache stat failed");
      }
      return { size: 123, type: "file" } as any;
    });

    await ingestCachedHvsc("token-cache-a");
    await ingestCachedHvsc("token-cache-b");

    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      "HVSC cache health degraded",
      expect.objectContaining({
        archiveName: "hvsc-baseline-5",
        failureCount: 2,
      }),
    );
    expect(nativeProgressListenerRemove).toHaveBeenCalled();
  });

  it("downloads archives via fetch when cache is missing", async () => {
    const originalEnv = process.env.VITE_ENABLE_TEST_PROBES;
    process.env.VITE_ENABLE_TEST_PROBES = "1";
    const originalFetch = globalThis.fetch;
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2]) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "2" },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "2" },
        body: { getReader: () => reader },
        arrayBuffer: async () => new Uint8Array([1, 2]).buffer,
      });

    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Filesystem.stat).mockRejectedValue(new Error("missing"));
    vi.mocked(readCachedArchiveMarker).mockResolvedValue(null as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    await installOrUpdateHvsc("token-download");

    expect(globalThis.fetch).toHaveBeenCalled();

    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
    if (originalEnv === undefined) {
      delete process.env.VITE_ENABLE_TEST_PROBES;
    } else {
      process.env.VITE_ENABLE_TEST_PROBES = originalEnv;
    }
  });

  it("emits incremental download progress during streaming fetch", async () => {
    const originalEnv = process.env.VITE_ENABLE_TEST_PROBES;
    process.env.VITE_ENABLE_TEST_PROBES = "1";
    const originalFetch = globalThis.fetch;
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2]) })
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([3, 4]) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "4" },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: () => "4" },
        body: { getReader: () => reader },
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      });

    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Filesystem.stat).mockRejectedValue(new Error("missing"));
    vi.mocked(readCachedArchiveMarker).mockResolvedValue(null as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    const progressEvents: Array<{ downloadedBytes?: number | null }> = [];
    const listener = await addHvscProgressListener((event) => {
      if (event.stage === "download") {
        progressEvents.push({ downloadedBytes: event.downloadedBytes ?? null });
      }
    });

    await installOrUpdateHvsc("token-download-progress");
    await listener.remove();

    expect(progressEvents.length).toBeGreaterThan(1);
    expect(progressEvents[0]?.downloadedBytes ?? 0).toBeLessThan(progressEvents.at(-1)?.downloadedBytes ?? 0);

    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
    if (originalEnv === undefined) {
      delete process.env.VITE_ENABLE_TEST_PROBES;
    } else {
      process.env.VITE_ENABLE_TEST_PROBES = originalEnv;
    }
  });

  it("skips install when already up to date", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);

    const status = await installOrUpdateHvsc("token-noop");

    expect(status.installedVersion).toBe(5);
  });

  it("uses native download when available", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => "1024" },
    });
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Filesystem.stat).mockRejectedValue(new Error("missing"));
    vi.mocked(readCachedArchiveMarker).mockResolvedValue(null as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    await installOrUpdateHvsc("token-native");

    expect(Filesystem.downloadFile).toHaveBeenCalled();

    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  });

  it("falls back to non-native extraction when native 7z method is unsupported", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Filesystem.stat).mockResolvedValue({ size: 123, type: "file" } as any);
    nativeHvscPlugin.ingestHvsc.mockRejectedValueOnce(
      new Error(
        "HVSC 7z method chain [3, 4, 1] is unsupported by Android native extraction; retry will use the non-native fallback extractor",
      ),
    );
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    await installOrUpdateHvsc("token-native-fallback");

    expect(nativeHvscPlugin.ingestHvsc).toHaveBeenCalled();
    expect(vi.mocked(extractArchiveEntries)).toHaveBeenCalled();
    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "warn",
      "HVSC native ingestion unsupported; falling back to non-native extractor",
      expect.objectContaining({ archiveName: "hvsc-baseline-5.7z" }),
    );
  });

  it("throws re-download message and deletes corrupt archive when native ingestHvsc returns corrupt error", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Filesystem.stat).mockResolvedValue({ size: 123, type: "file" } as any);
    nativeHvscPlugin.ingestHvsc.mockRejectedValueOnce(
      new Error("HVSC archive is corrupt or truncated; please re-download"),
    );

    const { deleteCachedArchive } = await import("@/lib/hvsc/hvscFilesystem");

    await expect(installOrUpdateHvsc("token-corrupt")).rejects.toThrow(/corrupt or truncated.*re-download/i);
    expect(vi.mocked(deleteCachedArchive)).toHaveBeenCalledWith("hvsc-baseline-5.7z");
  });

  it("treats raw 'offset bytes must be larger/equal zero' IOException as corrupt archive error", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Filesystem.stat).mockResolvedValue({ size: 123, type: "file" } as any);
    nativeHvscPlugin.ingestHvsc.mockRejectedValueOnce(new Error("offset bytes must be larger equal zero"));

    const { deleteCachedArchive } = await import("@/lib/hvsc/hvscFilesystem");

    await expect(installOrUpdateHvsc("token-offset-bytes")).rejects.toThrow(/corrupt or truncated.*re-download/i);
    expect(vi.mocked(deleteCachedArchive)).toHaveBeenCalledWith("hvsc-baseline-5.7z");
  });

  it("deletes corrupt cached archive during ingestCachedHvsc and rethrows", async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ["hvsc-baseline-5.complete.json"],
    } as any);
    vi.mocked(readCachedArchiveMarker).mockResolvedValue({
      version: 5,
      type: "baseline",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(Filesystem.stat).mockResolvedValue({ size: 123, type: "file" } as any);
    nativeHvscPlugin.ingestHvsc.mockRejectedValueOnce(
      new Error("HVSC archive is corrupt or truncated; please re-download"),
    );

    const { deleteCachedArchive } = await import("@/lib/hvsc/hvscFilesystem");
    vi.mocked(deleteCachedArchive).mockClear();

    await expect(ingestCachedHvsc("token-corrupt-cached")).rejects.toThrow();
    expect(vi.mocked(deleteCachedArchive)).toHaveBeenCalledWith(expect.stringContaining("hvsc-baseline-5"));
  });

  it("rejects cached ingest when baseline is missing", async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);

    await expect(ingestCachedHvsc("token-missing")).rejects.toThrow("No cached HVSC archives available");
  });

  it("ingests cached baseline and updates", async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ["hvsc-baseline-5.complete.json", "hvsc-update-6.complete.json"],
    } as any);
    vi.mocked(readCachedArchiveMarker).mockResolvedValue({
      version: 5,
      type: "baseline",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/DELETE.TXT", new TextEncoder().encode("demo.sid\n"));
      await onEntry?.("HVSC/C64Music/songlengths.txt", new TextEncoder().encode("demo.sid=0:30"));
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    await ingestCachedHvsc("token-cached");

    expect(writeLibraryFile).toHaveBeenCalled();
    expect(deleteLibraryFile).toHaveBeenCalledWith("/demo.sid");
  });

  it("skips applied updates during cached ingest", async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ["hvsc-baseline-5.complete.json", "hvsc-update-6.complete.json"],
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(isUpdateApplied).mockReturnValue(true);

    await ingestCachedHvsc("token-skip");

    expect(extractArchiveEntries).not.toHaveBeenCalled();
  });

  it("rejects cached ingest when installed but no cached baseline and no updates", async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({ files: [] } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);

    await expect(ingestCachedHvsc("token-no-cache-no-updates")).rejects.toThrow("No cached HVSC archives available");
  });

  it("recovers stale ingestion state on cold start", async () => {
    const { loadHvscStatusSummary, saveHvscStatusSummary } = await import("@/lib/hvsc/hvscStatusStore");
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "installing",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(loadHvscStatusSummary as any).mockReturnValue({
      download: { status: "in-progress" },
      extraction: { status: "in-progress" },
      lastUpdatedAt: new Date(0).toISOString(),
    });

    const recovered = recoverStaleIngestionState();

    expect(recovered).toBe(true);
    expect(updateHvscState).toHaveBeenCalledWith(expect.objectContaining({ ingestionState: "error" }));
    expect(vi.mocked(saveHvscStatusSummary as any)).toHaveBeenCalled();
  });

  it("returns false when stale recovery is not needed", () => {
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);

    expect(recoverStaleIngestionState()).toBe(false);
  });

  it("logs warning when native cancellation fails", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    nativeHvscPlugin.cancelIngestion.mockRejectedValueOnce(new Error("cancel failed"));

    await cancelHvscInstall("token-cancel-fail");

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Failed to cancel native HVSC ingestion",
      expect.objectContaining({ token: "token-cancel-fail" }),
    );
  });

  it("reports isIngestionRuntimeActive as false when idle", async () => {
    const { isIngestionRuntimeActive } = await import("@/lib/hvsc/hvscIngestionRuntime");
    expect(isIngestionRuntimeActive()).toBe(false);
  });

  it("getHvscStatus returns current state", async () => {
    const { getHvscStatus } = await import("@/lib/hvsc/hvscIngestionRuntime");
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "ready",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);

    const status = await getHvscStatus();
    expect(status.ingestionState).toBe("ready");
  });

  it("rejects concurrent installOrUpdateHvsc calls", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    const first = installOrUpdateHvsc("token-concurrent-1");
    await expect(installOrUpdateHvsc("token-concurrent-2")).rejects.toThrow("already running");
    await first;
  });

  it("rejects concurrent ingestCachedHvsc calls", async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ["hvsc-baseline-5.complete.json"],
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    const first = ingestCachedHvsc("token-cached-concurrent-1");
    await expect(ingestCachedHvsc("token-cached-concurrent-2")).rejects.toThrow("already running");
    await first;
  });

  it("checkForHvscUpdates returns empty updates when already up to date", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);

    const result = await checkForHvscUpdates();
    expect(result.requiredUpdates).toEqual([]);
    expect(result.latestVersion).toBe(5);
  });

  it("checkForHvscUpdates returns baseline + update range for fresh install", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 84,
      updateVersion: 87,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);

    const result = await checkForHvscUpdates();
    expect(result.requiredUpdates).toEqual([85, 86, 87]);
    expect(result.baselineVersion).toBe(84);
  });

  it("marks update as failed when installOrUpdateHvsc error occurs during update phase", async () => {
    const { markUpdateApplied } = await import("@/lib/hvsc/hvscStateStore");
    vi.mocked(isUpdateApplied).mockReturnValue(false);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 6,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(readCachedArchiveMarker).mockResolvedValue({
      version: 6,
      type: "update",
    } as any);
    vi.mocked(extractArchiveEntries).mockRejectedValue(new Error("extraction exploded"));

    await expect(installOrUpdateHvsc("token-update-fail")).rejects.toThrow("extraction exploded");
    expect(markUpdateApplied).toHaveBeenCalledWith(6, "failed", "extraction exploded");
  });

  it("resolves cached ingest when baseline newer than installed and updates available", async () => {
    vi.mocked(isUpdateApplied).mockReturnValue(false);
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ["hvsc-baseline-84.complete.json", "hvsc-update-85.complete.json"],
    } as any);
    vi.mocked(readCachedArchiveMarker).mockResolvedValue({
      version: 85,
      type: "update",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 84,
      installedBaselineVersion: 84,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    await ingestCachedHvsc("token-update-cached");
    expect(writeLibraryFile).toHaveBeenCalled();
  });

  it("handles canUseNativeHvscIngestion when Capacitor throws", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockImplementation(() => {
      throw new Error("Capacitor not ready");
    });
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    await installOrUpdateHvsc("token-capacitor-error");

    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Failed to probe HvscIngestion native plugin",
      expect.objectContaining({ error: "Capacitor not ready" }),
    );
  });

  it("cacheStatus handles mixed file name formats in readdir", async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: [
        "hvsc-baseline-84.complete.json",
        { name: "hvsc-update-85.complete.json" },
        "random-file.txt",
        { name: "another-random" },
      ],
    } as any);

    const status = await getHvscCacheStatus();
    expect(status.baselineVersion).toBe(84);
    expect(status.updateVersions).toEqual([85]);
  });

  it("recovers stale ingestion state with updating status", async () => {
    const { loadHvscStatusSummary, saveHvscStatusSummary } = await import("@/lib/hvsc/hvscStatusStore");
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "updating",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(loadHvscStatusSummary as any).mockReturnValue({
      download: { status: "completed" },
      extraction: { status: "in-progress" },
      lastUpdatedAt: new Date(0).toISOString(),
    });

    const recovered = recoverStaleIngestionState();

    expect(recovered).toBe(true);
    expect(updateHvscState).toHaveBeenCalledWith(expect.objectContaining({ ingestionState: "error" }));
    expect(vi.mocked(saveHvscStatusSummary as any)).toHaveBeenCalled();
  });

  it("keeps installOrUpdateHvsc in cancelled idle state when cancellation wins", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async () => {
      await cancelHvscInstall("token-cancel-install");
      throw new Error("HVSC update cancelled");
    });

    await expect(installOrUpdateHvsc("token-cancel-install")).rejects.toThrow("HVSC update cancelled");

    const statePatches = vi.mocked(updateHvscState).mock.calls.map(([patch]) => patch as Record<string, unknown>);
    expect(
      statePatches.some(
        (patch) => patch.ingestionState === "error" && patch.ingestionError === "HVSC update cancelled",
      ),
    ).toBe(false);
    expect(statePatches).toContainEqual(
      expect.objectContaining({ ingestionState: "idle", ingestionError: "Cancelled" }),
    );
  });

  it("keeps ingestCachedHvsc in cancelled idle state when cancellation wins", async () => {
    vi.mocked(Filesystem.readdir).mockResolvedValue({
      files: ["hvsc-baseline-5.complete.json"],
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async () => {
      await cancelHvscInstall("token-cancel-cached");
      throw new Error("HVSC update cancelled");
    });

    await expect(ingestCachedHvsc("token-cancel-cached")).rejects.toThrow("HVSC update cancelled");

    const statePatches = vi.mocked(updateHvscState).mock.calls.map(([patch]) => patch as Record<string, unknown>);
    expect(
      statePatches.some(
        (patch) => patch.ingestionState === "error" && patch.ingestionError === "HVSC update cancelled",
      ),
    ).toBe(false);
    expect(statePatches).toContainEqual(
      expect.objectContaining({ ingestionState: "idle", ingestionError: "Cancelled" }),
    );
  });

  // Coverage: checkForHvscUpdates returns [] when already up-to-date (BRDA:212 empty array branch)
  it("returns empty requiredUpdates when already at latest version", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 84,
      updateVersion: 86,
    } as any);
    // installedVersion === updateVersion → neither condition is true → []
    vi.mocked(updateHvscState).mockReturnValue({ installedVersion: 86 } as any);

    const result = await checkForHvscUpdates();

    expect(result.requiredUpdates).toEqual([]);
  });

  // Coverage: formatPathListPreview with ≤10 paths (BRDA:154 FALSE branch — plain preview without "+N more")
  it("formats deletion failure preview without truncation for few paths", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    // Only 3 deletion failures — formatPathListPreview called with paths.length <= previewLimit (10)
    const deletionList = ["demo-1.sid", "demo-2.sid", "demo-3.sid"].join("\n");
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/DELETE.TXT", new TextEncoder().encode(deletionList));
    });
    vi.mocked(deleteLibraryFile).mockRejectedValue(new Error("cannot delete"));

    await expect(installOrUpdateHvsc("token-short-deletion")).rejects.toThrow(/cleanup failed/i);
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      "HVSC deletion manifest",
      expect.objectContaining({ failureCount: 3 }),
    );
  });

  // Coverage: recoverStaleIngestionState returns false when activeIngestionRunning (BRDA:170 TRUE)
  it("recoverStaleIngestionState returns false when ingestion is active", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({
      ingestionState: "ready",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    // installOrUpdateHvsc sets activeIngestionRunning=true synchronously before first await
    const ingestionPromise = installOrUpdateHvsc("token-for-recovery-check");

    // At this point, activeIngestionRunning is true — recoverStaleIngestionState should return false
    const recovered = recoverStaleIngestionState();
    expect(recovered).toBe(false);

    // Complete the ingestion
    await ingestionPromise.catch(() => undefined);
  });

  it("installs baseline via native Android ingestion plugin when available", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({
      ingestionState: "ready",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    nativeHvscPlugin.addListener.mockImplementationOnce(
      async (_event: string, callback: (event: Record<string, unknown>) => void) => {
        callback({
          stage: "archive_extraction",
          message: "Extracting archive…",
          currentFile: "test.sid",
          processedCount: 50,
          totalCount: 100,
          percent: 50,
          songsUpserted: 50,
          songsDeleted: 0,
        });
        return { remove: nativeProgressListenerRemove };
      },
    );

    const status = await installOrUpdateHvsc("token-native-baseline");

    expect(nativeHvscPlugin.ingestHvsc).toHaveBeenCalledWith(
      expect.objectContaining({
        relativeArchivePath: expect.stringContaining("hvsc-baseline-5"),
        mode: "baseline",
        resetLibrary: true,
      }),
    );
    expect(nativeProgressListenerRemove).toHaveBeenCalled();
    expect(status).toBeDefined();
  });

  it("ingests cached baseline via native Android ingestion plugin when available", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({
      ingestionState: "ready",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);

    const status = await ingestCachedHvsc("token-native-cached");

    expect(nativeHvscPlugin.ingestHvsc).toHaveBeenCalledWith(
      expect.objectContaining({
        relativeArchivePath: expect.stringContaining("hvsc-baseline-5"),
        mode: "baseline",
        resetLibrary: true,
      }),
    );
    expect(nativeProgressListenerRemove).toHaveBeenCalled();
    expect(status).toBeDefined();
  });

  it("falls back to non-native extractor when native ingest throws 7z method unsupported error", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({
      ingestionState: "ready",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    nativeHvscPlugin.ingestHvsc.mockRejectedValueOnce(new Error("7z method chain [AES256+LZMA2] unsupported"));
    vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
      await onEntry?.("HVSC/C64Music/Demo/demo.sid", new Uint8Array([1, 2, 3]));
    });

    await installOrUpdateHvsc("token-native-fallback");

    expect(extractArchiveEntries).toHaveBeenCalled();
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      expect.stringContaining("falling back"),
      expect.objectContaining({ archiveName: expect.any(String) }),
    );
  });

  it("applies native update ingestion and marks the update as applied", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 6,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 5,
      installedBaselineVersion: 5,
    } as any);
    vi.mocked(updateHvscState).mockReturnValue({
      ingestionState: "ready",
      ingestionError: null,
      installedVersion: 6,
      installedBaselineVersion: 5,
    } as any);

    const status = await installOrUpdateHvsc("token-native-update");

    expect(nativeHvscPlugin.ingestHvsc).toHaveBeenCalledWith(
      expect.objectContaining({
        relativeArchivePath: expect.stringContaining("hvsc-update-6"),
        mode: "update",
        resetLibrary: false,
      }),
    );
    expect(status).toBeDefined();
  });

  it("native ingest with failed songs calls applyIngestionFailureAndThrow and throws", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 5,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(loadHvscState).mockReturnValue({
      ingestionState: "idle",
      ingestionError: null,
      installedVersion: 0,
      installedBaselineVersion: null,
    } as any);
    nativeHvscPlugin.ingestHvsc.mockResolvedValueOnce({
      totalEntries: 100,
      songsIngested: 98,
      songsDeleted: 0,
      failedSongs: 2,
      failedPaths: ["bad1.sid", "bad2.sid"],
      songlengthFilesWritten: 0,
      metadataRows: 100,
      metadataUpserts: 98,
      metadataDeletes: 0,
      archiveBytes: 10,
    });

    await expect(installOrUpdateHvsc("token-native-failed-songs")).rejects.toThrow(/2 of 100/);
    expect(vi.mocked(updateHvscState)).toHaveBeenCalledWith(
      expect.objectContaining({
        ingestionState: "error",
        ingestionError: expect.stringMatching(/2 of 100/),
      }),
    );
  });

  it("skips already-applied update plans during installOrUpdateHvsc", async () => {
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue({
      baselineVersion: 5,
      updateVersion: 6,
      baseUrl: "https://example.com",
    } as any);
    vi.mocked(isUpdateApplied).mockReturnValue(true);

    const status = await installOrUpdateHvsc("token-skip-applied-update");

    expect(status.installedVersion).toBe(5);
    expect(nativeHvscPlugin.ingestHvsc).not.toHaveBeenCalled();
    expect(vi.mocked(extractArchiveEntries)).not.toHaveBeenCalled();
  });
});

// P0-E: shared ingestion helper functions have identical state contract at facade boundary
describe("ingestion shared helpers (P0-E)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(updateHvscState).mockReturnValue({} as any);
    vi.mocked(getHvscSonglengthsStats).mockReturnValue({
      backendStats: { rejectedLines: 0 },
    } as any);
  });

  it("buildIngestionFailureMessage formats message with count and path preview", () => {
    const msg = buildIngestionFailureMessage(3, 100, ["a.sid", "b.sid", "c.sid"]);
    expect(msg).toMatch(/3 of 100/);
    expect(msg).toMatch(/a\.sid/);
    expect(msg).toMatch(/b\.sid/);
  });

  it("buildIngestionFailureMessage emits readable placeholder when failedPaths is empty", () => {
    const msg = buildIngestionFailureMessage(5, 100, []);
    expect(msg).toMatch(/5 of 100/);
    expect(msg).toContain("no paths reported");
    expect(msg).not.toContain("()");
  });

  it("buildIngestionFailureMessage truncates path list to 10 entries", () => {
    const paths = Array.from({ length: 15 }, (_, i) => `track${i}.sid`);
    const msg = buildIngestionFailureMessage(15, 200, paths);
    expect(msg).not.toContain("track10.sid");
    expect(msg).toContain("track9.sid");
  });

  it("applyIngestionSuccess calls updateHvscState with ingestionState ready", () => {
    applyIngestionSuccess({
      plan: { type: "update", version: 84 },
      baselineInstalled: 74,
      archiveName: "HVSC_Update_84.7z",
      totalSongs: 100,
      ingestedSongs: 100,
      failedSongs: 0,
      failedPaths: [],
    });
    expect(vi.mocked(updateHvscState)).toHaveBeenCalledWith(
      expect.objectContaining({
        ingestionState: "ready",
        ingestionError: null,
        installedVersion: 84,
        installedBaselineVersion: 74,
      }),
    );
  });

  it("applyIngestionFailureAndThrow calls updateHvscState with ingestionState error and throws", () => {
    expect(() =>
      applyIngestionFailureAndThrow({
        archiveName: "HVSC_Update_84.7z",
        totalSongs: 100,
        ingestedSongs: 80,
        failedSongs: 20,
        failedPaths: ["bad.sid"],
      }),
    ).toThrow(/20 of 100/);
    expect(vi.mocked(updateHvscState)).toHaveBeenCalledWith(
      expect.objectContaining({
        ingestionState: "error",
        ingestionError: expect.stringMatching(/20 of 100/),
      }),
    );
  });
});
