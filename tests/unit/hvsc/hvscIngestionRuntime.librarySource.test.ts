/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { Filesystem } from "@capacitor/filesystem";
import { extractArchiveEntries } from "@/lib/hvsc/hvscArchiveExtraction";
import { createLibraryStagingDir, readCachedArchiveMarker, resetLibraryRoot } from "@/lib/hvsc/hvscFilesystem";
import { checkForHvscUpdates, installOrUpdateHvsc, resetHvscLibraryData } from "@/lib/hvsc/hvscIngestionRuntime";
import {
  getHvscIngestionRuntimeState,
  isIngestionRuntimeActive,
  subscribeIngestionRuntimeIdle,
} from "@/lib/hvsc/hvscIngestionRuntimeSupport";
import { fetchLatestHvscVersions } from "@/lib/hvsc/hvscReleaseService";
import { loadHvscState, saveHvscState, type HvscState } from "@/lib/hvsc/hvscStateStore";
import { addLog } from "@/lib/logging";
import { notifyHvscDemoLibraryRemoved } from "@/lib/hvsc/hvscDemoLibraryCleanup";
import { removeDemoTunesFromPlaylist } from "@/lib/hvsc/hvscDemoPlaylistCleanup";
import { getMd548PathIndexStats, rebuildMd548PathIndex, resetMd548PathIndex } from "@/lib/sidRadio/md5PathIndex";

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Filesystem: { readdir: vi.fn(), readFile: vi.fn(), stat: vi.fn(), downloadFile: vi.fn() },
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: vi.fn(() => ({
    ingestHvsc: vi.fn(),
    cancelIngestion: vi.fn(async () => undefined),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
  })),
  Capacitor: { isNativePlatform: vi.fn(() => false), isPluginAvailable: vi.fn(() => false) },
}));

vi.mock("@/lib/hvsc/hvscFilesystem", () => ({
  MAX_BRIDGE_READ_BYTES: 5 * 1024 * 1024,
  ensureHvscDirs: vi.fn(async () => undefined),
  getHvscCacheDir: vi.fn(() => "hvsc/cache"),
  listHvscFolder: vi.fn(),
  getHvscSongByVirtualPath: vi.fn(),
  getHvscDurationByMd5: vi.fn(),
  resetLibraryRoot: vi.fn(async () => undefined),
  writeLibraryFile: vi.fn(),
  deleteLibraryFile: vi.fn(),
  resetSonglengthsCache: vi.fn(),
  writeCachedArchive: vi.fn(),
  deleteCachedArchive: vi.fn(),
  deleteCachedArchivePart: vi.fn(async () => undefined),
  readCachedArchiveMarker: vi.fn(),
  writeCachedArchiveMarker: vi.fn(),
  createLibraryStagingDir: vi.fn(async () => undefined),
  writeStagingFile: vi.fn(),
  promoteLibraryStagingDir: vi.fn(async () => undefined),
  cleanupStaleStagingDir: vi.fn(async () => undefined),
  resetHvscCache: vi.fn(async () => undefined),
  resetStilStore: vi.fn(async () => undefined),
  writeStilFile: vi.fn(async () => undefined),
  readStilFile: vi.fn(async () => null),
}));

vi.mock("@/lib/hvsc/hvscInstallGuard", () => ({
  beginHvscInstallGuard: vi.fn(async () => undefined),
  endHvscInstallGuard: vi.fn(async () => undefined),
}));

vi.mock("@/lib/hvsc/hvscArchiveExtraction", () => ({ extractArchiveEntries: vi.fn() }));

vi.mock("@/lib/hvsc/hvscSongLengthService", () => ({
  reloadHvscSonglengthsOnConfigChange: vi.fn(async () => undefined),
  getHvscSonglengthsStats: vi.fn(() => ({ backendStats: { rejectedLines: 0 } })),
}));

vi.mock("@/lib/hvsc/hvscReleaseService", () => ({
  buildHvscBaselineUrl: vi.fn(),
  buildHvscUpdateUrl: vi.fn(),
  fetchLatestHvscVersions: vi.fn(),
}));

vi.mock("@/lib/sid/sidUtils", () => ({
  buildSidTrackSubsongs: vi.fn(() => null),
  parseSidHeaderMetadata: vi.fn(() => null),
}));

vi.mock("@/lib/hvsc/hvscBrowseIndexStore", () => ({
  clearHvscBrowseIndexSnapshot: vi.fn(async () => undefined),
  createHvscBrowseIndexMutable: vi.fn(async () => ({
    upsertSong: vi.fn(),
    deleteSong: vi.fn(),
    finalize: vi.fn(async () => undefined),
  })),
}));

vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));

vi.mock("@/lib/hvsc/hvscDemoPlaylistCleanup", () => ({ removeDemoTunesFromPlaylist: vi.fn(async () => 1) }));
vi.mock("@/lib/hvsc/hvscDemoLibraryCleanup", () => ({ notifyHvscDemoLibraryRemoved: vi.fn() }));

const DEMO_BASE_URL = "http://127.0.0.1:41955/hvsc/per-boot-token/";
const REAL_BASE_URL = "https://hvsc.example.test/HVSC/";

const storeState = (patch: Partial<HvscState>) => saveHvscState({ ...loadHvscState(), ...patch });

