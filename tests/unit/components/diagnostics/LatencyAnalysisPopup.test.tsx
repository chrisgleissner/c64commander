/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LatencyAnalysisPopup } from "@/components/diagnostics/LatencyAnalysisPopup";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { clearLatencySamples, recordLatencySample } from "@/lib/diagnostics/latencyTracker";

const renderPopup = () =>
  render(
    <DisplayProfileProvider>
      <LatencyAnalysisPopup open onClose={() => {}} />
    </DisplayProfileProvider>,
  );

describe("LatencyAnalysisPopup", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 600,
    });
  });

  afterEach(() => {
    clearLatencySamples();
  });

  it("shows a dedicated empty state when no latency samples are available", () => {
    clearLatencySamples();

    renderPopup();

    expect(screen.getByTestId("latency-analysis-popup")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Latency" })).toBeVisible();
    expect(screen.getByText("No latency samples yet")).toBeVisible();
    expect(screen.queryByText(/Purpose:/i)).toBeNull();
  });

  it("keeps filter state collapsed until the filter editor is opened", () => {
    recordLatencySample("REST", "/v1/info", 40);
    recordLatencySample("REST", "/v1/configs", 90);

    renderPopup();

    expect(screen.queryByTestId("latency-filters-editor")).toBeNull();
    expect(screen.getByTestId("latency-filter-bar")).toHaveTextContent("All call types");

    fireEvent.click(screen.getByTestId("open-latency-filters"));

    expect(screen.getByTestId("latency-filters-editor")).toBeVisible();
  });

  it("shows the filtered empty state after narrowing to an unused transport", () => {
    recordLatencySample("REST", "/v1/info", 40);

    renderPopup();

    fireEvent.click(screen.getByTestId("open-latency-filters"));
    fireEvent.click(screen.getByLabelText("All call types"));
    fireEvent.click(screen.getByLabelText("FTP"));

    expect(screen.getByText("No latency samples match these filters")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Reset" }).length).toBeGreaterThan(0);
  });

  it("renders percentile metrics without explanatory copy when samples exist", () => {
    recordLatencySample("REST", "/v1/info", 40);
    recordLatencySample("REST", "/v1/info", 80);
    recordLatencySample("FTP", "/v1/ftp/read", 110);

    renderPopup();

    expect(screen.getByTestId("latency-summary-metrics")).toHaveTextContent("P50");
    expect(screen.getByTestId("latency-summary-metrics")).toHaveTextContent("P90");
    expect(screen.getByTestId("latency-summary-metrics")).toHaveTextContent("P99");
    expect(screen.getByTestId("latency-chart-panel")).toBeVisible();
  });

  it("covers endpoint filter selection and transport toggle interactions", () => {
    recordLatencySample("REST", "/v1/info", 40);
    recordLatencySample("FTP", "/v1/ftp/list", 80);

    renderPopup();
    fireEvent.click(screen.getByTestId("open-latency-filters"));

    // Uncheck "All call types" first so individual checkboxes are selectable
    fireEvent.click(screen.getByLabelText("All call types"));

    // Select an endpoint to cover updateEndpoints (lines 156-168)
    fireEvent.click(screen.getByLabelText("Info"));
    expect(screen.getByLabelText("Info")).toBeChecked();

    // Add REST transport while endpoints is non-empty – covers endpointTransport (line 117)
    fireEvent.click(screen.getByLabelText("REST"));
    expect(screen.getByLabelText("REST")).toBeChecked();

    // Remove REST transport – covers transports.delete branch (lines 141-142)
    // and calls endpointTransport again in the endpoint filter
    fireEvent.click(screen.getByLabelText("REST"));
    expect(screen.getByLabelText("REST")).not.toBeChecked();

    // Re-check "All call types" while allCallTypes is false –
    // covers the if(checked) { onFiltersChange(defaultFilters()); return; } branch (lines 189-191)
    fireEvent.click(screen.getByLabelText("All call types"));
    expect(screen.getByLabelText("All call types")).toBeChecked();
    expect(screen.getByTestId("latency-filter-bar")).toHaveTextContent("All call types");
  });

  it("resets filters via the Reset button inside the filter editor", () => {
    recordLatencySample("REST", "/v1/info", 40);

    renderPopup();
    fireEvent.click(screen.getByTestId("open-latency-filters"));

    // Narrow to FTP so filters are non-default
    fireEvent.click(screen.getByLabelText("All call types"));
    fireEvent.click(screen.getByLabelText("FTP"));

    // Click Reset inside the editor to restore defaults via onFiltersChange(defaultFilters())
    const resetButtons = screen.getAllByRole("button", { name: "Reset" });
    const editorReset = resetButtons.find((btn) => btn.closest("[data-testid='latency-filters-editor']"));
    expect(editorReset).toBeDefined();
    fireEvent.click(editorReset!);

    expect(screen.getByLabelText("All call types")).toBeChecked();
  });

  it("shows compact filter editor layout on narrow displays", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 400 });
    recordLatencySample("REST", "/v1/info", 40);

    renderPopup();
    fireEvent.click(screen.getByTestId("open-latency-filters"));

    // With innerWidth=400 the profile is "compact", so the compact sheet layout is rendered
    expect(screen.getByTestId("latency-filters-editor")).toBeVisible();
  });
});
