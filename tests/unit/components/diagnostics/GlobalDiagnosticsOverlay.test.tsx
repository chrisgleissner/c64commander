import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalDiagnosticsOverlay } from "@/components/diagnostics/GlobalDiagnosticsOverlay";
import { reportUserError } from "@/lib/uiErrors";
import { shareAllDiagnosticsZip } from "@/lib/diagnostics/diagnosticsExport";

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

vi.mock("@/lib/logging", () => ({
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
}));

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
  subscribeDiagnosticsSuppression: () => () => {},
  isDiagnosticsOverlaySuppressionArmed: () => false,
}));

vi.mock("@/lib/diagnostics/diagnosticsSeverity", () => ({
  resolveLogSeverity: vi.fn(() => "error"),
  resolveTraceSeverity: vi.fn(() => "info"),
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

describe("GlobalDiagnosticsOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeDiagnosticsOpenRequestMock.mockReturnValue("actions");
  });

  it("opens from a pending diagnostics request and shares all diagnostics", async () => {
    vi.mocked(shareAllDiagnosticsZip).mockResolvedValue(undefined);

    renderOverlay();

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: /^share all$/i })).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: /^share all$/i }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: /^share all$/i }));

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
});
