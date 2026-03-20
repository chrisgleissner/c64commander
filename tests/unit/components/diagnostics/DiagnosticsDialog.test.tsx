import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import type { OverallHealthState } from "@/lib/diagnostics/healthModel";

vi.mock("@/components/ui/app-surface", () => ({
  AppSheet: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
  AppSheetContent: ({ children }: any) => <div>{children}</div>,
  AppSheetHeader: ({ children }: any) => <div>{children}</div>,
  AppSheetTitle: ({ children }: any) => <div>{children}</div>,
  AppSheetDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <div>{children}</div>,
  AlertDialogTrigger: ({ children, asChild }: any) => (asChild ? children : <div>{children}</div>),
  AlertDialogContent: ({ children }: any) => <div role="alertdialog">{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogAction: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: any) => (asChild ? children : <div>{children}</div>),
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onSelect, ...props }: any) => (
    <button
      onClick={(event) => {
        onSelect?.(event);
      }}
      {...props}
    >
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => <div />,
}));

vi.mock("@/components/ui/tooltip", () => ({
  TooltipProvider: ({ children }: any) => <>{children}</>,
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: any) => (asChild ? children : <div>{children}</div>),
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/diagnostics/DiagnosticsListItem", () => ({
  DiagnosticsListItem: ({ children, testId }: any) => <div data-testid={testId}>{children}</div>,
}));

vi.mock("@/components/diagnostics/ActionSummaryListItem", () => ({
  ActionSummaryListItem: ({ summary }: any) => (
    <div data-testid={`action-${summary.correlationId}`}>{summary.actionName}</div>
  ),
}));

vi.mock("@/lib/diagnostics/timeFormat", () => ({
  formatDiagnosticsTimestamp: (value: string) => value,
}));

vi.mock("@/lib/tracing/traceFormatter", () => ({
  getTraceTitle: (entry: any) => entry.title ?? entry.id,
}));

vi.mock("@/lib/diagnostics/diagnosticsSeverity", () => ({
  resolveLogSeverity: () => "info",
  resolveTraceSeverity: () => "info",
  resolveActionSeverity: () => "info",
}));

let currentDialogProfile: "compact" | "medium" | "expanded" = "medium";

vi.mock("@/hooks/useDisplayProfile", () => ({
  useDisplayProfile: () => ({ profile: currentDialogProfile }),
}));

