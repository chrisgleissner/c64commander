import { beforeEach, describe, expect, it, vi } from "vitest";
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

const noteCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock("@/lib/sourceNavigation/guardedConfigListing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sourceNavigation/guardedConfigListing")>();
  return {
    ...actual,
    createConfigListing: (...args: Parameters<typeof actual.createConfigListing>) => {
      const listing = actual.createConfigListing(...args);
      const note = listing.noteDeviceAnswered;
      listing.noteDeviceAnswered = () => {
        noteCalls.count += 1;
        note();
      };
      return listing;
    },
  };
});

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

describe("addFileSelections songlengths retry folders", () => {
  beforeEach(() => {
    discoverConfigCandidates.mockClear();
    resolvePlaybackConfig.mockClear();
  });

  it("stores every folder it could not look in, also those below a folder the device did not answer for", async () => {
    const { getSavedDevicesSnapshot } = await import("@/lib/savedDevices/store");
    const { collectSonglengthsSearchPaths } = await import("@/lib/sid/songlengthsDiscovery");
    const { clearSkippedSonglengthsFolders, getSkippedSonglengthsFolders } =
      await import("@/pages/playFiles/songlengthsRetryStore");
    clearSkippedSonglengthsFolders();
    const deps = createDeps();
    deps.collectSonglengthsCandidates = vi.fn(collectSonglengthsSearchPaths);
    const listEntries = vi.fn(async () => {
      throw new Error("FTP list failed: Timeout (control socket)");
    });

    await createAddFileSelectionsHandler(deps as never)(createSource("ultimate", listEntries), [
      { type: "file", name: "Tone.sid", path: "/USB0/C64Music/MUSICIANS/T/Tone.sid", sizeBytes: 4096 },
    ]);

    const stored = getSkippedSonglengthsFolders(getSavedDevicesSnapshot().selectedDeviceId);
    expect(stored).toContain("/USB0/C64Music/DOCUMENTS/");
    expect(stored).toContain("/USB0/DOCUMENTS/");
    clearSkippedSonglengthsFolders();
  });

  it("marks the device answered only when a recursive listing of it came back whole", async () => {
    noteCalls.count = 0;
    const file = { type: "file" as const, name: "a.sid", path: "/USB0/Games/a.sid" };
    const source = { ...createSource("ultimate", async () => []), listFilesRecursive: async () => [file] };

    await createAddFileSelectionsHandler(createDeps() as never)(source, [
      { type: "dir", name: "Games", path: "/USB0/Games" },
    ]);

    expect(noteCalls.count).toBe(1);
  });

  it("does not mark the device answered for a file picked from a listing the phone already had", async () => {
    noteCalls.count = 0;

    await createAddFileSelectionsHandler(createDeps() as never)(
      createSource("ultimate", async () => []),
      [{ type: "file", name: "a.sid", path: "/USB0/Games/a.sid", sizeBytes: 4096, modifiedAt: "2026-01-01T00:00:00Z" }],
    );

    expect(noteCalls.count).toBe(0);
  });
});
