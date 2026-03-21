import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const renderDialog = (props?: Partial<typeof defaultProps>) =>
  render(
    <DisplayProfileProvider>
      <DiagnosticsDialog {...defaultProps} {...props} />
    </DisplayProfileProvider>,
  );

const healthyHealthState: OverallHealthState = {
  state: "Healthy",
  connectivity: "Online",
  host: "c64u",
  connectedDeviceLabel: "C64U",
  problemCount: 0,
  contributors: {
    App: { state: "Healthy", problemCount: 0, totalOperations: 3, failedOperations: 0 },
    REST: { state: "Healthy", problemCount: 0, totalOperations: 4, failedOperations: 0 },
    FTP: { state: "Healthy", problemCount: 0, totalOperations: 2, failedOperations: 0 },
  },
  lastRestActivity: { operation: "GET /v1/info", result: "200", timestampMs: Date.now() - 5_000 },
  lastFtpActivity: { operation: "LIST /Usb0", result: "success", timestampMs: Date.now() - 8_000 },
  primaryProblem: null,
};

const unhealthyHealthState: OverallHealthState = {
  ...healthyHealthState,
  state: "Unhealthy",
  problemCount: 1,
  contributors: {
    ...healthyHealthState.contributors,
    REST: { state: "Unhealthy", problemCount: 1, totalOperations: 4, failedOperations: 2 },
  },
  primaryProblem: {
    id: "problem-1",
    title: "PUT /v1/configs/Audio/Volume failed",
    contributor: "REST",
    timestampMs: Date.now() - 10_000,
    impactLevel: 2,
    causeHint: "HTTP 403",
  },
};

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  healthState: healthyHealthState,
  logs: [
    {
      id: "log-1",
      level: "info" as const,
      message: "Configuration updated successfully",
      timestamp: new Date(Date.now() - 4_000).toISOString(),
    },
  ],
  errorLogs: [
    {
      id: "error-1",
      level: "error" as const,
      message: "Failed to save audio profile",
      timestamp: new Date(Date.now() - 6_000).toISOString(),
      details: { code: "E_AUDIO" },
    },
  ],
  traceEvents: [
    {
      id: "trace-1",
      timestamp: new Date(Date.now() - 5_000).toISOString(),
      relativeMs: 0,
      type: "rest-response" as const,
      origin: "user" as const,
      correlationId: "action-1",
      data: {
        lifecycleState: "foreground" as const,
        sourceKind: null,
        localAccessMode: null,
        trackInstanceId: null,
        playlistItemId: null,
        method: "GET",
        path: "/v1/info",
        status: 200,
      },
    },
  ],
  actionSummaries: [
    {
      correlationId: "action-1",
      actionName: "Configuration updated successfully",
      origin: "user" as const,
      originalOrigin: "user" as const,
      startTimestamp: new Date(Date.now() - 7_000).toISOString(),
      endTimestamp: new Date(Date.now() - 6_500).toISOString(),
      durationMs: 500,
      outcome: "success" as const,
      startRelativeMs: 0,
      effects: [
        {
          type: "REST" as const,
          label: "Save",
          method: "PUT",
          path: "/v1/configs",
          target: null,
          status: 200,
          durationMs: 500,
        },
      ],
    },
  ],
  onShareAll: vi.fn(),
  onShareFiltered: vi.fn(),
  onClearAll: vi.fn(),
  onRetryConnection: vi.fn(),
  connectionCallbacks: {
    onRetryConnection: vi.fn().mockResolvedValue({ success: true, message: "Connected to c64u" }),
    onSwitchDevice: vi.fn().mockResolvedValue({ success: true, message: "Switched to c64u-backup" }),
  },
  deviceInfo: null,
  healthCheckRunning: false,
  onRunHealthCheck: vi.fn(),
  lastHealthCheckResult: {
    runId: "hc-1",
    startTimestamp: new Date(Date.now() - 60_000).toISOString(),
    endTimestamp: new Date(Date.now() - 59_000).toISOString(),
    totalDurationMs: 1000,
    overallHealth: "Healthy" as const,
    probes: {
      REST: { probe: "REST" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 0 },
      FTP: { probe: "FTP" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 100 },
      CONFIG: { probe: "CONFIG" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 200 },
      RASTER: { probe: "RASTER" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 300 },
      JIFFY: { probe: "JIFFY" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 400 },
    },
    latency: { p50: 10, p90: 20, p99: 30 },
    deviceInfo: null,
  },
  liveHealthCheckProbes: null,
};

