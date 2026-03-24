/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiagnosticsListItem } from "@/components/diagnostics/DiagnosticsListItem";

describe("DiagnosticsListItem", () => {
  it("renders a shared summary layout with severity and timestamp", () => {
    const timestamp = new Date("2024-01-01T12:34:56.789Z");
    render(
      <DiagnosticsListItem mode="trace" severity="info" title="Trace entry" timestamp={timestamp}>
        <div>details</div>
      </DiagnosticsListItem>,
    );

    const summary = screen.getByText("Trace entry").closest("summary");
    expect(summary).toBeTruthy();
    expect(summary?.querySelector('[data-testid="diagnostics-summary-grid"]')).toBeTruthy();
    expect(screen.getByText("Trace entry")).toHaveClass("truncate");
    expect(screen.getByTestId("diagnostics-severity-glyph")).toHaveTextContent("I");
    expect(screen.getByTestId("diagnostics-severity-glyph")).toHaveClass("whitespace-nowrap");
    expect(screen.getByTestId("diagnostics-timestamp-base")).toBeInTheDocument();
    expect(screen.getByTestId("diagnostics-timestamp-ms")).toHaveClass("text-[10px]");
  });

  it("renders action origin dot and secondary line", () => {
    const timestamp = new Date("2024-01-01T01:02:03.004Z");
    render(
      <DiagnosticsListItem
        mode="action"
        severity="warn"
        title="Action name"
        timestamp={timestamp}
        origin="user"
        secondaryLeft={<span>REST×1</span>}
        secondaryRight="25 ms"
        testId="action-entry"
      />,
    );

    const entry = screen.getByTestId("action-entry");
    const summary = entry.querySelector("summary");
    expect(summary).toBeTruthy();
    const summaryEl = summary as HTMLElement;
    expect(screen.getByLabelText("origin: user")).toHaveClass("bg-diagnostics-user");
    expect(within(summaryEl).queryByText("REST×1")).toBeNull();
    expect(within(entry).getByText("REST×1")).toBeInTheDocument();
    expect(within(entry).getByText("25 ms")).toBeInTheDocument();
    expect(within(entry).getByTestId("diagnostics-severity-label")).toHaveTextContent("WARN");
    const actionHeaderRow = within(entry).getByTestId("diagnostics-action-expanded-header");
    expect(actionHeaderRow).toHaveTextContent("WARN");
    expect(actionHeaderRow).toHaveTextContent("REST×1");
    expect(actionHeaderRow).toHaveTextContent("25 ms");
  });

  it("renders unknown origin marker for action entries without origin", () => {
    render(
      <DiagnosticsListItem
        mode="action"
        severity="info"
        title="Action without origin"
        timestamp={new Date("2024-01-01T00:00:00.000Z")}
      />,
    );
    expect(screen.getByLabelText("origin: unknown")).toBeInTheDocument();
  });

  it("renders system origin dot with correct background class", () => {
    render(
      <DiagnosticsListItem
        mode="action"
        severity="info"
        title="System action"
        timestamp={new Date("2024-01-01T00:00:00.000Z")}
        origin="system"
        testId="system-action"
      />,
    );
    expect(screen.getByLabelText("origin: system")).toHaveClass("bg-diagnostics-system");
  });

  it("renders secondary row in trace mode when secondaryLeft and secondaryRight are provided", () => {
    render(
      <DiagnosticsListItem
        mode="trace"
        severity="info"
        title="REST GET /v1/info"
        timestamp={new Date("2024-01-01T00:00:00.000Z")}
        secondaryLeft={<span data-testid="sec-left">200 OK</span>}
        secondaryRight={<span data-testid="sec-right">45 ms</span>}
        testId="trace-with-secondary"
      />,
    );

    const entry = screen.getByTestId("trace-with-secondary");
    // Secondary content is in the expanded area (inside <details>)
    expect(within(entry).getByTestId("sec-left")).toBeInTheDocument();
    expect(within(entry).getByTestId("sec-right")).toBeInTheDocument();
  });

  it("starts expanded but still lets the user collapse the item", () => {
    render(
      <DiagnosticsListItem
        mode="trace"
        severity="info"
        title="Expandable trace"
        timestamp={new Date("2024-01-01T00:00:00.000Z")}
        testId="expandable-trace"
        defaultExpanded={true}
      >
        <div>details</div>
      </DiagnosticsListItem>,
    );

    const entry = screen.getByTestId("expandable-trace");
    expect(entry).toHaveAttribute("open");

    const summary = entry.querySelector("summary");
    expect(summary).toBeTruthy();
    fireEvent.click(summary as HTMLElement);

    expect(entry).not.toHaveAttribute("open");
  });
});
