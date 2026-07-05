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

  it("keeps per-batch config-candidate merge work linear in selected file count (HARD12-015)", async () => {
    // The previous implementation rebuilt ALL parents' merged entries from
    // scratch on every call to getPrefetchedConfigEntriesByPath (one call per
    // imported file in the per-file loop). For a single-folder N-file add,
    // the merge work was O(N^2) - the merged Map for the parent was rebuilt
    // N times, each rebuild iterating the N selected files for that parent.
    //
    // The fix memoizes the merged entries per parent: each parent is built
    // exactly once for the lifetime of the add handler. We assert that
    // observable behaviour here by counting how many distinct "merged list"
    // instances the prefetched-entries map ever holds across the per-file
    // discoverConfigCandidates calls - with the fix it stays constant (1 per
    // parent), with the previous code it grew on every call.
    const measure = async (fileCount: number) => {
      const deps = createDeps();
      const folder = `/Music/measure/${fileCount}`;
      const fileNames = Array.from({ length: fileCount }, (_, i) => `track_${i.toString().padStart(3, "0")}.sid`);
      const listing = fileNames.map((name) => ({
        type: "file" as const,
        name,
        path: `${folder}/${name}`,
        modifiedAt: "2026-03-29T12:00:00Z",
        sizeBytes: 100,
      }));
      const source = createSource("ultimate", async () => listing);
      const handler = createAddFileSelectionsHandler(deps as any);
      await handler(
        source,
        fileNames.map((name) => ({
          type: "file" as const,
          name,
          path: `${folder}/${name}`,
        })),
      );
      const mapInstances = new Set<unknown>();
      for (const call of discoverConfigCandidates.mock.calls) {
        const args = call[0] as { prefetchedEntriesByPath: Map<string, unknown[]> };
        mapInstances.add(args.prefetchedEntriesByPath);
      }
      return { mapInstances: mapInstances.size, calls: discoverConfigCandidates.mock.calls.length };
    };

    discoverConfigCandidates.mockClear();
    const m20 = await measure(20);
    discoverConfigCandidates.mockClear();
    const m80 = await measure(80);

    expect(m20.calls).toBe(20);
    expect(m80.calls).toBe(80);
    // The fix memoizes the per-parent entries Map inside
    // getPrefetchedConfigEntriesByPath - the same Map reference is reused
    // across every per-file discoverConfigCandidates call in a batch.
    expect(m20.mapInstances).toBe(1);
    expect(m80.mapInstances).toBe(1);
  });

  it("shares the merged per-parent entry list across discoverConfigCandidates calls (HARD12-015)", async () => {
    // The previous implementation rebuilt the merged per-parent Map for every
    // getPrefetchedConfigEntriesByPath call inside the per-file loop. We
    // measure that work by spying on Map.prototype.set during the test and
    // counting how many set operations happen on the *inner* merged Maps
    // (the ones constructed inside getDirectoryEntries). With the fix the
    // merged Map is built at most once per parent - so total inner-set work
    // scales as O(parent-files). Without the fix it is O(parent-files x
    // getPrefetchedConfigEntriesByPath-calls).
    const innerMapSetCounts: number[] = [];
    const originalSet = Map.prototype.set;
    let inHandler = false;
    Map.prototype.set = function trackedSet(...args: Parameters<typeof originalSet>) {
      // Count set operations on the inner merged Maps specifically (those
      // created during the test and used as the prefetched entries values).
      // We approximate "inner" by counting Maps that themselves were the
      // values returned from getDirectoryEntries - here we count any Map set
      // performed while the handler is on the stack.
      if (inHandler) innerMapSetCounts.push(1);
      return originalSet.apply(this, args as [unknown, unknown]);
    };
    try {
      const deps = createDeps();
      const folder = "/Music/share";
      const fileNames = Array.from({ length: 30 }, (_, i) => `track_${i.toString().padStart(3, "0")}.sid`);
      const listing = fileNames.map((name) => ({
        type: "file" as const,
        name,
        path: `${folder}/${name}`,
        modifiedAt: "2026-03-29T12:00:00Z",
        sizeBytes: 100,
      }));
      const source = createSource("ultimate", async () => listing);
      const handler = createAddFileSelectionsHandler(deps as any);
      inHandler = true;
      await handler(
        source,
        fileNames.map((name) => ({
          type: "file" as const,
          name,
          path: `${folder}/${name}`,
        })),
      );
      inHandler = false;
    } finally {
      Map.prototype.set = originalSet;
    }
    // Per-parent merged Map set operations must be small and bounded by the
    // per-parent entry count (here 30). With the fix, all 30 set calls happen
    // in a single getDirectoryEntries invocation (since the result is cached);
    // the previous code would re-do 30 set calls for each of the 30
    // discoverConfigCandidates invocations in the per-file loop. Empirically
    // the fix bounds inner-set work to ~4 * parent-files (combined selected,
    // listing cache, parent map, prefetched wrapper); the old version scales
    // as N_files * N_parent_entries. Cap at 5 * 30 below as a generous
    // bound for the fixed path; the unfixed path tops out at N_files * N +
    // bookkeeping and stays in the hundreds-to-thousands.
    expect(innerMapSetCounts.length).toBeLessThanOrEqual(5 * 30);
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
