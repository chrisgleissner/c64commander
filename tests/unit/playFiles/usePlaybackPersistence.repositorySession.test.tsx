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
import { PLAYBACK_SESSION_KEY, buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";

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

const useHarness = (playlistStorageKey: string, options?: { startEmpty?: boolean }) => {
  const [playlist, setPlaylist] = useState<PlaylistItem[]>(
    options?.startEmpty
      ? []
      : [
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
        ],
  );
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
    playlist,
    isPlaying,
    elapsedMs,
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

  it("does not delete a stored playing session while repository hydration is pending (playback survives navigation remount)", async () => {
    const playlistStorageKey = buildPlaylistStorageKey("device-1");
    const trackId = "hvsc:hvsc-library:/MUSICIANS/Test/one.sid";
    sessionStorage.setItem(
      PLAYBACK_SESSION_KEY,
      JSON.stringify({
        playlistKey: playlistStorageKey,
        currentItemId: trackId,
        currentItemLabel: "one.sid",
        currentIndex: 0,
        isPlaying: true,
        isPaused: false,
        elapsedMs: 5000,
        playedMs: 5000,
        durationMs: 60000,
        updatedAt: new Date().toISOString(),
      }),
    );

    repository.getPlaylistItemCount.mockResolvedValue(1);
    let releaseHydration: (items: unknown[]) => void = () => {};
    repository.getPlaylistItems.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseHydration = resolve;
      }),
    );
    repository.getTracksByIds.mockResolvedValue(
      new Map([
        [
          trackId,
          {
            trackId,
            sourceKind: "hvsc",
            sourceId: "hvsc-library",
            sourceLocator: "/MUSICIANS/Test/one.sid",
            path: "/MUSICIANS/Test/one.sid",
            title: "one.sid",
            origin: null,
            configRef: null,
            archiveRef: null,
            defaultDurationMs: 60000,
            subsongCount: null,
            sizeBytes: null,
            modifiedAt: null,
          },
        ],
      ]),
    );

    const { result } = renderHook(() => useHarness(playlistStorageKey, { startEmpty: true }));

    // Hydration is still pending: the freshly mounted (not yet restored)
    // instance must not delete the live session a navigation remount relies on.
    expect(sessionStorage.getItem(PLAYBACK_SESSION_KEY)).not.toBeNull();

    await act(async () => {
      releaseHydration([
        {
          trackId,
          songNr: undefined,
          configRef: null,
          configOrigin: null,
          configOverrides: null,
          addedAt: new Date().toISOString(),
          status: "ready",
          unavailableReason: null,
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.playlist).toHaveLength(1);
      expect(result.current.isPlaying).toBe(true);
    });
    expect(result.current.elapsedMs).toBe(5000);
    expect(JSON.parse(sessionStorage.getItem(PLAYBACK_SESSION_KEY)!).isPlaying).toBe(true);
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
