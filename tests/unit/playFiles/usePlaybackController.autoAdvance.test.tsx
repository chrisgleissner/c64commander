/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { USER_TRANSPORT_COALESCE_MS, usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { executePlayPlan } from "@/lib/playback/playbackRouter";
import { getC64API } from "@/lib/c64api";
import { addErrorLog, addLog } from "@/lib/logging";

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
  getHvscDurationsByMd5Seconds: vi.fn(async () => null),
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
}));

const createPlaylistItem = (id: string, durationMs: number): PlaylistItem => ({
  id,
  request: {
    source: "ultimate",
    path: `/PROGRAMS/${id}.prg`,
  },
  category: "prg",
  label: `${id}.prg`,
  path: `/PROGRAMS/${id}.prg`,
  durationMs,
  sourceId: null,
  sizeBytes: null,
  modifiedAt: null,
  addedAt: new Date(0).toISOString(),
  status: "ready",
  unavailableReason: null,
});

const renderPlaybackHarness = (initialPlaylist: PlaylistItem[], options?: { repeatEnabled?: boolean }) =>
  renderHook(() => {
    const [playlist, setPlaylist] = useState(initialPlaylist);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [playedMs, setPlayedMs] = useState(0);
    const [durationMs, setDurationMs] = useState<number | undefined>(undefined);
    const [currentSubsongCount, setCurrentSubsongCount] = useState<number | null>(null);
    const [trackInstanceId, setTrackInstanceId] = useState(0);
    const [autoAdvanceDueAtMs, setAutoAdvanceDueAtMs] = useState<number | null>(null);
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
    const cancelAutoAdvance = vi.fn(() => {
      autoAdvanceGuardRef.current = null;
      setAutoAdvanceDueAtMs(null);
    });
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
      setCurrentSubsongCount,
      setTrackInstanceId,
      repeatEnabled: options?.repeatEnabled ?? false,
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
      cancelAutoAdvance,
      enqueuePlayTransition,
      durationSeconds: 45,
      setAutoAdvanceDueAtMs,
      trace: (fn: (...args: unknown[]) => unknown) => fn,
    });

    return {
      ...controller,
      playlist,
      currentIndex,
      isPlaying,
      isPaused,
      durationMs,
      currentSubsongCount,
      trackInstanceId,
      autoAdvanceDueAtMs,
      autoAdvanceGuardRef,
      trackInstanceIdRef,
      cancelAutoAdvance,
    };
  });

