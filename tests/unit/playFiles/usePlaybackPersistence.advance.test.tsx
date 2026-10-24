/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackPersistence } from "@/pages/playFiles/hooks/usePlaybackPersistence";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { readStoredPlaybackSession } from "@/lib/playback/playbackSessionStore";
import { buildPlaylistStorageKey } from "@/pages/playFiles/playFilesUtils";
import { createPlaybackTimeStore } from "@/pages/playFiles/playbackTimeStore";
import { useSoundingTune } from "@/pages/playFiles/hooks/useSoundingTune";

vi.mock("@/lib/playlistRepository", () => ({
  getPlaylistDataRepository: () => ({
    upsertTracks: vi.fn().mockResolvedValue(undefined),
    replacePlaylistItems: vi.fn().mockResolvedValue(undefined),
    getPlaylistItems: vi.fn().mockResolvedValue([]),
    getPlaylistItemCount: vi.fn().mockResolvedValue(0),
    getTracksByIds: vi.fn().mockResolvedValue(new Map()),
    saveSession: vi.fn().mockResolvedValue(undefined),
    getSession: vi.fn().mockResolvedValue(null),
  }),
}));

const makeItem = (id: string, path: string) =>
  ({
    id,
    request: { source: "hvsc", path },
    category: "sid",
    label: path.slice(1),
    path,
    sourceId: "lib",
    addedAt: "2026-01-01T00:00:00.000Z",
    status: "ready",
    unavailableReason: null,
  }) as unknown as PlaylistItem;

const tuneA = makeItem("hvsc:lib:/a.sid", "/a.sid");
const tuneB = makeItem("hvsc:lib:/b.sid", "/b.sid");

const useHarness = () => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [playbackTime] = useState(createPlaybackTimeStore);
  const trackStartedAtRef = useRef<number | null>(Date.now());
  const sounding = useSoundingTune();
  usePlaybackPersistence({
    playlist: [tuneA, tuneB],
    setPlaylist: vi.fn(),
    currentIndex,
    setCurrentIndex: vi.fn(),
    isPlaying: true,
    setIsPlaying: vi.fn(),
    isPaused: false,
    setIsPaused: vi.fn(),
    playbackTime,
    durationMs: 195_000,
    setDurationMs: vi.fn(),
    setDurationMsItemId: vi.fn(),
    autoAdvanceDueAtMs: null,
    setCurrentSubsongCount: vi.fn(),
    resolvedDeviceId: "device-1",
    playlistStorageKey: buildPlaylistStorageKey("device-1"),
    localEntriesBySourceId: new Map(),
    localSourceTreeUris: new Map(),
    buildHvscLocalPlayFile: () => null,
    buildPlaylistItem: () => null,
    playedClockRef: { current: { hydrate: vi.fn() } } as never,
    trackStartedAtRef,
    ...sounding,
    trackInstanceIdRef: { current: 0 },
    autoAdvanceGuardRef: { current: null },
    setTrackInstanceId: vi.fn(),
    setAutoAdvanceDueAtMs: vi.fn(),
    setSessionRestoreSettled: vi.fn(),
  });
  return { setCurrentIndex, playbackTime, setSoundingTune: sounding.setSoundingTune };
};

describe("usePlaybackPersistence at an auto-advance (#559)", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("does not store the previous tune with the new tune's elapsed time of zero before the page has re-rendered", async () => {
    const { result } = renderHook(useHarness);
    await act(async () => {
      result.current.setSoundingTune(tuneA);
      result.current.playbackTime.set({ elapsedMs: 150_000, playedMs: 150_000 });
    });
    expect(readStoredPlaybackSession()).toMatchObject({ currentItemId: tuneA.id, elapsedMs: 150_000 });

    await act(async () => {
      result.current.setSoundingTune(tuneB);
      result.current.playbackTime.set({ elapsedMs: 0, playedMs: 0 });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(readStoredPlaybackSession()).toMatchObject({ currentItemId: tuneA.id, elapsedMs: 150_000 });
  });

  it("stores the new tune with its own elapsed time once the page has caught up", async () => {
    const { result } = renderHook(useHarness);
    await act(async () => {
      result.current.setSoundingTune(tuneA);
      result.current.playbackTime.set({ elapsedMs: 150_000, playedMs: 150_000 });
    });

    await act(async () => {
      result.current.setSoundingTune(tuneB);
      result.current.playbackTime.set({ elapsedMs: 0, playedMs: 0 });
      result.current.setCurrentIndex(1);
    });

    expect(readStoredPlaybackSession()).toMatchObject({ currentItemId: tuneB.id, currentIndex: 1, elapsedMs: 0 });
  });
});
