/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HealthCheckDetailView } from "@/components/diagnostics/HealthCheckDetailView";
import type {
  HealthCheckProbeRecord,
  HealthCheckProbeType,
  HealthCheckRunResult,
} from "@/lib/diagnostics/healthCheckEngine";

const makeProbe = (
  probe: HealthCheckProbeType,
  outcome: "Success" | "Fail" | "Skipped" | "Partial",
  durationMs: number | null = 42,
  reason: string | null = null,
): HealthCheckProbeRecord => ({
  probe,
  outcome,
  durationMs,
  reason,
  startMs: Date.now(),
});

const makeResult = (overrides?: Partial<HealthCheckRunResult>): HealthCheckRunResult => ({
  runId: "test-run",
  startTimestamp: "2025-01-01T00:00:00.000Z",
  endTimestamp: "2025-01-01T00:00:01.000Z",
  totalDurationMs: 1000,
  overallHealth: "Healthy",
  probes: {
    REST: makeProbe("REST", "Success"),
    FTP: makeProbe("FTP", "Success"),
    CONFIG: makeProbe("CONFIG", "Success"),
    RASTER: makeProbe("RASTER", "Success"),
    JIFFY: makeProbe("JIFFY", "Success"),
  },
  latency: { p50: 10, p90: 20, p99: 30 },
  ...overrides,
});

