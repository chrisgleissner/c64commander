import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";
import { executePlayPlan } from "@/lib/playback/playbackRouter";

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
    setPlaylist?: ReturnType<typeof vi.fn>;
    setDurationMs?: ReturnType<typeof vi.fn>;
    ensurePlaybackConnection?: ReturnType<typeof vi.fn>;
    ensureUnmuted?: ReturnType<typeof vi.fn>;
  },
) =>
  renderHook(() =>
    usePlaybackController({
      playlist,
      setPlaylist: options?.setPlaylist ?? vi.fn(),
      currentIndex: options?.currentIndex ?? 0,
      setCurrentIndex: vi.fn(),
      isPlaying: false,
      setIsPlaying: vi.fn(),
      isPaused: false,
      setIsPaused: vi.fn(),
      setIsPlaylistLoading: vi.fn(),
      elapsedMs: 0,
      setElapsedMs: vi.fn(),
      playedMs: 0,
      setPlayedMs: vi.fn(),
      durationMs: options?.durationMs,
      setDurationMs: options?.setDurationMs ?? vi.fn(),
      setCurrentSubsongCount: vi.fn(),
      repeatEnabled: false,
      localEntriesBySourceId: new Map(),
      localSourceTreeUris: new Map(),
      ensurePlaybackConnection: options?.ensurePlaybackConnection ?? vi.fn().mockResolvedValue(undefined),
      resolveSonglengthDurationMsForPath: vi.fn().mockResolvedValue(null),
      applySonglengthsToItems: vi.fn().mockImplementation(async (items) => items),
      restoreVolumeOverrides: vi.fn().mockResolvedValue(undefined),
      applyAudioMixerUpdates: vi.fn().mockResolvedValue(undefined),
      buildEnabledSidMuteUpdates: vi.fn().mockReturnValue({}),
      captureSidMuteSnapshot: vi.fn().mockReturnValue({ volumes: {}, enablement: {} }),
      snapshotToUpdates: vi.fn().mockReturnValue({}),
      resolveEnabledSidVolumeItems: vi.fn().mockResolvedValue([]),
      dispatchVolume: vi.fn(),
      sidEnablement: {} as any,
      pauseMuteSnapshotRef: { current: null },
      pausingFromPauseRef: { current: false },
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
      trace: (fn: (...args: unknown[]) => unknown) => fn,
      setTrackInstanceId: vi.fn(),
      setAutoAdvanceDueAtMs: vi.fn(),
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
});
