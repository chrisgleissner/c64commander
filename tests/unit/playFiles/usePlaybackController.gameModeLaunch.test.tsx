/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";

vi.mock("@/lib/archive/client", () => ({ createArchiveClient: vi.fn() }));
vi.mock("@/lib/archive/execution", () => ({ buildArchivePlayPlan: vi.fn() }));
vi.mock("@/lib/c64api", () => ({ getC64API: vi.fn(() => ({})) }));
vi.mock("@/lib/playback/playbackRouter", () => ({
  buildPlayPlan: vi.fn((request) => request),
  executePlayPlan: vi.fn(async () => undefined),
  tryFetchUltimateSidBlob: vi.fn(async () => null),
}));
vi.mock("@/lib/hvsc", () => ({
  getHvscDurationByMd5Seconds: vi.fn(async () => null),
  getHvscDurationsByMd5Seconds: vi.fn(async () => null),
}));
vi.mock("@/lib/sid/sidUtils", () => ({
  getSidSongCount: vi.fn(() => 1),
  computeSidMd5: vi.fn(async () => "mock-md5"),
}));
vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock("@/lib/uiErrors", () => ({ reportUserError: vi.fn() }));
vi.mock("@/lib/config/applyConfigFileReference", () => ({
  applyConfigFileReference: vi.fn(async () => undefined),
}));

const createPlaylistItem = (id: string): PlaylistItem => ({
  id,
  request: { source: "ultimate", path: `/PROGRAMS/${id}.prg` },
  category: "prg",
  label: `${id}.prg`,
  path: `/PROGRAMS/${id}.prg`,
  durationMs: 1_000,
  sourceId: null,
  sizeBytes: null,
  modifiedAt: null,
  addedAt: new Date(0).toISOString(),
  status: "ready",
  unavailableReason: null,
});

const renderHarness = (initialPlaylist: PlaylistItem[], onUserLaunchedItem: (item: PlaylistItem) => void) =>
  renderHook(() => {
    const [playlist, setPlaylist] = useState(initialPlaylist);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [playedMs, setPlayedMs] = useState(0);
    const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
    const playedClockRef = useRef({
      start: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      reset: vi.fn(),
      current: vi.fn(() => playedMs),
    });
    const trackStartedAtRef = useRef<number | null>(null);
    const trackInstanceIdRef = useRef(0);
    const autoAdvanceGuardRef = useRef<{
      trackInstanceId: number;
      dueAtMs: number;
      autoFired: boolean;
      userCancelled: boolean;
    } | null>(null);
    const playStartInFlightRef = useRef(false);
    const enqueuePlayTransition = useCallback(async (task: () => Promise<void>) => await task(), []);

    const controller = usePlaybackController({
      playlist,
      setPlaylist,
      currentIndex,
      setCurrentIndex,
      isPlaying,
      setIsPlaying,
      isPaused,
      setIsPaused,
      setIsPlaylistLoading: vi.fn(),
      elapsedMs,
      setElapsedMs,
      playedMs,
      setPlayedMs,
      durationMs,
      setDurationMs,
      setCurrentSubsongCount: vi.fn(),
      setTrackInstanceId: vi.fn(),
      repeatEnabled: false,
      localEntriesBySourceId: new Map(),
      localSourceTreeUris: new Map(),
      deviceProduct: "Ultimate 64 Elite",
      ensurePlaybackConnection: vi.fn().mockResolvedValue(undefined),
      resolveSonglengthDurationMsForPath: vi.fn().mockResolvedValue(null),
      applySonglengthsToItems: vi.fn().mockImplementation(async (items) => items),
      restoreVolumeOverrides: vi.fn().mockResolvedValue(undefined),
      applyAudioMixerUpdates: vi.fn().mockResolvedValue(undefined),
      buildEnabledSidMuteUpdates: vi.fn().mockReturnValue({}),
      captureSidMuteSnapshot: vi.fn().mockReturnValue({ volumes: {}, enablement: {} }),
      snapshotToUpdates: vi.fn().mockReturnValue({}),
      resolveEnabledSidVolumeItems: vi.fn().mockResolvedValue([]),
      dispatchVolume: vi.fn(),
      sidEnablement: {} as never,
      pauseMuteSnapshotRef: { current: null },
      pausingFromPauseRef: { current: false },
      resumingFromPauseRef: { current: false },
      ensureUnmuted: vi.fn().mockResolvedValue(undefined),
      playedClockRef,
      trackStartedAtRef,
      trackInstanceIdRef,
      autoAdvanceGuardRef,
      playStartInFlightRef,
      cancelAutoAdvance: vi.fn(),
      enqueuePlayTransition,
      durationSeconds: 45,
      setAutoAdvanceDueAtMs: vi.fn(),
      trace: (fn: (...args: unknown[]) => unknown) => fn,
      onUserLaunchedItem,
    });

    return { ...controller, trackInstanceIdRef };
  });

// GM-18. `handleUserLaunchedItem` in PlayFilesPage is what turns a launch into
// Game Mode, and it only ever runs if the controller is told about the launch.
// It was written, unit-tested through `shouldEnterGameModeOnLaunch`, and then
// never connected, so the setting did nothing from the day it shipped.
describe("usePlaybackController launch reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports a launch the user started", async () => {
    const onUserLaunchedItem = vi.fn();
    const playlist = [createPlaylistItem("boulder")];
    const { result } = renderHarness(playlist, onUserLaunchedItem);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });

    expect(onUserLaunchedItem).toHaveBeenCalledTimes(1);
    expect(onUserLaunchedItem).toHaveBeenCalledWith(expect.objectContaining({ id: "boulder" }));
  });

  it("stays silent when the playlist moved on by itself", async () => {
    const onUserLaunchedItem = vi.fn();
    const playlist = [createPlaylistItem("one"), createPlaylistItem("two")];
    const { result } = renderHarness(playlist, onUserLaunchedItem);

    await act(async () => {
      await result.current.playItem(playlist[1], { playlistIndex: 1, origin: "auto" });
    });

    expect(onUserLaunchedItem).not.toHaveBeenCalled();
  });
});