const idleHealthState: OverallHealthState = {
  state: "Idle",
  connectivity: "Not yet connected",
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

const primaryProblemHealthState: OverallHealthState = {
  state: "Unhealthy",
  connectivity: "Online",
  host: "c64u",
  problemCount: 1,
  contributors: {
    App: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
    REST: { state: "Unhealthy", problemCount: 1, totalOperations: 2, failedOperations: 2 },
    FTP: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
  },
  lastRestActivity: null,
  lastFtpActivity: null,
  primaryProblem: {
    id: "problem-1",
    title: "GET /v1/info failed",
    contributor: "REST",
    timestampMs: Date.now() - 1000,
    impactLevel: 2,
    causeHint: "HTTP 503",
  },
};

describe("DiagnosticsDialog", () => {
  beforeEach(() => {
    currentDialogProfile = "medium";
  });

  const renderDialog = (overrides: Partial<React.ComponentProps<typeof DiagnosticsDialog>> = {}) => {
    const props: React.ComponentProps<typeof DiagnosticsDialog> = {
      open: true,
      onOpenChange: vi.fn(),
      healthState: idleHealthState,
      logs: [],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [],
      onShareFiltered: vi.fn(),
      onShareAll: vi.fn(),
      onClearAll: vi.fn(),
      onRetryConnection: vi.fn(),
      ...overrides,
    };
    return { props, ...render(<DiagnosticsDialog {...props} />) };
  };

  const openToolsView = () => {
    fireEvent.click(screen.getByTestId("show-details-button"));

    const technicalDetailsToggle = screen.getByTestId("technical-details-toggle");
    if (technicalDetailsToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(technicalDetailsToggle);
    }

    const toolsToggle = screen.getByTestId("tools-card-toggle");
    if (toolsToggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(toolsToggle);
    }
  };

  it("shows logs and filters them by search text", () => {
    const onShareFiltered = vi.fn();
    renderDialog({
      // activate Logs type from the start
      defaultEvidenceTypes: new Set(["Logs"]),
      logs: [
        { id: "log-1", level: "info", message: "Ready", timestamp: "2024-01-01T00:00:00.000Z" },
        { id: "log-2", level: "warn", message: "Ignored", timestamp: "2024-01-01T00:00:01.000Z" },
      ],
      onShareFiltered,
    });

    openToolsView();

    // Both entries visible initially
    expect(screen.getByTestId("log-log-1")).toBeInTheDocument();
    expect(screen.getByTestId("log-log-2")).toBeInTheDocument();

    // Type in filter — only matching entry remains
    fireEvent.change(screen.getByTestId("diagnostics-filter-input"), { target: { value: "ready" } });
    expect(screen.getByTestId("log-log-1")).toBeInTheDocument();
    expect(screen.queryByTestId("log-log-2")).not.toBeInTheDocument();

    // Clear filter
    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    expect(screen.getByTestId("log-log-1")).toBeInTheDocument();
    expect(screen.getByTestId("log-log-2")).toBeInTheDocument();
  });

  it("shows action summaries and filters by search text", () => {
    renderDialog({
      defaultEvidenceTypes: new Set(["Actions"]),
      actionSummaries: [
        {
          correlationId: "act-1",
          actionName: "Upload",
          origin: "user",
          originalOrigin: "user",
          outcome: "success",
          startTimestamp: "2024-01-01T00:00:00.000Z",
          durationMs: null,
        },
        {
          correlationId: "act-2",
          actionName: "Ignore",
          origin: "system",
          originalOrigin: "system",
          outcome: "success",
          startTimestamp: "2024-01-01T00:00:01.000Z",
          durationMs: 12,
        },
      ],
    });

    openToolsView();

    expect(screen.getByTestId("action-act-1")).toBeInTheDocument();
    expect(screen.getByTestId("action-act-2")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("diagnostics-filter-input"), { target: { value: "upload" } });
    expect(screen.getByTestId("action-act-1")).toBeInTheDocument();
    expect(screen.queryByTestId("action-act-2")).not.toBeInTheDocument();
  });

  it("surfaces REST failures as problem entries when Problems filter is active", () => {
    renderDialog({
      defaultEvidenceTypes: new Set(["Problems"]),
      traceEvents: [
        {
          id: "rest-fail-1",
          timestamp: "2024-01-01T00:00:05.000Z",
          type: "rest-response",
          data: { method: "GET", path: "/v1/machine", status: 500 },
        },
      ],
    });

    openToolsView();

    // REST failure should appear as a problem entry
    expect(screen.getByTestId("problem-rest-fail-1")).toBeInTheDocument();
  });

  it("surfaces FTP failures as problem entries when Problems filter is active", () => {
    renderDialog({
      defaultEvidenceTypes: new Set(["Problems"]),
      traceEvents: [
        {
          id: "ftp-fail-1",
          timestamp: "2024-01-01T00:00:05.000Z",
          type: "ftp-operation",
          data: { operation: "STOR", path: "/test.sid", result: "failure" },
        },
      ],
    });
    openToolsView();
    expect(screen.getByTestId("problem-ftp-fail-1")).toBeInTheDocument();
  });

  it("uses the technical health-check controls and shows the last-check shortcut when a result exists", () => {
    currentDialogProfile = "compact";

    renderDialog({
      onRunHealthCheck: vi.fn(),
      lastHealthCheckResult: {
        runId: "hc-1",
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
      },
    });

    openToolsView();
    expect(screen.getByTestId("technical-run-health-check-button")).toHaveTextContent("Run health check");
    expect(screen.getByTestId("open-health-check-detail")).toHaveTextContent("Last health check");
  });

  it("shows the running health-check label when a check is already in progress", () => {
    currentDialogProfile = "compact";

    renderDialog({
      onRunHealthCheck: vi.fn(),
      healthCheckRunning: true,
    });

    openToolsView();
    expect(screen.getByTestId("technical-run-health-check-button")).toHaveTextContent("Running health check…");
    expect(screen.getByTestId("technical-run-health-check-button")).toBeDisabled();
    expect(screen.queryByTestId("open-health-check-detail")).not.toBeInTheDocument();
  });

  it("does not duplicate failed traces as both problem and trace entries", () => {
    renderDialog({
      defaultEvidenceTypes: new Set(["Problems", "Traces"]),
      traceEvents: [
        {
          id: "rest-fail-2",
          timestamp: "2024-01-01T00:00:05.000Z",
          type: "rest-response",
          data: { method: "PUT", path: "/v1/config", status: 502 },
        },
      ],
    });

    openToolsView();
    // Should appear as a problem, not duplicated as a trace
    expect(screen.getByTestId("problem-rest-fail-2")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-rest-fail-2")).not.toBeInTheDocument();
  });

  it("shows contributor badge on problem entries", () => {
    renderDialog({
      defaultEvidenceTypes: new Set(["Problems"]),
      errorLogs: [{ id: "err-app-1", message: "App crash", timestamp: "2024-01-01T00:00:00.000Z" }],
      traceEvents: [
        {
          id: "rest-fail-3",
          timestamp: "2024-01-01T00:00:05.000Z",
          type: "rest-response",
          data: { method: "GET", path: "/v1/info", status: 503 },
        },
      ],
    });

    openToolsView();
    const appProblem = screen.getByTestId("problem-err-app-1");
    expect(appProblem.textContent).toContain("App");

    const restProblem = screen.getByTestId("problem-rest-fail-3");
    expect(restProblem.textContent).toContain("REST");
  });

  it("filters traces by indicator — excludes traces whose contributor does not match", () => {
    currentDialogProfile = "expanded";
    // We need to open the dialog with Traces active and set an indicatorFilter.
    // The indicator filter is controlled via the contributor rows in the health summary.
    // We test that with Traces active, a REST-type trace survives while an FTP-type trace is excluded
    // when the REST indicator row is clicked.
    renderDialog({
      defaultEvidenceTypes: new Set(["Traces"]),
      traceEvents: [
        {
          id: "trace-rest-1",
          timestamp: "2024-01-01T00:00:01.000Z",
          title: "REST request",
          type: "rest-request",
        },
        {
          id: "trace-ftp-1",
          timestamp: "2024-01-01T00:00:02.000Z",
          title: "FTP operation",
          type: "ftp-operation",
          data: { operation: "STOR", path: "/test.sid", result: "success" },
        },
        {
          id: "trace-unknown-1",
          timestamp: "2024-01-01T00:00:03.000Z",
          title: "Unknown trace",
          type: "action-start",
        },
      ],
    });

    openToolsView();
    // All three visible initially (no indicator filter)
    expect(screen.getByTestId("trace-trace-rest-1")).toBeInTheDocument();
    expect(screen.getByTestId("trace-trace-ftp-1")).toBeInTheDocument();
    expect(screen.getByTestId("trace-trace-unknown-1")).toBeInTheDocument();
    // Click the REST contributor row to set indicatorFilter = "REST"
    fireEvent.click(screen.getByTestId("contributor-row-rest"));

    // REST trace stays; FTP trace and unknown-contributor trace are filtered out
    expect(screen.getByTestId("trace-trace-rest-1")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-trace-ftp-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trace-trace-unknown-1")).not.toBeInTheDocument();
  });

  it("filters problem entries from trace events by origin when one origin filter is active", () => {
    renderDialog({
      defaultEvidenceTypes: new Set(["Problems"]),
      traceEvents: [
        {
          id: "rest-fail-user",
          timestamp: "2024-01-01T00:00:01.000Z",
          type: "rest-response",
          origin: "user",
          data: { method: "GET", path: "/v1/info", status: 500 },
        },
        {
          id: "rest-fail-system",
          timestamp: "2024-01-01T00:00:02.000Z",
          type: "rest-response",
          origin: "system",
          data: { method: "GET", path: "/v1/config", status: 500 },
        },
      ],
    });

    openToolsView();
    // Both problem entries visible initially
    expect(screen.getByTestId("problem-rest-fail-user")).toBeInTheDocument();
    expect(screen.getByTestId("problem-rest-fail-system")).toBeInTheDocument();

    // Open Refine (medium profile) and activate System origin filter only
    fireEvent.click(screen.getByTestId("refine-button"));
    fireEvent.click(screen.getByTestId("origin-toggle-system"));

    // Only system-origin problem remains
    expect(screen.queryByTestId("problem-rest-fail-user")).not.toBeInTheDocument();
    expect(screen.getByTestId("problem-rest-fail-system")).toBeInTheDocument();
  });

  it("filters action summaries by origin when one origin filter is active", () => {
    renderDialog({
      defaultEvidenceTypes: new Set(["Actions"]),
      actionSummaries: [
        {
          correlationId: "act-user",
          actionName: "UserAction",
          origin: "user",
          originalOrigin: "user",
          outcome: "success",
          startTimestamp: "2024-01-01T00:00:01.000Z",
          durationMs: null,
        },
        {
          correlationId: "act-system",
          actionName: "SystemAction",
          origin: "system",
          originalOrigin: "system",
          outcome: "success",
          startTimestamp: "2024-01-01T00:00:02.000Z",
          durationMs: null,
        },
      ],
    });

    openToolsView();
    // Both actions visible initially
    expect(screen.getByTestId("action-act-user")).toBeInTheDocument();
    expect(screen.getByTestId("action-act-system")).toBeInTheDocument();

    // Activate User origin filter only
    fireEvent.click(screen.getByTestId("refine-button"));
    fireEvent.click(screen.getByTestId("origin-toggle-user"));

    // Only user-origin action remains
    expect(screen.getByTestId("action-act-user")).toBeInTheDocument();
    expect(screen.queryByTestId("action-act-system")).not.toBeInTheDocument();
  });

  it("filters traces by origin when one origin filter is active", () => {
    renderDialog({
      defaultEvidenceTypes: new Set(["Traces"]),
      traceEvents: [
        {
          id: "trace-user-1",
          timestamp: "2024-01-01T00:00:01.000Z",
          title: "User trace",
          type: "rest-request",
          origin: "user",
        },
        {
          id: "trace-system-1",
          timestamp: "2024-01-01T00:00:02.000Z",
          title: "System trace",
          type: "rest-request",
          origin: "system",
        },
      ],
    });

    openToolsView();
    // Both visible initially
    expect(screen.getByTestId("trace-trace-user-1")).toBeInTheDocument();
    expect(screen.getByTestId("trace-trace-system-1")).toBeInTheDocument();

    // Open Refine panel and click User origin filter
    fireEvent.click(screen.getByTestId("refine-button"));
    fireEvent.click(screen.getByTestId("origin-toggle-user"));

    // Only user-origin trace remains
    expect(screen.getByTestId("trace-trace-user-1")).toBeInTheDocument();
    expect(screen.queryByTestId("trace-trace-system-1")).not.toBeInTheDocument();
  });

  it("reveals the issue card from the compact unhealthy summary after disclosure", () => {
    currentDialogProfile = "compact";
    renderDialog({
      healthState: primaryProblemHealthState,
      defaultEvidenceTypes: new Set(["Actions"]),
      errorLogs: [
        {
          id: "problem-1",
          message: "GET /v1/info failed",
          timestamp: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    });

    fireEvent.click(screen.getByTestId("show-details-button"));

    expect(screen.getByTestId("issue-card")).toBeInTheDocument();
  });

  it("keeps problem entries visible after disclosure when problems are already active", () => {
    currentDialogProfile = "medium";
    renderDialog({
      healthState: primaryProblemHealthState,
      defaultEvidenceTypes: new Set(["Problems"]),
      errorLogs: [
        {
          id: "problem-1",
          message: "GET /v1/info failed",
          timestamp: new Date(Date.now() - 1000).toISOString(),
        },
      ],
    });

    openToolsView();

    expect(screen.getByTestId("problem-problem-1")).toBeInTheDocument();
  });

  it("invokes share-all, share-filtered, and clear-all actions", async () => {
    const onShareAll = vi.fn();
    const onShareFiltered = vi.fn();
    const onClearAll = vi.fn();
    renderDialog({
      defaultEvidenceTypes: new Set(["Problems"]),
      errorLogs: [{ id: "err-1", message: "Broken export", timestamp: "2024-01-01T00:00:00.000Z" }],
      onShareAll,
      onShareFiltered,
      onClearAll,
    });

    openToolsView();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByTestId("diagnostics-share-all"));
    fireEvent.click(within(dialog).getByTestId("diagnostics-share-filtered"));
    fireEvent.click(within(dialog).getByTestId("diagnostics-tools-menu"));
    fireEvent.click(screen.getByTestId("diagnostics-clear-all-trigger"));
    // The confirm button in AlertDialog
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^clear$/i }));

    expect(onShareAll).toHaveBeenCalled();
    expect(onShareFiltered).toHaveBeenCalled();
    expect(onClearAll).toHaveBeenCalled();
  });
});
