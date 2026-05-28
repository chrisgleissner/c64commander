/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_TRANSPORT_COALESCE_MS, usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { executePlayPlan } from "@/lib/playback/playbackRouter";
import { SupersededMachineTransitionError } from "@/lib/deviceInteraction/machineTransitionCoordinator";

vi.mock("@/lib/archive/client", () => ({
  createArchiveClient: vi.fn(),
}));

vi.mock("@/lib/archive/execution", () => ({
  buildArchivePlayPlan: vi.fn(),
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: vi.fn(() => ({})),
}));

vi.mock("@/lib/playback/playbackRouter", () => ({
  buildPlayPlan: vi.fn((request) => request),
  executePlayPlan: vi.fn(async () => undefined),
  tryFetchUltimateSidBlob: vi.fn(async () => null),
}));

vi.mock("@/lib/hvsc", () => ({
  getHvscDurationByMd5Seconds: vi.fn(async () => null),
}));

vi.mock("@/lib/sid/sidUtils", () => ({
  getSidSongCount: vi.fn(() => 1),
  computeSidMd5: vi.fn(async () => "mock-md5"),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/lib/config/applyConfigFileReference", () => ({
  applyConfigFileReference: vi.fn(async () => undefined),
  ensureConfigFileReferenceAccessible: vi.fn(async () => undefined),
}));

