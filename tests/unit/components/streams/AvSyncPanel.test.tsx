/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvSyncPanel } from "@/components/streams/AvSyncPanel";
import type { AvSyncStats } from "@/lib/streams/avSync";

const emptyLatency = {
  count: 0,
  missed: 0,
  seeLastMs: null,
  seeP99Ms: null,
  hearLastMs: null,
  hearP99Ms: null,
  offsetLastMs: null,
  offsetP99Ms: null,
};

const emptyStats: AvSyncStats = {
  count: 0,
  lastMs: null,
  minMs: null,
  avgMs: null,
  p90Ms: null,
  p99Ms: null,
  maxMs: null,
  unmatchedVideo: 0,
  unmatchedAudio: 0,
};

const mirror = vi.hoisted(() => ({
  reset: vi.fn(),
  runTest: vi.fn(),
  runKeyTest: vi.fn(),
  pressSpace: vi.fn(),
  stopTest: vi.fn(),
  state: {
    stats: {} as AvSyncStats,
    latencyStats: {} as typeof emptyLatency,
    testActive: false,
    runningTest: false,
    testError: null as string | null,
  },
}));

vi.mock("@/hooks/useAvSync", () => ({
  useAvSync: () => ({
    stats: mirror.state.stats,
    latencyStats: mirror.state.latencyStats,
    reset: mirror.reset,
    runTest: mirror.runTest,
    runKeyTest: mirror.runKeyTest,
    pressSpace: mirror.pressSpace,
    stopTest: mirror.stopTest,
    testActive: mirror.state.testActive,
    runningTest: mirror.state.runningTest,
    testError: mirror.state.testError,
  }),
}));

const expandSync = () => fireEvent.click(screen.getByTestId("av-sync-toggle"));
const expandLatency = () => fireEvent.click(screen.getByTestId("av-sync-lat-toggle"));

describe("AvSyncPanel", () => {
  beforeEach(() => {
    mirror.reset.mockReset();
    mirror.runTest.mockReset();
    mirror.runKeyTest.mockReset();
    mirror.pressSpace.mockReset();
    mirror.stopTest.mockReset();
    mirror.state = {
      stats: { ...emptyStats },
      latencyStats: { ...emptyLatency },
      testActive: false,
      runningTest: false,
      testError: null,
    };
  });

  it("shows both test sections, each collapsed by default", () => {
    render(<AvSyncPanel />);
    expect(screen.getByTestId("av-sync-panel")).toBeInTheDocument();
    expect(screen.getByTestId("av-sync-section")).toBeInTheDocument();
    expect(screen.getByTestId("av-sync-lat-section")).toBeInTheDocument();
    expect(screen.getByTestId("av-sync-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("av-sync-lat-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("av-sync-body")).not.toBeInTheDocument();
    expect(screen.queryByTestId("av-sync-lat-body")).not.toBeInTheDocument();
  });

  it("expands the A/V Sync section to reveal run/reset and every statistic", () => {
    mirror.state.stats = {
      count: 12,
      lastMs: 33,
      minMs: -5,
      avgMs: 21.6,
      p90Ms: 40,
      p99Ms: 48,
      maxMs: 51,
      unmatchedVideo: 0,
      unmatchedAudio: 1,
    };
    render(<AvSyncPanel />);
    expect(screen.getByTestId("av-sync-count")).toHaveTextContent("12 pops");
    expandSync();
    expect(screen.getByTestId("av-sync-stat-last")).toHaveTextContent("+33 ms");
    expect(screen.getByTestId("av-sync-stat-min")).toHaveTextContent("-5 ms");
    expect(screen.getByTestId("av-sync-stat-avg")).toHaveTextContent("+22 ms"); // rounded
    expect(screen.getByTestId("av-sync-stat-max")).toHaveTextContent("+51 ms");
    fireEvent.click(screen.getByTestId("av-sync-run"));
    expect(mirror.runTest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("av-sync-reset"));
    expect(mirror.reset).toHaveBeenCalledTimes(1);
  });

  it("expands the Tap latency section and shows the latest See/Hear/Offset immediately (with p99)", () => {
    mirror.state.latencyStats = {
      count: 1,
      missed: 0,
      seeLastMs: 42,
      seeP99Ms: 42,
      hearLastMs: 40,
      hearP99Ms: 40,
      offsetLastMs: 6,
      offsetP99Ms: 6,
    };
    render(<AvSyncPanel />);
    expect(screen.getByTestId("av-sync-lat-count")).toHaveTextContent("1 tap");
    expandLatency();
    // The latest value surfaces after a single tap, not only once a percentile stabilises.
    expect(screen.getByTestId("av-sync-lat-see")).toHaveTextContent("42 ms");
    expect(screen.getByTestId("av-sync-lat-hear")).toHaveTextContent("40 ms");
    expect(screen.getByTestId("av-sync-lat-offset")).toHaveTextContent("6 ms");
    expect(screen.getByTestId("av-sync-lat-see-p99")).toHaveTextContent("p99 42 ms");

    fireEvent.click(screen.getByTestId("av-sync-key-load"));
    expect(mirror.runKeyTest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("av-sync-press"));
    expect(mirror.pressSpace).toHaveBeenCalledTimes(1);
  });

  it("surfaces the missed-tap count in the header summary", () => {
    mirror.state.latencyStats = { ...emptyLatency, count: 5, missed: 2 };
    render(<AvSyncPanel />);
    expect(screen.getByTestId("av-sync-lat-count")).toHaveTextContent("5 taps");
    expect(screen.getByTestId("av-sync-lat-count")).toHaveTextContent("2 missed");
  });

  it("shows a Stop button that resets the C64 only while a test is active", () => {
    // Not active → no Stop control in either section.
    const { rerender } = render(<AvSyncPanel />);
    expandSync();
    expect(screen.queryByTestId("av-sync-stop")).not.toBeInTheDocument();

    // Active → Stop appears; clicking it calls stopTest (which resets the machine).
    mirror.state.testActive = true;
    rerender(<AvSyncPanel />);
    const stop = screen.getByTestId("av-sync-stop");
    fireEvent.click(stop);
    expect(mirror.stopTest).toHaveBeenCalledTimes(1);
  });

  it("disables the controls while a test is starting and surfaces an error", () => {
    mirror.state.runningTest = true;
    mirror.state.testError = "device offline";
    render(<AvSyncPanel />);
    expandSync();
    expect(screen.getByTestId("av-sync-run")).toBeDisabled();
    expect(screen.getByTestId("av-sync-run")).toHaveTextContent("Starting…");
    expect(screen.getByTestId("av-sync-error")).toHaveTextContent("device offline");
  });
});