describe("DiagnosticsDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("keeps the healthy first-open state calm and summary-only", () => {
    setViewportWidth(600);

    renderDialog();

    expect(screen.getByTestId("status-summary-card")).toBeVisible();
    expect(screen.getByText("Healthy")).toBeVisible();
    expect(screen.getByText("C64U")).toBeVisible();
    expect(screen.getByText("All systems working")).toBeVisible();
    expect(screen.getByTestId("show-details-button")).toHaveTextContent("Run health check");
    expect(screen.queryByTestId("issue-card")).toBeNull();
    expect(screen.queryByTestId("diagnostics-details-layer")).toBeNull();
    expect(screen.queryByTestId("diagnostics-analysis-layer")).toBeNull();
    expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();
    expect(screen.queryByText(/Showing \d+ of \d+/i)).toBeNull();
  });

  it("uses the healthy summary action to run a health check and reveal focused details", () => {
    setViewportWidth(600);
    const onRunHealthCheck = vi.fn();

    renderDialog({ onRunHealthCheck });

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(onRunHealthCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("diagnostics-details-layer")).toBeVisible();
    expect(screen.getByTestId("diagnostics-scope-label")).toHaveTextContent("Showing: Health check");
  });

  it("shows contributor context, issue, and one dominant action immediately when unhealthy", () => {
    setViewportWidth(600);

    renderDialog({ healthState: unhealthyHealthState });

    expect(screen.getByRole("heading", { name: "Unhealthy" })).toBeVisible();
    expect(screen.getByText("Contributor: REST")).toBeVisible();
    expect(screen.getByTestId("issue-card")).toBeVisible();
    expect(screen.getByText("A device request could not be completed")).toBeVisible();
    expect(screen.getByText("HTTP 403")).toBeVisible();
    expect(screen.getByTestId("show-details-button")).toHaveTextContent("View issue");
    expect(screen.getByTestId("run-health-check-button")).toHaveTextContent("Run health check");
  });

  it("uses the offline summary action for recovery and retry", () => {
    setViewportWidth(600);
    const onRetryConnection = vi.fn();

    renderDialog({
      healthState: {
        ...healthyHealthState,
        connectivity: "Offline",
        connectedDeviceLabel: null,
      },
      onRetryConnection,
    });

    expect(screen.getByRole("heading", { name: "Offline" })).toBeVisible();
    expect(screen.getByText("Device not reachable")).toBeVisible();
    expect(screen.getByTestId("show-details-button")).toHaveTextContent("Fix / Retry");

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(onRetryConnection).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("diagnostics-details-layer")).toBeVisible();
    expect(screen.getByTestId("diagnostics-scope-label")).toHaveTextContent("Showing: Connection recovery");
  });

  it("closes analytic popups when the diagnostics sheet closes externally", async () => {
    setViewportWidth(600);
    const { rerender } = renderDialog();

    fireEvent.click(screen.getByTestId("show-details-button"));
    fireEvent.click(screen.getByTestId("health-history-row"));

    expect(screen.getByTestId("health-history-popup")).toBeVisible();

    rerender(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} open={false} />
      </DisplayProfileProvider>,
    );

    await waitFor(() => {
      expect(screen.queryByTestId("health-history-popup")).toBeNull();
    });
  });

  it("enforces progressive disclosure from summary to details to analysis", () => {
    setViewportWidth(600);

    renderDialog();

    expect(screen.queryByTestId("diagnostics-details-layer")).toBeNull();
    expect(screen.queryByTestId("diagnostics-analysis-layer")).toBeNull();
    expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(screen.getByTestId("diagnostics-details-layer")).toBeVisible();
    expect(screen.queryByTestId("diagnostics-analysis-layer")).toBeNull();
    expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();

    fireEvent.click(screen.getByTestId("analyse-button"));

    expect(screen.getByTestId("diagnostics-analysis-layer")).toBeVisible();
    expect(screen.getByTestId("diagnostics-filter-input")).toBeVisible();
    expect(screen.getByTestId("evidence-full-view")).toBeVisible();
  });

  it("keeps counts and timestamps singular inside analysis", () => {
    setViewportWidth(600);

    renderDialog({ healthState: unhealthyHealthState });

    fireEvent.click(screen.getByTestId("show-details-button"));
    fireEvent.click(screen.getByTestId("analyse-button"));

    expect(screen.getAllByText(/Showing \d+ of \d+/i)).toHaveLength(1);
    expect(screen.getAllByText(/Latest/i)).toHaveLength(1);
    expect(screen.queryByText(/matches$/i)).toBeNull();
  });

  it("keeps the unhealthy summary as one coherent block instead of a dashboard", () => {
    setViewportWidth(600);

    renderDialog({ healthState: unhealthyHealthState });

    const summary = screen.getByTestId("status-summary-card");
    const issue = screen.getByTestId("issue-card");

    expect(summary).toContainElement(issue);
    expect(summary).toContainElement(screen.getByTestId("summary-activity-line"));
    expect(summary).toContainElement(screen.getByTestId("summary-contributors"));
    expect(screen.queryByText(/Technical details/i)).toBeNull();
  });

  it("makes nested overlay depth explicit", async () => {
    setViewportWidth(600);

    renderDialog();

    fireEvent.click(screen.getByTestId("show-details-button"));
    fireEvent.click(screen.getByTestId("health-history-row"));

    expect(screen.getByTestId("health-history-popup")).toBeVisible();
    expect(screen.getByTestId("analytic-popup-return")).toHaveTextContent("← Diagnostics");
    expect(screen.getByRole("heading", { name: "Health history" })).toBeVisible();
    expect(screen.getByTestId("diagnostics-sheet")).toBeVisible();

    await waitFor(() => {
      expect(screen.getByTestId("health-history-popup").className).toContain("shadow-");
    });
  });

  it("updates focused scope labels for detail shortcuts", () => {
    setViewportWidth(600);

    renderDialog();

    fireEvent.click(screen.getByTestId("show-details-button"));
    fireEvent.click(screen.getByTestId("open-device-detail"));
    expect(screen.getByTestId("diagnostics-scope-label")).toHaveTextContent("Showing: Device detail");

    fireEvent.click(screen.getByTestId("device-detail-back"));
    fireEvent.click(screen.getByTestId("open-health-check-detail"));
    expect(screen.getByTestId("diagnostics-scope-label")).toHaveTextContent("Showing: Health check detail");
  });

  it("switches the analysis scope label for contributor focus and search results", () => {
    setViewportWidth(600);

    renderDialog({ healthState: unhealthyHealthState });

    fireEvent.click(screen.getByRole("button", { name: /REST/i }));
    expect(screen.getByTestId("diagnostics-scope-label")).toHaveTextContent("Showing: REST issues");

    fireEvent.click(screen.getByTestId("analyse-button"));
    expect(screen.getByTestId("diagnostics-analysis-scope-label")).toHaveTextContent("Showing: REST issues");

    fireEvent.change(screen.getByTestId("diagnostics-filter-input"), { target: { value: "audio" } });
    expect(screen.getByTestId("diagnostics-analysis-scope-label")).toHaveTextContent("Showing: Search results");
  });

  it("toggles contributor focus back to the full view when the same contributor is pressed twice", () => {
    setViewportWidth(600);

    renderDialog({ healthState: unhealthyHealthState });

    fireEvent.click(screen.getByRole("button", { name: /REST/i }));
    expect(screen.getByTestId("diagnostics-scope-label")).toHaveTextContent("Showing: REST issues");

    fireEvent.click(screen.getByRole("button", { name: /REST/i }));
    expect(screen.queryByTestId("diagnostics-scope-label")).toBeNull();
  });

  it("shows running health-check labels and hides completed-result shortcuts while a check is active", () => {
    setViewportWidth(600);

    renderDialog({
      healthCheckRunning: true,
      lastHealthCheckResult: null,
    });

    expect(screen.getByTestId("show-details-button")).toHaveTextContent("Running health check…");

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(screen.getByTestId("technical-run-health-check-button")).toHaveTextContent("Running health check…");
    expect(screen.getByTestId("technical-run-health-check-button")).toBeDisabled();
    expect(screen.queryByTestId("open-health-check-detail")).toBeNull();
  });

  it("omits health-check controls when no runner or prior result is available", () => {
    setViewportWidth(600);

    renderDialog({
      onRunHealthCheck: undefined,
      lastHealthCheckResult: null,
    });

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(screen.queryByTestId("technical-run-health-check-button")).toBeNull();
    expect(screen.queryByTestId("open-health-check-detail")).toBeNull();
  });

  it("closes nested overlay first, then requests closing diagnostics", async () => {
    setViewportWidth(600);
    const onOpenChange = vi.fn();

    renderDialog({ onOpenChange });

    fireEvent.click(screen.getByTestId("show-details-button"));
    fireEvent.click(screen.getByTestId("health-history-row"));

    expect(screen.getByTestId("health-history-popup")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("health-history-popup")).toBeNull();
    });
    expect(screen.getByTestId("diagnostics-sheet")).toBeVisible();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
