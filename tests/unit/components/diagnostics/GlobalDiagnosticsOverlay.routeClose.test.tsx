import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalDiagnosticsOverlay } from "@/components/diagnostics/GlobalDiagnosticsOverlay";

const {
  consumeDiagnosticsOpenRequestMock,
  runDiagnosticsReconcilerMock,
  runPlaybackReconcilerMock,
  diagnosticsDialogState,
  recordActionEndMock,
  connectionSnapshotMock,
  withDiagnosticsTraceOverrideMock,
} = vi.hoisted(() => ({
  consumeDiagnosticsOpenRequestMock: vi.fn(),
  runDiagnosticsReconcilerMock: vi.fn(async () => ({ driftDetected: false, actionsTaken: [], detail: null })),
  runPlaybackReconcilerMock: vi.fn(async () => ({ driftDetected: false, actionsTaken: [], detail: null })),
  diagnosticsDialogState: {
    firstVisibleCallback: null as (() => void) | null,
  },
  recordActionEndMock: vi.fn(),
  connectionSnapshotMock: {
    state: "OFFLINE_NO_DEMO",
    lastDiscoveryTrigger: null,
    lastTransitionAtMs: 0,
    lastProbeAtMs: null,
    lastProbeSucceededAtMs: null,
    lastProbeFailedAtMs: null,
    lastProbeError: null,
    deviceInfo: null,
    demoInterstitialVisible: false,
  },
  withDiagnosticsTraceOverrideMock: vi.fn((fn: () => unknown) => fn()),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/hooks/useActionTrace", () => ({
  useActionTrace: () =>
    Object.assign(<T extends (...args: any[]) => any>(fn: T) => fn, {
      scope: async () => undefined,
    }),
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

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
  clearLogs: vi.fn(),
  getErrorLogs: vi.fn(() => []),
  getLogs: vi.fn(() => []),
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  clearTraceEvents: vi.fn(),
  getTraceEvents: vi.fn(() => []),
  recordActionEnd: recordActionEndMock,
  recordActionStart: vi.fn(),
  recordRestResponse: vi.fn(),
}));

vi.mock("@/lib/diagnostics/actionSummaries", () => ({
  buildActionSummaries: vi.fn(() => []),
}));

vi.mock("@/lib/diagnostics/diagnosticsExport", () => ({
  shareAllDiagnosticsZip: vi.fn(),
  shareDiagnosticsZip: vi.fn(),
}));

vi.mock("@/lib/diagnostics/diagnosticsActivity", () => ({
  resetDiagnosticsActivity: vi.fn(),
}));

vi.mock("@/lib/diagnostics/diagnosticsReconciler", () => ({
  runDiagnosticsReconciler: runDiagnosticsReconcilerMock,
  runPlaybackReconciler: runPlaybackReconcilerMock,
  runRepair: vi.fn(async () => undefined),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  consumeDiagnosticsOpenRequest: () => consumeDiagnosticsOpenRequestMock(),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  setDiagnosticsOverlayActive: vi.fn(),
  withDiagnosticsTraceOverride: withDiagnosticsTraceOverrideMock,
}));

vi.mock("@/lib/diagnostics/healthCheckState", () => ({
  resetHealthCheckStateSnapshot: vi.fn(),
  setHealthCheckStateSnapshot: vi.fn(),
  useHealthCheckState: () => ({
    latestResult: null,
    liveProbes: null,
    running: false,
  }),
}));

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

vi.mock("@/lib/connection/connectionManager", () => ({
  discoverConnection: vi.fn(),
  getConnectionSnapshot: vi.fn(() => connectionSnapshotMock),
  subscribeConnection: vi.fn(() => () => undefined),
}));

vi.mock("@/lib/connection/hostEdit", () => ({
  getConfiguredHost: vi.fn(() => "c64u"),
  saveConfiguredHostAndRetry: vi.fn(),
}));

vi.mock("@/lib/diagnostics/healthCheckEngine", () => ({
  isHealthCheckRunning: vi.fn(() => false),
  runHealthCheck: vi.fn(),
}));

vi.mock("@/lib/diagnostics/latencyTracker", () => ({
  clearLatencySamples: vi.fn(),
  getAllLatencySamples: vi.fn(() => []),
}));

vi.mock("@/lib/diagnostics/healthHistory", () => ({
  clearHealthHistory: vi.fn(),
  getHealthHistory: vi.fn(() => []),
}));

vi.mock("@/lib/diagnostics/recentTargets", () => ({
  recordRecentTarget: vi.fn(),
}));

