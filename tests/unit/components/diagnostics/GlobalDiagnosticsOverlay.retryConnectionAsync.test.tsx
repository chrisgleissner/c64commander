import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalDiagnosticsOverlay } from "@/components/diagnostics/GlobalDiagnosticsOverlay";
import { InterstitialStateProvider } from "@/components/ui/interstitial-state";
import { C64API } from "@/lib/c64api";
import type { ConnectionActionsCallbacks } from "@/components/diagnostics/ConnectionActionsRegion";

// HARD18-027: handleRetryConnectionAsync (the real async retry callback with
// inline success/failure feedback, host:port resolution, and REST trace
// recording) is passed to DiagnosticsDialog via the `connectionCallbacks`
// prop, but DiagnosticsDialog currently never renders a component that
// reads that prop (ConnectionActionsRegion is not mounted anywhere in the
// real render tree - only in its own isolated component test). There is
// therefore no reachable button in the live app that invokes this callback
// today. To still exercise the real implementation (not a copy of its
// logic), mock DiagnosticsDialog to capture the connectionCallbacks prop
// and invoke onRetryConnection directly, rather than driving a UI element
// that does not exist.
const capturedConnectionCallbacks = vi.hoisted(() => ({
  current: null as ConnectionActionsCallbacks | null,
}));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlagValue: () => false,
  useFeatureFlags: () => ({ flags: { keypad_input_enabled: false } }),
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) },
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

vi.mock("@/lib/uiErrors", () => ({
  reportUserError: vi.fn(),
}));

const { addErrorLogMock } = vi.hoisted(() => ({ addErrorLogMock: vi.fn() }));
vi.mock("@/lib/logging", async () => {
  const actual = await vi.importActual<typeof import("@/lib/logging")>("@/lib/logging");
  return {
    ...actual,
    addErrorLog: addErrorLogMock,
  };
});

vi.mock("@/lib/diagnostics/actionSummaries", () => ({
  buildActionSummaries: vi.fn(() => []),
}));

vi.mock("@/lib/diagnostics/diagnosticsExport", () => ({
  shareAllDiagnosticsZip: vi.fn(),
  shareDiagnosticsZip: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscPerformance", () => ({
  collectHvscPerfTimings: vi.fn(() => []),
}));

vi.mock("@/lib/diagnostics/diagnosticsReconciler", () => ({
  runDiagnosticsReconciler: vi.fn(async () => ({ driftDetected: false, actionsTaken: [], detail: null })),
  runPlaybackReconciler: vi.fn(async () => ({ driftDetected: false, actionsTaken: [], detail: null })),
  runRepair: vi.fn(async () => undefined),
}));

vi.mock("@/lib/diagnostics/diagnosticsActivity", () => ({
  resetDiagnosticsActivity: vi.fn(),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  clearDiagnosticsOpenRequest: vi.fn(),
  consumeDiagnosticsOpenRequest: () => ({ preset: null, panel: null }),
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
  shouldSuppressDiagnosticsSideEffects: () => false,
}));

const { discoverConnectionMock } = vi.hoisted(() => ({ discoverConnectionMock: vi.fn() }));
vi.mock("@/lib/connection/connectionManager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/connection/connectionManager")>();
  return {
    ...actual,
    discoverConnection: discoverConnectionMock,
  };
});

const { getConfiguredHostMock } = vi.hoisted(() => ({
  getConfiguredHostMock: vi.fn(() => "office-u64"),
}));
vi.mock("@/lib/connection/hostEdit", () => ({
  getConfiguredHost: getConfiguredHostMock,
  saveConfiguredHostAndRetry: vi.fn(),
}));

const { runHealthCheckMock } = vi.hoisted(() => ({ runHealthCheckMock: vi.fn(async () => null) }));
vi.mock("@/lib/diagnostics/healthCheckEngine", () => ({
  runHealthCheck: runHealthCheckMock,
}));

vi.mock("@/components/diagnostics/DiagnosticsDialog", () => ({
  DiagnosticsDialog: (props: { connectionCallbacks?: ConnectionActionsCallbacks }) => {
    capturedConnectionCallbacks.current = props.connectionCallbacks ?? null;
    return null;
  },
}));

const renderOverlay = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <InterstitialStateProvider>
          <Routes>
            <Route path="*" element={<GlobalDiagnosticsOverlay />} />
          </Routes>
        </InterstitialStateProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("GlobalDiagnosticsOverlay handleRetryConnectionAsync (HARD18-027)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedConnectionCallbacks.current = null;
    getConfiguredHostMock.mockReturnValue("office-u64");
    runHealthCheckMock.mockResolvedValue(null);
  });

  it("resolves success, records success recovery evidence, and triggers rediscovery + health check", async () => {
    const getInfoSpy = vi.spyOn(C64API.prototype, "getInfo").mockResolvedValue({ model: "u64" } as never);

    renderOverlay();
    const callbacks = capturedConnectionCallbacks.current;
    expect(callbacks).not.toBeNull();

    const result = await callbacks!.onRetryConnection();

    expect(result).toEqual({ success: true, message: "Connected to office-u64" });
    expect(discoverConnectionMock).toHaveBeenCalledWith("manual");
    expect(runHealthCheckMock).toHaveBeenCalled();
    expect(addErrorLogMock).not.toHaveBeenCalled();

    getInfoSpy.mockRestore();
  });

  it("resolves failure and logs the REST contributor error when the probe fails", async () => {
    const getInfoSpy = vi.spyOn(C64API.prototype, "getInfo").mockRejectedValue(new Error("HTTP 503"));

    renderOverlay();
    const callbacks = capturedConnectionCallbacks.current;
    expect(callbacks).not.toBeNull();

    const result = await callbacks!.onRetryConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain("Connection failed to office-u64");
    expect(addErrorLogMock).toHaveBeenCalledWith(
      expect.stringContaining("Connection failed to office-u64"),
      expect.objectContaining({
        contributor: "REST",
        endpoint: "/v1/info",
        probe: "REST",
      }),
    );
    expect(discoverConnectionMock).not.toHaveBeenCalled();

    getInfoSpy.mockRestore();
  });
});
