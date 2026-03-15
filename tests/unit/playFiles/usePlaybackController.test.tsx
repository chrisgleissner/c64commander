import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { executePlayPlan } from "@/lib/playback/playbackRouter";
import { getC64API } from "@/lib/c64api";
import { reportUserError } from "@/lib/uiErrors";

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

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

const createPlaylistItem = (overrides: Partial<PlaylistItem> = {}): PlaylistItem => ({
  id: "item-1",
  request: {
    source: "ultimate",
    path: "/PROGRAMS/demo.prg",
  },
  category: "prg",
  label: "demo.prg",
  path: "/PROGRAMS/demo.prg",
  durationMs: undefined,
  sourceId: null,
  sizeBytes: null,
  modifiedAt: null,
  addedAt: new Date(0).toISOString(),
  status: "ready",
  unavailableReason: null,
  ...overrides,
});

const renderPlaybackController = (
  playlist: PlaylistItem[],
  options?: {
    currentIndex?: number;
    durationMs?: number;
    isPlaying?: boolean;
    isPaused?: boolean;
    repeatEnabled?: boolean;
    setPlaylist?: ReturnType<typeof vi.fn>;
    setCurrentIndex?: ReturnType<typeof vi.fn>;
    setIsPlaying?: ReturnType<typeof vi.fn>;
    setIsPaused?: ReturnType<typeof vi.fn>;
    setIsPlaylistLoading?: ReturnType<typeof vi.fn>;
    setElapsedMs?: ReturnType<typeof vi.fn>;
    setPlayedMs?: ReturnType<typeof vi.fn>;
    setDurationMs?: ReturnType<typeof vi.fn>;
    setCurrentSubsongCount?: ReturnType<typeof vi.fn>;
    setTrackInstanceId?: ReturnType<typeof vi.fn>;
    setAutoAdvanceDueAtMs?: ReturnType<typeof vi.fn>;
    ensurePlaybackConnection?: ReturnType<typeof vi.fn>;
    ensureUnmuted?: ReturnType<typeof vi.fn>;
    applyAudioMixerUpdates?: ReturnType<typeof vi.fn>;
    restoreVolumeOverrides?: ReturnType<typeof vi.fn>;
    dispatchVolume?: ReturnType<typeof vi.fn>;
    resolveEnabledSidVolumeItems?: ReturnType<typeof vi.fn>;
    pauseMuteSnapshotRef?: { current: any };
    trackStartedAtRef?: { current: number | null };
    trackInstanceIdRef?: { current: number };
    autoAdvanceGuardRef?: { current: any };
    playStartInFlightRef?: { current: boolean };
    playedClockRef?: {
      current: {
        start: ReturnType<typeof vi.fn>;
        stop: ReturnType<typeof vi.fn>;
        pause: ReturnType<typeof vi.fn>;
        resume: ReturnType<typeof vi.fn>;
        reset: ReturnType<typeof vi.fn>;
        current: ReturnType<typeof vi.fn>;
      };
    };
    captureSidMuteSnapshot?: ReturnType<typeof vi.fn>;
    buildEnabledSidMuteUpdates?: ReturnType<typeof vi.fn>;
    applySonglengthsToItems?: ReturnType<typeof vi.fn>;
    cancelAutoAdvance?: ReturnType<typeof vi.fn>;
    enqueuePlayTransition?: ReturnType<typeof vi.fn>;
  },
) =>
  renderHook(() =>
    usePlaybackController({
      playlist,
      setPlaylist: options?.setPlaylist ?? vi.fn(),
      currentIndex: options?.currentIndex ?? 0,
      setCurrentIndex: options?.setCurrentIndex ?? vi.fn(),
      isPlaying: options?.isPlaying ?? false,
      setIsPlaying: options?.setIsPlaying ?? vi.fn(),
      isPaused: options?.isPaused ?? false,
      setIsPaused: options?.setIsPaused ?? vi.fn(),
      setIsPlaylistLoading: options?.setIsPlaylistLoading ?? vi.fn(),
      elapsedMs: 0,
      setElapsedMs: options?.setElapsedMs ?? vi.fn(),
      playedMs: 0,
      setPlayedMs: options?.setPlayedMs ?? vi.fn(),
      durationMs: options?.durationMs,
      setDurationMs: options?.setDurationMs ?? vi.fn(),
      setCurrentSubsongCount: options?.setCurrentSubsongCount ?? vi.fn(),
      repeatEnabled: options?.repeatEnabled ?? false,
      localEntriesBySourceId: new Map(),
      localSourceTreeUris: new Map(),
      ensurePlaybackConnection: options?.ensurePlaybackConnection ?? vi.fn().mockResolvedValue(undefined),
      resolveSonglengthDurationMsForPath: vi.fn().mockResolvedValue(null),
      applySonglengthsToItems: options?.applySonglengthsToItems ?? vi.fn().mockImplementation(async (items) => items),
      restoreVolumeOverrides: options?.restoreVolumeOverrides ?? vi.fn().mockResolvedValue(undefined),
      applyAudioMixerUpdates: options?.applyAudioMixerUpdates ?? vi.fn().mockResolvedValue(undefined),
      buildEnabledSidMuteUpdates: options?.buildEnabledSidMuteUpdates ?? vi.fn().mockReturnValue({}),
      captureSidMuteSnapshot:
        options?.captureSidMuteSnapshot ?? vi.fn().mockReturnValue({ volumes: {}, enablement: {} }),
      snapshotToUpdates: vi.fn().mockReturnValue({}),
      resolveEnabledSidVolumeItems: options?.resolveEnabledSidVolumeItems ?? vi.fn().mockResolvedValue([]),
      dispatchVolume: options?.dispatchVolume ?? vi.fn(),
      sidEnablement: {} as any,
      pauseMuteSnapshotRef: options?.pauseMuteSnapshotRef ?? { current: null },
      pausingFromPauseRef: { current: false },
      resumingFromPauseRef: { current: false },
      playedClockRef:
        options?.playedClockRef ??
        ({
          current: {
            start: vi.fn(),
            stop: vi.fn(),
            pause: vi.fn(),
            resume: vi.fn(),
            reset: vi.fn(),
            current: vi.fn().mockReturnValue(0),
          },
        } as const),
      trackStartedAtRef: options?.trackStartedAtRef ?? { current: null },
      trackInstanceIdRef: options?.trackInstanceIdRef ?? { current: 0 },
      autoAdvanceGuardRef: options?.autoAdvanceGuardRef ?? { current: null },
      playStartInFlightRef: options?.playStartInFlightRef ?? { current: false },
      cancelAutoAdvance: options?.cancelAutoAdvance ?? vi.fn(),
      enqueuePlayTransition: options?.enqueuePlayTransition ?? vi.fn().mockImplementation(async (task) => task()),
      durationSeconds: 45,
      trace: (fn: (...args: unknown[]) => unknown) => fn,
      setTrackInstanceId: options?.setTrackInstanceId ?? vi.fn(),
      setAutoAdvanceDueAtMs: options?.setAutoAdvanceDueAtMs ?? vi.fn(),
      ensureUnmuted: options?.ensureUnmuted ?? vi.fn().mockResolvedValue(undefined),
    }),
  );

