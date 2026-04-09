/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackPersistence } from "@/pages/playFiles/hooks/usePlaybackPersistence";
import type { PlayableEntry, PlaylistItem } from "@/pages/playFiles/types";
import { buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";

const repository = {
  upsertTracks: vi.fn().mockResolvedValue(undefined),
  replacePlaylistItems: vi.fn().mockResolvedValue(undefined),
  getPlaylistItems: vi.fn().mockResolvedValue([]),
  getPlaylistItemCount: vi.fn().mockResolvedValue(2),
  getTracksByIds: vi.fn().mockResolvedValue(new Map()),
  saveSession: vi.fn().mockResolvedValue(undefined),
  getSession: vi.fn().mockResolvedValue(null),
  createSession: vi.fn(),
  next: vi.fn(),
  getRandomSession: vi.fn(),
  saveRandomSession: vi.fn(),
};

vi.mock("@/lib/playlistRepository", () => ({
  getPlaylistDataRepository: () => repository,
}));

const buildPlaylistItem = (entry: PlayableEntry, songNrOverride?: number, addedAtOverride?: string | null) =>
  ({
    id: `${entry.source}:${entry.sourceId ?? ""}:${entry.path}`,
    request: {
      source: entry.source,
      path: entry.path,
      file: entry.file,
      songNr: songNrOverride,
    },
    category: "sid",
    label: entry.name,
    path: entry.path,
    durationMs: entry.durationMs,
    sourceId: entry.sourceId ?? null,
    sizeBytes: entry.sizeBytes ?? null,
    modifiedAt: entry.modifiedAt ?? null,
    addedAt: addedAtOverride ?? new Date().toISOString(),
    status: "ready",
    unavailableReason: null,
  }) satisfies PlaylistItem;

const useHarness = (playlistStorageKey: string) => {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>([
    buildPlaylistItem({
      source: "hvsc",
      name: "one.sid",
      path: "/MUSICIANS/Test/one.sid",
      sourceId: "hvsc-library",
    }),
    buildPlaylistItem({
      source: "hvsc",
      name: "two.sid",
      path: "/MUSICIANS/Test/two.sid",
      sourceId: "hvsc-library",
    }),
  ]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [playedMs, setPlayedMs] = useState(0);
  const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
  const [activePlaylistQuery, setActivePlaylistQuery] = useState("");
  const playedClockRef = useRef({ hydrate: vi.fn() });
  const trackStartedAtRef = useRef<number | null>(null);
  const trackInstanceIdRef = useRef(0);
  const autoAdvanceGuardRef = useRef<any>(null);

  usePlaybackPersistence({
    playlist,
    setPlaylist,
    currentIndex,
    setCurrentIndex,
    isPlaying,
    setIsPlaying,
    isPaused,
    setIsPaused,
    elapsedMs,
    setElapsedMs,
    playedMs,
    setPlayedMs,
    durationMs,
    setDurationMs,
    setCurrentSubsongCount: vi.fn(),
    activePlaylistQuery,
    resolvedDeviceId: "device-1",
    playlistStorageKey,
    setActivePlaylistQuery,
    localEntriesBySourceId: new Map(),
    localSourceTreeUris: new Map(),
    buildHvscLocalPlayFile: (path, name) => ({
      name,
      webkitRelativePath: path,
      lastModified: Date.now(),
      arrayBuffer: async () => new ArrayBuffer(4),
    }),
    buildPlaylistItem,
    playedClockRef: playedClockRef as any,
    trackStartedAtRef,
    trackInstanceIdRef,
    autoAdvanceGuardRef,
    setTrackInstanceId: vi.fn(),
    setAutoAdvanceDueAtMs: vi.fn(),
  });

  return {
    activePlaylistQuery,
    currentIndex,
    setCurrentIndex,
    setActivePlaylistQuery,
  };
};

describe("usePlaybackPersistence repository session persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    Object.values(repository).forEach((value) => {
      if (typeof value === "function" && "mockClear" in value) {
        value.mockClear();
      }
    });
    repository.getPlaylistItems.mockResolvedValue([]);
    repository.getPlaylistItemCount.mockResolvedValue(2);
    repository.getTracksByIds.mockResolvedValue(new Map());
    repository.getSession.mockResolvedValue(null);
    repository.upsertTracks.mockResolvedValue(undefined);
    repository.replacePlaylistItems.mockResolvedValue(undefined);
    repository.saveSession.mockResolvedValue(undefined);
  });

  it("updates repository session state without rewriting playlist rows when only currentIndex changes", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    const { result } = renderHook(() => useHarness(playlistStorageKey));

    await waitFor(() => {
      expect(repository.replacePlaylistItems).toHaveBeenCalledTimes(1);
    });

    repository.replacePlaylistItems.mockClear();

    await act(async () => {
      result.current.setCurrentIndex(1);
    });

    await waitFor(() => {
      expect(repository.saveSession).toHaveBeenCalled();
    });

    expect(repository.replacePlaylistItems).not.toHaveBeenCalled();
    expect(repository.saveSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        playlistId: playlistStorageKey,
        currentPlaylistItemId: "hvsc:hvsc-library:/MUSICIANS/Test/two.sid",
        activeQuery: "",
      }),
    );
  });

  it("persists the active playlist query in repository session state without rewriting playlist rows", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    const { result } = renderHook(() => useHarness(playlistStorageKey));

    await waitFor(() => {
      expect(repository.replacePlaylistItems).toHaveBeenCalledTimes(1);
    });

    repository.replacePlaylistItems.mockClear();

    await act(async () => {
      result.current.setActivePlaylistQuery("demo");
    });

    await waitFor(() => {
      expect(repository.saveSession).toHaveBeenCalledWith(
        expect.objectContaining({
          playlistId: playlistStorageKey,
          activeQuery: "demo",
        }),
      );
    });

    expect(repository.replacePlaylistItems).not.toHaveBeenCalled();
  });

  it("restores the active playlist query from repository session state", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    repository.getSession.mockResolvedValueOnce({
      playlistId: playlistStorageKey,
      currentPlaylistItemId: null,
      isPlaying: false,
      isPaused: false,
      elapsedMs: 0,
      playedMs: 0,
      shuffleEnabled: false,
      repeatEnabled: false,
      randomSeed: null,
      randomCursor: null,
      activeQuery: "demo",
      updatedAt: "2026-04-03T20:00:00.000Z",
    });

    const { result } = renderHook(() => useHarness(playlistStorageKey));

    await waitFor(() => {
      expect(result.current.activePlaylistQuery).toBe("demo");
    });
  });
});