vi.mock("@/lib/c64api", () => ({
  buildBaseUrlFromDeviceHost: vi.fn((host: string) => `http://${host}`),
  normalizeDeviceHost: vi.fn((host: string) => host),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
  createActionContext: vi.fn(() => ({ correlationId: "COR-1", origin: "user", name: "x" })),
  runWithActionTrace: vi.fn(async (_action: unknown, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@/lib/diagnostics/recoveryEvidence", () => ({
  clearRecoveryEvidence: vi.fn(),
  getRecoveryEvidence: vi.fn(() => []),
  recordRecoveryEvidence: vi.fn(),
}));

vi.mock("@/lib/diagnostics/diagnosticsTestBridge", () => ({
  DIAGNOSTICS_TEST_ANALYTICS_EVENT: "diagnostics-test-analytics",
  DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT: "diagnostics-test-overlay-state",
}));

vi.mock("@/components/diagnostics/DiagnosticsDialog", () => ({
  DiagnosticsDialog: ({
    open,
    onOpenChange,
    onFirstVisible,
    requestedPanel,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onFirstVisible?: () => void;
    requestedPanel?: string | null;
  }) => {
    diagnosticsDialogState.firstVisibleCallback = onFirstVisible ?? null;
    return open ? (
      <div role="dialog">
        <div data-testid="requested-panel">{requestedPanel}</div>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close overlay
        </button>
      </div>
    ) : null;
  },
}));

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location-path">{location.pathname}</div>;
};

const renderOverlay = (initialPath: string) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <LocationProbe />
                <GlobalDiagnosticsOverlay />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("GlobalDiagnosticsOverlay route close", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consumeDiagnosticsOpenRequestMock.mockReturnValue(null);
    diagnosticsDialogState.firstVisibleCallback = null;
    withDiagnosticsTraceOverrideMock.mockClear();
  });

  it("defers diagnostics reconciliation until the dialog reports first visible paint", async () => {
    consumeDiagnosticsOpenRequestMock.mockReturnValue({ preset: "header", panel: null });

    renderOverlay("/");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(runDiagnosticsReconcilerMock).not.toHaveBeenCalled();
    expect(runPlaybackReconcilerMock).not.toHaveBeenCalled();

    diagnosticsDialogState.firstVisibleCallback?.();

    await waitFor(() => {
      expect(runDiagnosticsReconcilerMock).toHaveBeenCalledWith("Diagnostics overlay opened");
      expect(runPlaybackReconcilerMock).toHaveBeenCalledWith("Diagnostics overlay opened");
    });
    expect(withDiagnosticsTraceOverrideMock).toHaveBeenCalled();
  });

  it("ends the pending diagnostics action when the overlay closes before first visible paint", async () => {
    consumeDiagnosticsOpenRequestMock.mockReturnValue({ preset: "header", panel: null });

    renderOverlay("/");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close overlay" }));

    await waitFor(() => {
      expect(recordActionEndMock).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: "COR-1" }),
        expect.objectContaining({ message: "Diagnostics overlay closed before first visible paint" }),
      );
    });
    expect(withDiagnosticsTraceOverrideMock).toHaveBeenCalled();
  });

  it("ends the pending diagnostics action when the overlay unmounts before first visible paint", async () => {
    consumeDiagnosticsOpenRequestMock.mockReturnValue({ preset: "header", panel: null });

    const view = renderOverlay("/");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    view.unmount();

    expect(recordActionEndMock).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: "COR-1" }),
      expect.objectContaining({ message: "Diagnostics overlay unmounted before first visible paint" }),
    );
    expect(withDiagnosticsTraceOverrideMock).toHaveBeenCalled();
  });

  it.each([
    ["/diagnostics", "overview"],
    ["/diagnostics/", "overview"],
    ["/diagnostics/latency", "latency"],
    ["/diagnostics/history", "history"],
    ["/diagnostics/config-drift", "config-drift"],
    ["/diagnostics/decision-state", "decision-state"],
    ["/diagnostics/heatmap/rest", "rest-heatmap"],
    ["/diagnostics/heatmap/ftp", "ftp-heatmap"],
    ["/diagnostics/heatmap/config", "config-heatmap"],
  ])("closes %s back to settings", async (initialPath, expectedPanel) => {
    renderOverlay(initialPath);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("requested-panel")).toHaveTextContent(expectedPanel);
    expect(screen.getByTestId("location-path")).toHaveTextContent(initialPath);

    fireEvent.click(screen.getByRole("button", { name: "Close overlay" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("location-path")).toHaveTextContent("/settings");
  });
});
