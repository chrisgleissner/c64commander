import { describe, expect, it, vi, beforeEach } from "vitest";
import { createAddFileSelectionsHandler } from "@/pages/playFiles/handlers/addFileSelections";
import { buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";
import { LocalSourceListingError } from "@/lib/sourceNavigation/localSourceErrors";
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

const mockArchiveClient = {
  getEntries: vi.fn(),
  downloadBinary: vi.fn(),
};

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

vi.mock("@/lib/archive/client", () => ({
  createArchiveClient: vi.fn(() => mockArchiveClient),
}));

vi.mock("@/lib/playback/localFileBrowser", () => ({
  getParentPath: vi.fn(() => "/"),
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

vi.mock("@/lib/sid/songlengthsDiscovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sid/songlengthsDiscovery")>()),
  isSonglengthsFileName: vi.fn(() => false),
}));

vi.mock("@/pages/playFiles/playlistRepositorySync", () => ({
  commitPlaylistSnapshot,
  markPlaylistRepositoryPhase,
}));

const archiveSource: SourceLocation = {
  id: "archive-commoserve",
  type: "commoserve",
  name: "CommoServe",
  rootPath: "/",
  isAvailable: true,
  listEntries: async () => [],
  listFilesRecursive: async () => [],
};

const createLocalSource = (listEntries: SourceLocation["listEntries"]): SourceLocation => ({
  id: "local-test",
  type: "local",
  name: "Local",
  rootPath: "/",
  isAvailable: true,
  listEntries,
  listFilesRecursive: async () => [],
});

const createHvscSource = (listEntries: SourceLocation["listEntries"]): SourceLocation => ({
  id: "hvsc-library",
  type: "hvsc",
  name: "HVSC",
  rootPath: "/",
  isAvailable: true,
  listEntries,
  listFilesRecursive: async () => [],
});

const createMockDeps = () => {
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
    localSourceTreeUris: new Map<string, string>(),
    localEntriesBySourceId: new Map(),
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
      category: entry.path.endsWith(".d64") ? "disk" : entry.path.endsWith(".sid") ? "sid" : "prg",
      label: entry.name,
      path: entry.path,
      archiveRef: entry.archiveRef ?? null,
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
    archiveConfigs: {
      "archive-commoserve": {
        id: "archive-commoserve",
        name: "CommoServe",
        baseUrl: "http://commoserve.files.commodore.net",
        enabled: true,
      },
    },
    _playlistItems: playlistItems,
  };
};

const folderOf = (names: string[]) => async (path: string) =>
  path === "/Mixed"
    ? names.map((name) => ({ type: "file" as const, name, path: `/Mixed/${name}` }))
    : [{ type: "dir" as const, name: "Mixed", path: "/Mixed" }];

const addFolder = async (names: string[], acceptsPath?: (path: string) => boolean) => {
  const deps = { ...createMockDeps(), acceptsPath };
  const handler = createAddFileSelectionsHandler(deps as any);
  await handler(createLocalSource(folderOf(names)), [{ type: "dir", name: "Mixed", path: "/Mixed" }]);
  return deps._playlistItems.map((item) => (item as { path: string }).path);
};

const sidOnly = (path: string) => /\.sid$/i.test(path);

describe("addFileSelections in SID Player", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commitPlaylistSnapshot.mockResolvedValue({ committedCount: 0, expectedCount: 0, revision: 1, snapshotKey: "t" });
  });

  it("SPM-PLAY-02 adding a folder of PRG and D64 files adds nothing", async () => {
    expect(await addFolder(["a.prg", "b.d64", "c.crt"], sidOnly)).toEqual([]);
  });

  it("SPM-PLAY-02 adding a mixed folder adds only the SID files", async () => {
    expect(await addFolder(["a.prg", "tune.sid", "b.d64"], sidOnly)).toEqual(["/Mixed/tune.sid"]);
  });

  it("SPM-PLAY-02 the Full App keeps every playable file", async () => {
    expect((await addFolder(["a.prg", "tune.sid", "b.d64"])).sort()).toEqual([
      "/Mixed/a.prg",
      "/Mixed/b.d64",
      "/Mixed/tune.sid",
    ]);
  });

  it("SPM-PLAY-02 an archive result stores its SID entry, not the first playable file", async () => {
    mockArchiveClient.getEntries.mockResolvedValue([
      { id: 0, path: "demo.d64", size: 1, date: 1 },
      { id: 1, path: "music.sid", size: 1, date: 1 },
    ]);
    const deps = { ...createMockDeps(), acceptsPath: sidOnly };
    const handler = createAddFileSelectionsHandler(deps as any);
    await handler(archiveSource, [{ type: "file", name: "Demo", path: "1/42" }]);
    expect((deps._playlistItems[0] as { request: { path: string } }).request.path).toBe("music.sid");
  });

  it("SPM-PLAY-02 an archive result with no SID entry is refused", async () => {
    mockArchiveClient.getEntries.mockResolvedValue([{ id: 0, path: "demo.d64", size: 1, date: 1 }]);
    const deps = { ...createMockDeps(), acceptsPath: sidOnly };
    const handler = createAddFileSelectionsHandler(deps as any);
    expect(await handler(archiveSource, [{ type: "file", name: "Demo", path: "1/42" }])).toBe(false);
    expect(deps._playlistItems).toEqual([]);
  });
});