/** A cached baseline archive holding one tune, so an install runs without a download. */
const serveCachedBaseline = (version: number) => {
  vi.mocked(readCachedArchiveMarker).mockResolvedValue({ version, type: "baseline" } as never);
  vi.mocked(extractArchiveEntries).mockImplementation(async ({ onEntry }) => {
    await onEntry?.("HVSC/C64Music/MUSICIANS/Demo/tune.sid", new Uint8Array([1, 2, 3]));
  });
};

const release = (version: number, simulated: boolean) => ({
  baselineVersion: version,
  updateVersion: version,
  baseUrl: simulated ? DEMO_BASE_URL : REAL_BASE_URL,
  simulated,
});

describe("hvscIngestionRuntime library source", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetMd548PathIndex();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Filesystem.stat).mockResolvedValue({ size: 123, type: "file" } as never);
    vi.mocked(Filesystem.readFile).mockResolvedValue({ data: "AA==" } as never);
    const runtimeState = getHvscIngestionRuntimeState();
    runtimeState.activeIngestionRunning = false;
    runtimeState.cancelTokens.clear();
  });

  it("records an install completed from Demo Mode's simulated release as demo-sourced", async () => {
    serveCachedBaseline(84);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue(release(84, true));

    await installOrUpdateHvsc("token-demo");

    expect(loadHvscState()).toMatchObject({ installedVersion: 84, ingestionState: "ready", librarySource: "demo" });
  });

  it("records an install completed from a real release as real", async () => {
    serveCachedBaseline(83);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue(release(83, false));

    await installOrUpdateHvsc("token-real");

    expect(loadHvscState()).toMatchObject({ installedVersion: 83, ingestionState: "ready", librarySource: "real" });
  });

  it("never replaces an installed real library from Demo Mode's simulated release", async () => {
    storeState({ installedVersion: 83, installedBaselineVersion: 83, ingestionState: "ready" });
    serveCachedBaseline(84);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue(release(84, true));

    await installOrUpdateHvsc("token-demo");

    expect(extractArchiveEntries).not.toHaveBeenCalled();
    expect(createLibraryStagingDir).not.toHaveBeenCalled();
    expect(resetLibraryRoot).not.toHaveBeenCalled();
    expect(loadHvscState()).toMatchObject({ installedVersion: 83, ingestionState: "ready", librarySource: "real" });
    expect(addLog).toHaveBeenCalledWith(
      "info",
      "HVSC install skipped: Demo Mode never replaces a real library",
      expect.objectContaining({ baseUrl: DEMO_BASE_URL }),
    );
  });

  it("reports no update from Demo Mode's simulated release to an older real library", async () => {
    storeState({ installedVersion: 83, installedBaselineVersion: 83, ingestionState: "ready" });
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue(release(84, true));

    const status = await checkForHvscUpdates();

    expect(status).toMatchObject({ installedVersion: 83, requiredUpdates: [] });
  });

  it("removes Demo Mode's library before installing a real release in its place", async () => {
    storeState({ installedVersion: 84, installedBaselineVersion: 84, ingestionState: "ready", librarySource: "demo" });
    serveCachedBaseline(83);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue(release(83, false));

    await installOrUpdateHvsc("token-real");

    expect(resetLibraryRoot).toHaveBeenCalledTimes(1);
    expect(loadHvscState()).toMatchObject({ installedVersion: 83, ingestionState: "ready", librarySource: "real" });
    // Its tunes went with it: a Demo Mode tune left in recently played answered "Song not found" when tapped.
    expect(removeDemoTunesFromPlaylist).toHaveBeenCalledTimes(1);
    expect(notifyHvscDemoLibraryRemoved).toHaveBeenCalledTimes(1);
  });

  it("installs the real release even when Demo Mode's tunes cannot be removed from the playlist", async () => {
    storeState({ installedVersion: 84, installedBaselineVersion: 84, ingestionState: "ready", librarySource: "demo" });
    serveCachedBaseline(83);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue(release(83, false));
    vi.mocked(removeDemoTunesFromPlaylist).mockRejectedValueOnce("playlist store unavailable");

    await installOrUpdateHvsc("token-real");

    expect(loadHvscState()).toMatchObject({ installedVersion: 83, ingestionState: "ready", librarySource: "real" });
    expect(addLog).toHaveBeenCalledWith("warn", "Could not remove Demo Mode's tunes after replacing its HVSC library", {
      error: "playlist store unavailable",
    });
  });

  it("empties the SID Radio md5 index when the library is reset", async () => {
    rebuildMd548PathIndex(["; /MUSICIANS/Demo/tune.sid", "0123456789abcdef0123456789abcdef=0:30"].join("\n"));
    expect(getMd548PathIndexStats().size).toBe(1);
    storeState({ installedVersion: 84, librarySource: "demo" });

    await resetHvscLibraryData();

    expect(getMd548PathIndexStats().size).toBe(0);
    expect(loadHvscState()).toMatchObject({ installedVersion: 0, librarySource: "real" });
  });

  it("tells idle subscribers once an install has finished and the runtime is idle", async () => {
    serveCachedBaseline(84);
    vi.mocked(fetchLatestHvscVersions).mockResolvedValue(release(84, true));
    const idleStates: boolean[] = [];
    const unsubscribe = subscribeIngestionRuntimeIdle(() => idleStates.push(isIngestionRuntimeActive()));

    await installOrUpdateHvsc("token-demo");
    unsubscribe();

    expect(idleStates).toEqual([false]);
  });
});
