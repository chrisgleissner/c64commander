import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import type { OverallHealthState } from "@/lib/diagnostics/healthModel";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const idleHealthState: OverallHealthState = {
  state: "Idle",
  connectivity: "Online",
  host: "c64u",
  problemCount: 0,
  contributors: {
    App: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
    REST: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
    FTP: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
  },
  lastRestActivity: null,
  lastFtpActivity: null,
  primaryProblem: null,
};

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  healthState: idleHealthState,
  logs: [],
  errorLogs: [],
  traceEvents: [],
  actionSummaries: [],
  onShareAll: vi.fn(),
  onShareFiltered: vi.fn(),
  onClearAll: vi.fn(),
  onRetryConnection: vi.fn(),
};

describe("DiagnosticsDialog", () => {
  it("adds compact inner padding so the title and toolbar do not sit flush to the fullscreen shell", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    const title = screen.getByText("Diagnostics");
    expect(title.closest("div.border-b")).toHaveClass("px-3");
  });

  it("keeps medium and expanded padding aligned with tighter list-browser rhythm", () => {
    localStorage.clear();
    setViewportWidth(900);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    const title = screen.getByText("Diagnostics");
    expect(title.closest("div.border-b")).toHaveClass("px-4");
    expect(title.closest("div.border-b")).not.toHaveClass("px-6");
  });

  it("keeps the description to a single concise line", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    const description = screen.getByTestId("diagnostics-subtitle");
    expect(description).toHaveTextContent("Health, status, and recent evidence.");
    expect(description).toHaveClass("truncate");
    expect(description).toHaveClass("whitespace-nowrap");
  });

  it("shows empty session message when no data and no filters active", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("diagnostics-empty-message")).toBeVisible();
  });

  it("shows evidence type toggles — Problems and Actions active by default", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    const problemsBtn = screen.getByTestId("evidence-toggle-problems");
    const actionsBtn = screen.getByTestId("evidence-toggle-actions");
    const logsBtn = screen.getByTestId("evidence-toggle-logs");
    const tracesBtn = screen.getByTestId("evidence-toggle-traces");

    expect(problemsBtn).toHaveAttribute("aria-pressed", "true");
    expect(actionsBtn).toHaveAttribute("aria-pressed", "true");
    expect(logsBtn).toHaveAttribute("aria-pressed", "false");
    expect(tracesBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("shows health summary with connectivity and overall health row", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          {...defaultProps}
          healthState={{ ...idleHealthState, state: "Healthy", connectivity: "Online" }}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("health-summary")).toBeVisible();
    expect(screen.getByTestId("overall-health-row")).toBeVisible();
  });

  it("shows contributor rows for App, REST, FTP", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("contributor-row-app")).toBeVisible();
    expect(screen.getByTestId("contributor-row-rest")).toBeVisible();
    expect(screen.getByTestId("contributor-row-ftp")).toBeVisible();
  });

  it("shows retry connection button when connectivity is Offline", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          {...defaultProps}
          healthState={{ ...idleHealthState, state: "Unavailable", connectivity: "Offline" }}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("retry-connection-button")).toBeVisible();
  });

  it("does not show retry button when connectivity is Online", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.queryByTestId("retry-connection-button")).toBeNull();
  });

  it("shows search input on medium and expanded profiles", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("diagnostics-filter-input")).toBeVisible();
  });

  it("does not show search input on compact profile (behind Refine)", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();
  });

  it("uses tooltip triggers to distinguish filters from the activity stream", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("filters-help")).toBeVisible();
    expect(screen.getByTestId("activity-help")).toBeVisible();
  });

  it("shows Share all and Share filtered buttons in a pinned action shelf", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("diagnostics-action-shelf")).toHaveClass("sticky");
    expect(screen.getByTestId("diagnostics-share-all")).toBeVisible();
    expect(screen.getByTestId("diagnostics-share-filtered")).toBeVisible();
    expect(screen.getByTestId("diagnostics-tools-menu")).toBeVisible();
  });

  it("uses a non-wrapping More filters label on compact layouts", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("refine-button")).toHaveTextContent("More filters");
    expect(screen.getByTestId("refine-button")).toHaveClass("whitespace-nowrap");
  });

  it("shows config drift, heat maps, and clear actions inside the tools menu", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    fireEvent.pointerDown(screen.getByTestId("diagnostics-tools-menu"));
    expect(screen.getByTestId("open-config-drift")).toBeVisible();
    expect(screen.getByTestId("open-heatmap-config")).toBeVisible();
    expect(screen.getByTestId("diagnostics-clear-all-trigger")).toBeVisible();
  });

  it("shows contributor and severity filters for multi-dimensional narrowing", () => {
    localStorage.clear();
    setViewportWidth(900);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("indicator-toggle-app")).toBeVisible();
    expect(screen.getByTestId("indicator-toggle-rest")).toBeVisible();
    expect(screen.getByTestId("severity-toggle-errors")).toBeVisible();
    expect(screen.getByTestId("severity-toggle-info")).toBeVisible();
  });

  it("auto-collapses the summary on compact screens when raw evidence filtering starts", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("refine-button"));
    fireEvent.click(screen.getByTestId("severity-toggle-errors"));

    expect(screen.getByLabelText("Expand health summary")).toBeVisible();
  });

  it("opens health check detail when a last health check result exists", async () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          {...defaultProps}
          onRunHealthCheck={vi.fn()}
          lastHealthCheckResult={{
            runId: "hcr-0001",
            startTimestamp: "2026-03-19T10:00:00.000Z",
            endTimestamp: "2026-03-19T10:00:01.000Z",
            totalDurationMs: 1000,
            overallHealth: "Healthy",
            latency: { p50: 10, p90: 20, p99: 30 },
            probes: {
              REST: { probe: "REST", outcome: "Success", durationMs: 10, reason: null, startMs: 1 },
              JIFFY: { probe: "JIFFY", outcome: "Success", durationMs: 20, reason: null, startMs: 2 },
              RASTER: { probe: "RASTER", outcome: "Skipped", durationMs: null, reason: "Unsupported", startMs: 3 },
              CONFIG: { probe: "CONFIG", outcome: "Success", durationMs: 30, reason: null, startMs: 4 },
              FTP: { probe: "FTP", outcome: "Success", durationMs: 40, reason: null, startMs: 5 },
            },
          }}
        />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("open-health-check-detail"));
    expect(screen.getByTestId("health-check-detail-view")).toBeVisible();
    expect(screen.getByTestId("health-check-probe-rest")).toBeVisible();
  });

  it("uses condensed health-check action labels on compact layouts", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          {...defaultProps}
          onRunHealthCheck={vi.fn()}
          lastHealthCheckResult={{
            runId: "hcr-0001",
            startTimestamp: "2026-03-19T10:00:00.000Z",
            endTimestamp: "2026-03-19T10:00:01.000Z",
            totalDurationMs: 1000,
            overallHealth: "Healthy",
            latency: { p50: 10, p90: 20, p99: 30 },
            probes: {
              REST: { probe: "REST", outcome: "Success", durationMs: 10, reason: null, startMs: 1 },
              JIFFY: { probe: "JIFFY", outcome: "Success", durationMs: 20, reason: null, startMs: 2 },
              RASTER: { probe: "RASTER", outcome: "Skipped", durationMs: null, reason: "Unsupported", startMs: 3 },
              CONFIG: { probe: "CONFIG", outcome: "Success", durationMs: 30, reason: null, startMs: 4 },
              FTP: { probe: "FTP", outcome: "Success", durationMs: 40, reason: null, startMs: 5 },
            },
          }}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("run-health-check-button")).toHaveTextContent("Run check");
    expect(screen.getByTestId("open-health-check-detail")).toHaveTextContent("Last check");
  });

  it("keeps the running health-check label explicit on compact layouts", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          {...defaultProps}
          healthCheckRunning
          onRunHealthCheck={vi.fn()}
          lastHealthCheckResult={{
            runId: "hcr-0002",
            startTimestamp: "2026-03-19T10:00:00.000Z",
            endTimestamp: "2026-03-19T10:00:01.000Z",
            totalDurationMs: 1000,
            overallHealth: "Healthy",
            latency: { p50: 10, p90: 20, p99: 30 },
            probes: {
              REST: { probe: "REST", outcome: "Success", durationMs: 10, reason: null, startMs: 1 },
              JIFFY: { probe: "JIFFY", outcome: "Success", durationMs: 20, reason: null, startMs: 2 },
              RASTER: { probe: "RASTER", outcome: "Skipped", durationMs: null, reason: "Unsupported", startMs: 3 },
              CONFIG: { probe: "CONFIG", outcome: "Success", durationMs: 30, reason: null, startMs: 4 },
              FTP: { probe: "FTP", outcome: "Success", durationMs: 40, reason: null, startMs: 5 },
            },
          }}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("run-health-check-button")).toHaveTextContent("Running health check…");
  });

  it("shows primary problem spotlight when healthState includes a primary problem", () => {
    localStorage.clear();
    setViewportWidth(600);

    const healthWithProblem: OverallHealthState = {
      ...idleHealthState,
      state: "Unhealthy",
      primaryProblem: {
        id: "prob-1",
        title: "GET /v1/machine failed",
        contributor: "REST",
        timestampMs: Date.now() - 10_000,
        impactLevel: 2,
        causeHint: "HTTP 500",
      },
    };

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} healthState={healthWithProblem} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("primary-problem-spotlight")).toBeVisible();
    expect(screen.getByText("Needs attention")).toBeVisible();
  });
});
