/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
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
});
