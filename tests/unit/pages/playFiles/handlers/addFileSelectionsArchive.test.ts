import { describe, expect, it, vi, beforeEach } from "vitest";
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
        buildPlaylistItem: vi.fn(() => null),
        applySonglengthsToItems: vi.fn(async (items: unknown[]) => items),
        mergeSonglengthsFiles: vi.fn(),
        collectSonglengthsCandidates: vi.fn(() => []),
        buildHvscLocalPlayFile: vi.fn(),
        _playlistItems: playlistItems,
    };
};

describe("addFileSelections archive source handler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("adds archive selections directly to the playlist as prg items", async () => {
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
        const item0 = deps._playlistItems[0] as any;
        expect(item0.label).toBe("Cool Demo");
        expect(item0.request.source).toBe("commoserve");
        expect(item0.request.path).toBe("123/42");
        expect(item0.category).toBe("prg");
        expect(item0.sourceId).toBe("archive-commoserve");
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
        const handler = createAddFileSelectionsHandler(deps as any);

        const selections = [{ type: "file" as const, name: "Demo", path: "789/1" }];
        const result = await handler(customSource, selections);

        expect(result).toBe(true);
        const item = deps._playlistItems[0] as any;
        expect(item.request.source).toBe("commoserve");
        expect(item.id).toContain("archive-custom");
    });
});
