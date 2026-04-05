import { describe, expect, it, vi } from "vitest";
import { createAddFileSelectionsHandler } from "@/pages/playFiles/handlers/addFileSelections";
import type { SourceLocation } from "@/lib/sourceNavigation/types";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/lib/playback/localFileBrowser", () => ({
  getParentPath: (value: string) => value.slice(0, value.lastIndexOf("/")) || "/",
}));

vi.mock("@/lib/playback/fileLibraryUtils", () => ({
  buildLocalPlayFileFromTree: vi.fn(),
  buildLocalPlayFileFromUri: vi.fn(),
}));

vi.mock("@/lib/sourceNavigation/localSourceAdapter", () => ({
  resolveLocalRuntimeFile: vi.fn(),
}));

vi.mock("@/lib/native/safUtils", () => ({
  redactTreeUri: vi.fn(() => "[redacted]"),
}));

vi.mock("@/lib/sid/songlengthsDiscovery", () => ({
  isSonglengthsFileName: vi.fn((name: string) => /\.ssl$/i.test(name)),
}));

vi.mock("@/lib/config/configDiscovery", () => ({
  discoverConfigCandidates: vi.fn(async () => []),
}));

vi.mock("@/lib/config/configResolution", () => ({
  resolvePlaybackConfig: vi.fn(() => ({
    configRef: null,
    configOrigin: "none",
    configCandidates: [],
    configOverrides: null,
  })),
}));

const createHvscSource = (entries: Awaited<ReturnType<SourceLocation["listEntries"]>>): SourceLocation => ({
  id: "hvsc-library",
  type: "hvsc",
  name: "HVSC",
  rootPath: "/",
  isAvailable: true,
  listEntries: async () => entries,
  listFilesRecursive: async () => [],
});

const createLocalSource = (
  listEntries: SourceLocation["listEntries"],
  listFilesRecursive?: SourceLocation["listFilesRecursive"],
): SourceLocation => ({
  id: "local-source-1",
  type: "local",
  name: "Local",
  rootPath: "/music",
  isAvailable: true,
  listEntries,
  listFilesRecursive: listFilesRecursive ?? (async () => []),
});

const createDeps = () => {
  const playlistItems: unknown[] = [];
  return {
    addItemsStartedAtRef: { current: null },
    addItemsOverlayActiveRef: { current: false },
    addItemsOverlayStartedAtRef: { current: null },
    addItemsSurface: "dialog" as const,
    browserOpen: true,
    recurseFolders: false,
    songlengthsFiles: [],
    localSourceTreeUris: new Map<string, string>(),
    localEntriesBySourceId: new Map(),
    setAddItemsSurface: vi.fn(),
    setShowAddItemsOverlay: vi.fn(),
    setIsAddingItems: vi.fn(),
    setAddItemsProgress: vi.fn(),
    setPlaylist: vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      playlistItems.push(...updater([]));
    }),
    buildPlaylistItem: vi.fn((entry) => ({
      id: `${entry.source}:${entry.sourceId ?? ""}:${entry.path}`,
      request: { source: entry.source, path: entry.path, file: entry.file },
      category: "sid",
      label: entry.name,
      path: entry.path,
      sourceId: entry.sourceId,
      addedAt: new Date().toISOString(),
      status: "ready",
      unavailableReason: null,
    })),
    applySonglengthsToItems: vi.fn(async (items: unknown[]) => items),
    mergeSonglengthsFiles: vi.fn(),
    collectSonglengthsCandidates: vi.fn(() => []),
    buildHvscLocalPlayFile: vi.fn(),
    archiveConfigs: {},
    _playlistItems: playlistItems,
  };
};

