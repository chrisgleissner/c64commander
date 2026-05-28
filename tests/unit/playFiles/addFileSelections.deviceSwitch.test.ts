import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";
import type { SourceLocation } from "@/lib/sourceNavigation/types";

const { addLogMock, commitPlaylistSnapshot, markPlaylistRepositoryPhase } = vi.hoisted(() => ({
  addLogMock: vi.fn(),
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
  addLog: addLogMock,
  addErrorLog: vi.fn(),
}));

vi.mock("@/lib/c64api", () => ({
  getC64APIConfigSnapshot: vi.fn(() => ({ deviceHost: "u64", password: "secret" })),
}));

vi.mock("@/lib/ftp/ftpClient", () => ({
  readFtpFile: vi.fn(),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
  getStoredFtpPort: vi.fn(() => 21),
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

vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({
  normalizeFtpHost: vi.fn((host: string) => host),
}));

vi.mock("@/lib/native/safUtils", () => ({
  redactTreeUri: vi.fn(() => "[redacted]"),
}));

vi.mock("@/lib/sid/songlengthsDiscovery", () => ({
  isSonglengthsFileName: vi.fn(() => false),
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

vi.mock("@/lib/hvsc/hvscPerformance", () => ({
  beginHvscPerfScope: vi.fn(() => ({
    scope: "playlist:add-batch",
    startedAt: "2026-05-28T00:00:00.000Z",
    startedAtMs: 0,
  })),
  endHvscPerfScope: vi.fn(),
}));

vi.mock("@/lib/hvsc", () => ({
  streamHvscSongsRecursive: vi.fn(async () => null),
}));

vi.mock("@/lib/smoke/smokeMode", () => ({
  recordSmokeBenchmarkSnapshot: vi.fn(),
}));

vi.mock("@/pages/playFiles/playlistRepositorySync", () => ({
  commitPlaylistSnapshot,
  markPlaylistRepositoryPhase,
}));

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const createUltimateSource = (
  listEntries: SourceLocation["listEntries"],
  listFilesRecursive?: SourceLocation["listFilesRecursive"],
): SourceLocation => ({
  id: "ultimate-source-1",
  type: "ultimate",
  name: "Ultimate",
  rootPath: "/music",
  isAvailable: true,
  listEntries,
  listFilesRecursive: listFilesRecursive ?? (async () => []),
});

const createDeps = (applySonglengthsToItems: (items: unknown[]) => Promise<unknown[]>) => {
  const playlistItems: unknown[] = [];
  const playlistSnapshotRef = { current: [] as unknown[] };
  return {
    addItemsStartedAtRef: { current: null },
    addItemsOverlayActiveRef: { current: false },
    addItemsOverlayStartedAtRef: { current: null },
    addItemsAbortControllerRef: { current: null as AbortController | null },
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
      category: "sid",
      label: entry.name,
      path: entry.path,
      sourceId: entry.sourceId,
      addedAt: new Date().toISOString(),
      status: "ready",
      unavailableReason: null,
    })),
    applySonglengthsToItems: vi.fn(applySonglengthsToItems),
    mergeSonglengthsFiles: vi.fn(),
    collectSonglengthsCandidates: vi.fn(() => []),
    buildHvscLocalPlayFile: vi.fn(),
    archiveConfigs: {},
    _playlistItems: playlistItems,
  };
};

const buildFiles = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    type: "file" as const,
    name: `track-${index + 1}.sid`,
    path: `/music/Test/track-${index + 1}.sid`,
  }));

describe("addFileSelections device switch cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("keeps pre-switch playlist items and blocks post-switch mutations", async () => {
    vi.resetModules();
    const { createAddFileSelectionsHandler } = await import("@/pages/playFiles/handlers/addFileSelections");
    const store = await import("@/lib/savedDevices/store");
    const initialDeviceId = store.getSavedDevicesSnapshot().selectedDeviceId;
    store.addSavedDevice({
      id: "device-backup",
      name: "Backup Lab",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E",
      lastKnownHostname: "backup-lab",
      lastKnownUniqueId: "UID-BACKUP",
      hasPassword: false,
    });

    const secondBatch = createDeferred<unknown[]>();
    const deps = createDeps(async (items) => {
      if (Array.isArray(items) && items.length === 250) {
        return items;
      }
      return await secondBatch.promise;
    });
    const source = createUltimateSource(
      async () => [{ type: "dir" as const, name: "Test", path: "/music/Test" }],
      async () => buildFiles(251),
    );
    const handler = createAddFileSelectionsHandler(deps as never);

    const resultPromise = handler(source, [{ type: "dir", name: "Test", path: "/music/Test" }]);

    await waitFor(() => expect(deps.applySonglengthsToItems).toHaveBeenCalledTimes(2));

    store.selectSavedDevice("device-backup");
    window.dispatchEvent(
      new CustomEvent("c64u-connection-change", {
        detail: { reason: "saved-device-switch" },
      }),
    );
    secondBatch.resolve(deps.applySonglengthsToItems.mock.calls[1]![0] as unknown[]);

    await expect(resultPromise).resolves.toBe(false);
    expect(initialDeviceId).not.toBe("device-backup");
    expect(deps.setPlaylist).toHaveBeenCalledTimes(1);
    expect(deps._playlistItems).toHaveLength(250);
    expect(addLogMock).toHaveBeenCalledWith(
      "debug",
      "Add items scan cancelled",
      expect.objectContaining({ sourceId: "ultimate-source-1", sourceType: "ultimate", selectionCount: 1 }),
    );
  });

  it("keeps user cancel independent and does not double-log when a switch follows", async () => {
    vi.resetModules();
    const { createAddFileSelectionsHandler } = await import("@/pages/playFiles/handlers/addFileSelections");
    const store = await import("@/lib/savedDevices/store");
    store.addSavedDevice({
      id: "device-backup",
      name: "Backup Lab",
      host: "backup-c64",
      httpPort: 8080,
      ftpPort: 2021,
      telnetPort: 2323,
      lastKnownProduct: "U64E",
      lastKnownHostname: "backup-lab",
      lastKnownUniqueId: "UID-BACKUP",
      hasPassword: false,
    });

    const secondBatch = createDeferred<unknown[]>();
    const deps = createDeps(async (items) => {
      if (Array.isArray(items) && items.length === 250) {
        return items;
      }
      return await secondBatch.promise;
    });
    const source = createUltimateSource(
      async () => [{ type: "dir" as const, name: "Test", path: "/music/Test" }],
      async () => buildFiles(251),
    );
    const handler = createAddFileSelectionsHandler(deps as never);

    const resultPromise = handler(source, [{ type: "dir", name: "Test", path: "/music/Test" }]);

    await waitFor(() => expect(deps.applySonglengthsToItems).toHaveBeenCalledTimes(2));

    deps.addItemsAbortControllerRef.current?.abort();
    store.selectSavedDevice("device-backup");
    window.dispatchEvent(
      new CustomEvent("c64u-connection-change", {
        detail: { reason: "saved-device-switch" },
      }),
    );
    secondBatch.resolve(deps.applySonglengthsToItems.mock.calls[1]![0] as unknown[]);

    await expect(resultPromise).resolves.toBe(false);
    const cancellationLogs = addLogMock.mock.calls.filter(
      (call) => call[0] === "debug" && call[1] === "Add items scan cancelled",
    );
    expect(cancellationLogs).toHaveLength(1);
    expect(deps.setPlaylist).toHaveBeenCalledTimes(1);
    expect(deps._playlistItems).toHaveLength(250);
    expect(commitPlaylistSnapshot).not.toHaveBeenCalled();
  });
});
