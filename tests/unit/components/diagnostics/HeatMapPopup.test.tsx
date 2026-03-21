/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeatMapPopup } from "@/components/diagnostics/HeatMapPopup";
import type { TraceEvent } from "@/lib/tracing/types";

const baseContext = {
  lifecycleState: "foreground" as const,
  sourceKind: null,
  localAccessMode: null,
  trackInstanceId: null,
  playlistItemId: null,
};

const makeRestResponseEvent = (): TraceEvent => ({
  id: "trace-1",
  timestamp: new Date("2026-03-20T12:00:00.000Z").toISOString(),
  relativeMs: 0,
  type: "rest-response",
  origin: "system",
  correlationId: "corr-1",
  data: {
    ...baseContext,
    path: "/v1/info",
    status: 200,
    durationMs: 42,
    method: "GET",
  },
});

const makeRestResponseEventForPath = (path: string, durationMs = 42): TraceEvent => ({
  id: `trace-${path}-${durationMs}`,
  timestamp: new Date("2026-03-20T12:00:00.000Z").toISOString(),
  relativeMs: 0,
  type: "rest-response",
  origin: "system",
  correlationId: `corr-${path}-${durationMs}`,
  data: {
    ...baseContext,
    path,
    status: 200,
    durationMs,
    method: "GET",
  },
});

describe("HeatMapPopup", () => {
  it("shows an empty state when there is no activity for the selected variant", () => {
    render(<HeatMapPopup open={true} onClose={() => undefined} variant="FTP" traceEvents={[]} />);

    expect(screen.getByText("No FTP activity recorded in this session.")).toBeInTheDocument();
  });

  it("renders heat map cells as keyboard-accessible buttons", () => {
    render(
      <HeatMapPopup open={true} onClose={() => undefined} variant="REST" traceEvents={[makeRestResponseEvent()]} />,
    );

    const cell = screen.getByTestId("heat-cell-Device info-Info");
    const button = within(cell).getByRole("button", { name: "Device info Info: 1 calls" });

    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(screen.getByTestId("heat-cell-detail")).toHaveTextContent("Device info / Info");
  });

  it("marks cells without backing data as disabled buttons with a no-data label", () => {
    render(
      <HeatMapPopup
        open={true}
        onClose={() => undefined}
        variant="REST"
        traceEvents={[
          makeRestResponseEventForPath("/v1/info", 42),
          makeRestResponseEventForPath("/v1/configs/Audio", 18),
        ]}
      />,
    );

    const emptyCell = screen.getByTestId("heat-cell-Device info-Audio");
    const button = within(emptyCell).getByRole("button", { name: "Device info Audio: no data" });

    expect(button).toBeDisabled();
  });

  it("updates aria labels and detail metrics when switching to latency mode", () => {
    render(
      <HeatMapPopup
        open={true}
        onClose={() => undefined}
        variant="REST"
        traceEvents={[
          makeRestResponseEventForPath("/v1/info", 10),
          makeRestResponseEventForPath("/v1/info", 20),
          makeRestResponseEventForPath("/v1/info", 30),
        ]}
      />,
    );

    fireEvent.click(screen.getByTestId("heat-metric-latency"));

    const cell = screen.getByTestId("heat-cell-Device info-Info");
    const button = within(cell).getByRole("button", { name: "Device info Info: 30ms p90" });
    fireEvent.click(button);

    const detail = screen.getByTestId("heat-cell-detail");
    expect(detail).toHaveTextContent("Mode");
    expect(detail).toHaveTextContent("Latency");
    expect(detail).toHaveTextContent("P50");
    expect(detail).toHaveTextContent("20ms");
    expect(detail).toHaveTextContent("P90");
    expect(detail).toHaveTextContent("30ms");
  });
});
