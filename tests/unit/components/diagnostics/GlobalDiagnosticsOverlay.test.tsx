import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalDiagnosticsOverlay } from "@/components/diagnostics/GlobalDiagnosticsOverlay";
import { InterstitialStateProvider } from "@/components/ui/interstitial-state";
import { reportUserError } from "@/lib/uiErrors";
import { shareAllDiagnosticsZip } from "@/lib/diagnostics/diagnosticsExport";
import { DIAGNOSTICS_TEST_OVERLAY_STATE_EVENT } from "@/lib/diagnostics/diagnosticsTestBridge";
import {
  getHealthCheckStateSnapshot,
  resetHealthCheckStateSnapshot,
  setHealthCheckStateSnapshot,
} from "@/lib/diagnostics/healthCheckState";

// The overlay renders the real DiagnosticsDialog, whose connection editor reads
// the keypad/T9 flag; default it off so this test needs no FeatureFlagsProvider.
vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlagValue: () => false,
  useFeatureFlags: () => ({ flags: { keypad_input_enabled: false } }),
}));

const { buildActionSummariesMock } = vi.hoisted(() => ({
  buildActionSummariesMock: vi.fn(() => [
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

const { consumeDiagnosticsOpenRequestMock, clearDiagnosticsOpenRequestMock } = vi.hoisted(() => ({
  consumeDiagnosticsOpenRequestMock: vi.fn(),
  clearDiagnosticsOpenRequestMock: vi.fn(),
}));

const appListenerState = vi.hoisted(() => ({
  backButtonListener: null as null | (() => void),
  addListener: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appListenerState.addListener,
  },
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
  recordActionEnd: vi.fn(),
  recordActionStart: vi.fn(),
}));

vi.mock("@/lib/tracing/traceFormatter", () => ({
  getTraceTitle: vi.fn(() => "REST GET /v1/info"),
}));

vi.mock("@/lib/diagnostics/actionSummaries", () => ({
  buildActionSummaries: buildActionSummariesMock,
}));

vi.mock("@/lib/diagnostics/diagnosticsExport", () => ({
  shareAllDiagnosticsZip: vi.fn(),
  shareDiagnosticsZip: vi.fn(),
}));

vi.mock("@/lib/hvsc/hvscPerformance", () => ({
  collectHvscPerfTimings: vi.fn(() => [{ id: "hvsc-perf-000001", scope: "browse:query" }]),
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
  clearDiagnosticsOpenRequest: clearDiagnosticsOpenRequestMock,
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
  resolveActionSeverity: vi.fn(() => "info"),
}));

vi.mock("@/components/diagnostics/DiagnosticsListItem", () => ({
  DiagnosticsListItem: ({ children, testId }: { children: React.ReactNode; testId: string }) => (
    <div data-testid={testId}>{children}</div>
  ),
}));

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="route-path">{location.pathname}</div>;
};

const renderOverlay = (initialPath = "/", extra?: React.ReactNode) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <InterstitialStateProvider>
          <LocationProbe />
          {extra}
          <Routes>
            <Route path="*" element={<GlobalDiagnosticsOverlay />} />
          </Routes>
        </InterstitialStateProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const expandDiagnosticsHeader = () => {
  fireEvent.click(screen.getByTestId("diagnostics-header-toggle"));
};

describe("GlobalDiagnosticsOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildActionSummariesMock.mockClear();
    appListenerState.backButtonListener = null;
    appListenerState.addListener.mockReset();
    appListenerState.remove.mockReset();
    appListenerState.addListener.mockImplementation(async (eventName: string, listener: () => void) => {
      if (eventName === "backButton") {
        appListenerState.backButtonListener = listener;
      }
      return { remove: appListenerState.remove };
    });
    resetHealthCheckStateSnapshot();
    consumeDiagnosticsOpenRequestMock.mockReturnValue({ preset: "header", panel: null });
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
        supplemental: expect.objectContaining({
          deviceSafetyResolution: expect.objectContaining({
            storedMode: expect.any(String),
            effectiveMode: expect.any(String),
          }),
          hvscPerfTimings: expect.arrayContaining([
            expect.objectContaining({ id: "hvsc-perf-000001", scope: "browse:query" }),
          ]),
        }),
      }),
    );
  }, 10_000);

  it("Android Back closes Diagnostics without changing the route", async () => {
    renderOverlay("/settings");

    await screen.findByRole("dialog");
    await waitFor(() => expect(appListenerState.backButtonListener).not.toBeNull());

    act(() => {
      appListenerState.backButtonListener?.();
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("route-path")).toHaveTextContent("/settings");
  });

  it("restores the active page-shell's scroll position on close, not the (always-0) window scroll (HARD9-027)", async () => {
    // Regression: the app never scrolls the window - pages scroll inside
    // the active page's .page-shell. Saving/restoring window.scrollY was a
    // no-op; a scroll reset while the sheet was open (page remount, scroll
    // lock, the route-driven close navigation) had nothing to restore it.
    consumeDiagnosticsOpenRequestMock.mockReturnValue(null);
    const scrollProbe = (
      <div data-slot-active="true">
        <div data-page-scroll-container="true" data-testid="page-scroll-container" />
      </div>
    );
    renderOverlay("/settings", scrollProbe);

    const container = screen.getByTestId("page-scroll-container");
    container.scrollTop = 400;

    // Open the overlay now (after the scroll position is set), so the
    // fix's on-open capture actually observes 400.
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("c64u-diagnostics-open-request", {
          detail: { preset: "header" },
        }),
      );
    });
    await screen.findByRole("dialog");
    await waitFor(() => expect(appListenerState.backButtonListener).not.toBeNull());

    // Something (page remount, scroll lock teardown) resets the container's
    // scroll while the sheet is still open - this is the actual failure
    // mode the fix restores from, not merely "closing preserves untouched
    // scroll".
    container.scrollTop = 0;

    act(() => {
      appListenerState.backButtonListener?.();
    });

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => expect(container.scrollTop).toBe(400));
  });

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

  it("clears the pinned health-check result along with the rest of diagnostics (HARD19-020)", async () => {
    // The pinned latestResult drives the global badge; "Clear all" must reset it
    // too, otherwise the badge keeps asserting a verdict whose supporting evidence
    // (logs, traces, health history) the user just deleted.
    setHealthCheckStateSnapshot({
      latestResult: {
        runId: "hc-cleared",
        startTimestamp: "2024-01-01T00:00:00.000Z",
        endTimestamp: "2024-01-01T00:00:01.000Z",
        totalDurationMs: 1000,
        overallHealth: "Unhealthy",
        connectivity: "Online",
        probes: {
          REST: { probe: "REST", outcome: "Fail", durationMs: 100, reason: "down", startMs: 0 },
          FTP: { probe: "FTP", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
          TELNET: { probe: "TELNET", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
          CONFIG: { probe: "CONFIG", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
          RASTER: { probe: "RASTER", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
          JIFFY: { probe: "JIFFY", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
        },
        latency: { p50: 10, p90: 20, p99: 30 },
        deviceInfo: null,
      },
    });

    renderOverlay();

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("diagnostics-overflow-menu"));
    fireEvent.click(within(dialog).getByTestId("diagnostics-clear-all-trigger"));
    fireEvent.click(await screen.findByTestId("diagnostics-clear-all-confirm"));

    expect(getHealthCheckStateSnapshot().latestResult).toBeNull();
  });

  it("opens the requested diagnostics panel from a deep-link route", async () => {
    consumeDiagnosticsOpenRequestMock.mockReturnValue(null);

    renderOverlay("/diagnostics/history");

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId("health-history-popup")).toBeVisible();
  });

  it.each([
    ["/diagnostics", null],
    ["/diagnostics/", null],
    ["/diagnostics/latency", "latency-analysis-popup"],
    ["/diagnostics/config-drift", "config-drift-surface"],
    ["/diagnostics/heatmap/rest", "heat-map-popup-rest"],
    ["/diagnostics/heatmap/ftp", "heat-map-popup-ftp"],
    ["/diagnostics/heatmap/config", "heat-map-popup-config"],
  ])("opens diagnostics deep link %s", async (path, surfaceTestId) => {
    consumeDiagnosticsOpenRequestMock.mockReturnValue(null);

    renderOverlay(path);

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    if (surfaceTestId) {
      expect(screen.getByTestId(surfaceTestId)).toBeVisible();
    }
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
    expect(clearDiagnosticsOpenRequestMock).toHaveBeenCalledTimes(1);
  });

  it("does not build action summaries while the overlay stays closed", () => {
    consumeDiagnosticsOpenRequestMock.mockReturnValue(null);

    renderOverlay();

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(buildActionSummariesMock).not.toHaveBeenCalled();
  });

  it("defers action summary building until the diagnostics sheet is first visible", async () => {
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    const cancelAnimationFrameSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    renderOverlay();

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(buildActionSummariesMock).not.toHaveBeenCalled();

    await act(async () => {
      frameCallbacks.shift()?.(0);
    });

    await waitFor(() => {
      expect(buildActionSummariesMock).toHaveBeenCalledTimes(1);
    });

    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
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
        TELNET: { probe: "TELNET", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
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
    expect(screen.getByTestId("diagnostics-header-expanded")).toHaveTextContent(
      /Latency:\s*p50 10ms\s*·\s*p90 20ms\s*·\s*p99 30ms/i,
    );

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
      expect(screen.getByTestId("run-health-check")).toHaveTextContent("Restart health check");
    });
    expect(screen.getByTestId("run-health-check")).toBeEnabled();
  });

  it("ignores runtime diagnostics open requests without a preset", async () => {
    consumeDiagnosticsOpenRequestMock.mockReturnValue(null);

    renderOverlay();

    await act(async () => {
      window.dispatchEvent(new CustomEvent("c64u-diagnostics-open-request", { detail: {} }));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not refresh logs/traces while closed, but seeds and refreshes once opened (HARD9-021)", async () => {
    const { getLogs, getErrorLogs } = await import("@/lib/logging");
    const { getTraceEvents } = await import("@/lib/tracing/traceSession");
    consumeDiagnosticsOpenRequestMock.mockReturnValue(null);

    renderOverlay();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const logsCallsWhileClosed = vi.mocked(getLogs).mock.calls.length;
    const errorLogsCallsWhileClosed = vi.mocked(getErrorLogs).mock.calls.length;
    const tracesCallsWhileClosed = vi.mocked(getTraceEvents).mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new CustomEvent("c64u-logs-updated"));
      window.dispatchEvent(new CustomEvent("c64u-traces-updated"));
    });

    // No listener is registered while closed, so these events must not have
    // triggered any additional store reads.
    expect(vi.mocked(getLogs).mock.calls.length).toBe(logsCallsWhileClosed);
    expect(vi.mocked(getErrorLogs).mock.calls.length).toBe(errorLogsCallsWhileClosed);
    expect(vi.mocked(getTraceEvents).mock.calls.length).toBe(tracesCallsWhileClosed);

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("c64u-diagnostics-open-request", {
          detail: { preset: "header", panel: null },
        }),
      );
    });
    await screen.findByRole("dialog");

    // Opening must seed a fresh snapshot.
    expect(vi.mocked(getLogs).mock.calls.length).toBeGreaterThan(logsCallsWhileClosed);
    expect(vi.mocked(getErrorLogs).mock.calls.length).toBeGreaterThan(errorLogsCallsWhileClosed);
    expect(vi.mocked(getTraceEvents).mock.calls.length).toBeGreaterThan(tracesCallsWhileClosed);

    const logsCallsAfterOpen = vi.mocked(getLogs).mock.calls.length;
    const tracesCallsAfterOpen = vi.mocked(getTraceEvents).mock.calls.length;

    await act(async () => {
      window.dispatchEvent(new CustomEvent("c64u-logs-updated"));
      window.dispatchEvent(new CustomEvent("c64u-traces-updated"));
    });

    // Once open, the listeners are live and refresh on every event.
    expect(vi.mocked(getLogs).mock.calls.length).toBeGreaterThan(logsCallsAfterOpen);
    expect(vi.mocked(getTraceEvents).mock.calls.length).toBeGreaterThan(tracesCallsAfterOpen);
  });
});
