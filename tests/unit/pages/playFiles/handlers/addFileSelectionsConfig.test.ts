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

const { discoverConfigCandidates, resolvePlaybackConfig } = vi.hoisted(() => ({
  discoverConfigCandidates: vi.fn(
    async (input: {
      sourceType: "local" | "ultimate";
      sourceId?: string | null;
      targetFile: { name: string; path: string };
      listEntries: (
        path: string,
      ) => Promise<
        Array<{ type: string; name: string; path: string; modifiedAt?: string | null; sizeBytes?: number | null }>
      >;
      localEntriesBySourceId?: Map<
        string,
        Map<string, { uri?: string | null; name: string; modifiedAt?: string | null; sizeBytes?: number | null }>
      >;
    }) => {
      const parentPath = input.targetFile.path.slice(0, input.targetFile.path.lastIndexOf("/")) || "/";
      const baseName = input.targetFile.name.replace(/\.[^.]+$/, "").toLowerCase();
      const entries = await input.listEntries(parentPath);
      return entries
        .filter((entry) => entry.type === "file" && entry.name.toLowerCase().endsWith(".cfg"))
        .map((entry) => ({
          ref:
            input.sourceType === "local"
              ? {
                kind: "local" as const,
                fileName: entry.name,
                path: entry.path,
                sourceId: input.sourceId ?? null,
                uri: input.localEntriesBySourceId?.get(input.sourceId ?? "")?.get(entry.path)?.uri ?? null,
                modifiedAt: entry.modifiedAt ?? null,
                sizeBytes: entry.sizeBytes ?? null,
              }
              : {
                kind: "ultimate" as const,
                fileName: entry.name,
                path: entry.path,
                modifiedAt: entry.modifiedAt ?? null,
                sizeBytes: entry.sizeBytes ?? null,
              },
          strategy: entry.name.replace(/\.[^.]+$/, "").toLowerCase() === baseName ? "exact-name" : "directory",
          distance: 0,
          confidence: entry.name.replace(/\.[^.]+$/, "").toLowerCase() === baseName ? "high" : "medium",
        }));
    },
  ),
  resolvePlaybackConfig: vi.fn((input: { candidates?: Array<{ ref?: unknown }> }) => {
    const configRef = input.candidates?.[0]?.ref ?? null;
    return {
      configRef,
      configOrigin: configRef ? "resolved" : "none",
      configCandidates: input.candidates ?? [],
      configOverrides: null,
    };
  }),
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

vi.mock("@/lib/config/configDiscovery", () => ({
  discoverConfigCandidates,
}));

vi.mock("@/lib/config/configResolution", () => ({
  resolvePlaybackConfig,
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
  beforeEach(() => {
    discoverConfigCandidates.mockClear();
    resolvePlaybackConfig.mockClear();
  });

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
    expect(discoverConfigCandidates).toHaveBeenCalledTimes(1);
    expect(resolvePlaybackConfig).toHaveBeenCalledTimes(1);
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
    expect(discoverConfigCandidates).toHaveBeenCalledTimes(1);
    expect(resolvePlaybackConfig).toHaveBeenCalledTimes(1);
  });

  it("skips config discovery for HVSC items and preserves null config fields", async () => {
    const deps = createDeps();
    deps.buildHvscLocalPlayFile = vi.fn(
      () =>
        ({
          name: "Comic_Bakery.sid",
          lastModified: 0,
          arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
        }) as any,
    );
    const source: SourceLocation = {
      id: "hvsc-library",
      type: "hvsc",
      name: "HVSC",
      rootPath: "/",
      isAvailable: true,
      listEntries: async () => [
        {
          type: "file",
          name: "Comic_Bakery.sid",
          path: "/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid",
          durationMs: 90_000,
          songNr: 1,
          subsongCount: 2,
        },
      ],
      listFilesRecursive: async () => [],
    };
    const handler = createAddFileSelectionsHandler(deps as any);

    const result = await handler(source, [
      { type: "file", name: "Comic_Bakery.sid", path: "/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid" },
    ]);

    expect(result).toBe(true);
    expect(discoverConfigCandidates).not.toHaveBeenCalled();
    expect(resolvePlaybackConfig).not.toHaveBeenCalled();
    expect(deps._playlistItems[0] as any).toMatchObject({
      configRef: null,
      sourceId: "hvsc-library",
    });
  });
});
