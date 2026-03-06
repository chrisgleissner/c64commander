import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { usePlaybackController } from "@/pages/playFiles/hooks/usePlaybackController";
import type { PlaylistItem } from "@/pages/playFiles/types";

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

const renderPlaybackController = (playlist: PlaylistItem[], currentIndex = 0, durationMs?: number) =>
  renderHook(() =>
    usePlaybackController({
      playlist,
      setPlaylist: vi.fn(),
      currentIndex,
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
      durationMs,
      setDurationMs: vi.fn(),
      setCurrentSubsongCount: vi.fn(),
      repeatEnabled: false,
      localEntriesBySourceId: new Map(),
      localSourceTreeUris: new Map(),
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
      sidEnablement: {} as any,
      pauseMuteSnapshotRef: { current: null },
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
    }),
  );

describe("usePlaybackController", () => {
  it("applies fallback duration to non-song items without explicit duration", () => {
    const playlist = [createPlaylistItem()];
    const { result } = renderPlaybackController(playlist);

    expect(result.current.playlistItemDuration(playlist[0], 0)).toBe(45_000);
  });

  it("preserves explicit duration for non-song items", () => {
    const playlist = [createPlaylistItem({ durationMs: 12_000 })];
    const { result } = renderPlaybackController(playlist);

    expect(result.current.playlistItemDuration(playlist[0], 0)).toBe(12_000);
  });
});