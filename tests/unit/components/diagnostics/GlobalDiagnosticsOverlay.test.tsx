import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalDiagnosticsOverlay } from "@/components/diagnostics/GlobalDiagnosticsOverlay";
import { reportUserError } from "@/lib/uiErrors";
import { shareAllDiagnosticsZip } from "@/lib/diagnostics/diagnosticsExport";
import { DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT } from "@/lib/diagnostics/diagnosticsTestBridge";

const consumeDiagnosticsOpenRequestMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () =>
    Object.assign(<T extends (...args: any[]) => any>(fn: T) => fn, {
      scope: async () => undefined,
    }),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/lib/logging", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logging")>("@/lib/logging");
  return {
    ...actual,
    addLog: vi.fn(),
    clearLogs: vi.fn(),
    getErrorLogs: vi.fn(() => [
      {
        id: "err-1",
        level: "error",
        message: "Broken export",
        timestamp: "2024-01-01T00:00:00.000Z",
        details: { code: "E1" },
      },
    ]),
    getLogs: vi.fn(() => [
      {
        id: "log-1",
        level: "info",
        message: "Ready",
        timestamp: "2024-01-01T00:00:01.000Z",
      },
    ]),
  };
});

vi.mock("@/lib/tracing/traceSession", () => ({
  clearTraceEvents: vi.fn(),
  getTraceEvents: vi.fn(() => [
    {
      id: "trace-1",
      timestamp: "2024-01-01T00:00:02.000Z",
      relativeMs: 0,
      type: "rest-request",
      origin: "user",
      correlationId: "COR-1",
      data: { method: "GET", url: "/v1/info" },
    },
  ]),
}));

vi.mock("@/lib/tracing/traceFormatter", () => ({
  getTraceTitle: vi.fn(() => "REST GET /v1/info"),
}));

vi.mock("@/lib/diagnostics/actionSummaries", () => ({
  buildActionSummaries: vi.fn(() => [
    {
      correlationId: "COR-1",
      actionName: "Inspect",
      origin: "user",
      originalOrigin: "user",
      outcome: "success",
      startTimestamp: "2024-01-01T00:00:02.000Z",
      durationMs: 12,
    },
  ]),
}));

vi.mock("@/lib/diagnostics/diagnosticsExport", () => ({
  shareAllDiagnosticsZip: vi.fn(),
  shareDiagnosticsZip: vi.fn(),
}));

vi.mock("@/lib/diagnostics/diagnosticsActivity", () => ({
  resetDiagnosticsActivity: vi.fn(),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  consumeDiagnosticsOpenRequest: () => consumeDiagnosticsOpenRequestMock(),
}));

vi.mock("@/hooks/useHealthState", () => ({
  useHealthState: () => ({
    state: "Idle",
    connectivity: "Offline",
    connectedDeviceLabel: null,
    problemCount: 0,
    host: null,
    contributors: {
      App: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
      REST: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
      FTP: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
    },
    lastRestActivity: null,
    lastFtpActivity: null,
    primaryProblem: null,
  }),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  setDiagnosticsOverlayActive: vi.fn(),
  withDiagnosticsTraceOverride: (fn: () => unknown) => fn(),
  subscribeDiagnosticsSuppression: () => () => { },
  isDiagnosticsOverlaySuppressionArmed: () => false,
}));

vi.mock("@/lib/diagnostics/diagnosticsSeverity", () => ({
  resolveLogSeverity: vi.fn(() => "error"),
  resolveTraceSeverity: vi.fn(() => "info"),
  resolveActionSeverity: vi.fn(() => "info"),
}));

vi.mock("@/components/diagnostics/DiagnosticsListItem", () => ({
  DiagnosticsListItem: ({ children, testId }: { children: React.ReactNode; testId: string }) => (
    <div data-testid={testId}>{children}</div>
  ),
}));

vi.mock("@/components/diagnostics/ActionSummaryListItem", () => ({
  ActionSummaryListItem: ({ summary }: { summary: { correlationId: string; actionName: string } }) => (
    <div data-testid={`action-summary-${summary.correlationId}`}>{summary.actionName}</div>
  ),
}));