describe("usePlaybackController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies fallback duration for non-song playlist rows before playback starts", () => {
    const playlist = [createPlaylistItem()];
    const { result } = renderPlaybackController(playlist);

    expect(result.current.playlistItemDuration(playlist[0], 0)).toBe(45_000);
  });

  it("returns early from pause-resume when playback is inactive", async () => {
    const playlist = [createPlaylistItem()];
    const machineResume = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machineResume } as any);
    const { result } = renderPlaybackController(playlist, { isPlaying: false, isPaused: false });

    await result.current.handlePauseResume();

    expect(machineResume).not.toHaveBeenCalled();
  });

  it("preserves explicit duration for non-song items", () => {
    const playlist = [createPlaylistItem({ durationMs: 12_000 })];
    const { result } = renderPlaybackController(playlist);

    expect(result.current.playlistItemDuration(playlist[0], 0)).toBe(12_000);
  });

  it("applies fallback duration when non-song playback starts", async () => {
    const playlist = [createPlaylistItem()];
    const setPlaylist = vi.fn();
    const setDurationMs = vi.fn();
    const { result } = renderPlaybackController(playlist, { setPlaylist, setDurationMs });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(setDurationMs).toHaveBeenCalledWith(45_000);
    const playlistUpdater = setPlaylist.mock.calls.find(([value]) => typeof value === "function")?.[0] as
      | ((items: PlaylistItem[]) => PlaylistItem[])
      | undefined;
    expect(playlistUpdater).toBeDefined();
    const nextPlaylist = playlistUpdater?.(playlist);
    expect(nextPlaylist?.[0]?.durationMs).toBe(45_000);
  });

  it("unmutes before starting playback and only then executes the play plan", async () => {
    const playlist = [createPlaylistItem()];
    const ensureUnmuted = vi.fn().mockResolvedValue(undefined);
    const ensurePlaybackConnection = vi.fn().mockResolvedValue(undefined);
    const { result } = renderPlaybackController(playlist, { ensurePlaybackConnection, ensureUnmuted });

    await result.current.playItem(playlist[0], { playlistIndex: 0 });

    expect(ensureUnmuted).toHaveBeenCalledTimes(1);
    expect(ensurePlaybackConnection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(executePlayPlan)).toHaveBeenCalledTimes(1);
    expect(ensureUnmuted.mock.invocationCallOrder[0]).toBeLessThan(
      ensurePlaybackConnection.mock.invocationCallOrder[0],
    );
    expect(ensurePlaybackConnection.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(executePlayPlan).mock.invocationCallOrder[0],
    );
  });

  it("fails playback start when unmuting before playback start fails", async () => {
    const playlist = [createPlaylistItem()];
    const ensureUnmuted = vi.fn().mockRejectedValue(new Error("unmute failed"));
    const { result } = renderPlaybackController(playlist, { ensureUnmuted });

    await expect(result.current.playItem(playlist[0], { playlistIndex: 0 })).rejects.toThrow("unmute failed");
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("keeps the pause mute state when resume snapshots are still at the playback mute target", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const dispatchVolume = vi.fn();
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    const resolveEnabledSidVolumeItems = vi.fn().mockResolvedValue([
      {
        name: "SID 1",
        value: "-42 dB",
        options: ["OFF", "-42 dB", "0 dB"],
      },
    ]);
    const pauseMuteSnapshotRef = {
      current: {
        volumes: { "SID 1": "-42 dB" },
        enablement: {},
      },
    };
    vi.mocked(getC64API).mockReturnValue({
      machineResume: vi.fn().mockResolvedValue(undefined),
    } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: true,
      dispatchVolume,
      applyAudioMixerUpdates,
      resolveEnabledSidVolumeItems,
      pauseMuteSnapshotRef,
    });

    await result.current.handlePauseResume();

    expect(dispatchVolume).toHaveBeenCalledWith({ type: "mute", reason: "pause" });
    expect(applyAudioMixerUpdates).toHaveBeenCalled();
  });

  it("mutes enabled SID outputs when pausing active playback", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const dispatchVolume = vi.fn();
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    const resolveEnabledSidVolumeItems = vi.fn().mockResolvedValue([
      {
        name: "SID 1",
        value: "5 dB",
        options: ["OFF", "-42 dB", "5 dB"],
      },
    ]);
    const captureSidMuteSnapshot = vi.fn().mockReturnValue({ volumes: { "SID 1": "5 dB" }, enablement: {} });
    const buildEnabledSidMuteUpdates = vi.fn().mockReturnValue({ "SID 1": "-42 dB" });
    vi.mocked(getC64API).mockReturnValue({
      machinePause: vi.fn().mockResolvedValue(undefined),
    } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: false,
      dispatchVolume,
      applyAudioMixerUpdates,
      resolveEnabledSidVolumeItems,
      captureSidMuteSnapshot,
      buildEnabledSidMuteUpdates,
    });

    await result.current.handlePauseResume();

    expect(captureSidMuteSnapshot).toHaveBeenCalled();
    expect(buildEnabledSidMuteUpdates).toHaveBeenCalled();
    expect(applyAudioMixerUpdates).toHaveBeenCalledWith({ "SID 1": "-42 dB" }, "Pause");
    expect(dispatchVolume).toHaveBeenCalledWith({ type: "mute", reason: "pause" });
  });

  it("pauses without mixer writes when no enabled SID outputs are active", async () => {
    const playlist = [
      createPlaylistItem({ request: { source: "ultimate", path: "/Usb0/Demos/demo.sid" }, category: "sid" }),
    ];
    const dispatchVolume = vi.fn();
    const applyAudioMixerUpdates = vi.fn().mockResolvedValue(undefined);
    const machinePause = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getC64API).mockReturnValue({ machinePause } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: false,
      dispatchVolume,
      applyAudioMixerUpdates,
      resolveEnabledSidVolumeItems: vi.fn().mockResolvedValue([]),
    });

    await result.current.handlePauseResume();

    expect(machinePause).toHaveBeenCalled();
    expect(applyAudioMixerUpdates).not.toHaveBeenCalled();
    expect(dispatchVolume).not.toHaveBeenCalled();
  });

  it("prevents duplicate play starts while a single-flight request is already active", async () => {
    const playlist = [createPlaylistItem()];
    const setIsPlaylistLoading = vi.fn();
    const playStartInFlightRef = { current: true };
    const { result } = renderPlaybackController(playlist, {
      setIsPlaylistLoading,
      playStartInFlightRef,
    });

    await result.current.handlePlay();

    expect(setIsPlaylistLoading).not.toHaveBeenCalled();
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("merges resolved playlist entries with existing extras when starting playback", async () => {
    const resolvedItems = [
      createPlaylistItem({ id: "resolved-1", label: "resolved-1.prg", path: "/PROGRAMS/resolved-1.prg" }),
    ];
    const extraItem = createPlaylistItem({ id: "extra-1", label: "extra-1.prg", path: "/PROGRAMS/extra-1.prg" });
    const setPlaylist = vi.fn();
    const applySonglengthsToItems = vi.fn().mockResolvedValue(resolvedItems);
    const { result } = renderPlaybackController(resolvedItems, {
      setPlaylist,
      applySonglengthsToItems,
    });

    await result.current.startPlaylist(resolvedItems, 0);

    const mergeUpdater = setPlaylist.mock.calls.find(([value]) => typeof value === "function")?.[0] as
      | ((items: PlaylistItem[]) => PlaylistItem[])
      | undefined;
    expect(mergeUpdater).toBeDefined();
    expect(mergeUpdater?.([extraItem])).toEqual([...resolvedItems, extraItem]);
  });

  it("reports playback start failures from startPlaylist and clears loading state", async () => {
    const playlist = [createPlaylistItem()];
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setIsPlaylistLoading = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const ensureUnmuted = vi.fn().mockRejectedValue(new Error("unmute failed"));
    const trackStartedAtRef = { current: 1234 };
    const autoAdvanceGuardRef = { current: { trackInstanceId: 1 } };
    const { result } = renderPlaybackController(playlist, {
      setIsPlaying,
      setIsPaused,
      setIsPlaylistLoading,
      setAutoAdvanceDueAtMs,
      ensureUnmuted,
      trackStartedAtRef,
      autoAdvanceGuardRef,
    });

    await result.current.startPlaylist(playlist, 0);

    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "PLAYBACK_START", title: "Playback failed" }),
    );
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(setIsPaused).toHaveBeenCalledWith(false);
    expect(trackStartedAtRef.current).toBeNull();
    expect(autoAdvanceGuardRef.current).toBeNull();
    expect(setAutoAdvanceDueAtMs).toHaveBeenCalledWith(null);
    expect(setIsPlaylistLoading).toHaveBeenLastCalledWith(false);
  });

  it("resumes before stopping paused disk playback and reboots the machine", async () => {
    const playlist = [
      createPlaylistItem({ category: "disk", request: { source: "ultimate", path: "/DISKS/demo.d64" } }),
    ];
    const machineResume = vi.fn().mockResolvedValue(undefined);
    const machineReboot = vi.fn().mockResolvedValue(undefined);
    const restoreVolumeOverrides = vi.fn().mockResolvedValue(undefined);
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(0),
      },
    };
    const setPlayedMs = vi.fn();
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setElapsedMs = vi.fn();
    const setDurationMs = vi.fn();
    const setCurrentSubsongCount = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const trackStartedAtRef = { current: 1234 };
    const autoAdvanceGuardRef = { current: { trackInstanceId: 1 } };
    vi.mocked(getC64API).mockReturnValue({ machineResume, machineReboot } as any);

    const { result } = renderPlaybackController(playlist, {
      isPlaying: true,
      isPaused: true,
      restoreVolumeOverrides,
      playedClockRef,
      setPlayedMs,
      setIsPlaying,
      setIsPaused,
      setElapsedMs,
      setDurationMs,
      setCurrentSubsongCount,
      setAutoAdvanceDueAtMs,
      trackStartedAtRef,
      autoAdvanceGuardRef,
    });

    await result.current.handleStop();

    expect(machineResume).toHaveBeenCalled();
    expect(machineReboot).toHaveBeenCalled();
    expect(restoreVolumeOverrides).toHaveBeenCalledWith("stop");
    expect(playedClockRef.current.stop).toHaveBeenCalled();
    expect(setPlayedMs).toHaveBeenCalledWith(0);
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(setIsPaused).toHaveBeenCalledWith(false);
    expect(setElapsedMs).toHaveBeenCalledWith(0);
    expect(setDurationMs).toHaveBeenCalledWith(undefined);
    expect(setCurrentSubsongCount).toHaveBeenCalledWith(null);
    expect(trackStartedAtRef.current).toBeNull();
    expect(autoAdvanceGuardRef.current).toBeNull();
    expect(setAutoAdvanceDueAtMs).toHaveBeenCalledWith(null);
  });

  it("stops auto-advance at the end of the playlist when repeat is disabled", async () => {
    const playlist = [createPlaylistItem()];
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const setPlayedMs = vi.fn();
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(2500),
      },
    };
    const autoAdvanceGuardRef = {
      current: {
        trackInstanceId: 4,
        dueAtMs: 10_000,
        autoFired: false,
        userCancelled: false,
      },
    };

    const { result } = renderPlaybackController(playlist, {
      currentIndex: 0,
      isPlaying: true,
      setIsPlaying,
      setIsPaused,
      setPlayedMs,
      setAutoAdvanceDueAtMs,
      playedClockRef,
      autoAdvanceGuardRef,
    });

    await result.current.handleNext("auto", 4);

    expect(playedClockRef.current.pause).toHaveBeenCalled();
    expect(setPlayedMs).toHaveBeenCalledWith(2500);
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(setIsPaused).toHaveBeenCalledWith(false);
    expect(autoAdvanceGuardRef.current).toBeNull();
    expect(setAutoAdvanceDueAtMs).toHaveBeenCalledWith(null);
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
  });

  it("ignores stale auto-advance callbacks when the track instance no longer matches", async () => {
    const playlist = [
      createPlaylistItem(),
      createPlaylistItem({ id: "item-2", label: "demo-2.prg", path: "/PROGRAMS/demo-2.prg" }),
    ];
    const setPlayedMs = vi.fn();
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(2500),
      },
    };
    const autoAdvanceGuardRef = {
      current: {
        trackInstanceId: 2,
        dueAtMs: 10_000,
        autoFired: false,
        userCancelled: false,
      },
    };

    const { result } = renderPlaybackController(playlist, {
      currentIndex: 0,
      isPlaying: true,
      setPlayedMs,
      playedClockRef,
      autoAdvanceGuardRef,
    });

    await result.current.handleNext("auto", 999);

    expect(playedClockRef.current.pause).not.toHaveBeenCalled();
    expect(setPlayedMs).not.toHaveBeenCalled();
    expect(vi.mocked(executePlayPlan)).not.toHaveBeenCalled();
    expect(autoAdvanceGuardRef.current.autoFired).toBe(false);
  });

  it("reports previous-track failures and clears playback state", async () => {
    const playlist = [
      createPlaylistItem(),
      createPlaylistItem({ id: "item-2", label: "demo-2.prg", path: "/PROGRAMS/demo-2.prg" }),
    ];
    const setIsPlaying = vi.fn();
    const setIsPaused = vi.fn();
    const setAutoAdvanceDueAtMs = vi.fn();
    const setPlayedMs = vi.fn();
    const cancelAutoAdvance = vi.fn();
    const playedClockRef = {
      current: {
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        reset: vi.fn(),
        current: vi.fn().mockReturnValue(900),
      },
    };
    const trackStartedAtRef = { current: 1234 };
    const autoAdvanceGuardRef = { current: { trackInstanceId: 1 } };
    const ensureUnmuted = vi.fn().mockRejectedValue(new Error("unmute failed"));

    const { result } = renderPlaybackController(playlist, {
      currentIndex: 1,
      isPlaying: true,
      setIsPlaying,
      setIsPaused,
      setAutoAdvanceDueAtMs,
      setPlayedMs,
      cancelAutoAdvance,
      playedClockRef,
      trackStartedAtRef,
      autoAdvanceGuardRef,
      ensureUnmuted,
    });

    await result.current.handlePrevious();

    expect(cancelAutoAdvance).toHaveBeenCalled();
    expect(playedClockRef.current.pause).toHaveBeenCalled();
    expect(setPlayedMs).toHaveBeenCalledWith(900);
    expect(vi.mocked(reportUserError)).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "PLAYBACK_PREVIOUS", title: "Playback previous failed" }),
    );
    expect(setIsPlaying).toHaveBeenCalledWith(false);
    expect(setIsPaused).toHaveBeenCalledWith(false);
    expect(trackStartedAtRef.current).toBeNull();
    expect(autoAdvanceGuardRef.current).toBeNull();
    expect(setAutoAdvanceDueAtMs).toHaveBeenCalledWith(null);
  });
});
