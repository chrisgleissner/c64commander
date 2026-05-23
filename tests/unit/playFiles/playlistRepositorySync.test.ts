/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commitPlaylistSnapshot, resetPlaylistRepositorySyncForTests } from "@/pages/playFiles/playlistRepositorySync";
import { buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";
import type { PlaylistItem } from "@/pages/playFiles/types";

const { beginHvscPerfScope, endHvscPerfScope } = vi.hoisted(() => ({
  beginHvscPerfScope: vi.fn((scope: string, metadata?: Record<string, unknown>) => ({
    scope,
    metadata: metadata ?? null,
  })),
  endHvscPerfScope: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscPerformance", () => ({
  beginHvscPerfScope,
  endHvscPerfScope,
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

const buildPlaylistItem = (index: number): PlaylistItem => ({
  id: `item-${index}`,
  request: {
    source: "hvsc",
    path: `/MUSICIANS/Test/Track${index}.sid`,
    songNr: 1,
  },
  category: "sid",
  label: `Track ${index}`,
  path: `/MUSICIANS/Test/Track${index}.sid`,
  sourceId: "hvsc-library",
  addedAt: "2026-04-06T10:00:00.000Z",
  status: "ready",
  unavailableReason: null,
});

describe("playlistRepositorySync", () => {
  beforeEach(() => {
    resetPlaylistRepositorySyncForTests();
    beginHvscPerfScope.mockClear();
    endHvscPerfScope.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("commits 10k playlist items and validates immediate repository visibility", async () => {
    const playlistId = buildPlaylistStorageKey("device-1");
    const items = Array.from({ length: 10_000 }, (_, index) => buildPlaylistItem(index));
    const repository = {
      upsertTracks: vi.fn().mockResolvedValue(undefined),
      replacePlaylistItems: vi.fn().mockResolvedValue(undefined),
      getPlaylistItems: vi.fn(),
      getPlaylistItemCount: vi.fn().mockResolvedValue(items.length),
      getTracksByIds: vi.fn(),
      saveSession: vi.fn(),
      getSession: vi.fn(),
      queryPlaylist: vi.fn(),
      createSession: vi.fn(),
      next: vi.fn(),
      getRandomSession: vi.fn(),
      saveRandomSession: vi.fn(),
    };

    const result = await commitPlaylistSnapshot({
      playlistId,
      items,
      repository: repository as any,
    });

    expect(result.committedCount).toBe(10_000);
    expect(result.expectedCount).toBe(10_000);
    expect(repository.upsertTracks).toHaveBeenCalledTimes(20);
    expect(repository.replacePlaylistItems).toHaveBeenCalledTimes(1);
    expect(repository.getPlaylistItemCount).toHaveBeenCalledWith(playlistId);
    expect(endHvscPerfScope).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "playlist:repo-sync" }),
      expect.objectContaining({ outcome: "success", committedCount: 10_000 }),
    );
  });

  it("fails loudly when repository validation count does not match the committed snapshot", async () => {
    const playlistId = buildPlaylistStorageKey("device-1");
    const items = Array.from({ length: 4 }, (_, index) => buildPlaylistItem(index));
    const repository = {
      upsertTracks: vi.fn().mockResolvedValue(undefined),
      replacePlaylistItems: vi.fn().mockResolvedValue(undefined),
      getPlaylistItems: vi.fn(),
      getPlaylistItemCount: vi.fn().mockResolvedValue(3),
      getTracksByIds: vi.fn(),
      saveSession: vi.fn(),
      getSession: vi.fn(),
      queryPlaylist: vi.fn(),
      createSession: vi.fn(),
      next: vi.fn(),
      getRandomSession: vi.fn(),
      saveRandomSession: vi.fn(),
    };

    await expect(
      commitPlaylistSnapshot({
        playlistId,
        items,
        repository: repository as any,
      }),
    ).rejects.toThrow(`Playlist repository validation failed for ${playlistId}: expected 4, got 3`);

    expect(endHvscPerfScope).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "playlist:repo-sync" }),
      expect.objectContaining({ outcome: "error", errorMessage: expect.stringContaining("expected 4, got 3") }),
    );
  });

  it("uses repository atomic snapshot persistence when available", async () => {
    const playlistId = buildPlaylistStorageKey("device-1");
    const items = Array.from({ length: 2_500 }, (_, index) => buildPlaylistItem(index));
    const repository = {
      replacePlaylistSnapshot: vi.fn().mockResolvedValue(undefined),
      upsertTracks: vi.fn().mockResolvedValue(undefined),
      replacePlaylistItems: vi.fn().mockResolvedValue(undefined),
      getPlaylistItems: vi.fn(),
      getPlaylistItemCount: vi.fn().mockResolvedValue(items.length),
      getTracksByIds: vi.fn(),
      saveSession: vi.fn(),
      getSession: vi.fn(),
      queryPlaylist: vi.fn(),
      createSession: vi.fn(),
      next: vi.fn(),
      getRandomSession: vi.fn(),
      saveRandomSession: vi.fn(),
    };

    const result = await commitPlaylistSnapshot({
      playlistId,
      items,
      repository: repository as any,
    });

    expect(result.committedCount).toBe(items.length);
    expect(repository.replacePlaylistSnapshot).toHaveBeenCalledTimes(1);
    expect(repository.upsertTracks).not.toHaveBeenCalled();
    expect(repository.replacePlaylistItems).not.toHaveBeenCalled();
  });

  describe("snapshot key (PH8: persisted-metadata coverage)", () => {
    const playlistId = "ph8-playlist";
    const buildRepo = (count: number) =>
      ({
        replacePlaylistSnapshot: vi.fn().mockResolvedValue(undefined),
        upsertTracks: vi.fn().mockResolvedValue(undefined),
        replacePlaylistItems: vi.fn().mockResolvedValue(undefined),
        getPlaylistItems: vi.fn(),
        getPlaylistItemCount: vi.fn().mockResolvedValue(count),
        getTracksByIds: vi.fn(),
        saveSession: vi.fn(),
        getSession: vi.fn(),
        queryPlaylist: vi.fn(),
        createSession: vi.fn(),
        next: vi.fn(),
        getRandomSession: vi.fn(),
        saveRandomSession: vi.fn(),
      }) as any;
    const commit = async (items: PlaylistItem[]) => {
      const repo = buildRepo(items.length);
      const result = await commitPlaylistSnapshot({ playlistId, items, repository: repo });
      return { result, repo };
    };

    it("re-commits when only durationMs (durationOverrideMs in repo) changes", async () => {
      const baseItems = [buildPlaylistItem(1)];
      const first = await commit(baseItems);
      const updated = [{ ...baseItems[0], durationMs: 45_000 }];
      const second = await commit(updated);
      expect(first.result.snapshotKey).not.toEqual(second.result.snapshotKey);
      // Each commit must actually persist (no false coalescing)
      expect(first.repo.replacePlaylistSnapshot).toHaveBeenCalledTimes(1);
      expect(second.repo.replacePlaylistSnapshot).toHaveBeenCalledTimes(1);
    });

    it("re-commits when only configRef changes", async () => {
      const baseItems = [buildPlaylistItem(2)];
      const first = await commit(baseItems);
      const updated = [
        {
          ...baseItems[0],
          configRef: { source: "library" as const, name: "fast-loader.cfg" } as any,
        },
      ];
      const second = await commit(updated);
      expect(first.result.snapshotKey).not.toEqual(second.result.snapshotKey);
    });

    it("re-commits when only configOrigin changes", async () => {
      const baseItems = [
        {
          ...buildPlaylistItem(21),
          configRef: { kind: "ultimate" as const, fileName: "fast.cfg", path: "/configs/fast.cfg" },
          configOrigin: "auto-exact" as const,
        },
      ];
      const first = await commit(baseItems);
      const updated = [{ ...baseItems[0], configOrigin: "manual" as const }];
      const second = await commit(updated);
      expect(first.result.snapshotKey).not.toEqual(second.result.snapshotKey);
    });

    it("re-commits when configOverrides change", async () => {
      const baseItems = [
        { ...buildPlaylistItem(3), configOverrides: [{ category: "audio", item: "volume", value: "80" }] },
      ];
      const first = await commit(baseItems);
      const updated = [{ ...baseItems[0], configOverrides: [{ category: "audio", item: "volume", value: "60" }] }];
      const second = await commit(updated);
      expect(first.result.snapshotKey).not.toEqual(second.result.snapshotKey);
    });

    it("re-commits when only source origin metadata changes", async () => {
      const baseItems = [
        {
          ...buildPlaylistItem(31),
          origin: {
            sourceKind: "ultimate" as const,
            originDeviceId: "u64",
            originDeviceLastKnownUniqueId: "38C1BA",
            originPath: "/USB/SIDS/Track31.sid",
            importedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      ];
      const first = await commit(baseItems);
      const updated = [
        {
          ...baseItems[0],
          origin: { ...baseItems[0].origin!, originDeviceId: "c64u", originDeviceLastKnownUniqueId: "5D4E12" },
        },
      ];
      const second = await commit(updated);
      expect(first.result.snapshotKey).not.toEqual(second.result.snapshotKey);
    });

    it("re-commits when unavailableReason flips status to unavailable", async () => {
      const baseItems = [buildPlaylistItem(4)];
      const first = await commit(baseItems);
      const updated = [
        { ...baseItems[0], status: "unavailable" as const, unavailableReason: "origin-file-missing" as const },
      ];
      const second = await commit(updated);
      expect(first.result.snapshotKey).not.toEqual(second.result.snapshotKey);
    });

    it("re-commits when sizeBytes or modifiedAt change (track-record drift)", async () => {
      const baseItems = [{ ...buildPlaylistItem(5), sizeBytes: 4096, modifiedAt: "2026-01-01T00:00:00.000Z" }];
      const first = await commit(baseItems);
      const updated = [{ ...baseItems[0], sizeBytes: 8192, modifiedAt: "2026-02-01T00:00:00.000Z" }];
      const second = await commit(updated);
      expect(first.result.snapshotKey).not.toEqual(second.result.snapshotKey);
    });

    it("re-commits when archiveRef or subsongCount change", async () => {
      const baseItems = [
        {
          ...buildPlaylistItem(51),
          archiveRef: {
            sourceId: "csdb",
            resultId: "release-1",
            category: 1,
            entryId: 100,
            entryPath: "music/old.sid",
          },
          subsongCount: 2,
        },
      ];
      const first = await commit(baseItems);
      const updated = [
        {
          ...baseItems[0],
          archiveRef: { ...baseItems[0].archiveRef!, entryPath: "music/new.sid" },
          subsongCount: 3,
        },
      ];
      const second = await commit(updated);
      expect(first.result.snapshotKey).not.toEqual(second.result.snapshotKey);
    });

    it("re-commits when category, label, or item order changes", async () => {
      const baseItems = [buildPlaylistItem(61), buildPlaylistItem(62)];
      const first = await commit(baseItems);
      const relabeled = [{ ...baseItems[0], category: "mod" as const, label: "Renamed Track" }, baseItems[1]];
      const second = await commit(relabeled);
      const reordered = [baseItems[1], baseItems[0]];
      const third = await commit(reordered);

      expect(first.result.snapshotKey).not.toEqual(second.result.snapshotKey);
      expect(first.result.snapshotKey).not.toEqual(third.result.snapshotKey);
    });

    it("coalesces a truly identical re-commit (no false-positive churn)", async () => {
      const items = [buildPlaylistItem(6)];
      const first = await commit(items);
      const repo = buildRepo(items.length);
      const second = await commitPlaylistSnapshot({
        playlistId,
        items: items.map((item) => ({ ...item })),
        repository: repo,
      });
      expect(second.snapshotKey).toEqual(first.result.snapshotKey);
      // Second call must short-circuit without hitting the repository
      expect(repo.replacePlaylistSnapshot).not.toHaveBeenCalled();
      expect(repo.upsertTracks).not.toHaveBeenCalled();
      expect(repo.replacePlaylistItems).not.toHaveBeenCalled();
    });

    it("keeps snapshot keys stable while persisting real timestamps for missing item dates", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-22T12:00:00.000Z"));
      const itemWithoutDate: PlaylistItem = { ...buildPlaylistItem(7) };
      delete itemWithoutDate.addedAt;
      const items = [itemWithoutDate];
      const firstRepo = buildRepo(items.length);

      const first = await commitPlaylistSnapshot({ playlistId, items, repository: firstRepo });

      expect(firstRepo.replacePlaylistSnapshot).toHaveBeenCalledWith(
        playlistId,
        expect.objectContaining({
          playlistItems: [expect.objectContaining({ addedAt: "2026-05-22T12:00:00.000Z" })],
          tracks: [expect.objectContaining({ updatedAt: "2026-05-22T12:00:00.000Z" })],
        }),
      );

      vi.setSystemTime(new Date("2026-05-22T13:00:00.000Z"));
      const secondRepo = buildRepo(items.length);
      const second = await commitPlaylistSnapshot({
        playlistId,
        items: items.map((item) => ({ ...item })),
        repository: secondRepo,
      });

      expect(second.snapshotKey).toEqual(first.snapshotKey);
      expect(secondRepo.replacePlaylistSnapshot).not.toHaveBeenCalled();
    });

    it("does not stringify the full serialized snapshot while deriving snapshot keys", async () => {
      const items = [buildPlaylistItem(8)];
      const repo = buildRepo(items.length);
      const originalStringify = JSON.stringify;
      const stringifySpy = vi.spyOn(JSON, "stringify").mockImplementation((value, replacer, space) => {
        if (value && typeof value === "object" && "tracks" in value && "playlistItems" in value) {
          throw new Error("full snapshot stringify is not allowed for snapshot keys");
        }
        return originalStringify(value, replacer as never, space);
      });

      try {
        await expect(commitPlaylistSnapshot({ playlistId, items, repository: repo })).resolves.toEqual(
          expect.objectContaining({ committedCount: items.length }),
        );
      } finally {
        stringifySpy.mockRestore();
      }
    });
  });
});
