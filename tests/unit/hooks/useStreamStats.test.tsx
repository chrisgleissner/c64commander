/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStreamStats } from "@/hooks/useStreamStats";
import type { AvMirrorSession, AvStatsSnapshot } from "@/lib/streams/avMirrorSession";

const baseSnapshot = (): AvStatsSnapshot => ({
  governor: {
    requested: "auto",
    ceilingDivisor: 1,
    governorDivisor: 1,
    effectiveDivisor: 1,
    overridden: false,
    reason: "start",
    lastTransitionAtMs: 0,
  },
  transitions: [],
  summary: {
    durationMs: 0,
    samples: 0,
    audioUnderruns: 0,
    audioConcealed: 0,
    audioLostPackets: 0,
    audioBufferMsMin: 0,
    videoPresented: 0,
    videoDecimated: 0,
    videoBacklogReplacements: 0,
    videoFramesLost: 0,
    videoDroppedPackets: 0,
    residence: { p50: 0, p95: 0, p99: 0, max: 0 },
    fpsMax: 0,
  },
  live: {
    fps: 0,
    audioBufferMs: 0,
    audioUnderruns: 0,
    audioConcealed: 0,
    renderResidenceMs: 0,
    maxResidenceMs: 0,
    presented: 0,
    decimated: 0,
    backlogReplacements: 0,
    framesLost: 0,
    droppedPackets: 0,
    standard: "PAL",
  },
});

const makeFakeSession = (opts: { audioLive?: boolean; videoLive?: boolean } = {}) => {
  const subs = new Set<(s: AvStatsSnapshot) => void>();
  return {
    audioLive: opts.audioLive ?? false,
    videoLive: opts.videoLive ?? false,
    getStatsSnapshot: () => baseSnapshot(),
    subscribeStats: (h: (s: AvStatsSnapshot) => void) => {
      subs.add(h);
      h(baseSnapshot());
      return () => subs.delete(h);
    },
    tick: vi.fn(),
    statsHistory: vi.fn(() => []),
    exportDiagnostics: vi.fn(() => ({})),
    setFrameRateMode: vi.fn(),
  } as unknown as AvMirrorSession & { tick: ReturnType<typeof vi.fn> };
};

describe("useStreamStats", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("drives session.tick on the interval only while a stream is live", () => {
    const live = makeFakeSession({ videoLive: true }) as AvMirrorSession & { tick: ReturnType<typeof vi.fn> };
    const { unmount } = renderHook(() => useStreamStats(live, 100));
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(live.tick).toHaveBeenCalledTimes(3);
    unmount();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(live.tick).toHaveBeenCalledTimes(3); // interval cleared on unmount
  });

  it("does not tick while nothing is live", () => {
    const idle = makeFakeSession({ audioLive: false, videoLive: false }) as AvMirrorSession & {
      tick: ReturnType<typeof vi.fn>;
    };
    renderHook(() => useStreamStats(idle, 100));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(idle.tick).not.toHaveBeenCalled();
  });

  it("persists and routes a frame-rate mode change", () => {
    const session = makeFakeSession({ videoLive: true });
    const { result } = renderHook(() => useStreamStats(session, 1000));
    act(() => {
      result.current.setFrameRateMode("50");
    });
    expect(session.setFrameRateMode).toHaveBeenCalledWith("50");
    expect(localStorage.getItem("c64u_stream_video_frame_rate_mode")).toBe("50");
    expect(result.current.requestedMode).toBe("50");
  });
});
