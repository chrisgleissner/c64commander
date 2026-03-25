import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalDiagnosticsOverlay } from "@/components/diagnostics/GlobalDiagnosticsOverlay";

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
  addErrorLog: vi.fn(),
  clearLogs: vi.fn(),
  getErrorLogs: vi.fn(() => []),
  getLogs: vi.fn(() => []),
}));

vi.mock("@/lib/tracing/traceSession", () => ({
  clearTraceEvents: vi.fn(),
  getTraceEvents: vi.fn(() => []),
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
  runDiagnosticsReconciler: vi.fn(async () => ({ driftDetected: false, actionsTaken: [], detail: null })),
  runPlaybackReconciler: vi.fn(async () => ({ driftDetected: false, actionsTaken: [], detail: null })),
  runRepair: vi.fn(async () => undefined),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  consumeDiagnosticsOpenRequest: () => consumeDiagnosticsOpenRequestMock(),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  setDiagnosticsOverlayActive: vi.fn(),
  withDiagnosticsTraceOverride: (fn: () => unknown) => fn(),
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
  DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT: "diagnostics-test-overlay-state",
}));

vi.mock("@/components/diagnostics/DiagnosticsDialog", () => ({
  DiagnosticsDialog: ({
    open,
    onOpenChange,
    requestedPanel,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    requestedPanel?: string | null;
  }) =>
    open ? (
      <div role="dialog">
        <div data-testid="requested-panel">{requestedPanel}</div>
        <button type="button" onClick={() => onOpenChange(false)}>
          Close overlay
        </button>
      </div>
    ) : null,
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
  });

  it("closes a deep-linked diagnostics route back to settings", async () => {
    renderOverlay("/diagnostics/history");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("requested-panel")).toHaveTextContent("history");
    expect(screen.getByTestId("location-path")).toHaveTextContent("/diagnostics/history");

    fireEvent.click(screen.getByRole("button", { name: "Close overlay" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("location-path")).toHaveTextContent("/settings");
  });
});