const renderOverlay = (initialPath = "/") =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="*" element={<GlobalDiagnosticsOverlay />} />
      </Routes>
    </MemoryRouter>,
  );

const expandDiagnosticsHeader = () => {
  fireEvent.click(screen.getByTestId("diagnostics-header-toggle"));
};

describe("GlobalDiagnosticsOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeDiagnosticsOpenRequestMock.mockReturnValue("actions");
    delete (
      window as Window & {
        __c64uDiagnosticsTestBridge?: { getOverlayStateSnapshot?: () => Record<string, unknown> };
      }
    ).__c64uDiagnosticsTestBridge;
  });

  it("opens from a pending diagnostics request and shares all diagnostics", async () => {
    vi.mocked(shareAllDiagnosticsZip).mockResolvedValue(undefined);

    renderOverlay();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("diagnostics-overflow-menu"));
    expect(within(dialog).getByTestId("diagnostics-share-all")).toBeInTheDocument();

    fireEvent.click(within(dialog).getByTestId("diagnostics-share-all"));

    expect(shareAllDiagnosticsZip).toHaveBeenCalledWith(
      expect.objectContaining({
        "error-logs": expect.any(Array),
        logs: expect.any(Array),
        traces: expect.any(Array),
        actions: expect.any(Array),
      }),
    );
  }, 10_000);

  it("reports share-all failures", async () => {
    vi.mocked(shareAllDiagnosticsZip).mockRejectedValue(new Error("zip failed"));

    renderOverlay();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(within(dialog).getByTestId("diagnostics-share-all"));

    await waitFor(() => {
      expect(reportUserError).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "DIAGNOSTICS_EXPORT",
          description: "zip failed",
        }),
      );
    });
  });

  it("renders nothing on the settings route", () => {
    renderOverlay("/settings");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens from a runtime diagnostics request event", async () => {
    consumeDiagnosticsOpenRequestMock.mockReturnValue(null);

    renderOverlay();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("c64u-diagnostics-open-request", {
          detail: { preset: "header" },
        }),
      );
    });

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("applies seeded health-check overlay state from the diagnostics bridge and runtime events", async () => {
    const seededResult = {
      runId: "hc-seeded",
      startTimestamp: "2024-01-01T00:00:00.000Z",
      endTimestamp: "2024-01-01T00:00:01.000Z",
      totalDurationMs: 1000,
      overallHealth: "Healthy",
      probes: {
        REST: { probe: "REST", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
        FTP: { probe: "FTP", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
        CONFIG: { probe: "CONFIG", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
        RASTER: { probe: "RASTER", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
        JIFFY: { probe: "JIFFY", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
      },
      latency: { p50: 10, p90: 20, p99: 30 },
      deviceInfo: null,
    };

    (
      window as Window & {
        __c64uDiagnosticsTestBridge?: { getOverlayStateSnapshot?: () => Record<string, unknown> };
      }
    ).__c64uDiagnosticsTestBridge = {
      getOverlayStateSnapshot: () => ({
        healthCheckRunning: false,
        lastHealthCheckResult: seededResult,
        liveHealthCheckProbes: null,
      }),
    };

    renderOverlay();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expandDiagnosticsHeader();
    expect(screen.getByTestId("diagnostics-header-expanded")).toHaveTextContent("P50 10ms");

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT, {
          detail: {
            healthCheckRunning: true,
            lastHealthCheckResult: null,
            liveHealthCheckProbes: null,
          },
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByTestId("run-health-check")).toHaveTextContent("Running health check");
    });
    expect(screen.getByTestId("run-health-check")).toBeDisabled();
  });

  it("ignores runtime diagnostics open requests without a preset", async () => {
    consumeDiagnosticsOpenRequestMock.mockReturnValue(null);

    renderOverlay();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("c64u-diagnostics-open-request", { detail: {} }));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
