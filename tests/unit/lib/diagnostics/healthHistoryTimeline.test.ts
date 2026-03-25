import { describe, expect, it } from "vitest";

import type { HealthHistoryEntry } from "@/lib/diagnostics/healthHistory";
import {
  buildHealthTimelineModel,
  buildRenderedHealthTimeline,
  formatTimelineTickLabel,
  getHealthTimelineTicks,
  selectMostRelevantTimelineEvent,
} from "@/lib/diagnostics/healthHistoryTimeline";
import type { HealthState } from "@/lib/diagnostics/healthModel";

const NOW_MS = Date.parse("2026-03-20T12:00:00.000Z");

const makeEntry = (
  minutesAgo: number,
  state: HealthState,
  overrides?: Partial<HealthHistoryEntry>,
): HealthHistoryEntry => ({
  timestamp: new Date(NOW_MS - minutesAgo * 60_000).toISOString(),
  overallHealth: state,
  durationMs: 240,
  probes: {
    rest: {
      outcome: state === "Unhealthy" ? "Fail" : "Success",
      durationMs: 42,
      reason: state === "Unhealthy" ? "REST timeout" : null,
    },
    jiffy: {
      outcome: state === "Degraded" ? "Partial" : "Success",
      durationMs: 28,
      reason: state === "Degraded" ? "Jiffy variance" : null,
    },
    raster: { outcome: "Success", durationMs: 22, reason: null },
    config: { outcome: "Success", durationMs: 36, reason: null },
    ftp: { outcome: "Success", durationMs: 51, reason: null },
    telnet: { outcome: "Success", durationMs: 29, reason: null },
  },
  latency: { p50: 12, p90: 24, p99: 48 },
  ...overrides,
});

describe("healthHistoryTimeline", () => {
  it("merges adjacent identical states into contiguous source segments", () => {
    const history = [
      makeEntry(60, "Healthy"),
      makeEntry(45, "Healthy"),
      makeEntry(30, "Degraded"),
      makeEntry(15, "Healthy"),
    ];

    const model = buildHealthTimelineModel(history, {
      nowMs: NOW_MS,
      windowEndMs: NOW_MS,
      windowDurationMs: 60 * 60 * 1000,
    });

    expect(model.sourceSegments.map((segment) => segment.state)).toEqual(["Healthy", "Degraded", "Healthy"]);
    expect(model.sourceSegments[0]?.startMs).toBe(NOW_MS - 60 * 60 * 1000);
    expect(model.sourceSegments[0]?.endMs).toBe(NOW_MS - 30 * 60 * 1000);
    expect(model.sourceSegments[0]?.events).toHaveLength(2);
  });

  it("uses worst-state aggregation for compressed low-severity rendered columns", () => {
    const history = [makeEntry(60, "Healthy"), makeEntry(30, "Idle"), makeEntry(10, "Healthy")];

    const model = buildHealthTimelineModel(history, {
      nowMs: NOW_MS,
      windowEndMs: NOW_MS,
      windowDurationMs: 60 * 60 * 1000,
    });
    const rendered = buildRenderedHealthTimeline(model, 2);

    expect(rendered.columns).toHaveLength(2);
    expect(rendered.columns[0]?.displayState).toBe("Healthy");
    expect(rendered.columns[1]?.displayState).toBe("Healthy");
  });

  it("guarantees degraded and unhealthy visibility even when both compress into the same broad region", () => {
    const history = [
      makeEntry(60, "Healthy"),
      makeEntry(30, "Degraded"),
      makeEntry(29, "Healthy"),
      makeEntry(28, "Unhealthy"),
      makeEntry(27, "Healthy"),
    ];

    const model = buildHealthTimelineModel(history, {
      nowMs: NOW_MS,
      windowEndMs: NOW_MS,
      windowDurationMs: 60 * 60 * 1000,
    });
    const rendered = buildRenderedHealthTimeline(model, 2);
    const visibleStates = rendered.columns.map((column) => column.displayState);

    expect(visibleStates).toContain("Degraded");
    expect(visibleStates).toContain("Unhealthy");
  });

  it("marks compressed low-severity mixes as aggregated selections", () => {
    const history = [makeEntry(60, "Healthy"), makeEntry(40, "Idle"), makeEntry(20, "Healthy")];

    const model = buildHealthTimelineModel(history, {
      nowMs: NOW_MS,
      windowEndMs: NOW_MS,
      windowDurationMs: 60 * 60 * 1000,
    });
    const rendered = buildRenderedHealthTimeline(model, 1);

    expect(rendered.displaySegments).toHaveLength(1);
    expect(rendered.displaySegments[0]?.selection.kind).toBe("aggregated");
    expect(rendered.displaySegments[0]?.selection.eventCount).toBe(3);
  });

  it("returns safe labels and fallback ticks for invalid or zero-length windows", () => {
    expect(formatTimelineTickLabel(Number.NaN)).toBe("--:--");
    expect(getHealthTimelineTicks(NOW_MS, NOW_MS)).toEqual([NOW_MS]);
  });

  it("returns the newest highest-severity event and null for empty selections", () => {
    const history = [makeEntry(30, "Degraded"), makeEntry(20, "Unhealthy"), makeEntry(10, "Unhealthy")];

    const model = buildHealthTimelineModel(history, {
      nowMs: NOW_MS,
      windowEndMs: NOW_MS,
      windowDurationMs: 60 * 60 * 1000,
    });
    const rendered = buildRenderedHealthTimeline(model, 20);
    const unhealthySelection = rendered.displaySegments.find((segment) => segment.state === "Unhealthy")?.selection;

    expect(unhealthySelection).toBeDefined();
    expect(selectMostRelevantTimelineEvent(unhealthySelection!)).toMatchObject({
      state: "Unhealthy",
      timestampMs: NOW_MS - 10 * 60 * 1000,
    });
    expect(
      selectMostRelevantTimelineEvent({
        kind: "aggregated",
        startMs: NOW_MS - 60 * 60 * 1000,
        endMs: NOW_MS,
        state: "Healthy",
        worstState: "Healthy",
        eventCount: 0,
        sourceSegments: [],
        events: [],
      }),
    ).toBeNull();
  });
});