const createPlaylistItem = (id: string, path: string): PlaylistItem => ({
  id,
  request: {
    source: "ultimate",
    path,
  },
  category: "prg",
  label: path.split("/").pop() ?? path,
  path,
  durationMs: 1_000,
  sourceId: null,
  sizeBytes: null,
  modifiedAt: null,
  addedAt: new Date(0).toISOString(),
  status: "ready",
  unavailableReason: null,
});

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe("usePlaybackController play transition supersession", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executePlayPlan).mockReset();
    vi.mocked(executePlayPlan).mockImplementation(async () => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces four rapid user next taps into one play of the final target", async () => {
    vi.useFakeTimers();
    const firstItem = createPlaylistItem("track-a", "/PROGRAMS/track-a.prg");
    const secondItem = createPlaylistItem("track-b", "/PROGRAMS/track-b.prg");
    const thirdItem = createPlaylistItem("track-c", "/PROGRAMS/track-c.prg");
    const fourthItem = createPlaylistItem("track-d", "/PROGRAMS/track-d.prg");
    const fifthItem = createPlaylistItem("track-e", "/PROGRAMS/track-e.prg");
    const playlist = [firstItem, secondItem, thirdItem, fourthItem, fifthItem];

    const { result } = renderHook(() =>
      usePlaybackController({
        playlist,
        setPlaylist: vi.fn(),
        currentIndex: 0,
        setCurrentIndex: vi.fn(),
        isPlaying: true,
        setIsPlaying: vi.fn(),
        isPaused: false,
        setIsPaused: vi.fn(),
        setIsPlaylistLoading: vi.fn(),
        elapsedMs: 0,
        setElapsedMs: vi.fn(),
        playedMs: 0,
        setPlayedMs: vi.fn(),
        durationMs: undefined,
        setDurationMs: vi.fn(),
        setCurrentSubsongCount: vi.fn(),
        setTrackInstanceId: vi.fn(),
        repeatEnabled: false,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
        deviceProduct: "C64 Ultimate",
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
        playedClockRef: {
          current: {
            start: vi.fn(),
            stop: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            reset: vi.fn(),
            current: vi.fn().mockReturnValue(0),
          },
        },
        trackStartedAtRef: { current: null },
        trackInstanceIdRef: { current: 0 },
        autoAdvanceGuardRef: { current: null },
        playStartInFlightRef: { current: false },
        cancelAutoAdvance: vi.fn(),
        enqueuePlayTransition: vi.fn().mockImplementation(async (task) => task()),
        durationSeconds: 45,
        setAutoAdvanceDueAtMs: vi.fn(),
        trace: (fn: (...args: unknown[]) => unknown) => fn,
      }),
    );

    const skips = [
      result.current.handleNext("user"),
      result.current.handleNext("user"),
      result.current.handleNext("user"),
      result.current.handleNext("user"),
    ];

    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(USER_TRANSPORT_COALESCE_MS);
    });
    await Promise.all(skips);

    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: "/PROGRAMS/track-e.prg" }),
      expect.anything(),
    );
  });

  it("coalesces rapid previous taps into one play of the final target", async () => {
    vi.useFakeTimers();
    const firstItem = createPlaylistItem("track-a", "/PROGRAMS/track-a.prg");
    const secondItem = createPlaylistItem("track-b", "/PROGRAMS/track-b.prg");
    const thirdItem = createPlaylistItem("track-c", "/PROGRAMS/track-c.prg");
    const playlist = [firstItem, secondItem, thirdItem];

    const { result } = renderHook(() =>
      usePlaybackController({
        playlist,
        setPlaylist: vi.fn(),
        currentIndex: 2,
        setCurrentIndex: vi.fn(),
        isPlaying: true,
        setIsPlaying: vi.fn(),
        isPaused: false,
        setIsPaused: vi.fn(),
        setIsPlaylistLoading: vi.fn(),
        elapsedMs: 0,
        setElapsedMs: vi.fn(),
        playedMs: 0,
        setPlayedMs: vi.fn(),
        durationMs: undefined,
        setDurationMs: vi.fn(),
        setCurrentSubsongCount: vi.fn(),
        setTrackInstanceId: vi.fn(),
        repeatEnabled: false,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
        deviceProduct: "C64 Ultimate",
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
        playedClockRef: {
          current: {
            start: vi.fn(),
            stop: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            reset: vi.fn(),
            current: vi.fn().mockReturnValue(0),
          },
        },
        trackStartedAtRef: { current: null },
        trackInstanceIdRef: { current: 1 },
        autoAdvanceGuardRef: { current: null },
        playStartInFlightRef: { current: false },
        cancelAutoAdvance: vi.fn(),
        enqueuePlayTransition: vi.fn().mockImplementation(async (task) => task()),
        durationSeconds: 45,
        setAutoAdvanceDueAtMs: vi.fn(),
        trace: (fn: (...args: unknown[]) => unknown) => fn,
      }),
    );

    const skips = [result.current.handlePrevious(), result.current.handlePrevious()];

    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(USER_TRANSPORT_COALESCE_MS);
    });
    await Promise.all(skips);

    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: "/PROGRAMS/track-a.prg" }),
      expect.anything(),
    );
  });

  it("lets a newer play request supersede an older queued transition", async () => {
    const firstItem = createPlaylistItem("track-a", "/PROGRAMS/track-a.prg");
    const secondItem = createPlaylistItem("track-b", "/PROGRAMS/track-b.prg");
    const playlist = [firstItem, secondItem];
    const setCurrentIndex = vi.fn();
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setElapsedMs = vi.fn();
    const setPlayedMs = vi.fn();
    const setDurationMs = vi.fn();
    const setCurrentSubsongCount = vi.fn();
    const setTrackInstanceId = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const runLatest = { current: null as null | (() => Promise<void>) };
    const rejectLatest = { current: null as null | ((error: Error) => void) };

    const enqueuePlayTransition = vi.fn((task: () => Promise<void>) => {
      if (rejectLatest.current) {
        rejectLatest.current(new SupersededMachineTransitionError("running"));
        rejectLatest.current = null;
      }
      return new Promise<void>((resolve, reject) => {
        rejectLatest.current = reject;
        runLatest.current = async () => {
          rejectLatest.current = null;
          try {
            await task();
            resolve();
          } catch (error) {
            reject(error as Error);
          }
        };
      });
    });

    const { result } = renderHook(() =>
      usePlaybackController({
        playlist,
        setPlaylist: vi.fn(),
        currentIndex: 0,
        setCurrentIndex,
        isPlaying: false,
        setIsPlaying,
        isPaused: false,
        setIsPaused,
        setIsPlaylistLoading: vi.fn(),
        elapsedMs: 0,
        setElapsedMs,
        playedMs: 0,
        setPlayedMs,
        durationMs: undefined,
        setDurationMs,
        setCurrentSubsongCount,
        setTrackInstanceId,
        repeatEnabled: false,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
        deviceProduct: "C64 Ultimate",
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
        playedClockRef: {
          current: {
            start: vi.fn(),
            stop: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            reset: vi.fn(),
            current: vi.fn().mockReturnValue(0),
          },
        },
        trackStartedAtRef: { current: null },
        trackInstanceIdRef: { current: 0 },
        autoAdvanceGuardRef: { current: null },
        playStartInFlightRef: { current: false },
        cancelAutoAdvance: vi.fn(),
        enqueuePlayTransition,
        durationSeconds: 45,
        setAutoAdvanceDueAtMs,
        trace: (fn: (...args: unknown[]) => unknown) => fn,
      }),
    );

    const firstPromise = result.current.playItem(firstItem, { playlistIndex: 0 });
    const firstOutcome = firstPromise.then(
      () => null,
      (error) => error,
    );
    const secondPromise = result.current.playItem(secondItem, { playlistIndex: 1 });

    expect(enqueuePlayTransition).toHaveBeenCalledTimes(2);
    expect(runLatest.current).not.toBeNull();

    await runLatest.current?.();

    await expect(firstOutcome).resolves.toBeInstanceOf(SupersededMachineTransitionError);
    await expect(secondPromise).resolves.toBeUndefined();

    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ path: "/PROGRAMS/track-b.prg", durationMs: 1_000 }),
      expect.objectContaining({}),
    );
    expect(setCurrentIndex).toHaveBeenCalledWith(1);
    expect(setIsPlaying).toHaveBeenCalledWith(true);
    expect(setIsPaused).toHaveBeenCalledWith(false);
  });

  it("cleans up a pending user skip when the controller unmounts", async () => {
    vi.useFakeTimers();
    const firstItem = createPlaylistItem("track-a", "/PROGRAMS/track-a.prg");
    const secondItem = createPlaylistItem("track-b", "/PROGRAMS/track-b.prg");
    const playlist = [firstItem, secondItem];
    const setCurrentIndex = vi.fn();
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setElapsedMs = vi.fn();
    const setPlayedMs = vi.fn();
    const setDurationMs = vi.fn();
    const setCurrentSubsongCount = vi.fn();
    const setTrackInstanceId = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const enqueuePlayTransition = vi.fn(async (task: () => Promise<void>) => task());

    const { result, unmount } = renderHook(() =>
      usePlaybackController({
        playlist,
        setPlaylist: vi.fn(),
        currentIndex: 0,
        setCurrentIndex,
        isPlaying: false,
        setIsPlaying,
        isPaused: false,
        setIsPaused,
        setIsPlaylistLoading: vi.fn(),
        elapsedMs: 0,
        setElapsedMs,
        playedMs: 0,
        setPlayedMs,
        durationMs: undefined,
        setDurationMs,
        setCurrentSubsongCount,
        setTrackInstanceId,
        repeatEnabled: false,
        localEntriesBySourceId: new Map(),
        localSourceTreeUris: new Map(),
        deviceProduct: "C64 Ultimate",
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
        playedClockRef: {
          current: {
            start: vi.fn(),
            stop: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            reset: vi.fn(),
            current: vi.fn().mockReturnValue(0),
          },
        },
        trackStartedAtRef: { current: null },
        trackInstanceIdRef: { current: 0 },
        autoAdvanceGuardRef: { current: null },
        playStartInFlightRef: { current: false },
        cancelAutoAdvance: vi.fn(),
        enqueuePlayTransition,
        durationSeconds: 45,
        setAutoAdvanceDueAtMs,
        trace: (fn: (...args: unknown[]) => unknown) => fn,
      }),
    );

    const pendingSkip = result.current.handleNext("user");
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(USER_TRANSPORT_COALESCE_MS);
    });

    await expect(pendingSkip).resolves.toBeUndefined();
    expect(enqueuePlayTransition).not.toHaveBeenCalled();
    expect(executePlayPlan).not.toHaveBeenCalled();
  });
});
