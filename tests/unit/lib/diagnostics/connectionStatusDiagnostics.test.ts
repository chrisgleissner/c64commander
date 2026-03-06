/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildConnectionDiagnosticsSummary } from "@/lib/diagnostics/connectionStatusDiagnostics";
import type { TraceEvent } from "@/lib/tracing/types";

const createTraceEvent = (
  type: TraceEvent["type"],
  data: Record<string, unknown>,
): TraceEvent => ({
  id: `${type}-1`,
  timestamp: "2026-01-01T00:00:00.000Z",
  relativeMs: 0,
  type,
  origin: "system",
  correlationId: "COR-1",
  data: {
    lifecycleState: "foreground",
    sourceKind: null,
    localAccessMode: null,
    trackInstanceId: null,
    playlistItemId: null,
    ...data,
  },
});

describe("connectionStatusDiagnostics", () => {
  it("computes rest, ftp and log issue totals with proportional severity", () => {
    const traceEvents: TraceEvent[] = [
      createTraceEvent("rest-response", { status: 200, error: null }),
      createTraceEvent("rest-response", { status: 503, error: null }),
      createTraceEvent("ftp-operation", { result: "success", error: null }),
      createTraceEvent("ftp-operation", {
        result: "failure",
        error: "Network down",
      }),
    ];
    const logs = [{}, {}, {}, {}];
    const errorLogs = [{}, {}];

    const summary = buildConnectionDiagnosticsSummary(
      traceEvents,
      logs,
      errorLogs,
    );

    expect(summary.rest).toEqual({ total: 2, failed: 1, severity: "high" });
    expect(summary.ftp).toEqual({ total: 2, failed: 1, severity: "high" });
    expect(summary.logIssues).toEqual({
      total: 4,
      issues: 2,
      severity: "high",
    });
  });

  it("returns none severity when there are no totals", () => {
    const summary = buildConnectionDiagnosticsSummary([], [], []);
    expect(summary.rest.severity).toBe("none");
    expect(summary.ftp.severity).toBe("none");
    expect(summary.logIssues.severity).toBe("none");
  });

  it("uses medium and low ratio bands for proportional severity", () => {
    const medium = buildConnectionDiagnosticsSummary(
      [
        createTraceEvent("rest-response", { status: 500, error: null }),
        createTraceEvent("rest-response", { status: 200, error: null }),
        createTraceEvent("rest-response", { status: 200, error: null }),
      ],
      [{}, {}, {}, {}, {}, {}],
      [{}],
    );
    expect(medium.rest.severity).toBe("medium");
    expect(medium.logIssues.severity).toBe("low");
  });

  it("counts REST status as null and uses error string to mark failure (BRDA:33 FALSE, BRDA:34 TRUE)", () => {
    const traceEvents: TraceEvent[] = [
      createTraceEvent("rest-response", {
        status: "not-a-number",
        error: null,
      }),
      createTraceEvent("rest-response", {
        status: "not-a-number",
        error: "timeout reached",
      }),
    ];
    const summary = buildConnectionDiagnosticsSummary(traceEvents, [], []);
    // first event: status=null, no error → not failed
    // second event: status=null, error string present → failed
    expect(summary.rest.total).toBe(2);
    expect(summary.rest.failed).toBe(1);
  });

  it("counts FTP hasError as failure when result is not failure (BRDA:48 TRUE)", () => {
    const traceEvents: TraceEvent[] = [
      createTraceEvent("ftp-operation", {
        result: "success",
        error: "disk full",
      }),
    ];
    const summary = buildConnectionDiagnosticsSummary(traceEvents, [], []);
    expect(summary.ftp.total).toBe(1);
    expect(summary.ftp.failed).toBe(1);
  });

  it("uses null for FTP result when it is not a string (BRDA:48 FALSE)", () => {
    const traceEvents: TraceEvent[] = [
      createTraceEvent("ftp-operation", { result: 42, error: null }),
    ];
    const summary = buildConnectionDiagnosticsSummary(
      traceEvents as any,
      [],
      [],
    );
    // result not a string → null, no error → not failed
    expect(summary.ftp.total).toBe(1);
    expect(summary.ftp.failed).toBe(0);
  });
});