describe("usePlaybackController auto advance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("plays through a three-song playlist and stops after the final auto-advance when repeat is off", async () => {
    const playlist = [
      createPlaylistItem("one", 1_000),
      createPlaylistItem("two", 1_000),
      createPlaylistItem("three", 1_000),
    ];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });
    expect(result.current.currentIndex).toBe(0);
    expect(result.current.isPlaying).toBe(true);

    await act(async () => {
      await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
    });
    expect(result.current.currentIndex).toBe(1);
    expect(result.current.isPlaying).toBe(true);

    await act(async () => {
      await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
    });
    expect(result.current.currentIndex).toBe(2);
    expect(result.current.isPlaying).toBe(true);

    await act(async () => {
      await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
    });

    expect(result.current.currentIndex).toBe(2);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.autoAdvanceGuardRef.current).toBeNull();
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "info",
      "Playlist playback ended",
      expect.objectContaining({
        reason: "auto-end",
        deviceAction: "none",
      }),
    );
  });

  it("mirrors an external (Home) pause and does not auto-advance onto the paused machine (HARD19-009)", async () => {
    const { setMachineExecutionPaused, resetMachineExecution } =
      await import("@/lib/deviceInteraction/machineExecutionStore");
    resetMachineExecution();
    const playlist = [createPlaylistItem("one", 1_000), createPlaylistItem("two", 1_000)];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });
    expect(result.current.isPlaying).toBe(true);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);

    // Home pauses the machine — an EXTERNAL write to the shared store.
    act(() => {
      setMachineExecutionPaused();
    });
    // Play mirrors it: the timeline is suspended and the due-time cleared.
    expect(result.current.isPaused).toBe(true);
    expect(result.current.autoAdvanceDueAtMs).toBeNull();

    vi.mocked(executePlayPlan).mockClear();
    await act(async () => {
      await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
    });

    // The next track must NOT launch on the paused machine.
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
    expect(result.current.currentIndex).toBe(0);

    resetMachineExecution();
  });

  it("keeps a Stop affordance reachable when a song-category playlist ends (HARD11-003)", async () => {
    const playlist = [
      {
        ...createPlaylistItem("one", 1_000),
        category: "sid" as const,
        request: { source: "ultimate" as const, path: "/PROGRAMS/one.prg" },
      },
    ];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });
    expect(result.current.isPlaying).toBe(true);

    await act(async () => {
      await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
    });

    // The SID keeps playing past its songlength; the device was never told to
    // stop, so the transport must still report "playing" (Stop stays reachable)
    // instead of silently flipping to Play with no way to stop the audio.
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.autoAdvanceGuardRef.current).toBeNull();
    expect(vi.mocked(addLog)).toHaveBeenCalledWith(
      "info",
      "Playlist playback ended",
      expect.objectContaining({
        reason: "auto-end",
        deviceAction: "none-song-still-audible",
      }),
    );

    const machineReset = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machineReset } as any);

    await act(async () => {
      await result.current.handleStop();
    });

    expect(machineReset).toHaveBeenCalledTimes(1);
    expect(result.current.isPlaying).toBe(false);
  });

  it("wraps back to the first playlist item when repeat is enabled", async () => {
    const playlist = [
      createPlaylistItem("one", 1_000),
      createPlaylistItem("two", 1_000),
      createPlaylistItem("three", 1_000),
    ];
    const { result } = renderPlaybackHarness(playlist, { repeatEnabled: true });

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });
    await act(async () => {
      await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
    });
    await act(async () => {
      await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
    });
    await act(async () => {
      await result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
    });

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.trackInstanceIdRef.current).toBe(4);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(4);
  });

  it("advances only once for duplicate auto callbacks with the same track instance", async () => {
    const playlist = [createPlaylistItem("one", 1_000), createPlaylistItem("two", 1_000)];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });

    const dueTrackInstanceId = result.current.trackInstanceIdRef.current;
    await act(async () => {
      await Promise.all([
        result.current.handleNext("auto", dueTrackInstanceId),
        result.current.handleNext("auto", dueTrackInstanceId),
      ]);
    });

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.isPlaying).toBe(true);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(2);
  });

  it("suppresses a pending auto-advance after manual stop clears the guard", async () => {
    const playlist = [createPlaylistItem("one", 1_000), createPlaylistItem("two", 1_000)];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });

    const dueTrackInstanceId = result.current.trackInstanceIdRef.current;
    await act(async () => {
      await result.current.handleStop();
      await result.current.handleNext("auto", dueTrackInstanceId);
    });

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.autoAdvanceGuardRef.current).toBeNull();
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
  });

  it("manual next at the end stops when repeat is off without launching another item", async () => {
    vi.useFakeTimers();
    const playlist = [createPlaylistItem("one", 1_000), createPlaylistItem("two", 1_000)];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[1], { playlistIndex: 1 });
    });

    const next = result.current.handleNext("user");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(USER_TRANSPORT_COALESCE_MS);
    });
    await next;

    expect(result.current.currentIndex).toBe(1);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
  });

  it("manual next resolves from the current track if auto-advance completes before the user skip flushes", async () => {
    vi.useFakeTimers();
    const playlist = [
      createPlaylistItem("one", 1_000),
      createPlaylistItem("two", 1_000),
      createPlaylistItem("three", 1_000),
    ];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });

    const next = result.current.handleNext("user");
    await act(async () => {
      await result.current.playItem(playlist[1], { playlistIndex: 1 });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(USER_TRANSPORT_COALESCE_MS);
    });
    await next;

    expect(result.current.currentIndex).toBe(2);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(3);
    expect(vi.mocked(executePlayPlan)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ path: "/PROGRAMS/three.prg" }),
      expect.anything(),
    );
  });

  it("manual next at the end wraps when repeat is on and launches only the first item", async () => {
    vi.useFakeTimers();
    const playlist = [createPlaylistItem("one", 1_000), createPlaylistItem("two", 1_000)];
    const { result } = renderPlaybackHarness(playlist, { repeatEnabled: true });

    await act(async () => {
      await result.current.playItem(playlist[1], { playlistIndex: 1 });
    });

    const next = result.current.handleNext("user");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(USER_TRANSPORT_COALESCE_MS);
    });
    await next;

    expect(result.current.currentIndex).toBe(0);
    expect(result.current.isPlaying).toBe(true);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(executePlayPlan)).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ path: "/PROGRAMS/one.prg" }),
      expect.anything(),
    );
  });
});

