/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist the mock object so it can be used in the mock factory
const mocks = vi.hoisted(() => ({
  mockIndex: {
    load: vi.fn(),
    loadBrowseSnapshot: vi.fn().mockResolvedValue({
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      songs: {},
      folders: { "/": { path: "/", folders: [], songs: [] } },
    }),
    clearBrowseSnapshot: vi.fn(),
    getAll: vi.fn().mockReturnValue([]),
    scan: vi.fn(),
    queryFolderPage: vi.fn().mockReturnValue({
      path: "/HVSC",
      folders: [],
      songs: [],
      totalFolders: 0,
      totalSongs: 0,
      offset: 0,
      limit: 200,
      query: "",
    }),
    querySongsRecursive: vi.fn().mockReturnValue(null),
  },
}));

import * as hvscService from "@/lib/hvsc/hvscService";
import { Capacitor } from "@capacitor/core";
import * as runtime from "@/lib/hvsc/hvscIngestionRuntime";

// Mocks
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    isPluginAvailable: vi.fn(),
  },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock("@/lib/hvsc/hvscIngestionRuntime", () => ({
  addHvscProgressListener: vi.fn(),
  cancelHvscInstall: vi.fn(),
  checkForHvscUpdates: vi.fn(),
  getHvscCacheStatus: vi.fn(),
  getHvscDurationByMd5Seconds: vi.fn(),
  getHvscFolderListing: vi.fn(),
  getHvscSong: vi.fn(),
  getHvscStatus: vi.fn(),
  ingestCachedHvsc: vi.fn(),
  installOrUpdateHvsc: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscMediaIndex", () => ({
  createHvscMediaIndex: () => mocks.mockIndex,
}));

vi.mock("@/lib/hvsc/hvscRootLocator", () => ({
  loadHvscRoot: vi.fn().mockReturnValue({ path: "/HVSC" }),
}));

vi.mock("@/lib/hvsc/hvscSongLengthService", () => ({
  ensureHvscSonglengthsReadyOnColdStart: vi.fn(),
  resolveHvscSonglengthDuration: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/hvsc/hvscBrowseIndexStore", () => ({
  loadHvscBrowseIndexSnapshot: vi.fn(async () => ({
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    songs: {},
    folders: { "/": { path: "/", folders: [], songs: [] } },
  })),
  verifyHvscBrowseIndexIntegrity: vi.fn(async () => ({
    isValid: true,
    sampled: 0,
    missingPaths: [],
  })),
}));

vi.mock("@/lib/native/hvscIngestion", () => ({
  HvscIngestion: {
    queryAllSongs: vi.fn(async () => ({
      totalSongs: 1,
      songs: [{ virtualPath: "/DEMOS/a.sid", fileName: "a.sid" }],
    })),
  },
}));

