import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

describe("DiagnosticsDialog", () => {
  it("adds compact inner padding so the title and controls do not sit flush to the fullscreen shell", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          open
          onOpenChange={vi.fn()}
          diagnosticsTab="logs"
          onDiagnosticsTabChange={vi.fn()}
          diagnosticsFilters={{ logs: "", traces: "", actions: "", "error-logs": "" }}
          onDiagnosticsFilterChange={vi.fn()}
          logs={[]}
          errorLogs={[]}
          traceEvents={[]}
          actionSummaries={[]}
          onShareCurrentTab={vi.fn()}
          onShareAll={vi.fn()}
          onClearAll={vi.fn()}
        />
      </DisplayProfileProvider>,
    );

    const title = screen.getByText("Diagnostics");
    expect(title.parentElement).toHaveClass("px-3");

    const shareAllButton = screen.getByRole("button", { name: "Share All" });
    expect(shareAllButton.parentElement).toHaveClass("px-3");
  });

  it("keeps medium and expanded diagnostics padding aligned with the tighter list-browser rhythm", () => {
    localStorage.clear();
    setViewportWidth(900);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          open
          onOpenChange={vi.fn()}
          diagnosticsTab="logs"
          onDiagnosticsTabChange={vi.fn()}
          diagnosticsFilters={{ logs: "", traces: "", actions: "", "error-logs": "" }}
          onDiagnosticsFilterChange={vi.fn()}
          logs={[]}
          errorLogs={[]}
          traceEvents={[]}
          actionSummaries={[]}
          onShareCurrentTab={vi.fn()}
          onShareAll={vi.fn()}
          onClearAll={vi.fn()}
        />
      </DisplayProfileProvider>,
    );

    const title = screen.getByText("Diagnostics");
    expect(title.parentElement).toHaveClass("px-4");
    expect(title.parentElement).not.toHaveClass("px-6");

    const shareAllButton = screen.getByRole("button", { name: "Share All" });
    expect(shareAllButton.parentElement).toHaveClass("px-4");
    expect(shareAllButton.parentElement).not.toHaveClass("px-6");

    const filterInput = screen.getByTestId("diagnostics-filter-input");
    expect(filterInput.parentElement?.parentElement).toHaveClass("px-4");
    expect(filterInput.parentElement?.parentElement).not.toHaveClass("px-6");
  });

  it("defaults missing filter keys without inflating the active filter state", () => {
    localStorage.clear();
    setViewportWidth(900);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          open
          onOpenChange={vi.fn()}
          diagnosticsTab="logs"
          onDiagnosticsTabChange={vi.fn()}
          diagnosticsFilters={{} as Record<"logs" | "traces" | "actions" | "error-logs", string>}
          onDiagnosticsFilterChange={vi.fn()}
          logs={[]}
          errorLogs={[]}
          traceEvents={[]}
          actionSummaries={[]}
          onShareCurrentTab={vi.fn()}
          onShareAll={vi.fn()}
          onClearAll={vi.fn()}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("diagnostics-filter-input")).toHaveValue("");
    expect(screen.getByText("No logs recorded.")).toBeVisible();
    expect(screen.getByTestId("diagnostics-share-logs")).toBeVisible();
  });

  it("filters error logs with missing details payloads and shares the active tab", () => {
    localStorage.clear();
    setViewportWidth(900);
    const onShareCurrentTab = vi.fn();

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          open
          onOpenChange={vi.fn()}
          diagnosticsTab="error-logs"
          onDiagnosticsTabChange={vi.fn()}
          diagnosticsFilters={{ "error-logs": "disk" } as Record<"logs" | "traces" | "actions" | "error-logs", string>}
          onDiagnosticsFilterChange={vi.fn()}
          logs={[]}
          errorLogs={[
            {
              id: "err-1",
              level: "warn",
              message: "Disk warning",
              timestamp: "2026-03-15T10:00:00.000Z",
            },
          ]}
          traceEvents={[]}
          actionSummaries={[]}
          onShareCurrentTab={onShareCurrentTab}
          onShareAll={vi.fn()}
          onClearAll={vi.fn()}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("diagnostics-filter-input")).toHaveValue("disk");
    expect(screen.getAllByText("Disk warning")).toHaveLength(2);

    fireEvent.click(screen.getByTestId("diagnostics-share-errors"));
    expect(onShareCurrentTab).toHaveBeenCalledTimes(1);
  });
});
