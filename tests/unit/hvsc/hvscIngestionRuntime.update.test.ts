/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    writeLibraryFile: vi.fn(async () => undefined),
    deleteLibraryFile: vi.fn(async () => undefined),
    resetLibraryRoot: vi.fn(async () => undefined),
    resetSonglengthsCache: vi.fn(),
    updateHvscState: vi.fn(),
    markUpdateApplied: vi.fn(),
    extractArchiveEntries: vi.fn(),
    reloadHvscSonglengthsOnConfigChange: vi.fn(async () => undefined),
    getHvscSonglengthsStats: vi.fn(() => ({ backendStats: { rejectedLines: 0 } })),
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

const browseIndexMutable = vi.hoisted(() => ({
    upsertSong: vi.fn(),
    deleteSong: vi.fn(),
    finalize: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/filesystem", () => ({
    Directory: { Data: "DATA" },
    Filesystem: {
        readdir: vi.fn(),
        readFile: vi.fn(),
        stat: vi.fn(),
        downloadFile: vi.fn(),
    },
}));

vi.mock("@capacitor/core", () => ({
    registerPlugin: vi.fn(() => ({
        ingestHvsc: vi.fn(),
        cancelIngestion: vi.fn(async () => undefined),
        addListener: vi.fn(async () => ({ remove: vi.fn(async () => undefined) })),
    })),
    Capacitor: {
        isNativePlatform: vi.fn(() => false),
        isPluginAvailable: vi.fn(() => false),
    },
}));

vi.mock("@/lib/hvsc/hvscFilesystem", () => ({
    ensureHvscDirs: vi.fn(async () => undefined),
    listHvscFolder: vi.fn(),
    getHvscSongByVirtualPath: vi.fn(),
    getHvscDurationByMd5: vi.fn(),
    writeLibraryFile: (...args: unknown[]) => mocks.writeLibraryFile(...args),
    deleteLibraryFile: (...args: unknown[]) => mocks.deleteLibraryFile(...args),
    resetLibraryRoot: (...args: unknown[]) => mocks.resetLibraryRoot(...args),
    resetSonglengthsCache: (...args: unknown[]) => mocks.resetSonglengthsCache(...args),
}));

vi.mock("@/lib/hvsc/hvscStateStore", () => ({
    loadHvscState: vi.fn(),
    updateHvscState: (...args: unknown[]) => mocks.updateHvscState(...args),
    isUpdateApplied: vi.fn(() => false),
    markUpdateApplied: (...args: unknown[]) => mocks.markUpdateApplied(...args),
}));

vi.mock("@/lib/hvsc/hvscStatusStore", () => ({
    loadHvscStatusSummary: vi.fn(() => ({ download: { status: "idle" }, extraction: { status: "idle" } })),
    saveHvscStatusSummary: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscSongLengthService", () => ({
    reloadHvscSonglengthsOnConfigChange: (...args: unknown[]) => mocks.reloadHvscSonglengthsOnConfigChange(...args),
    getHvscSonglengthsStats: (...args: unknown[]) => mocks.getHvscSonglengthsStats(...args),
}));

vi.mock("@/lib/hvsc/hvscArchiveExtraction", () => ({
    extractArchiveEntries: (...args: unknown[]) => mocks.extractArchiveEntries(...args),
}));

vi.mock("@/lib/hvsc/hvscBrowseIndexStore", () => ({
    clearHvscBrowseIndexSnapshot: vi.fn(async () => undefined),
    createHvscBrowseIndexMutable: vi.fn(async () => browseIndexMutable),
}));

vi.mock("@/lib/logging", () => ({
    addErrorLog: (...args: unknown[]) => mocks.addErrorLog(...args),
    addLog: (...args: unknown[]) => mocks.addLog(...args),
}));

vi.mock("@/lib/tracing/failureTaxonomy", () => ({
    classifyError: vi.fn(() => ({ category: "unknown", isExpected: false })),
}));

vi.mock("@/lib/sid/sidUtils", () => ({
    buildSidTrackSubsongs: vi.fn(() => null),
    parseSidHeaderMetadata: vi.fn(() => null),
}));

