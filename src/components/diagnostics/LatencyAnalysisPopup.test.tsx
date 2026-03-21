import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LatencyAnalysisPopup } from "@/components/diagnostics/LatencyAnalysisPopup";
import { clearLatencySamples } from "@/lib/diagnostics/latencyTracker";

describe("LatencyAnalysisPopup", () => {
  afterEach(() => {
    clearLatencySamples();
  });

  it("shows a dedicated empty state when no latency samples are available", () => {
    clearLatencySamples();

    render(<LatencyAnalysisPopup open onClose={() => {}} />);

    expect(screen.getByTestId("latency-analysis-popup")).toBeVisible();
    expect(screen.getByText("No latency samples yet")).toBeVisible();
    expect(screen.getByText("Run a health check or keep using the app to populate the chart.")).toBeVisible();
  });

  it("shows the filtered empty state and reset affordance after narrowing call types", () => {
    clearLatencySamples();

    render(<LatencyAnalysisPopup open onClose={() => {}} />);

    fireEvent.click(screen.getByLabelText("All call types"));

    expect(screen.getByText("No latency samples match these filters")).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Reset filters" }).length).toBeGreaterThan(0);
  });
});
