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
  isSonglengthsFileName: vi.fn(() => false),
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
});
