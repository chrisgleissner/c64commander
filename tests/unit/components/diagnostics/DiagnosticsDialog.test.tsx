/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import type { OverallHealthState } from "@/lib/diagnostics/healthModel";
import { buildBaseUrlFromDeviceHost, updateC64APIConfig } from "@/lib/c64api";
import { setStoredFtpPort } from "@/lib/ftp/ftpConfig";

type DiagnosticsDialogProps = ComponentProps<typeof DiagnosticsDialog>;

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

const renderDialog = (props?: Partial<DiagnosticsDialogProps>) =>
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

const defaultProps: DiagnosticsDialogProps = {
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
    updateC64APIConfig(buildBaseUrlFromDeviceHost("c64u:80"), undefined, "c64u:80");
    setStoredFtpPort(21);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows evidence immediately with a collapsed filter bar and corrected wording", () => {
    setViewportWidth(600);

    renderDialog();

    expect(screen.getByTestId("diagnostics-header")).toBeVisible();
    expect(screen.getByTestId("evidence-panel")).toBeVisible();
    expect(screen.getByTestId("evidence-heading")).toHaveTextContent("Activity");
    expect(screen.getByTestId("activity-kinds-line")).toHaveTextContent("Problems, actions, logs, and traces");
    expect(screen.getByTestId("filters-collapsed-bar")).toBeVisible();
    expect(screen.queryByText(/in view/i)).toBeNull();
    expect(screen.queryByTestId("filters-editor-surface")).toBeNull();
  });

  it("opens connection view on tap and connection edit on long press", async () => {
    setViewportWidth(600);
    vi.useFakeTimers();

    renderDialog();

    fireEvent.pointerDown(screen.getByTestId("diagnostics-device-line"));
    fireEvent.pointerUp(screen.getByTestId("diagnostics-device-line"));

    expect(screen.getByTestId("connection-view-surface")).toBeVisible();
    expect(screen.getByText("c64u")).toBeVisible();

    fireEvent.click(screen.getByTestId("connection-view-edit"));
    expect(screen.getByTestId("connection-edit-surface")).toBeVisible();

    fireEvent.click(within(screen.getByTestId("connection-edit-surface")).getByRole("button", { name: "Close" }));

    fireEvent.pointerDown(screen.getByTestId("diagnostics-device-line"));
    await vi.advanceTimersByTimeAsync(500);

    expect(screen.getByTestId("connection-edit-surface")).toBeVisible();

    vi.useRealTimers();
  });

  it("persists connection edits and retries the connection", async () => {
    setViewportWidth(600);
    const onRetryConnection = vi.fn();

    renderDialog({ onRetryConnection });

    fireEvent.contextMenu(screen.getByTestId("diagnostics-device-line"));

    fireEvent.change(screen.getByTestId("connection-edit-host"), { target: { value: "ultimate.local" } });
    fireEvent.change(screen.getByTestId("connection-edit-http"), { target: { value: "8081" } });
    fireEvent.change(screen.getByTestId("connection-edit-ftp"), { target: { value: "2121" } });
    fireEvent.click(screen.getByTestId("connection-edit-save"));

    await waitFor(() => {
      expect(onRetryConnection).toHaveBeenCalledTimes(1);
    });

    expect(localStorage.getItem("c64u_device_host")).toBe("ultimate.local:8081");
    expect(localStorage.getItem("c64u_ftp_port")).toBe("2121");
  });

  it("keeps filter configuration separate from filter visibility", () => {
    setViewportWidth(600);

    renderDialog();

    fireEvent.click(screen.getByTestId("open-filters-editor"));

    expect(screen.getByTestId("filters-editor-surface")).toBeVisible();
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "Logs" }));
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "✓ Problems" }));

    expect(screen.getByTestId("filters-collapsed-bar")).toHaveTextContent("Actions");
  });

  it("opens latency and history screens without descriptive copy and closes them when the sheet closes", async () => {
    setViewportWidth(600);
    const { rerender } = renderDialog({ healthState: unhealthyHealthState });

    fireEvent.click(screen.getByTestId("open-latency-screen"));
    expect(screen.getByTestId("latency-analysis-popup")).toBeVisible();
    expect(screen.queryByText(/Purpose:/i)).toBeNull();

    fireEvent.click(screen.getByTestId("analytic-popup-close"));
    fireEvent.click(screen.getByTestId("open-timeline-screen"));
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

  it("shares only the filtered evidence set", () => {
    setViewportWidth(600);
    const onShareFiltered = vi.fn();

    renderDialog({ onShareFiltered });

    fireEvent.click(screen.getByTestId("open-filters-editor"));
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "Logs" }));
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "✓ Problems" }));
    fireEvent.click(within(screen.getByTestId("filters-editor-surface")).getByRole("button", { name: "✓ Actions" }));

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(screen.getByTestId("diagnostics-share-filtered"));

    expect(onShareFiltered).toHaveBeenCalledTimes(1);
    expect(onShareFiltered.mock.calls[0][0]).toHaveLength(1);
    expect(onShareFiltered.mock.calls[0][0][0]).toMatchObject({ message: "Configuration updated successfully" });
  });

  it("expands and collapses activity rows when extra detail exists", () => {
    setViewportWidth(600);

    renderDialog();

    const row = screen.getByTestId("evidence-row-action-action-1");
    expect(row).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(row);

    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("evidence-detail-action-action-1")).toHaveTextContent('"effects"');

    fireEvent.click(row);

    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("evidence-detail-action-action-1")).toBeNull();
  });

  it("hides activity expand affordance when no additional detail exists", () => {
    setViewportWidth(600);

    renderDialog({
      defaultEvidenceTypes: new Set(["Logs"]),
      logs: [
        {
          id: "log-plain",
          level: "info" as const,
          message: "Background refresh complete",
          timestamp: new Date(Date.now() - 2_000).toISOString(),
        },
      ],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [],
    });

    const row = screen.getByTestId("evidence-row-log-log-plain");
    expect(row.tagName).toBe("DIV");
    expect(row.querySelector("svg")).toBeNull();
    expect(row).not.toHaveAttribute("aria-expanded");
  });

  it("auto-expands the health detail view when a health check starts", () => {
    setViewportWidth(600);
    const onRunHealthCheck = vi.fn();

    renderDialog({
      onRunHealthCheck,
      lastHealthCheckResult: null,
      liveHealthCheckProbes: {},
      healthCheckRunning: true,
    });

    expect(screen.getByTestId("diagnostics-header-expanded")).toBeVisible();
    expect(screen.getByTestId("health-check-detail-view")).toBeVisible();
    expect(screen.getByTestId("health-check-probe-raster")).toHaveTextContent("Pending");
    expect(screen.getByTestId("health-check-probe-jiffy")).toHaveTextContent("Pending");

    fireEvent.click(screen.getByTestId("run-health-check"));
    expect(onRunHealthCheck).not.toHaveBeenCalled();
  });

  it("opens the latest health detail when the run button is pressed", () => {
    setViewportWidth(600);
    const onRunHealthCheck = vi.fn();

    renderDialog({ onRunHealthCheck });

    expect(screen.queryByTestId("diagnostics-header-expanded")).toBeNull();

    fireEvent.click(screen.getByTestId("run-health-check"));

    expect(onRunHealthCheck).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("diagnostics-header-expanded")).toBeVisible();
    expect(screen.getByTestId("health-check-probe-raster")).toHaveTextContent("Success");
    expect(screen.getByTestId("health-check-probe-jiffy")).toHaveTextContent("Success");
  });
});
