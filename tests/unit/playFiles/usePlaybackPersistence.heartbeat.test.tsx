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
import { PLAYBACK_SESSION_HEARTBEAT_MS, usePlaybackPersistence } from "@/pages/playFiles/hooks/usePlaybackPersistence";
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

const item = {
  id: "hvsc:lib:/one.sid",
  request: { source: "hvsc", path: "/one.sid" },
  category: "sid",
  label: "one.sid",
  path: "/one.sid",
  sourceId: "lib",
  addedAt: "2026-01-01T00:00:00.000Z",
  status: "ready",
  unavailableReason: null,
} as unknown as PlaylistItem;

const useHarness = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [playbackTime] = useState(createPlaybackTimeStore);
  const trackStartedAtRef = useRef<number | null>(null);
  const sounding = useSoundingTune();
  sounding.soundingTuneRef.current = item;
  usePlaybackPersistence({
    playlist: [item],
    setPlaylist: vi.fn(),
    currentIndex: 0,
    setCurrentIndex: vi.fn(),
    isPlaying,
    setIsPlaying,
    isPaused,
    setIsPaused,
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
  return { setIsPlaying, setIsPaused, playbackTime, trackStartedAtRef, soundingTuneRef: sounding.soundingTuneRef };
};

describe("usePlaybackPersistence stored position while the clock is not ticking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is refreshed from the tune's start time every few seconds, though the Play tab's clock is stopped", async () => {
    const { result } = renderHook(useHarness);
    result.current.trackStartedAtRef.current = Date.now() - 20_000;
    await act(async () => {
      result.current.setIsPlaying(true);
    });
    expect(readStoredPlaybackSession()?.elapsedMs).toBe(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYBACK_SESSION_HEARTBEAT_MS);
    });

    expect(readStoredPlaybackSession()?.elapsedMs).toBe(25_000);
    expect(readStoredPlaybackSession()?.playedMs).toBe(25_000);
  });

  it("writes no session while a skip has cleared the sounding tune, and keeps the last consistent one", async () => {
    const { result } = renderHook(useHarness);
    result.current.trackStartedAtRef.current = Date.now() - 20_000;
    await act(async () => {
      result.current.setIsPlaying(true);
    });
    const before = readStoredPlaybackSession();
    expect(before?.currentItemId).toBe(item.id);
    result.current.soundingTuneRef.current = null;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYBACK_SESSION_HEARTBEAT_MS * 3);
    });

    expect(readStoredPlaybackSession()).toEqual(before);
  });

  it("keeps up with the tune on every beat, not just the first", async () => {
    const { result } = renderHook(useHarness);
    result.current.trackStartedAtRef.current = Date.now();
    await act(async () => {
      result.current.setIsPlaying(true);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYBACK_SESSION_HEARTBEAT_MS * 3);
    });

    expect(readStoredPlaybackSession()?.elapsedMs).toBe(PLAYBACK_SESSION_HEARTBEAT_MS * 3);
  });

  it("never writes a position behind the one the clock already shows", async () => {
    const { result } = renderHook(useHarness);
    result.current.trackStartedAtRef.current = Date.now();
    result.current.playbackTime.set({ elapsedMs: 90_000, playedMs: 90_000 });
    await act(async () => {
      result.current.setIsPlaying(true);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYBACK_SESSION_HEARTBEAT_MS);
    });

    expect(readStoredPlaybackSession()?.elapsedMs).toBe(90_000);
  });

  it("does not run while paused, so the paused position is not advanced", async () => {
    const { result } = renderHook(useHarness);
    result.current.trackStartedAtRef.current = Date.now() - 20_000;
    result.current.playbackTime.set({ elapsedMs: 20_000, playedMs: 20_000 });
    await act(async () => {
      result.current.setIsPlaying(true);
      result.current.setIsPaused(true);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYBACK_SESSION_HEARTBEAT_MS * 3);
    });

    expect(readStoredPlaybackSession()?.elapsedMs).toBe(20_000);
  });

  it("does nothing before the tune has a start time", async () => {
    const { result } = renderHook(useHarness);
    await act(async () => {
      result.current.setIsPlaying(true);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(PLAYBACK_SESSION_HEARTBEAT_MS * 2);
    });

    expect(readStoredPlaybackSession()?.elapsedMs).toBe(0);
  });
});
