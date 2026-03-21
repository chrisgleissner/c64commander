import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HealthHistoryPopup } from "@/components/diagnostics/HealthHistoryPopup";
import type { HealthHistoryEntry } from "@/lib/diagnostics/healthHistory";
import type { HealthState } from "@/lib/diagnostics/healthModel";

vi.mock("@/lib/diagnostics/healthHistory", () => ({
  getHealthHistory: vi.fn(),
}));

import { getHealthHistory } from "@/lib/diagnostics/healthHistory";

const NOW_MS = Date.parse("2026-03-20T12:00:00.000Z");

const makeEntry = (
  minutesAgo: number,
  state: HealthState,
  overrides?: Partial<HealthHistoryEntry>,
): HealthHistoryEntry => ({
  timestamp: new Date(NOW_MS - minutesAgo * 60_000).toISOString(),
  overallHealth: state,
  durationMs: 280,
  probes: {
    rest: {
      outcome: state === "Unhealthy" ? "Fail" : "Success",
      durationMs: 44,
      reason: state === "Unhealthy" ? "REST timeout" : null,
    },
    jiffy: {
      outcome: state === "Degraded" ? "Partial" : "Success",
      durationMs: 31,
      reason: state === "Degraded" ? "Jiffy variance" : null,
    },
    raster: { outcome: "Success", durationMs: 19, reason: null },
    config: { outcome: "Success", durationMs: 35, reason: null },
    ftp: { outcome: "Success", durationMs: 41, reason: null },
  },
  latency: { p50: 10, p90: 18, p99: 30 },
  ...overrides,
});

class ResizeObserverMock {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

describe("HealthHistoryPopup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    vi.stubGlobal("ResizeObserver", ResizeObserverMock as unknown as typeof ResizeObserver);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          width: 120,
          height: 28,
          top: 0,
          left: 0,
          right: 120,
          bottom: 28,
          toJSON: () => ({}),
        }) as DOMRect,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("opens deterministic segment detail when a rendered timeline segment is tapped", () => {
    vi.mocked(getHealthHistory).mockReturnValue([
      makeEntry(60, "Healthy"),
      makeEntry(30, "Degraded"),
      makeEntry(20, "Unhealthy"),
      makeEntry(10, "Healthy"),
    ]);

    render(<HealthHistoryPopup open={true} onClose={vi.fn()} />);

    const unhealthySegment = screen
      .getAllByTestId(/health-history-segment-/)
      .find((node) => node.getAttribute("data-state") === "Unhealthy");

    expect(unhealthySegment).toBeDefined();
    fireEvent.click(unhealthySegment!);

    const overlay = screen.getByTestId("health-history-selection-overlay");
    expect(overlay).toBeInTheDocument();
    expect(within(overlay).getByText("Segment detail")).toBeInTheDocument();
    expect(within(overlay).getByText("Unhealthy")).toBeInTheDocument();
    expect(within(overlay).getByTestId("health-history-selection-reason")).toHaveTextContent("REST timeout");
    expect(within(overlay).getByTestId("health-history-selection-error")).toHaveTextContent("REST timeout");
  });

  it("shows aggregated interval metadata when a compressed mixed-state column is tapped", () => {
    vi.mocked(getHealthHistory).mockReturnValue([
      makeEntry(60, "Healthy"),
      makeEntry(40, "Idle"),
      makeEntry(20, "Healthy"),
    ]);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 0,
          y: 0,
          width: 1,
          height: 28,
          top: 0,
          left: 0,
          right: 1,
          bottom: 28,
          toJSON: () => ({}),
        }) as DOMRect,
    );

    render(<HealthHistoryPopup open={true} onClose={vi.fn()} />);

    const segment = screen.getAllByTestId(/health-history-segment-/)[0];
    fireEvent.click(segment!);

    const overlay = screen.getByTestId("health-history-selection-overlay");
    expect(within(overlay).getByText("Aggregated interval")).toBeInTheDocument();
    expect(within(overlay).getByText(/Worst state/i)).toBeInTheDocument();
    expect(within(overlay).getByText(/^Events$/i, { selector: "p" })).toBeInTheDocument();
  });

  it("renders a color-only legend with no glyph text", () => {
    vi.mocked(getHealthHistory).mockReturnValue([makeEntry(60, "Healthy"), makeEntry(20, "Degraded")]);

    render(<HealthHistoryPopup open={true} onClose={vi.fn()} />);

    const legend = screen.getByTestId("health-history-legend");
    expect(legend).toHaveTextContent("Healthy");
    expect(legend).toHaveTextContent("Degraded");
    expect(legend).toHaveTextContent("Unhealthy");
    expect(legend).not.toHaveTextContent("●");
    expect(legend).not.toHaveTextContent("▲");
    expect(legend).not.toHaveTextContent("◆");
  });

  it("shows the empty state when no health history is available", () => {
    vi.mocked(getHealthHistory).mockReturnValue([]);

    render(<HealthHistoryPopup open={true} onClose={vi.fn()} />);

    expect(screen.getByText("No health check history yet.")).toBeInTheDocument();
    expect(screen.getByText("Run a health check to start recording history.")).toBeInTheDocument();
    expect(screen.queryByTestId("health-history-track")).not.toBeInTheDocument();
  });

  it("supports zooming out even when ResizeObserver is unavailable", () => {
    vi.mocked(getHealthHistory).mockReturnValue([makeEntry(60, "Healthy"), makeEntry(20, "Degraded")]);
    vi.stubGlobal("ResizeObserver", undefined);

    render(<HealthHistoryPopup open={true} onClose={vi.fn()} />);

    expect(screen.getByText(/Visible window 4h/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("health-history-zoom-in"));
    expect(screen.getByText(/Visible window 2h/i)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("health-history-zoom-out"));
    expect(screen.getByText(/Visible window 4h/i)).toBeInTheDocument();
  });
});