import { ingestArchiveBuffer } from "@/lib/hvsc/hvscIngestionRuntime";

const createOptions = () => ({
    plan: { type: "update" as const, version: 85 },
    archiveName: "hvsc-update-85.7z",
    archiveBuffer: new Uint8Array([1, 2, 3]),
    cancelToken: "token-update",
    cancelTokens: new Map([["token-update", { cancelled: false }]]),
    emitProgress: vi.fn(),
    pipeline: { transition: vi.fn() },
    baselineInstalled: 84,
});

describe("hvscIngestionRuntime update archive ingestion", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("processes delete.txt and removes listed files from the library and browse index", async () => {
        mocks.extractArchiveEntries.mockImplementation(
            async ({ onEntry }: { onEntry?: (path: string, data: Uint8Array) => Promise<void> }) => {
                await onEntry?.("HVSC/delete.txt", new TextEncoder().encode("MUSICIANS/Demo/old.sid\n"));
            },
        );

        await ingestArchiveBuffer(createOptions());

        expect(mocks.deleteLibraryFile).toHaveBeenCalledWith("/MUSICIANS/Demo/old.sid");
        expect(browseIndexMutable.deleteSong).toHaveBeenCalledWith("/MUSICIANS/Demo/old.sid");
        expect(mocks.markUpdateApplied).toHaveBeenCalledWith(85, "success");
    });

    it("adds new songs from an update archive to the library and browse index", async () => {
        mocks.extractArchiveEntries.mockImplementation(
            async ({ onEntry }: { onEntry?: (path: string, data: Uint8Array) => Promise<void> }) => {
                await onEntry?.("HVSC/new/MUSICIANS/Demo/new.sid", new Uint8Array([1, 2, 3]));
            },
        );

        await ingestArchiveBuffer(createOptions());

        expect(mocks.writeLibraryFile).toHaveBeenCalledWith("/MUSICIANS/Demo/new.sid", expect.any(Uint8Array));
        expect(browseIndexMutable.upsertSong).toHaveBeenCalledWith(
            expect.objectContaining({
                virtualPath: "/MUSICIANS/Demo/new.sid",
                fileName: "new.sid",
            }),
        );
        expect(browseIndexMutable.finalize).toHaveBeenCalledTimes(1);
    });

    it("updates songlengths assets for changed songs and reloads the cache", async () => {
        mocks.extractArchiveEntries.mockImplementation(
            async ({ onEntry }: { onEntry?: (path: string, data: Uint8Array) => Promise<void> }) => {
                await onEntry?.(
                    "HVSC/updated/C64Music/DOCUMENTS/Songlengths.txt",
                    new TextEncoder().encode("MUSICIANS/Demo/new.sid 0:42"),
                );
            },
        );

        await ingestArchiveBuffer(createOptions());

        expect(mocks.writeLibraryFile).toHaveBeenCalledWith("/DOCUMENTS/Songlengths.txt", expect.anything());
        expect(mocks.resetSonglengthsCache).toHaveBeenCalledTimes(1);
        expect(mocks.reloadHvscSonglengthsOnConfigChange).toHaveBeenCalledTimes(1);
    });

    it("applies an update on top of the baseline without resetting untouched songs", async () => {
        mocks.extractArchiveEntries.mockImplementation(
            async ({ onEntry }: { onEntry?: (path: string, data: Uint8Array) => Promise<void> }) => {
                await onEntry?.("HVSC/updated/MUSICIANS/Demo/new.sid", new Uint8Array([4, 5, 6]));
            },
        );

        const result = await ingestArchiveBuffer(createOptions());

        expect(result.baselineInstalled).toBe(84);
        expect(mocks.resetLibraryRoot).not.toHaveBeenCalled();
        expect(mocks.deleteLibraryFile).not.toHaveBeenCalled();
        expect(mocks.writeLibraryFile).not.toHaveBeenCalledWith("/MUSICIANS/Legacy/existing.sid", expect.anything());
    });
});
