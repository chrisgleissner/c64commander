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
    expect(screen.queryByText(/Interpretation:/i)).toBeNull();
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
});
