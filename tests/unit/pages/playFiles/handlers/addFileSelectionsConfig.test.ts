import { describe, expect, it, vi } from "vitest";
import { createAddFileSelectionsHandler } from "@/pages/playFiles/handlers/addFileSelections";
import { buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";
import type { SourceLocation } from "@/lib/sourceNavigation/types";

const { commitPlaylistSnapshot, markPlaylistRepositoryPhase } = vi.hoisted(() => ({
  commitPlaylistSnapshot: vi.fn().mockResolvedValue({
    committedCount: 0,
    expectedCount: 0,
    revision: 1,
    snapshotKey: "test",
  }),
  markPlaylistRepositoryPhase: vi.fn(),
}));

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

vi.mock("@/pages/playFiles/playlistRepositorySync", () => ({
  commitPlaylistSnapshot,
  markPlaylistRepositoryPhase,
}));

const createSource = (type: "local" | "ultimate", listEntries: SourceLocation["listEntries"]): SourceLocation => ({
  id: `${type}-source`,
  type,
  name: type,
  rootPath: "/",
  isAvailable: true,
  listEntries,
  listFilesRecursive: async () => [],
});

const createDeps = () => {
  const playlistItems: unknown[] = [];
  const playlistSnapshotRef = { current: [] as unknown[] };
  return {
    addItemsStartedAtRef: { current: null },
    addItemsOverlayActiveRef: { current: false },
    addItemsOverlayStartedAtRef: { current: null },
    addItemsSurface: "dialog" as const,
    browserOpen: true,
    recurseFolders: true,
    songlengthsFiles: [],
    localSourceTreeUris: new Map<string, string>([["local-source", "content://tree/music"]]),
    localEntriesBySourceId: new Map([
      [
        "local-source",
        new Map([
          [
            "/Music/demo.cfg",
            {
              uri: "content://demo.cfg",
              name: "demo.cfg",
              modifiedAt: "2026-03-29T12:00:00Z",
              sizeBytes: 321,
            },
          ],
        ]),
      ],
    ]),
    setAddItemsSurface: vi.fn(),
    setShowAddItemsOverlay: vi.fn(),
    setIsAddingItems: vi.fn(),
    setAddItemsProgress: vi.fn(),
    setPlaylist: vi.fn((updater: (prev: unknown[]) => unknown[]) => {
      const next = updater(playlistSnapshotRef.current);
      playlistSnapshotRef.current = next;
      playlistItems.splice(0, playlistItems.length, ...next);
    }),
    playlistSnapshotRef,
    playlistStorageKey: buildPlaylistStorageKey("device-1"),
    buildPlaylistItem: vi.fn((entry) => ({
      id: `${entry.source}:${entry.sourceId ?? ""}:${entry.path}`,
      request: { source: entry.source, path: entry.path, file: entry.file },
      category: "sid",
      label: entry.name,
      path: entry.path,
      configRef: entry.configRef ?? null,
      sourceId: entry.sourceId,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
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

describe("addFileSelections config discovery", () => {
  it("associates a sibling local .cfg file with imported playlist items", async () => {
    const deps = createDeps();
    const source = createSource("local", async () => [
      { type: "file", name: "demo.sid", path: "/Music/demo.sid", modifiedAt: "2026-03-29T12:00:00Z", sizeBytes: 123 },
      { type: "file", name: "demo.cfg", path: "/Music/demo.cfg", modifiedAt: "2026-03-29T12:00:00Z", sizeBytes: 321 },
    ]);
    const handler = createAddFileSelectionsHandler(deps as any);

    const result = await handler(source, [{ type: "file", name: "demo.sid", path: "/Music/demo.sid" }]);

    expect(result).toBe(true);
    expect((deps._playlistItems[0] as any).configRef).toEqual({
      kind: "local",
      fileName: "demo.cfg",
      path: "/Music/demo.cfg",
      sourceId: "local-source",
      uri: "content://demo.cfg",
      modifiedAt: "2026-03-29T12:00:00Z",
      sizeBytes: 321,
    });
  });

  it("associates a sibling ultimate .cfg file with imported playlist items", async () => {
    const deps = createDeps();
    const source = createSource("ultimate", async () => [
      {
        type: "file",
        name: "demo.sid",
        path: "/USB1/test-data/sid/demo.sid",
        modifiedAt: "2026-03-29T12:00:00Z",
        sizeBytes: 123,
      },
      {
        type: "file",
        name: "demo.cfg",
        path: "/USB1/test-data/sid/demo.cfg",
        modifiedAt: "2026-03-29T12:01:00Z",
        sizeBytes: 456,
      },
    ]);
    const handler = createAddFileSelectionsHandler(deps as any);

    const result = await handler(source, [{ type: "file", name: "demo.sid", path: "/USB1/test-data/sid/demo.sid" }]);

    expect(result).toBe(true);
    expect((deps._playlistItems[0] as any).configRef).toEqual({
      kind: "ultimate",
      fileName: "demo.cfg",
      path: "/USB1/test-data/sid/demo.cfg",
      modifiedAt: "2026-03-29T12:01:00Z",
      sizeBytes: 456,
    });
  });
});
