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

  it("status-summary-card is visible in the initial summary view", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("status-summary-card")).toBeVisible();
    expect(screen.getByTestId("show-details-button")).toBeVisible();
  });

  it("subtitle is hidden in summary view and visible after expanding to full details", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("diagnostics-subtitle")).toHaveClass("hidden");

    fireEvent.click(screen.getByTestId("show-details-button"));

    const description = screen.getByTestId("diagnostics-subtitle");
    expect(description).not.toHaveClass("hidden");
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

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(screen.getByTestId("contributor-row-app")).toBeVisible();
    expect(screen.getByTestId("contributor-row-rest")).toBeVisible();
    expect(screen.getByTestId("contributor-row-ftp")).toBeVisible();
  });

  it("shows retry connection button when connectivity is Offline (after expanding to full details)", () => {
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

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(screen.getByTestId("retry-connection-button")).toBeVisible();
  });

  it("does not show retry button in summary view when connectivity is Offline and no connectionCallbacks", () => {
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

    // retry button is in HealthSummary (full-details only)
    expect(screen.queryByTestId("retry-connection-button")).toBeNull();
  });

  it("does not show retry button when connectivity is Online", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));
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

    fireEvent.click(screen.getByTestId("show-details-button"));

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

    fireEvent.click(screen.getByTestId("show-details-button"));
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
    expect(screen.getByTestId("status-summary-card")).toHaveTextContent("Needs attention");
  });

  it("hides technical details rows by default on compact profile", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(screen.queryByTestId("contributor-row-app")).not.toBeInTheDocument();
    expect(screen.queryByTestId("contributor-row-rest")).not.toBeInTheDocument();
    expect(screen.queryByTestId("contributor-row-ftp")).not.toBeInTheDocument();
    expect(screen.getByTestId("technical-details-toggle")).toBeVisible();
  });

  it("shows technical details rows after toggle click on compact profile", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("show-details-button"));
    fireEvent.click(screen.getByTestId("technical-details-toggle"));

    expect(screen.getByTestId("contributor-row-app")).toBeVisible();
    expect(screen.getByTestId("contributor-row-rest")).toBeVisible();
    expect(screen.getByTestId("contributor-row-ftp")).toBeVisible();
  });

  it("shows technical details open by default on expanded profile", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(screen.getByTestId("contributor-row-app")).toBeVisible();
    expect(screen.getByTestId("contributor-row-rest")).toBeVisible();
    expect(screen.getByTestId("contributor-row-ftp")).toBeVisible();
    expect(screen.getByTestId("technical-details-toggle")).toBeVisible();
  });

  it("stream section header is labelled Activity", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(screen.getByText("Activity")).toBeVisible();
    expect(screen.queryByText("Recent evidence")).not.toBeInTheDocument();
  });

  it("status-summary-card shows Healthy title for Healthy state", () => {
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

    const card = screen.getByTestId("status-summary-card");
    expect(card).toHaveTextContent("Healthy");
  });

  it("status-summary-card shows Device not reachable for Offline connectivity", () => {
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

    const card = screen.getByTestId("status-summary-card");
    expect(card).toHaveTextContent("Device not reachable");
  });

  it("status-summary-card shows Needs attention for Unhealthy state with primary problem", () => {
    localStorage.clear();
    setViewportWidth(600);

    const healthWithProblem: OverallHealthState = {
      ...idleHealthState,
      state: "Unhealthy",
      primaryProblem: {
        id: "prob-99",
        title: "REST probe failed",
        contributor: "REST",
        timestampMs: Date.now() - 5_000,
        impactLevel: 2,
        causeHint: "HTTP 503",
      },
    };

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} healthState={healthWithProblem} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("status-summary-card")).toHaveTextContent("Needs attention");
    expect(screen.getByTestId("status-summary-card")).toHaveTextContent("REST probe failed");
  });

  it("evidence-preview-card shows view-all link when entries are present", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          {...defaultProps}
          actionSummaries={[
            {
              correlationId: "COR-0001",
              operationType: "REST",
              endpoint: "/v1/machine",
              startTimestamp: new Date(Date.now() - 2000).toISOString(),
              endTimestamp: new Date(Date.now() - 1000).toISOString(),
              outcome: "Success",
              durationMs: 1000,
              errorMessage: null,
              statusCode: 200,
              contributor: "App",
              impactLevel: 0,
            },
          ]}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("evidence-preview-card")).toBeVisible();
    expect(screen.getByTestId("view-all-activity")).toBeVisible();
  });

  it("pane-focus-activity maximises the activity pane and restores via pane-expand-right", () => {
    setViewportWidth(1200);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("show-details-button"));

    // Both pane-focus buttons visible in split view
    expect(screen.getByTestId("pane-focus-activity")).toBeInTheDocument();
    expect(screen.getByTestId("pane-focus-health")).toBeInTheDocument();

    // Maximise activity pane
    fireEvent.click(screen.getByTestId("pane-focus-activity"));

    // Left pane is now minimised — restore button visible, content gone
    expect(screen.getByTestId("pane-expand-left")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-focus-health")).not.toBeInTheDocument();

    // Restore split view
    fireEvent.click(screen.getByTestId("pane-expand-left"));

    expect(screen.getByTestId("pane-focus-health")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-expand-left")).not.toBeInTheDocument();
  });

  it("pane-focus-health maximises the health pane and restores via pane-expand-right", () => {
    setViewportWidth(1200);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("show-details-button"));

    // Maximise health pane
    fireEvent.click(screen.getByTestId("pane-focus-health"));

    // Right pane is now minimised — restore button visible
    expect(screen.getByTestId("pane-expand-right")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-focus-activity")).not.toBeInTheDocument();

    // Restore split view
    fireEvent.click(screen.getByTestId("pane-expand-right"));

    expect(screen.getByTestId("pane-focus-activity")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-expand-right")).not.toBeInTheDocument();
  });

  it("paneFocus resets to split view when dialog is closed and re-opened", () => {
    setViewportWidth(1200);
    const onOpenChange = vi.fn();

    const { rerender } = render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} onOpenChange={onOpenChange} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("show-details-button"));
    fireEvent.click(screen.getByTestId("pane-focus-activity"));
    expect(screen.getByTestId("pane-expand-left")).toBeInTheDocument();

    // Close dialog
    rerender(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} open={false} onOpenChange={onOpenChange} />
      </DisplayProfileProvider>,
    );

    // Re-open dialog — paneFocus should have reset to 'both'
    rerender(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} open={true} onOpenChange={onOpenChange} />
      </DisplayProfileProvider>,
    );

    fireEvent.click(screen.getByTestId("show-details-button"));

    // Both pane-focus buttons visible again (no maximised state)
    expect(screen.getByTestId("pane-focus-activity")).toBeInTheDocument();
    expect(screen.getByTestId("pane-focus-health")).toBeInTheDocument();
    expect(screen.queryByTestId("pane-expand-left")).not.toBeInTheDocument();
  });
});