// HARD18-022/023 (M3): a user-initiated whole-machine reset (Home
// reboot/reboot-clear-memory/power-cycle) or an out-of-playlist launch
// (CommoServe Run/Mount & run) must stop an armed Play session in place
// instead of letting auto-advance later relaunch content on the machine the
// user reset/repurposed. publishMachineTakeover is the real module (not
// mocked) so these tests exercise the actual subscriber wiring end to end.
describe("usePlaybackController machine takeover (HARD18-022/023)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops an armed session in place on a home-reset takeover, without touching playlist position", async () => {
    const { publishMachineTakeover } = await import("@/lib/deviceInteraction/machineTakeoverEvent");
    const playlist = [createPlaylistItem("one", 5_000), createPlaylistItem("two", 5_000)];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.autoAdvanceGuardRef.current).not.toBeNull();

    await act(async () => {
      await publishMachineTakeover({ reason: "home-reset", label: "Reboot" });
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.autoAdvanceGuardRef.current).toBeNull();
    expect(result.current.autoAdvanceDueAtMs).toBeNull();
    // Playlist position is preserved - a takeover stops in place, it does not
    // advance or reset the current track.
    expect(result.current.currentIndex).toBe(0);
  });

  it("stops an armed session in place on an external-launch takeover (e.g. CommoServe Run)", async () => {
    const { publishMachineTakeover } = await import("@/lib/deviceInteraction/machineTakeoverEvent");
    const playlist = [createPlaylistItem("one", 5_000), createPlaylistItem("two", 5_000)];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });
    expect(result.current.isPlaying).toBe(true);

    await act(async () => {
      await publishMachineTakeover({ reason: "external-launch", label: "game.d64" });
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.autoAdvanceGuardRef.current).toBeNull();
    expect(result.current.autoAdvanceDueAtMs).toBeNull();
  });

  it("is a no-op when no session is armed (nothing playing or paused)", async () => {
    const { publishMachineTakeover } = await import("@/lib/deviceInteraction/machineTakeoverEvent");
    const playlist = [createPlaylistItem("one", 5_000)];
    const { result } = renderPlaybackHarness(playlist);

    expect(result.current.isPlaying).toBe(false);

    await act(async () => {
      await publishMachineTakeover({ reason: "home-reset", label: "Reboot" });
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.autoAdvanceGuardRef.current).toBeNull();
  });

  it("playItem's own reboot-before-play never publishes a takeover that stops itself", async () => {
    const playlist = [{ ...createPlaylistItem("disk-one", 5_000), category: "disk" as const, mountType: "d64" }];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0, rebootBeforePlay: true });
    });

    // playItem's own reboot must not trigger the takeover subscriber and
    // stop the very session it just started.
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.autoAdvanceGuardRef.current).not.toBeNull();
  });
});