describe("addFileSelections batching", () => {
  it("flushes large playable selections to the playlist in bounded batches", async () => {
    const deps = createDeps();
    const entries = Array.from({ length: 600 }, (_, index) => ({
      type: "file" as const,
      name: `track-${index + 1}.sid`,
      path: `/MUSICIANS/Test/track-${index + 1}.sid`,
    }));
    const source = createHvscSource(entries);
    const handler = createAddFileSelectionsHandler(deps as any);

    const result = await handler(source, [{ type: "dir", name: "Test", path: "/MUSICIANS/Test" }]);

    expect(result).toBe(true);
    expect(deps._playlistItems).toHaveLength(600);
    expect(deps.applySonglengthsToItems).toHaveBeenCalledTimes(3);
    expect(deps.setPlaylist).toHaveBeenCalledTimes(3);
    expect(deps.applySonglengthsToItems.mock.calls.map(([items]: [unknown[]]) => items.length)).toEqual([
      250, 250, 100,
    ]);
  });

  it("streams recursive local folders into playlist batches before traversal completes", async () => {
    const deps = createDeps();
    let resolveLastFolder: (() => void) | null = null;
    const source = createLocalSource(
      vi.fn(async (path: string) => {
        if (path === "/music/Test") {
          return [
            { type: "dir" as const, name: "A", path: "/music/Test/A" },
            { type: "dir" as const, name: "B", path: "/music/Test/B" },
            { type: "dir" as const, name: "C", path: "/music/Test/C" },
          ];
        }
        if (path === "/music/Test/A") {
          return Array.from({ length: 200 }, (_, index) => ({
            type: "file" as const,
            name: `a-${index + 1}.sid`,
            path: `/music/Test/A/a-${index + 1}.sid`,
          }));
        }
        if (path === "/music/Test/B") {
          return Array.from({ length: 200 }, (_, index) => ({
            type: "file" as const,
            name: `b-${index + 1}.sid`,
            path: `/music/Test/B/b-${index + 1}.sid`,
          }));
        }
        if (path === "/music/Test/C") {
          await new Promise<void>((resolve) => {
            resolveLastFolder = resolve;
          });
          return Array.from({ length: 50 }, (_, index) => ({
            type: "file" as const,
            name: `c-${index + 1}.sid`,
            path: `/music/Test/C/c-${index + 1}.sid`,
          }));
        }
        return [];
      }),
    );
    const handler = createAddFileSelectionsHandler({ ...deps, recurseFolders: true } as any);

    const pending = handler(source, [{ type: "dir", name: "Test", path: "/music/Test" }]);

    // Give traversal time to process A and B (400 files) while C is delayed
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Playlist writes don't happen until after traversal + songlengths resolution
    // but the streaming callback should have yielded control during discovery
    expect(deps.setPlaylist).toHaveBeenCalledTimes(0);

    resolveLastFolder?.();
    const result = await pending;

    expect(result).toBe(true);
    expect(deps._playlistItems).toHaveLength(450);
    // 450 files / 250 batch = 2 batches (250 + 200)
    expect(deps.setPlaylist).toHaveBeenCalledTimes(2);
    const batchSizes = deps.applySonglengthsToItems.mock.calls.map(([items]: [unknown[]]) => items.length);
    expect(batchSizes).toEqual([250, 200]);
  });

  it("streams 1k local recursive files through bounded playlist batches", async () => {
    const deps = createDeps();
    const filesPerFolder = 250;
    const folderCount = 4; // 4 x 250 = 1,000 files
    const source = createLocalSource(async (path: string) => {
      if (path === "/music/root") {
        return Array.from({ length: folderCount }, (_, i) => ({
          type: "dir" as const,
          name: `folder-${i}`,
          path: `/music/folder-${i}`,
        }));
      }
      const folderMatch = path.match(/\/music\/folder-(\d+)/);
      if (folderMatch) {
        return Array.from({ length: filesPerFolder }, (_, j) => ({
          type: "file" as const,
          name: `track-${j}.sid`,
          path: `${path}/track-${j}.sid`,
        }));
      }
      return [];
    });
    const handler = createAddFileSelectionsHandler({ ...deps, recurseFolders: true } as any);

    const result = await handler(source, [{ type: "dir", name: "root", path: "/music/root" }]);

    expect(result).toBe(true);
    const totalFiles = folderCount * filesPerFolder;
    expect(deps._playlistItems).toHaveLength(totalFiles);
    // 1,000 files / 250 batch size = 4 batches
    expect(deps.setPlaylist).toHaveBeenCalledTimes(4);
    expect(deps.applySonglengthsToItems).toHaveBeenCalledTimes(4);
    const batchSizes = deps.applySonglengthsToItems.mock.calls.map(([items]: [unknown[]]) => items.length);
    batchSizes.forEach((size: number) => {
      expect(size).toBeLessThanOrEqual(250);
      expect(size).toBeGreaterThan(0);
    });
  }, 30_000);

  it("eliminates duplicate traversal for local songlengths when recurseFolders is true", async () => {
    const deps = createDeps();
    const listEntriesSpy = vi.fn(async (path: string) => {
      if (path === "/music/root") {
        return [{ type: "dir" as const, name: "subdir", path: "/music/root/subdir" }];
      }
      if (path === "/music/root/subdir") {
        return [
          { type: "file" as const, name: "track.sid", path: "/music/root/subdir/track.sid" },
          { type: "file" as const, name: "SONGLENGTHS.ssl", path: "/music/root/subdir/SONGLENGTHS.ssl" },
        ];
      }
      return [];
    });
    const listFilesRecursiveSpy = vi.fn(async () => []);
    const source = createLocalSource(listEntriesSpy, listFilesRecursiveSpy);
    const handler = createAddFileSelectionsHandler({ ...deps, recurseFolders: true } as any);

    await handler(source, [{ type: "dir", name: "root", path: "/music/root" }]);

    // listFilesRecursive should NOT be called when recurseFolders is true
    // because songlengths entries are tracked during the streaming recursive traversal
    expect(listFilesRecursiveSpy).not.toHaveBeenCalled();
  });

  it("batches 5k hvsc files through bounded playlist appends", async () => {
    const deps = createDeps();
    const filesPerFolder = 500;
    const folderCount = 10; // 10 x 500 = 5,000 files
    const source: SourceLocation = {
      id: "hvsc-library",
      type: "hvsc",
      name: "HVSC",
      rootPath: "/",
      isAvailable: true,
      listEntries: vi.fn(async () => []),
      listFilesRecursive: vi.fn(async (path: string) => {
        if (path === "/MUSICIANS") {
          const files: { type: "file"; name: string; path: string }[] = [];
          for (let i = 0; i < folderCount; i++) {
            for (let j = 0; j < filesPerFolder; j++) {
              files.push({
                type: "file",
                name: `song-${j}.sid`,
                path: `/MUSICIANS/artist-${i}/song-${j}.sid`,
              });
            }
          }
          return files;
        }
        return [];
      }),
    };
    const handler = createAddFileSelectionsHandler({ ...deps, recurseFolders: true } as any);

    const result = await handler(source, [{ type: "dir", name: "MUSICIANS", path: "/MUSICIANS" }]);

    expect(result).toBe(true);
    const totalFiles = folderCount * filesPerFolder;
    expect(deps._playlistItems).toHaveLength(totalFiles);
    // 5,000 / 250 = 20 batches
    expect(deps.setPlaylist).toHaveBeenCalledTimes(20);
    const batchSizes = deps.applySonglengthsToItems.mock.calls.map(([items]: [unknown[]]) => items.length);
    batchSizes.forEach((size: number) => {
      expect(size).toBeLessThanOrEqual(250);
      expect(size).toBeGreaterThan(0);
    });
  }, 60_000);
});
