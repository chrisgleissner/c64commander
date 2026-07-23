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

const mirror = vi.hoisted(() => ({
  reset: vi.fn(),
  runTest: vi.fn(),
  state: {
    stats: {
      count: 0,
      lastMs: null,
      minMs: null,
      avgMs: null,
      p90Ms: null,
      p99Ms: null,
      maxMs: null,
      unmatchedVideo: 0,
      unmatchedAudio: 0,
    } as AvSyncStats,
    runningTest: false,
    testError: null as string | null,
  },
}));

vi.mock("@/hooks/useAvSync", () => ({
  useAvSync: () => ({
    stats: mirror.state.stats,
    reset: mirror.reset,
    runTest: mirror.runTest,
    runningTest: mirror.state.runningTest,
    testError: mirror.state.testError,
  }),
}));

describe("AvSyncPanel", () => {
  beforeEach(() => {
    mirror.reset.mockReset();
    mirror.runTest.mockReset();
    mirror.state = {
      stats: {
        count: 0,
        lastMs: null,
        minMs: null,
        avgMs: null,
        p90Ms: null,
        p99Ms: null,
        maxMs: null,
        unmatchedVideo: 0,
        unmatchedAudio: 0,
      },
      runningTest: false,
      testError: null,
    };
  });

  it("shows placeholders before any pops and the run/reset controls", () => {
    render(<AvSyncPanel />);
    expect(screen.getByTestId("av-sync-panel")).toBeInTheDocument();
    expect(screen.getByTestId("av-sync-count")).toHaveTextContent("0 pops");
    expect(screen.getByTestId("av-sync-stat-last")).toHaveTextContent("—");
    fireEvent.click(screen.getByTestId("av-sync-run"));
    expect(mirror.runTest).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("av-sync-reset"));
    expect(mirror.reset).toHaveBeenCalledTimes(1);
  });

  it("formats offsets with a sign and renders every statistic", () => {
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
    expect(screen.getByTestId("av-sync-stat-last")).toHaveTextContent("+33 ms");
    expect(screen.getByTestId("av-sync-stat-min")).toHaveTextContent("-5 ms");
    expect(screen.getByTestId("av-sync-stat-avg")).toHaveTextContent("+22 ms"); // rounded
    expect(screen.getByTestId("av-sync-stat-max")).toHaveTextContent("+51 ms");
  });

  it("disables Run while a test is starting and surfaces an error", () => {
    mirror.state.runningTest = true;
    mirror.state.testError = "device offline";
    render(<AvSyncPanel />);
    expect(screen.getByTestId("av-sync-run")).toBeDisabled();
    expect(screen.getByTestId("av-sync-run")).toHaveTextContent("Starting…");
    expect(screen.getByTestId("av-sync-error")).toHaveTextContent("device offline");
  });
});
