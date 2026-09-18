import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";
import type { SourceLocation } from "@/lib/sourceNavigation/types";

const { addLogMock, commitPlaylistSnapshot, markPlaylistRepositoryPhase, discoverConfigCandidatesMock } = vi.hoisted(
  () => ({
    discoverConfigCandidatesMock: vi.fn(async () => []),
    addLogMock: vi.fn(),
    commitPlaylistSnapshot: vi.fn().mockResolvedValue({
      committedCount: 0,
      expectedCount: 0,
      revision: 1,
      snapshotKey: "test",
    }),
    markPlaylistRepositoryPhase: vi.fn(),
  }),
);

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
  discoverConfigCandidates: discoverConfigCandidatesMock,
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

const createDeferred = <T>() => {
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

/*
 * A `.cfg` beside a program on a C64 Ultimate stayed unresolved when the program was added, and
 * resolved as "same name, high confidence" the moment the config sheet listed the folder for real.
 * The add was handing discovery the files the user had ticked as if they were the folder's
 * contents, and the settings file is exactly the file nobody ticks. The map either carries the
 * folder's real contents or does not carry the folder at all.
 */
describe("what an add tells config discovery about a folder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    discoverConfigCandidatesMock.mockResolvedValue([]);
  });

  const prg = { type: "file" as const, name: "Game.prg", path: "/music/Test/Game.prg" };
  const cfg = { type: "file" as const, name: "Game.cfg", path: "/music/Test/Game.cfg" };

  const runAdd = async (listEntries: SourceLocation["listEntries"]) => {
    vi.resetModules();
    const { createAddFileSelectionsHandler } = await import("@/pages/playFiles/handlers/addFileSelections");
    const deps = createDeps(async (items) => items);
    const handler = createAddFileSelectionsHandler(deps as never);
    /*
     * The picker hands over a file it has already listed, so the add skips the lookup that would
     * otherwise list the folder as a side effect. That is the case the defect lived in.
     */
    await handler(createUltimateSource(listEntries), [
      { type: "file", name: prg.name, path: prg.path, sizeBytes: 35, modifiedAt: "2026-09-18T00:00:00.000Z" },
    ]);
    return discoverConfigCandidatesMock.mock.calls.at(-1)?.[0] as unknown as {
      prefetchedEntriesByPath?: Map<string, { name: string }[]>;
      targetFile: { path: string };
    };
  };

  it("never offers a folder whose contents it only half knows", async () => {
    const options = await runAdd(async () => [prg, cfg]);
    const folder = [...(options.prefetchedEntriesByPath?.entries() ?? [])].find(([key]) => key.includes("/music/Test"));
    const names = folder?.[1].map((entry) => entry.name) ?? null;
    // Either the folder is absent, so discovery lists it itself, or it is there with the .cfg in it.
    expect(names === null || names.includes("Game.cfg"), `offered ${JSON.stringify(names)}`).toBe(true);
  });

  it("passes discovery the file it is resolving settings for", async () => {
    const options = await runAdd(async () => [prg, cfg]);
    expect(options.targetFile.path).toBe("/music/Test/Game.prg");
  });
});
