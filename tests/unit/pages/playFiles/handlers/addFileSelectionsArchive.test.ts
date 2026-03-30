import { describe, expect, it, vi, beforeEach } from "vitest";
import { createAddFileSelectionsHandler } from "@/pages/playFiles/handlers/addFileSelections";
import { LocalSourceListingError } from "@/lib/sourceNavigation/localSourceErrors";
import type { SourceLocation } from "@/lib/sourceNavigation/types";

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

vi.mock("@/lib/sid/songlengthsDiscovery", () => ({
  isSonglengthsFileName: vi.fn(() => false),
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
      playlistItems.push(...updater([]));
    }),
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

describe("addFileSelections archive source handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockArchiveClient.getEntries.mockResolvedValue([{ id: 0, path: "demo.d64", size: 174848, date: 1773676443000 }]);
  });

  it("stores archive references and defers runtime downloads until playback", async () => {
    const deps = createMockDeps();
    const handler = createAddFileSelectionsHandler(deps as any);

    const selections = [
      { type: "file" as const, name: "Cool Demo", path: "123/42" },
      { type: "file" as const, name: "Awesome Game", path: "456/7" },
    ];

    const result = await handler(archiveSource, selections);

    expect(result).toBe(true);
    expect(deps.setPlaylist).toHaveBeenCalledOnce();
    expect(deps._playlistItems).toHaveLength(2);
    expect(mockArchiveClient.getEntries).toHaveBeenNthCalledWith(1, "123", 42);
    expect(mockArchiveClient.downloadBinary).not.toHaveBeenCalled();
    const item0 = deps._playlistItems[0] as any;
    expect(item0.label).toBe("Cool Demo");
    expect(item0.request.source).toBe("commoserve");
    expect(item0.request.path).toBe("demo.d64");
    expect(item0.request.file).toBeUndefined();
    expect(item0.category).toBe("disk");
    expect(item0.sourceId).toBe("archive-commoserve");
    expect(item0.archiveRef).toEqual({
      sourceId: "archive-commoserve",
      resultId: "123",
      category: 42,
      entryId: 0,
      entryPath: "demo.d64",
    });
    const item1 = deps._playlistItems[1] as any;
    expect(item1.label).toBe("Awesome Game");
    expect(item1.request.source).toBe("commoserve");
  });

  it("reports error when archive selections are empty", async () => {
    const { reportUserError: mockReportUserError } = await import("@/lib/uiErrors");
    const deps = createMockDeps();
    const handler = createAddFileSelectionsHandler(deps as any);

    const result = await handler(archiveSource, []);

    expect(result).toBe(false);
    expect(mockReportUserError).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "PLAYLIST_ADD",
        title: "No items selected",
      }),
    );
    expect(deps.setPlaylist).not.toHaveBeenCalled();
  });

  it("preserves the selected archive source id in playlist items", async () => {
    const customSource: SourceLocation = {
      ...archiveSource,
      id: "archive-custom",
      name: "Custom Archive",
    };
    const deps = createMockDeps();
    deps.archiveConfigs = {
      "archive-custom": {
        id: "archive-custom",
        name: "Custom Archive",
        baseUrl: "http://archive.custom",
        enabled: true,
      },
    };
    const handler = createAddFileSelectionsHandler(deps as any);

    const selections = [{ type: "file" as const, name: "Demo", path: "789/1" }];
    const result = await handler(customSource, selections);

    expect(result).toBe(true);
    const item = deps._playlistItems[0] as any;
    expect(item.request.source).toBe("commoserve");
    expect(item.id).toContain("archive-custom");
  });

  it("stores the first playable archive entry when non-playable attachments are present", async () => {
    const deps = createMockDeps();
    const handler = createAddFileSelectionsHandler(deps as any);
    mockArchiveClient.getEntries.mockResolvedValueOnce([
      { id: 0, path: "readme.txt", size: 1200, date: 1773676442000 },
      { id: 1, path: "joyride.sid", size: 8192, date: 1773676443000 },
    ]);

    const result = await handler(archiveSource, [{ type: "file", name: "Joyride", path: "100/40" }]);

    expect(result).toBe(true);
    expect(mockArchiveClient.downloadBinary).not.toHaveBeenCalled();
    expect((deps._playlistItems[0] as any).category).toBe("sid");
    expect((deps._playlistItems[0] as any).request.path).toBe("joyride.sid");
    expect((deps._playlistItems[0] as any).archiveRef).toEqual({
      sourceId: "archive-commoserve",
      resultId: "100",
      category: 40,
      entryId: 1,
      entryPath: "joyride.sid",
    });
  });

  it("reports an error when an archive result has no playable entries", async () => {
    const { reportUserError: mockReportUserError } = await import("@/lib/uiErrors");
    const deps = createMockDeps();
    const handler = createAddFileSelectionsHandler(deps as any);
    mockArchiveClient.getEntries.mockResolvedValueOnce([{ id: 0, path: "readme.txt", size: 200, date: 1773676443000 }]);

    const result = await handler(archiveSource, [{ type: "file", name: "Readme Pack", path: "100/40" }]);

    expect(result).toBe(false);
    expect(mockReportUserError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Add items failed",
        description: "No playable archive file found for Readme Pack.",
      }),
    );
    expect(deps.setPlaylist).not.toHaveBeenCalled();
  });

  it("shows and clears the add-items overlay when archive results are added from the page surface", async () => {
    vi.useFakeTimers();
    const deps = {
      ...createMockDeps(),
      browserOpen: false,
    };
    const handler = createAddFileSelectionsHandler(deps as any);

    const promise = handler(archiveSource, [{ type: "file" as const, name: "Demo", path: "100/40" }]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(deps.setAddItemsSurface).toHaveBeenCalledWith("page");
    expect(deps.setShowAddItemsOverlay).toHaveBeenCalledWith(true);
    expect(deps.setShowAddItemsOverlay).toHaveBeenLastCalledWith(false);
    expect(deps.addItemsOverlayStartedAtRef.current).toBeNull();
    expect(deps.addItemsOverlayActiveRef.current).toBe(false);
    vi.useRealTimers();
  });

  it("reuses an existing add-items overlay without reopening it", async () => {
    vi.useFakeTimers();
    const deps = {
      ...createMockDeps(),
      browserOpen: false,
      addItemsOverlayActiveRef: { current: true },
      addItemsOverlayStartedAtRef: { current: Date.now() - 1200 },
    };
    const handler = createAddFileSelectionsHandler(deps as any);

    const promise = handler(archiveSource, [{ type: "file" as const, name: "Demo", path: "100/40" }]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(deps.setShowAddItemsOverlay).toHaveBeenCalledTimes(1);
    expect(deps.setShowAddItemsOverlay).toHaveBeenCalledWith(false);
    expect(deps.addItemsOverlayActiveRef.current).toBe(false);
    vi.useRealTimers();
  });

  it("clears the page overlay after an empty archive selection error", async () => {
    const { reportUserError: mockReportUserError } = await import("@/lib/uiErrors");
    vi.useFakeTimers();
    const deps = {
      ...createMockDeps(),
      browserOpen: false,
    };
    const handler = createAddFileSelectionsHandler(deps as any);

    const promise = handler(archiveSource, []);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(false);
    expect(mockReportUserError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "No items selected",
      }),
    );
    expect(deps.setShowAddItemsOverlay).toHaveBeenCalledWith(true);
    expect(deps.setShowAddItemsOverlay).toHaveBeenLastCalledWith(false);
    expect(deps.addItemsOverlayActiveRef.current).toBe(false);
    vi.useRealTimers();
  });

  it("adds local file selections after resolving file metadata from the source listing", async () => {
    vi.useFakeTimers();
    const localSource = createLocalSource(async () => [
      {
        type: "file",
        name: "demo.prg",
        path: "/demo.prg",
        sizeBytes: 2048,
        modifiedAt: "2024-01-02T03:04:05.000Z",
      },
    ]);
    const deps = createMockDeps();
    deps.buildPlaylistItem = vi.fn((entry) => ({
      id: `local:${entry.path}`,
      request: { source: entry.source, path: entry.path, file: entry.file },
      category: "prg",
      label: entry.name,
      path: entry.path,
      sourceId: entry.sourceId,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
      addedAt: new Date().toISOString(),
      status: "ready",
      unavailableReason: null,
    }));
    const handler = createAddFileSelectionsHandler(deps as any);

    const promise = handler(localSource, [{ type: "file", name: "demo.prg", path: "/demo.prg" }]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(deps.buildPlaylistItem).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "local",
        path: "/demo.prg",
        name: "demo.prg",
        sizeBytes: 2048,
      }),
    );
    expect(deps._playlistItems).toHaveLength(1);
    vi.useRealTimers();
  });

  it("falls back to source listing metadata when selections only carry null placeholders", async () => {
    vi.useFakeTimers();
    const localSource = createLocalSource(async () => [
      {
        type: "file",
        name: "demo.prg",
        path: "/demo.prg",
        sizeBytes: 2048,
        modifiedAt: "2024-01-02T03:04:05.000Z",
      },
    ]);
    const deps = createMockDeps();
    deps.buildPlaylistItem = vi.fn((entry) => ({
      id: `local:${entry.path}`,
      request: { source: entry.source, path: entry.path, file: entry.file },
      category: "prg",
      label: entry.name,
      path: entry.path,
      sourceId: entry.sourceId,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
      addedAt: new Date().toISOString(),
      status: "ready",
      unavailableReason: null,
    }));
    const handler = createAddFileSelectionsHandler(deps as any);

    const promise = handler(localSource, [
      { type: "file", name: "demo.prg", path: "/demo.prg", sizeBytes: null, modifiedAt: null },
    ]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(deps.buildPlaylistItem).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "local",
        path: "/demo.prg",
        name: "demo.prg",
        sizeBytes: 2048,
        modifiedAt: "2024-01-02T03:04:05.000Z",
      }),
    );
    vi.useRealTimers();
  });

  it("uses selection metadata directly when modifiedAt is already populated", async () => {
    vi.useFakeTimers();
    const localSource = createLocalSource(async () => {
      throw new Error("selection lookup should not run");
    });
    const deps = createMockDeps();
    deps.buildPlaylistItem = vi.fn((entry) => ({
      id: `local:${entry.path}`,
      request: { source: entry.source, path: entry.path, file: entry.file },
      category: "prg",
      label: entry.name,
      path: entry.path,
      sourceId: entry.sourceId,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
      addedAt: new Date().toISOString(),
      status: "ready",
      unavailableReason: null,
    }));
    const handler = createAddFileSelectionsHandler(deps as any);

    const promise = handler(localSource, [
      {
        type: "file",
        name: "demo.prg",
        path: "/demo.prg",
        sizeBytes: null,
        modifiedAt: "2024-01-02T03:04:05.000Z",
      },
    ]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(deps.buildPlaylistItem).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/demo.prg",
        modifiedAt: "2024-01-02T03:04:05.000Z",
      }),
    );
    vi.useRealTimers();
  });

  it("uses selection metadata directly when sizeBytes is zero", async () => {
    vi.useFakeTimers();
    const localSource = createLocalSource(async () => {
      throw new Error("selection lookup should not run");
    });
    const deps = createMockDeps();
    deps.buildPlaylistItem = vi.fn((entry) => ({
      id: `local:${entry.path}`,
      request: { source: entry.source, path: entry.path, file: entry.file },
      category: "prg",
      label: entry.name,
      path: entry.path,
      sourceId: entry.sourceId,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
      addedAt: new Date().toISOString(),
      status: "ready",
      unavailableReason: null,
    }));
    const handler = createAddFileSelectionsHandler(deps as any);

    const promise = handler(localSource, [
      {
        type: "file",
        name: "empty.prg",
        path: "/empty.prg",
        sizeBytes: 0,
        modifiedAt: null,
      },
    ]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(deps.buildPlaylistItem).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/empty.prg",
        sizeBytes: 0,
      }),
    );
    vi.useRealTimers();
  });

  it("reports no supported files when local selections do not resolve to playable entries", async () => {
    const { reportUserError: mockReportUserError } = await import("@/lib/uiErrors");
    const localSource = createLocalSource(async () => [
      {
        type: "file",
        name: "notes.txt",
        path: "/notes.txt",
      },
    ]);
    const deps = createMockDeps();
    const handler = createAddFileSelectionsHandler(deps as any);

    const result = await handler(localSource, [{ type: "file", name: "notes.txt", path: "/notes.txt" }]);

    expect(result).toBe(false);
    expect(mockReportUserError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "No supported files",
      }),
    );
    expect(deps.setPlaylist).not.toHaveBeenCalled();
  });

  it("adds directory selections without recursion when recurseFolders is disabled", async () => {
    vi.useFakeTimers();
    const localSource: SourceLocation = {
      ...createLocalSource(async (path) =>
        path === "/folder"
          ? [
              {
                type: "file",
                name: "demo.prg",
                path: "/folder/demo.prg",
                sizeBytes: 1024,
                modifiedAt: "2024-02-03T04:05:06.000Z",
              },
            ]
          : [],
      ),
      listFilesRecursive: vi.fn(async () => []),
    };
    const deps = {
      ...createMockDeps(),
      recurseFolders: false,
    };
    deps.buildPlaylistItem = vi.fn((entry) => ({
      id: `local:${entry.path}`,
      request: { source: entry.source, path: entry.path, file: entry.file },
      category: "prg",
      label: entry.name,
      path: entry.path,
      sourceId: entry.sourceId,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
      addedAt: new Date().toISOString(),
      status: "ready",
      unavailableReason: null,
    }));
    const handler = createAddFileSelectionsHandler(deps as any);

    const promise = handler(localSource, [{ type: "dir", name: "folder", path: "/folder" }]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(localSource.listFilesRecursive).toHaveBeenCalledWith("/folder");
    expect(deps.buildPlaylistItem).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "local",
        path: "/folder/demo.prg",
        name: "demo.prg",
      }),
    );
    vi.useRealTimers();
  });

  it("adds hvsc selections using the hvsc file builder", async () => {
    vi.useFakeTimers();
    const hvscSource = createHvscSource(async () => []);
    const hvscFile = {
      name: "demo.sid",
      lastModified: 0,
      arrayBuffer: vi.fn(async () => new ArrayBuffer(0)),
    };
    const deps = createMockDeps();
    deps.buildHvscLocalPlayFile = vi.fn(() => hvscFile as any);
    deps.buildPlaylistItem = vi.fn((entry) => ({
      id: `hvsc:${entry.path}`,
      request: { source: entry.source, path: entry.path, file: entry.file },
      category: "sid",
      label: entry.name,
      path: entry.path,
      sourceId: entry.sourceId,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
      addedAt: new Date().toISOString(),
      status: "ready",
      unavailableReason: null,
    }));
    const handler = createAddFileSelectionsHandler(deps as any);

    const promise = handler(hvscSource, [
      {
        type: "file",
        name: "demo.sid",
        path: "/MUSICIANS/D/Demo/demo.sid",
        durationMs: 87_000,
        songNr: 2,
        subsongCount: 4,
        sizeBytes: 4096,
      },
    ]);

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(deps.buildHvscLocalPlayFile).toHaveBeenCalledWith("/MUSICIANS/D/Demo/demo.sid", "demo.sid");
    expect(deps.buildPlaylistItem).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "hvsc",
        sourceId: "hvsc-library",
        durationMs: 87_000,
        songNr: 2,
        subsongCount: 4,
        file: hvscFile,
      }),
    );
    vi.useRealTimers();
  });

  it("logs selection lookup failures and still reports unsupported files", async () => {
    const { addLog: mockAddLog } = await import("@/lib/logging");
    const failingSource = createLocalSource(async () => {
      throw new Error("lookup failed");
    });
    const deps = createMockDeps();
    const handler = createAddFileSelectionsHandler(deps as any);

    const result = await handler(failingSource, [{ type: "file", name: "notes.txt", path: "/notes.txt" }]);

    expect(result).toBe(false);
    expect(mockAddLog).toHaveBeenCalledWith(
      "warn",
      "Failed to list entries for selection lookup",
      expect.objectContaining({
        sourceId: "local-test",
        selectionPath: "/notes.txt",
      }),
    );
  });

  it("reports no-files-found when directory selections resolve to no files", async () => {
    const { addLog: mockAddLog } = await import("@/lib/logging");
    const emptySource = createLocalSource(async () => []);
    const deps = {
      ...createMockDeps(),
      recurseFolders: false,
    };
    const handler = createAddFileSelectionsHandler(deps as any);

    const result = await handler(emptySource, [{ type: "dir", name: "folder", path: "/folder" }]);

    expect(result).toBe(false);
    expect(mockAddLog).toHaveBeenCalledWith(
      "debug",
      "No supported files after scan",
      expect.objectContaining({ reason: "no-files-found" }),
    );
  });

  it("returns a detailed error when local listing throws a LocalSourceListingError", async () => {
    const { reportUserError: mockReportUserError } = await import("@/lib/uiErrors");
    const failingSource = createLocalSource(async () => {
      throw new LocalSourceListingError("listing unavailable", "saf-listing-unavailable", {
        treeUri: "content://tree",
      });
    });
    const deps = createMockDeps();
    const handler = createAddFileSelectionsHandler(deps as any);

    const result = await handler(failingSource, [{ type: "dir", name: "folder", path: "/folder" }]);

    expect(result).toBe(false);
    expect(mockReportUserError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Add items failed",
        context: expect.objectContaining({
          sourceId: "local-test",
          details: { treeUri: "content://tree" },
        }),
      }),
    );
  });
});