describe("hvscService", () => {
  // Helper to stub window but keep dispatchEvent to avoid logging errors
  const stubWindow = (overrides: Record<string, any> = {}) => {
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      CustomEvent: class CustomEvent {
        constructor(public type: string) {}
      },
      ...overrides,
    });
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    mocks.mockIndex.loadBrowseSnapshot.mockResolvedValue({
      schemaVersion: 2,
      updatedAt: new Date().toISOString(),
      songs: {},
      folders: { "/": { path: "/", folders: [], songs: [] } },
    });
  });

  describe("isHvscBridgeAvailable", () => {
    it("returns true if mock bridge exists", () => {
      stubWindow({ __hvscMock__: {} });
      expect(hvscService.isHvscBridgeAvailable()).toBe(true);
    });

    it("returns true if native platform", () => {
      stubWindow({});
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      expect(hvscService.isHvscBridgeAvailable()).toBe(true);
    });

    it("returns true if Filesystem plugin available", () => {
      stubWindow({});
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
      expect(hvscService.isHvscBridgeAvailable()).toBe(true);
    });

    it("returns false otherwise", () => {
      stubWindow({});
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
      expect(hvscService.isHvscBridgeAvailable()).toBe(false);
    });
  });

  describe("getHvscStatus", () => {
    it("uses mock bridge if available", async () => {
      const mockStatus = { version: "1.0" };
      stubWindow({
        __hvscMock__: { getHvscStatus: vi.fn().mockReturnValue(mockStatus) },
      });
      const result = await hvscService.getHvscStatus();
      expect(result).toBe(mockStatus);
    });

    it("uses runtime if no mock bridge", async () => {
      stubWindow({});
      const runtimeStatus = { version: "2.0" } as any;
      vi.mocked(runtime.getHvscStatus).mockResolvedValue(runtimeStatus);
      const result = await hvscService.getHvscStatus();
      expect(result).toBe(runtimeStatus);
      expect(runtime.getHvscStatus).toHaveBeenCalled();
    });
  });

  describe("getHvscFolderListing", () => {
    it("uses the browse snapshot path without eagerly loading the full media index", async () => {
      mocks.mockIndex.queryFolderPage.mockReturnValue({
        path: "/HVSC",
        folders: [],
        songs: [{ id: 1, virtualPath: "/HVSC/foo.sid", fileName: "foo.sid" }],
        totalFolders: 0,
        totalSongs: 1,
        offset: 0,
        limit: 200,
        query: "",
      });

      const result = await hvscService.getHvscFolderListing("/HVSC");

      expect(result.songs).toHaveLength(1);
      expect(result.songs[0].fileName).toBe("foo.sid");
      expect(mocks.mockIndex.loadBrowseSnapshot).toHaveBeenCalled();
      expect(mocks.mockIndex.load).not.toHaveBeenCalled();
      // Should NOT call runtime
      expect(runtime.getHvscFolderListing).not.toHaveBeenCalled();
    });

    it("falls back to mock bridge if index empty", async () => {
      mocks.mockIndex.getAll.mockReturnValue([]);
      mocks.mockIndex.queryFolderPage.mockReturnValue({
        path: "/path",
        folders: [],
        songs: [],
        totalFolders: 0,
        totalSongs: 0,
        offset: 0,
        limit: 200,
        query: "",
      });
      stubWindow({
        __hvscMock__: {
          getHvscFolderListing: vi.fn().mockReturnValue({ path: "/path", folders: [], songs: [] }),
        },
      });

      const result = await hvscService.getHvscFolderListing("/path");
      expect(result).toEqual({ path: "/path", folders: [], songs: [] });
    });

    it("falls back to runtime if index empty and no mock bridge", async () => {
      mocks.mockIndex.loadBrowseSnapshot.mockResolvedValue(null);
      mocks.mockIndex.queryFolderPage.mockReturnValue({
        path: "/path",
        folders: [],
        songs: [],
        totalFolders: 0,
        totalSongs: 0,
        offset: 0,
        limit: 200,
        query: "",
      });
      stubWindow({});
      vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
      vi.mocked(runtime.getHvscFolderListing).mockResolvedValue({
        path: "/path",
        folders: [],
        songs: [],
      } as any);

      const result = await hvscService.getHvscFolderListing("/path");
      expect(result).toEqual({ path: "/path", folders: [], songs: [] });
    });

    it("clears invalid browse snapshots before falling back", async () => {
      const { verifyHvscBrowseIndexIntegrity } = await import("@/lib/hvsc/hvscBrowseIndexStore");
      vi.mocked(verifyHvscBrowseIndexIntegrity).mockResolvedValueOnce({
        isValid: false,
        sampled: 0,
        missingPaths: [],
      });
      mocks.mockIndex.queryFolderPage.mockReturnValue({
        path: "/path",
        folders: [],
        songs: [],
        totalFolders: 0,
        totalSongs: 0,
        offset: 0,
        limit: 200,
        query: "",
      });
      stubWindow({
        __hvscMock__: {
          getHvscFolderListing: vi.fn().mockReturnValue({ path: "/path", folders: [], songs: [] }),
        },
      });

      await hvscService.getHvscFolderListing("/path");

      expect(mocks.mockIndex.clearBrowseSnapshot).toHaveBeenCalled();
      expect(mocks.mockIndex.load).not.toHaveBeenCalled();
    });
  });

  describe("pageRuntimeListing", () => {
    const { pageRuntimeListing } = hvscService.__test__;

    it("filters runtime listings by query and paging", () => {
      const page = pageRuntimeListing(
        {
          path: "/HVSC/DEMOS",
          folders: ["/HVSC/DEMOS/A", "/HVSC/DEMOS/B"],
          songs: [
            {
              id: 1,
              virtualPath: "/HVSC/DEMOS/alpha.sid",
              fileName: "alpha.sid",
            },
            {
              id: 2,
              virtualPath: "/HVSC/DEMOS/beta.sid",
              fileName: "beta.sid",
            },
          ],
        },
        "beta",
        0,
        10,
      );

      expect(page.path).toBe("/HVSC/DEMOS");
      expect(page.totalSongs).toBe(1);
      expect(page.songs[0]?.fileName).toBe("beta.sid");
    });
  });

  describe("getHvscSongsRecursive", () => {
    it("returns songs from the browse snapshot without running integrity check", async () => {
      const snapshot = {
        schemaVersion: 2,
        updatedAt: new Date().toISOString(),
        songs: { "/DEMOS/a.sid": { virtualPath: "/DEMOS/a.sid", fileName: "a.sid" } },
        folders: {
          "/": { path: "/", folders: ["/DEMOS"], songs: [] },
          "/DEMOS/": { path: "/DEMOS/", folders: [], songs: ["/DEMOS/a.sid"] },
        },
      };
      mocks.mockIndex.loadBrowseSnapshot.mockResolvedValue(snapshot);
      const expectedSongs = [{ virtualPath: "/DEMOS/a.sid", fileName: "a.sid" }];
      mocks.mockIndex.querySongsRecursive.mockReturnValue(expectedSongs);

      stubWindow({});
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      const result = await hvscService.getHvscSongsRecursive("/DEMOS");

      expect(mocks.mockIndex.loadBrowseSnapshot).toHaveBeenCalled();
      expect(mocks.mockIndex.querySongsRecursive).toHaveBeenCalledWith("/DEMOS");
      expect(result).toBe(expectedSongs);
      // The integrity check must NOT have cleared the snapshot — that would
      // cause querySongsRecursive to return null and trigger a minutes-long
      // BFS fallback instead of the sub-second bulk query.
      expect(mocks.mockIndex.clearBrowseSnapshot).not.toHaveBeenCalled();
    });

    it("rebuilds browse snapshot from native when snapshot is missing", async () => {
      mocks.mockIndex.loadBrowseSnapshot.mockResolvedValue(null);
      mocks.mockIndex.querySongsRecursive.mockReturnValue(null);

      stubWindow({});
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      const result = await hvscService.getHvscSongsRecursive("/DEMOS");

      expect(mocks.mockIndex.loadBrowseSnapshot).toHaveBeenCalled();
      expect(mocks.mockIndex.clearBrowseSnapshot).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("returns null when browse snapshot remains empty after songlength bootstrap", async () => {
      const emptySnapshot = {
        schemaVersion: 2,
        updatedAt: new Date().toISOString(),
        songs: {},
        folders: {},
      };
      mocks.mockIndex.loadBrowseSnapshot.mockResolvedValue(emptySnapshot);
      mocks.mockIndex.querySongsRecursive.mockReturnValue(null);

      stubWindow({});
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);

      const result = await hvscService.getHvscSongsRecursive("/DEMOS");

      expect(mocks.mockIndex.clearBrowseSnapshot).not.toHaveBeenCalled();
      expect(mocks.mockIndex.loadBrowseSnapshot).toHaveBeenCalled();
      expect(result).toBeNull();
    });
  });
});
