/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvSyncPanel } from "@/components/streams/AvSyncPanel";
import type { AvSyncStats } from "@/lib/streams/avSync";
import type { ToneLadderNote, ToneLadderResult } from "@/lib/streams/toneLadder";

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

const ladder = vi.hoisted(() => ({
  run: vi.fn(),
  reset: vi.fn(),
  state: {
    running: false,
    error: null as string | null,
    result: null as ToneLadderResult | null,
  },
}));

vi.mock("@/hooks/useToneLadderTest", () => ({
  useToneLadderTest: () => ({
    running: ladder.state.running,
    result: ladder.state.result,
    error: ladder.state.error,
    run: ladder.run,
    reset: ladder.reset,
  }),
}));

const note = (overrides: Partial<ToneLadderNote> = {}): ToneLadderNote => ({
  slot: 0,
  expected: "C-4",
  expectedHz: 261.6,
  detectedHz: 261.6,
  cents: 0,
  colour: 6,
  colourName: "blue",
  seconds: 0.5,
  expectedSeconds: 0.5,
  lengthErrorMs: 0,
  ok: true,
  ...overrides,
});

const ladderResult = (overrides: Partial<ToneLadderResult> = {}): ToneLadderResult => ({
  notes: [note(), note({ slot: 1, expected: "D-4", detectedHz: 293.7, cents: 0 })],
  notesInTune: 2,
  inTunePct: 100,
  medianCentsError: 0,
  centsSpread: 0,
  medianLengthErrorMs: 0,
  lengthSpreadMs: 0,
  shortNotes: 0,
  longNotes: 0,
  silence: { measured: 2, floorDbfs: -78, peakDbfs: -70, passed: true },
  av: { samples: 4, medianOffsetMs: 12, spreadMs: 3, driftPpm: null, verdict: "undetectable" },
  ...overrides,
});

const expandSync = () => fireEvent.click(screen.getByTestId("av-sync-toggle"));
const expandLatency = () => fireEvent.click(screen.getByTestId("av-sync-lat-toggle"));
const expandLadder = () => fireEvent.click(screen.getByTestId("av-tone-ladder-toggle"));

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
    ladder.run.mockReset();
    ladder.reset.mockReset();
    ladder.state = { running: false, error: null, result: null };
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

  it("shows nothing to reset until the tone ladder has produced a result", () => {
    render(<AvSyncPanel />);
    expandLadder();
    expect(screen.getByTestId("av-tone-ladder-summary")).toHaveTextContent("not measured");
    expect(screen.getByTestId("av-tone-ladder-reset")).toBeDisabled();
    expect(screen.queryByTestId("av-tone-ladder-notes")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("av-tone-ladder-run"));
    expect(ladder.run).toHaveBeenCalledTimes(1);
  });

  it("reports a measured tone ladder note by note", () => {
    ladder.state.result = ladderResult();
    render(<AvSyncPanel />);
    expandLadder();

    expect(screen.getByTestId("av-tone-ladder-summary")).toHaveTextContent("100% in tune");
    expect(screen.getByTestId("av-tone-ladder-in-tune")).toHaveTextContent("100%");
    expect(screen.getByTestId("av-tone-ladder-cents")).toHaveTextContent("0c");
    expect(screen.getByTestId("av-tone-ladder-av-offset")).toHaveTextContent("+12ms");
    expect(screen.getByTestId("av-tone-ladder-silence")).toHaveTextContent("-78dB");

    // One row per note, so a fault confined to part of the scale stays visible instead
    // of being averaged into the summary.
    const notes = screen.getByTestId("av-tone-ladder-notes");
    expect(within(notes).getAllByRole("row")).toHaveLength(3); // header + two notes
    expect(within(notes).getByText("C-4")).toBeInTheDocument();
    expect(within(notes).getByText("D-4")).toBeInTheDocument();

    // Nothing was short or long, so there is no warning to show.
    expect(screen.queryByTestId("av-tone-ladder-length-warning")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("av-tone-ladder-reset"));
    expect(ladder.reset).toHaveBeenCalledTimes(1);
  });

  it("says a value was not measured instead of reporting it as zero", () => {
    // With video off there is no A/V offset and no silence floor. Printing "+0ms" and
    // "0dB" would read as a perfect result rather than as a missing one, so both must
    // fall back to a dash.
    ladder.state.result = ladderResult({
      inTunePct: 50,
      notesInTune: 1,
      notes: [note(), note({ slot: 1, expected: "D-4", cents: 80, ok: false, colour: null, colourName: null })],
      shortNotes: 1,
      longNotes: 2,
      av: { samples: 0, medianOffsetMs: 0, spreadMs: 0, driftPpm: null, verdict: "not measured" },
      silence: { measured: 0, floorDbfs: null, peakDbfs: null, passed: false },
    });
    render(<AvSyncPanel />);
    expandLadder();

    expect(screen.getByTestId("av-tone-ladder-av-offset")).toHaveTextContent("—");
    expect(screen.getByTestId("av-tone-ladder-av-offset")).not.toHaveTextContent("0ms");
    expect(screen.getByTestId("av-tone-ladder-silence")).toHaveTextContent("—");
    expect(screen.getByText("no video")).toBeInTheDocument();
    expect(screen.getByText("not found")).toBeInTheDocument();

    // Short and long notes are different faults, so both counts are named.
    const warning = screen.getByTestId("av-tone-ladder-length-warning");
    expect(warning).toHaveTextContent("1 note(s) cut short");
    expect(warning).toHaveTextContent("2 note(s) ran long");
  });

  it("surfaces a tone ladder failure in place of the instructions", () => {
    ladder.state.error = "no audio received";
    render(<AvSyncPanel />);
    expandLadder();
    expect(screen.getByTestId("av-tone-ladder-error")).toHaveTextContent("no audio received");
  });
});
