/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQueryFilteredPlaylist } from "@/pages/playFiles/hooks/useQueryFilteredPlaylist";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";

const { beginHvscPerfScope, endHvscPerfScope } = vi.hoisted(() => ({
  beginHvscPerfScope: vi.fn((scope: string, metadata?: Record<string, unknown>) => ({
    scope,
    name: `hvsc:perf:${scope}`,
    startMarkName: `${scope}:start`,
    startedAt: "2026-04-05T00:00:00.000Z",
    startedAtMs: 0,
    metadata: metadata ?? null,
  })),
  endHvscPerfScope: vi.fn(),
}));

const { recordSmokeBenchmarkSnapshot } = vi.hoisted(() => ({
  recordSmokeBenchmarkSnapshot: vi.fn(),
}));

const buildPlaylistItem = ({
  id,
  name,
  path,
  category,
}: {
  id: string;
  name: string;
  path: string;
  category: PlaylistItem["category"];
}) =>
  ({
    id,
    request: {
      source: "hvsc",
      path,
      songNr: 1,
    },
    category,
    label: name,
    path,
    sourceId: "hvsc-library",
    addedAt: "2026-04-03T18:00:00.000Z",
    status: "ready",
    unavailableReason: null,
  }) satisfies PlaylistItem;

const playlist = [
  buildPlaylistItem({
    id: "sid-1",
    name: "One.sid",
    path: "/MUSICIANS/Test/One.sid",
    category: "sid",
  }),
  buildPlaylistItem({
    id: "disk-1",
    name: "Demo.d64",
    path: "/DEMOS/Test/Demo.d64",
    category: "disk",
  }),
];

const queryRows = [
  {
    playlistItem: {
      playlistItemId: "sid-1",
      playlistId: buildPlaylistStorageKey("device-1"),
      trackId: "track-sid-1",
      songNr: 1,
      sortKey: "00000000",
      status: "ready" as const,
      unavailableReason: null,
      addedAt: "2026-04-03T18:00:00.000Z",
    },
    track: {
      trackId: "track-sid-1",
      sourceKind: "hvsc" as const,
      sourceLocator: "/MUSICIANS/Test/One.sid",
      sourceId: "hvsc-library",
      category: "sid",
      title: "One.sid",
      path: "/MUSICIANS/Test/One.sid",
      createdAt: "2026-04-03T18:00:00.000Z",
      updatedAt: "2026-04-03T18:00:00.000Z",
    },
  },
  {
    playlistItem: {
      playlistItemId: "disk-1",
      playlistId: buildPlaylistStorageKey("device-1"),
      trackId: "track-disk-1",
      songNr: 1,
      sortKey: "00000001",
      status: "ready" as const,
      unavailableReason: null,
      addedAt: "2026-04-03T18:00:00.000Z",
    },
    track: {
      trackId: "track-disk-1",
      sourceKind: "hvsc" as const,
      sourceLocator: "/DEMOS/Test/Demo.d64",
      sourceId: "hvsc-library",
      category: "disk",
      title: "Demo.d64",
      path: "/DEMOS/Test/Demo.d64",
      createdAt: "2026-04-03T18:00:00.000Z",
      updatedAt: "2026-04-03T18:00:00.000Z",
    },
  },
];

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
  queryPlaylist: vi.fn(async ({ categoryFilter, limit }: { categoryFilter?: string[]; limit: number }) => {
    const rows =
      categoryFilter && categoryFilter.length
        ? queryRows.filter((row) => categoryFilter.includes(row.track.category ?? ""))
        : queryRows;
    return {
      rows: rows.slice(0, limit),
      totalMatchCount: rows.length,
    };
  }),
};

vi.mock("@/lib/playlistRepository", () => ({
  getPlaylistDataRepository: () => repository,
}));

vi.mock("@/lib/hvsc/hvscPerformance", () => ({
  beginHvscPerfScope,
  endHvscPerfScope,
}));

