/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQueryFilteredPlaylist } from "@/pages/playFiles/hooks/useQueryFilteredPlaylist";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";
import type { PlayFileCategory } from "@/lib/playback/fileTypes";

const CATEGORIES: PlayFileCategory[] = ["sid", "mod", "prg", "crt", "disk"];

const buildScalePlaylistItem = (index: number): PlaylistItem => {
    const category = CATEGORIES[index % CATEGORIES.length];
    return {
        id: `item-${index}`,
        request: { source: "hvsc", path: `/MUSICIANS/Artist${index % 100}/Track${index}.sid`, songNr: 1 },
        category,
        label: `Track ${index}`,
        path: `/MUSICIANS/Artist${index % 100}/Track${index}.sid`,
        sourceId: "hvsc-library",
        addedAt: "2026-04-03T18:00:00.000Z",
        status: "ready",
        unavailableReason: null,
    };
};

const buildScaleQueryRow = (item: PlaylistItem, index: number, playlistId: string) => ({
    playlistItem: {
        playlistItemId: item.id,
        playlistId,
        trackId: `hvsc:hvsc-library:${item.path}`,
        songNr: 1,
        sortKey: String(index).padStart(8, "0"),
        status: "ready" as const,
        unavailableReason: null,
        addedAt: item.addedAt ?? "2026-04-03T18:00:00.000Z",
    },
    track: {
        trackId: `hvsc:hvsc-library:${item.path}`,
        sourceKind: "hvsc" as const,
        sourceLocator: item.path,
        sourceId: "hvsc-library",
        category: item.category,
        title: item.label,
        path: item.path,
        createdAt: "2026-04-03T18:00:00.000Z",
        updatedAt: "2026-04-03T18:00:00.000Z",
    },
});

const repository = {
    upsertTracks: vi.fn().mockResolvedValue(undefined),
    replacePlaylistItems: vi.fn().mockResolvedValue(undefined),
    getPlaylistItems: vi.fn(),
    getTracksByIds: vi.fn(),
    saveSession: vi.fn(),
    getSession: vi.fn(),
    createSession: vi.fn(),
    next: vi.fn(),
    getRandomSession: vi.fn(),
    saveRandomSession: vi.fn(),
    queryPlaylist: vi.fn(),
};

vi.mock("@/lib/playlistRepository", () => ({
    getPlaylistDataRepository: () => repository,
}));

const runScaleTest = async (itemCount: number) => {
    const playlistId = buildPlaylistStorageKey("device-1");
    const items = Array.from({ length: itemCount }, (_, i) => buildScalePlaylistItem(i));
    const allRows = items.map((item, i) => buildScaleQueryRow(item, i, playlistId));

    repository.queryPlaylist.mockImplementation(
        async ({
            categoryFilter,
            query,
            limit,
            offset,
        }: {
            categoryFilter?: string[];
            query?: string;
            limit: number;
            offset?: number;
        }) => {
            const filtered = allRows.filter((row) => {
                const catMatch = categoryFilter?.length ? categoryFilter.includes(row.track.category ?? "") : true;
                const qMatch = query ? row.track.title.toLowerCase().includes(query.toLowerCase()) : true;
                return catMatch && qMatch;
            });
            const start = offset ?? 0;
            return {
                rows: filtered.slice(start, start + limit),
                totalMatchCount: filtered.length,
            };
        },
    );

    const previewLimit = 100;
    const viewAllPageSize = 200;

    const startMs = performance.now();
    const { result } = renderHook(() =>
        useQueryFilteredPlaylist({
            playlist: items,
            playlistStorageKey: playlistId,
            playlistTypeFilters: CATEGORIES,
            query: "",
            previewLimit,
            viewAllPageSize,
        }),
    );

    await waitFor(() => {
        expect(result.current.totalMatchCount).toBe(itemCount);
    });
    const syncMs = performance.now() - startMs;

    return { result, syncMs, items, previewLimit, viewAllPageSize, itemCount };
};

describe("useQueryFilteredPlaylist scale", () => {
    beforeEach(() => {
        Object.values(repository).forEach((value) => {
            if (typeof value === "function" && "mockClear" in value) {
                value.mockClear();
            }
        });
        repository.upsertTracks.mockResolvedValue(undefined);
        repository.replacePlaylistItems.mockResolvedValue(undefined);
    });

    it(
        "handles 10k playlist items with correct windowing",
        async () => {
            const { result, previewLimit, itemCount } = await runScaleTest(10_000);

            expect(result.current.previewPlaylist).toHaveLength(previewLimit);
            expect(result.current.viewAllPlaylist.length).toBeLessThanOrEqual(Math.max(previewLimit, 200));
            expect(result.current.totalMatchCount).toBe(itemCount);
            expect(result.current.hasMoreViewAllResults).toBe(true);
            expect(repository.upsertTracks).toHaveBeenCalledTimes(1);
            expect(repository.replacePlaylistItems).toHaveBeenCalledTimes(1);
        },
        30_000,
    );

    it(
        "handles 50k playlist items with correct windowing",
        async () => {
            const { result, previewLimit, itemCount } = await runScaleTest(50_000);

            expect(result.current.previewPlaylist).toHaveLength(previewLimit);
            expect(result.current.totalMatchCount).toBe(itemCount);
            expect(result.current.hasMoreViewAllResults).toBe(true);
        },
        60_000,
    );

    it(
        "handles 100k playlist items with correct windowing",
        async () => {
            const { result, previewLimit, itemCount } = await runScaleTest(100_000);

            expect(result.current.previewPlaylist).toHaveLength(previewLimit);
            expect(result.current.totalMatchCount).toBe(itemCount);
            expect(result.current.hasMoreViewAllResults).toBe(true);
        },
        120_000,
    );

    it(
        "category filter at 10k scale returns correct subset",
        async () => {
            const playlistId = buildPlaylistStorageKey("device-1");
            const items = Array.from({ length: 10_000 }, (_, i) => buildScalePlaylistItem(i));
            const allRows = items.map((item, i) => buildScaleQueryRow(item, i, playlistId));
            const sidCount = allRows.filter((r) => r.track.category === "sid").length;

            repository.queryPlaylist.mockImplementation(
                async ({
                    categoryFilter,
                    limit,
                    offset,
                }: {
                    categoryFilter?: string[];
                    limit: number;
                    offset?: number;
                }) => {
                    const filtered = allRows.filter((row) =>
                        categoryFilter?.length ? categoryFilter.includes(row.track.category ?? "") : true,
                    );
                    const start = offset ?? 0;
                    return {
                        rows: filtered.slice(start, start + limit),
                        totalMatchCount: filtered.length,
                    };
                },
            );

            const { result } = renderHook(() =>
                useQueryFilteredPlaylist({
                    playlist: items,
                    playlistStorageKey: playlistId,
                    playlistTypeFilters: ["sid"],
                    query: "",
                    previewLimit: 100,
                    viewAllPageSize: 200,
                }),
            );

            await waitFor(() => {
                expect(result.current.totalMatchCount).toBe(sidCount);
            });

            expect(result.current.previewPlaylist.every((item) => item.category === "sid")).toBe(true);
            expect(result.current.totalMatchCount).toBe(2000);
        },
        30_000,
    );
});