// HARD18-009 (M5): Stop pressed while a track transition (auto-advance,
// Next/Previous, a row-tap) is mid-flight must win, not be silently
// overridden by the queued transition's post-launch state writes once its
// executePlayPlan resolves.
describe("usePlaybackController Stop supersedes in-flight transitions (HARD18-009)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("Stop mid-flight supersedes the transition: isPlaying stays false and no auto-advance guard is re-armed", async () => {
    const playlist = [createPlaylistItem("one", 1_000), createPlaylistItem("two", 1_000)];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });
    expect(result.current.isPlaying).toBe(true);

    let resolveSecondLaunch!: () => void;
    vi.mocked(executePlayPlan).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSecondLaunch = resolve;
        }),
    );
    const machineResetMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machineReset: machineResetMock } as any);

    let autoAdvancePromise!: Promise<void>;
    await act(async () => {
      autoAdvancePromise = result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
      // Let the transition enter playItem and reach the hung executePlayPlan.
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.handleStop();
    });
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.autoAdvanceGuardRef.current).toBeNull();

    // Now the in-flight (superseded) launch reaches the device.
    await act(async () => {
      resolveSecondLaunch();
      await autoAdvancePromise;
    });

    // Stop's state must still win: no re-assertion of isPlaying/auto-advance.
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.isPaused).toBe(false);
    expect(result.current.autoAdvanceGuardRef.current).toBeNull();
    expect(result.current.autoAdvanceDueAtMs).toBeNull();
    // Stop's own reset, plus a corrective follow-up reset for the launch
    // that reached the device after being superseded.
    expect(machineResetMock).toHaveBeenCalledTimes(2);
  });

  it("HARD18-009: logs (rather than throwing) when the corrective follow-up reset itself fails", async () => {
    const playlist = [createPlaylistItem("one", 1_000), createPlaylistItem("two", 1_000)];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });
    expect(result.current.isPlaying).toBe(true);

    let resolveSecondLaunch!: () => void;
    vi.mocked(executePlayPlan).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveSecondLaunch = resolve;
        }),
    );
    const machineResetMock = vi
      .fn()
      .mockResolvedValueOnce(undefined) // Stop's own reset succeeds
      .mockRejectedValueOnce(new Error("follow-up reset failed")); // corrective reset fails
    vi.mocked(getC64API).mockReturnValue({ machineReset: machineResetMock } as any);

    let autoAdvancePromise!: Promise<void>;
    await act(async () => {
      autoAdvancePromise = result.current.handleNext("auto", result.current.trackInstanceIdRef.current);
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.handleStop();
    });

    // Now the in-flight (superseded) launch reaches the device and its
    // corrective follow-up reset rejects - must not throw out of the
    // playback launch call, only log.
    await act(async () => {
      resolveSecondLaunch();
      await expect(autoAdvancePromise).resolves.toBeUndefined();
    });

    expect(addErrorLog).toHaveBeenCalledWith(
      "Follow-up reset after superseded playback launch failed",
      expect.objectContaining({ error: "follow-up reset failed" }),
    );
    expect(result.current.isPlaying).toBe(false);
  });

  it("a rapid Play right after Stop is not itself treated as superseded", async () => {
    const playlist = [createPlaylistItem("one", 1_000), createPlaylistItem("two", 1_000)];
    const { result } = renderPlaybackHarness(playlist);

    await act(async () => {
      await result.current.playItem(playlist[0], { playlistIndex: 0 });
    });
    expect(result.current.isPlaying).toBe(true);

    const machineResetMock = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machineReset: machineResetMock } as any);

    await act(async () => {
      await result.current.handleStop();
    });
    expect(result.current.isPlaying).toBe(false);

    await act(async () => {
      await result.current.playItem(playlist[1], { playlistIndex: 1 });
    });

    expect(result.current.isPlaying).toBe(true);
    expect(result.current.autoAdvanceGuardRef.current).not.toBeNull();
  });
});