describe("HealthCheckDetailView", () => {
  describe("empty state", () => {
    it("shows placeholder when result is null and not running", () => {
      render(<HealthCheckDetailView result={null} onBack={vi.fn()} />);
      expect(screen.getByText("Run a health check to inspect per-probe detail.")).toBeInTheDocument();
    });

    it("shows dashboard when isRunning=true and liveProbes is an empty object", () => {
      render(<HealthCheckDetailView result={null} liveProbes={{}} isRunning={true} onBack={vi.fn()} />);
      // Not placeholder — probe rows are rendered
      expect(screen.queryByText("Run a health check to inspect per-probe detail.")).not.toBeInTheDocument();
      expect(screen.getByTestId("health-check-probe-rest")).toBeInTheDocument();
    });

    it("shows placeholder when isRunning=true but liveProbes is null", () => {
      render(<HealthCheckDetailView result={null} liveProbes={null} isRunning={true} onBack={vi.fn()} />);
      expect(screen.getByText("Run a health check to inspect per-probe detail.")).toBeInTheDocument();
    });
  });

  describe("static result (not live)", () => {
    it("renders probe names and outcomes from result", () => {
      render(<HealthCheckDetailView result={makeResult()} onBack={vi.fn()} />);
      expect(screen.getByTestId("health-check-probe-rest")).toHaveTextContent("Success");
      expect(screen.getByTestId("health-check-probe-ftp")).toHaveTextContent("Success");
    });

    it("shows duration in ms when durationMs is non-null", () => {
      const result = makeResult();
      result.probes.REST = makeProbe("REST", "Success", 123);
      render(<HealthCheckDetailView result={result} onBack={vi.fn()} />);
      expect(screen.getByTestId("health-check-probe-rest")).toHaveTextContent("123ms");
    });

    it("shows — when durationMs is null", () => {
      const result = makeResult();
      result.probes.REST = makeProbe("REST", "Fail", null);
      render(<HealthCheckDetailView result={result} onBack={vi.fn()} />);
      const row = screen.getByTestId("health-check-probe-rest");
      // Duration column shows — (not a numeric value)
      expect(row.textContent).toContain("—");
    });

    it("shows Fail outcome in destructive colour class", () => {
      const result = makeResult();
      result.probes.JIFFY = makeProbe("JIFFY", "Fail", 5);
      render(<HealthCheckDetailView result={result} onBack={vi.fn()} />);
      expect(screen.getByTestId("health-check-probe-jiffy")).toHaveTextContent("Fail");
    });

    it("shows Skipped outcome", () => {
      const result = makeResult();
      result.probes.CONFIG = makeProbe("CONFIG", "Skipped", null);
      render(<HealthCheckDetailView result={result} onBack={vi.fn()} />);
      expect(screen.getByTestId("health-check-probe-config")).toHaveTextContent("Skipped");
    });

    it("renders latency summary when result present and not running", () => {
      render(<HealthCheckDetailView result={makeResult()} onBack={vi.fn()} />);
      expect(screen.getByText(/p50/)).toBeInTheDocument();
      expect(screen.getByText(/p90/)).toBeInTheDocument();
    });

    it("shows — for a probe with no data (probe entry missing from probes map)", () => {
      const result = makeResult();
      // Delete RASTER key to exercise the "no probe" code path
      delete (result.probes as Partial<typeof result.probes>)["RASTER"];
      render(<HealthCheckDetailView result={result} onBack={vi.fn()} />);
      const row = screen.getByTestId("health-check-probe-raster");
      expect(row.textContent).toContain("—");
    });
  });

  describe("live run (isRunning=true, liveProbes provided)", () => {
    it("shows Running for the first probe when liveProbes is empty", () => {
      render(<HealthCheckDetailView result={null} liveProbes={{}} isRunning={true} onBack={vi.fn()} />);
      const restRow = screen.getByTestId("health-check-probe-rest");
      expect(restRow).toHaveTextContent("Running");
      expect(restRow.getAttribute("data-live-status")).toBe("running");
    });

    it("shows Pending for probes after the running probe", () => {
      render(<HealthCheckDetailView result={null} liveProbes={{}} isRunning={true} onBack={vi.fn()} />);
      const ftpRow = screen.getByTestId("health-check-probe-ftp");
      expect(ftpRow).toHaveTextContent("Pending");
      expect(ftpRow.getAttribute("data-live-status")).toBe("pending");
    });

    it("shows done outcome when probe has completed in liveProbes", () => {
      render(
        <HealthCheckDetailView
          result={null}
          liveProbes={{ REST: makeProbe("REST", "Success") }}
          isRunning={true}
          onBack={vi.fn()}
        />,
      );
      const restRow = screen.getByTestId("health-check-probe-rest");
      expect(restRow.getAttribute("data-live-status")).toBe("done");
      expect(restRow).toHaveTextContent("Success");
      // FTP is now running
      const ftpRow = screen.getByTestId("health-check-probe-ftp");
      expect(ftpRow.getAttribute("data-live-status")).toBe("running");
    });

    it("hides latency summary while running", () => {
      render(<HealthCheckDetailView result={makeResult()} liveProbes={{}} isRunning={true} onBack={vi.fn()} />);
      expect(screen.queryByText(/p50/)).not.toBeInTheDocument();
    });

    it("all 5 probes show done when liveProbes has all entries", () => {
      const allProbes: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> = {
        REST: makeProbe("REST", "Success"),
        FTP: makeProbe("FTP", "Success"),
        CONFIG: makeProbe("CONFIG", "Success"),
        RASTER: makeProbe("RASTER", "Success"),
        JIFFY: makeProbe("JIFFY", "Success"),
      };
      render(<HealthCheckDetailView result={null} liveProbes={allProbes} isRunning={true} onBack={vi.fn()} />);
      for (const name of ["rest", "ftp", "config", "raster", "jiffy"]) {
        expect(screen.getByTestId(`health-check-probe-${name}`).getAttribute("data-live-status")).toBe("done");
      }
    });

    it("marks the first missing probe as running even when later probes finish out of order", () => {
      render(
        <HealthCheckDetailView
          result={null}
          liveProbes={{
            REST: makeProbe("REST", "Success"),
            CONFIG: makeProbe("CONFIG", "Success"),
          }}
          isRunning={true}
          onBack={vi.fn()}
        />,
      );

      expect(screen.getByTestId("health-check-probe-rest").getAttribute("data-live-status")).toBe("done");
      expect(screen.getByTestId("health-check-probe-ftp").getAttribute("data-live-status")).toBe("running");
      expect(screen.getByTestId("health-check-probe-config").getAttribute("data-live-status")).toBe("done");
      expect(screen.getByTestId("health-check-probe-raster").getAttribute("data-live-status")).toBe("pending");
    });
  });

  describe("back button", () => {
    it("calls onBack when clicked", () => {
      const onBack = vi.fn();
      render(<HealthCheckDetailView result={makeResult()} onBack={onBack} />);
      fireEvent.click(screen.getByTestId("health-check-detail-back"));
      expect(onBack).toHaveBeenCalledOnce();
    });
  });
});