vi.mock("@/lib/smoke/smokeMode", () => ({
  recordSmokeBenchmarkSnapshot,
}));

const useHarness = () => {
  const [playlistTypeFilters, setPlaylistTypeFilters] = useState<Array<PlaylistItem["category"]>>(["sid", "disk"]);
  const [query, setQuery] = useState("");
  const queryFilteredPlaylist = useQueryFilteredPlaylist({
    playlist,
    playlistStorageKey: buildPlaylistStorageKey("device-1"),
    playlistTypeFilters,
    query,
    previewLimit: 1,
    viewAllPageSize: 1,
  });

  return {
    queryFilteredPlaylist,
    setPlaylistTypeFilters,
    setQuery,
  };
};

describe("useQueryFilteredPlaylist", () => {
  beforeEach(() => {
    Object.values(repository).forEach((value) => {
      if (typeof value === "function" && "mockClear" in value) {
        value.mockClear();
      }
    });
    beginHvscPerfScope.mockClear();
    endHvscPerfScope.mockClear();
    recordSmokeBenchmarkSnapshot.mockClear();
    repository.upsertTracks.mockResolvedValue(undefined);
    repository.replacePlaylistItems.mockResolvedValue(undefined);
  });

  it("re-queries category filters without rewriting playlist rows", async () => {
    const { result } = renderHook(() => useHarness());

    await waitFor(() => {
      expect(repository.replacePlaylistItems).toHaveBeenCalledTimes(1);
      expect(repository.queryPlaylist).toHaveBeenCalledTimes(1);
      expect(result.current.queryFilteredPlaylist.viewAllPlaylist).toHaveLength(1);
      expect(result.current.queryFilteredPlaylist.previewPlaylist).toHaveLength(1);
      expect(result.current.queryFilteredPlaylist.totalMatchCount).toBe(2);
    });

    repository.upsertTracks.mockClear();
    repository.replacePlaylistItems.mockClear();
    repository.queryPlaylist.mockClear();

    act(() => {
      result.current.setPlaylistTypeFilters(["sid"]);
    });

    await waitFor(() => {
      expect(repository.queryPlaylist).toHaveBeenCalledTimes(1);
      expect(result.current.queryFilteredPlaylist.viewAllPlaylist.map((item) => item.id)).toEqual(["sid-1"]);
      expect(result.current.queryFilteredPlaylist.totalMatchCount).toBe(1);
    });

    expect(repository.upsertTracks).not.toHaveBeenCalled();
    expect(repository.replacePlaylistItems).not.toHaveBeenCalled();
    expect(beginHvscPerfScope).toHaveBeenCalledWith(
      "playlist:repo-sync",
      expect.objectContaining({ playlistId: buildPlaylistStorageKey("device-1") }),
    );
    expect(beginHvscPerfScope).toHaveBeenCalledWith(
      "playlist:filter",
      expect.objectContaining({ playlistId: buildPlaylistStorageKey("device-1"), query: "" }),
    );
    expect(endHvscPerfScope).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "playlist:repo-sync" }),
      expect.objectContaining({ outcome: "success" }),
    );
    expect(endHvscPerfScope).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "playlist:filter" }),
      expect.objectContaining({ source: "repository" }),
    );
  });

  it("re-queries text filters without rewriting playlist rows", async () => {
    repository.queryPlaylist.mockImplementationOnce(async ({ limit }: { limit: number }) => ({
      rows: queryRows.slice(0, limit),
      totalMatchCount: queryRows.length,
    }));
    repository.queryPlaylist.mockImplementation(
      async ({ categoryFilter, query, limit }: { categoryFilter?: string[]; query?: string; limit: number }) => {
        const rows = queryRows.filter((row) => {
          const categoryMatch = categoryFilter?.length ? categoryFilter.includes(row.track.category ?? "") : true;
          const queryMatch = query ? row.track.title.toLowerCase().includes(query.toLowerCase()) : true;
          return categoryMatch && queryMatch;
        });
        return {
          rows: rows.slice(0, limit),
          totalMatchCount: rows.length,
        };
      },
    );

    const { result } = renderHook(() => useHarness());

    await waitFor(() => {
      expect(repository.replacePlaylistItems).toHaveBeenCalledTimes(1);
      expect(repository.queryPlaylist).toHaveBeenCalledTimes(1);
      expect(result.current.queryFilteredPlaylist.viewAllPlaylist).toHaveLength(1);
      expect(result.current.queryFilteredPlaylist.totalMatchCount).toBe(2);
    });

    repository.upsertTracks.mockClear();
    repository.replacePlaylistItems.mockClear();
    repository.queryPlaylist.mockClear();

    act(() => {
      result.current.setQuery("demo");
    });

    await waitFor(() => {
      expect(repository.queryPlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          query: "demo",
        }),
      );
      expect(result.current.queryFilteredPlaylist.viewAllPlaylist.map((item) => item.id)).toEqual(["disk-1"]);
      expect(result.current.queryFilteredPlaylist.totalMatchCount).toBe(1);
    });

    expect(repository.upsertTracks).not.toHaveBeenCalled();
    expect(repository.replacePlaylistItems).not.toHaveBeenCalled();
    expect(recordSmokeBenchmarkSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: "playlist-filter",
        metadata: expect.objectContaining({
          query: "demo",
          source: "repository",
        }),
      }),
    );
  });

  it("loads additional view-all pages without rewriting playlist rows", async () => {
    const { result } = renderHook(() => useHarness());

    await waitFor(() => {
      expect(result.current.queryFilteredPlaylist.viewAllPlaylist.map((item) => item.id)).toEqual(["sid-1"]);
      expect(result.current.queryFilteredPlaylist.hasMoreViewAllResults).toBe(true);
    });

    repository.upsertTracks.mockClear();
    repository.replacePlaylistItems.mockClear();
    repository.queryPlaylist.mockClear();

    act(() => {
      result.current.queryFilteredPlaylist.loadMoreViewAllResults();
    });

    await waitFor(() => {
      expect(repository.queryPlaylist).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 2,
        }),
      );
      expect(result.current.queryFilteredPlaylist.viewAllPlaylist.map((item) => item.id)).toEqual(["sid-1", "disk-1"]);
      expect(result.current.queryFilteredPlaylist.hasMoreViewAllResults).toBe(false);
    });

    expect(repository.upsertTracks).not.toHaveBeenCalled();
    expect(repository.replacePlaylistItems).not.toHaveBeenCalled();
  });

  it("keeps filtering in memory when repository sync fails", async () => {
    repository.upsertTracks.mockRejectedValueOnce(new Error("sync failed"));

    const { result } = renderHook(() => useHarness());

    await waitFor(() => {
      expect(result.current.queryFilteredPlaylist.totalMatchCount).toBe(2);
      expect(result.current.queryFilteredPlaylist.viewAllPlaylist.map((item) => item.id)).toEqual(["sid-1"]);
    });

    repository.queryPlaylist.mockClear();

    act(() => {
      result.current.setQuery("demo");
    });

    await waitFor(() => {
      expect(result.current.queryFilteredPlaylist.viewAllPlaylist.map((item) => item.id)).toEqual(["disk-1"]);
      expect(result.current.queryFilteredPlaylist.totalMatchCount).toBe(1);
    });

    expect(repository.queryPlaylist).not.toHaveBeenCalled();
    expect(endHvscPerfScope).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "playlist:repo-sync" }),
      expect.objectContaining({ outcome: "error", errorMessage: "sync failed" }),
    );
    expect(endHvscPerfScope).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "playlist:filter" }),
      expect.objectContaining({ outcome: "fallback", source: "memory" }),
    );
    expect(recordSmokeBenchmarkSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        scenario: "playlist-filter",
        metadata: expect.objectContaining({
          query: "demo",
          source: "memory",
        }),
      }),
    );
  });
});
