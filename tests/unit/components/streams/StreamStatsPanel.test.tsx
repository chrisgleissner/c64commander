/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StreamStatsPanel } from "@/components/streams/StreamStatsPanel";
import type { AvMirrorSession, AvStatsSnapshot } from "@/lib/streams/avMirrorSession";

const snapshot = (
  over: Partial<AvStatsSnapshot["governor"]> = {},
  live: Partial<AvStatsSnapshot["live"]> = {},
): AvStatsSnapshot => ({
  governor: {
    requested: "auto",
    ceilingPercent: 100,
    governorPercent: 100,
    effectivePercent: 100,
    effectiveFraction: 1,
    overridden: false,
    reason: "start",
    lastTransitionAtMs: 0,
    ...over,
  },
  transitions: [],
  summary: {
    durationMs: 65000,
    samples: 10,
    audioUnderruns: 0,
    audioConcealed: 0,
    audioLostPackets: 0,
    audioBufferMsMin: 60,
    videoPresented: 500,
    videoDecimated: 0,
    videoBacklogReplacements: 0,
    videoFramesLost: 0,
    videoDroppedPackets: 0,
    residence: { p50: 5, p95: 12, p99: 18, max: 25 },
    fpsMax: 50,
  },
  live: {
    fps: 50,
    audioBufferMs: 80,
    audioUnderruns: 0,
    audioConcealed: 0,
    renderResidenceMs: 6,
    maxResidenceMs: 25,
    presented: 500,
    decimated: 0,
    backlogReplacements: 0,
    completeFrames: 0,
    partialConcealed: 0,
    repeatedFrames: 0,
    framesLost: 0,
    droppedPackets: 0,
    standard: "PAL",
    ...live,
  },
});

const makeFakeSession = (initial: AvStatsSnapshot) => {
  let snap = initial;
  const subs = new Set<(s: AvStatsSnapshot) => void>();
  const fake = {
    audioLive: true,
    videoLive: false,
    getStatsSnapshot: () => snap,
    subscribeStats: (h: (s: AvStatsSnapshot) => void) => {
      subs.add(h);
      h(snap);
      return () => subs.delete(h);
    },
    tick: vi.fn(),
    statsHistory: vi.fn(() => []),
    exportDiagnostics: vi.fn(() => ({ ok: true, governor: snap.governor })),
    setFrameRateMode: vi.fn((mode: string) => {
      const effectivePercent = mode === "25" ? 25 : mode === "50" ? 50 : 100;
      snap = {
        ...snap,
        governor: {
          ...snap.governor,
          requested: mode as never,
          effectivePercent: effectivePercent as never,
          effectiveFraction: (effectivePercent / 100) as never,
        },
      };
      subs.forEach((h) => h(snap));
    }),
  };
  return fake as unknown as AvMirrorSession & typeof fake;
};

describe("StreamStatsPanel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the compact live summary", () => {
    render(<StreamStatsPanel session={makeFakeSession(snapshot())} />);
    expect(screen.getByTestId("stream-stats-fps")).toHaveTextContent("50");
    expect(screen.getByTestId("stream-stats-rate")).toHaveTextContent("100%");
    expect(screen.getByTestId("stream-stats-audio-buffer")).toHaveTextContent("80 ms");
    expect(screen.getByTestId("stream-stats-underruns")).toHaveTextContent("0");
  });

  it("selecting a frame-rate mode routes to the session and persists it", () => {
    const session = makeFakeSession(snapshot());
    render(<StreamStatsPanel session={session} />);
    fireEvent.click(screen.getByTestId("stream-stats-mode-25"));
    expect(session.setFrameRateMode).toHaveBeenCalledWith("25");
    expect(localStorage.getItem("c64u_stream_video_frame_rate_mode")).toBe("25");
    // The effective rate re-renders from the session's new snapshot.
    expect(screen.getByTestId("stream-stats-rate")).toHaveTextContent("25%");
  });

  it("shows the auto-reduced override badge when the governor overrides a manual maximum", () => {
    const session = makeFakeSession(
      snapshot({
        requested: "100",
        ceilingPercent: 100,
        effectivePercent: 50,
        overridden: true,
        reason: "audio underrun ×1",
      }),
    );
    render(<StreamStatsPanel session={session} />);
    expect(screen.getByTestId("stream-stats-override")).toHaveTextContent("auto-reduced → 50%");
  });

  it("warns visually on low audio buffer and underruns", () => {
    const session = makeFakeSession(snapshot({}, { audioBufferMs: 12, audioUnderruns: 3 }));
    render(<StreamStatsPanel session={session} />);
    expect(screen.getByTestId("stream-stats-audio-buffer")).toHaveClass("text-destructive");
    expect(screen.getByTestId("stream-stats-underruns")).toHaveClass("text-destructive");
  });

  it("expands to detailed sections including honestly-labelled local residence", () => {
    render(<StreamStatsPanel session={makeFakeSession(snapshot())} />);
    expect(screen.queryByTestId("stream-stats-details")).toBeNull();
    fireEvent.click(screen.getByTestId("stream-stats-toggle"));
    expect(screen.getByTestId("stream-stats-details")).toBeInTheDocument();
    expect(screen.getByTestId("stream-stats-latency")).toHaveTextContent(/Local pipeline residence/i);
    expect(screen.getByTestId("stream-stats-residence-p99")).toHaveTextContent("18 ms");
    expect(screen.getByTestId("stream-stats-presented")).toHaveTextContent("500");
  });

  it("offers selectable history windows and re-queries the telemetry when one is chosen", () => {
    const session = makeFakeSession(snapshot());
    render(<StreamStatsPanel session={session} />);
    fireEvent.click(screen.getByTestId("stream-stats-toggle"));
    // The window selector + charts are present.
    expect(screen.getByTestId("stream-stats-window")).toBeInTheDocument();
    expect(screen.getByTestId("stream-stats-spark-loss")).toBeInTheDocument();
    expect(screen.getByTestId("stream-stats-spark-rate")).toBeInTheDocument();
    (session.statsHistory as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByTestId("stream-stats-window-Session"));
    // Choosing "Session" re-queries history with a large window (the full-session coarse tier).
    const calls = (session.statsHistory as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(Math.max(...calls)).toBeGreaterThan(900);
  });

  it("exports a diagnostic payload via the injected sink", () => {
    const onExport = vi.fn();
    const session = makeFakeSession(snapshot());
    render(<StreamStatsPanel session={session} onExport={onExport} />);
    fireEvent.click(screen.getByTestId("stream-stats-toggle"));
    fireEvent.click(screen.getByTestId("stream-stats-export"));
    expect(session.exportDiagnostics).toHaveBeenCalled();
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});
