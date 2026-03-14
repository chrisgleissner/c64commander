import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: any) => (open ? <div role="dialog">{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ children }: any) => <div>{children}</div>,
  AlertDialogTrigger: ({ children }: any) => <div>{children}</div>,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogCancel: ({ children }: any) => <button>{children}</button>,
  AlertDialogAction: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, ...props }: any) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  TabsContent: ({ children, value }: any) => <section data-testid={`tab-${value}`}>{children}</section>,
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
}));

describe("DiagnosticsDialog", () => {
  const renderDialog = (overrides: Partial<React.ComponentProps<typeof DiagnosticsDialog>> = {}) => {
    const props: React.ComponentProps<typeof DiagnosticsDialog> = {
      open: true,
      onOpenChange: vi.fn(),
      diagnosticsTab: "traces",
      onDiagnosticsTabChange: vi.fn(),
      diagnosticsFilters: {
        "error-logs": "",
        logs: "",
        traces: "",
        actions: "",
      },
      onDiagnosticsFilterChange: vi.fn(),
      logs: [],
      errorLogs: [],
      traceEvents: [],
      actionSummaries: [],
      onShareCurrentTab: vi.fn(),
      onShareAll: vi.fn(),
      onClearAll: vi.fn(),
      ...overrides,
    };
    return { props, ...render(<DiagnosticsDialog {...props} />) };
  };

  it("filters entries, clears the active filter, and renders empty states", () => {
    const onDiagnosticsFilterChange = vi.fn();
    renderDialog({
      diagnosticsTab: "logs",
      diagnosticsFilters: {
        "error-logs": "",
        logs: "ready",
        traces: "",
        actions: "",
      },
      onDiagnosticsFilterChange,
      logs: [
        { id: "log-1", level: "info", message: "Ready", timestamp: "2024-01-01T00:00:00.000Z" },
        { id: "log-2", level: "warn", message: "Ignored", timestamp: "2024-01-01T00:00:01.000Z" },
      ],
    });

    expect(screen.getByTestId("log-entry-log-1")).toBeInTheDocument();
    expect(screen.queryByTestId("log-entry-log-2")).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("diagnostics-filter-input"), { target: { value: "warn" } });
    expect(onDiagnosticsFilterChange).toHaveBeenCalledWith("logs", "warn");

    fireEvent.click(screen.getByRole("button", { name: /clear filter/i }));
    expect(onDiagnosticsFilterChange).toHaveBeenCalledWith("logs", "");

    expect(screen.getByText("No warning or error logs recorded.")).toBeInTheDocument();
    expect(screen.getByText("No traces recorded.")).toBeInTheDocument();
    expect(screen.getByText("No actions recorded.")).toBeInTheDocument();
  });

  it("shows the trace truncation warning and filters actions using unknown duration text", () => {
    const traceEvents = Array.from({ length: 101 }, (_, index) => ({
      id: `trace-${index}`,
      title: `Trace ${index}`,
      timestamp: `2024-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    }));

    renderDialog({
      diagnosticsTab: "actions",
      diagnosticsFilters: {
        "error-logs": "",
        logs: "",
        traces: "",
        actions: "unknown",
      },
      traceEvents,
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

    expect(screen.getByText("Showing last 100 events. Export for full history.")).toBeInTheDocument();
    expect(screen.getByTestId("action-act-1")).toBeInTheDocument();
    expect(screen.queryByTestId("action-act-2")).not.toBeInTheDocument();
  });

  it("invokes share-all, share-current-tab, and clear-all actions", () => {
    const onShareAll = vi.fn();
    const onShareCurrentTab = vi.fn();
    const onClearAll = vi.fn();
    renderDialog({
      diagnosticsTab: "error-logs",
      onShareAll,
      onShareCurrentTab,
      onClearAll,
      errorLogs: [{ id: "err-1", message: "Broken export", timestamp: "2024-01-01T00:00:00.000Z" }],
    });

    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^share all$/i }));
    fireEvent.click(screen.getByTestId("diagnostics-share-errors"));
    fireEvent.click(screen.getByRole("button", { name: /^clear$/i }));

    expect(onShareAll).toHaveBeenCalled();
    expect(onShareCurrentTab).toHaveBeenCalled();
    expect(onClearAll).toHaveBeenCalled();
  });
});
