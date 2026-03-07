/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TraceEvent } from "@/lib/tracing/types";

export type DiagnosticsSeverity = "none" | "low" | "medium" | "high";

export type ConnectionDiagnosticsSummary = {
  rest: { total: number; failed: number; severity: DiagnosticsSeverity };
  ftp: { total: number; failed: number; severity: DiagnosticsSeverity };
  logIssues: { total: number; issues: number; severity: DiagnosticsSeverity };
};

const resolveSeverity = (failed: number, total: number): DiagnosticsSeverity => {
  if (failed <= 0 || total <= 0) return "none";
  const ratio = failed / total;
  if (ratio >= 0.5) return "high";
  if (ratio >= 0.2) return "medium";
  return "low";
};

const countRest = (traceEvents: TraceEvent[]) => {
  let total = 0;
  let failed = 0;
  traceEvents.forEach((event) => {
    if (event.type !== "rest-response") return;
    total += 1;
    const status = typeof event.data.status === "number" ? event.data.status : null;
    const hasError = typeof event.data.error === "string" && event.data.error.trim().length > 0;
    if ((status !== null && status >= 400) || hasError) {
      failed += 1;
    }
  });
  return { total, failed, severity: resolveSeverity(failed, total) };
};

const countFtp = (traceEvents: TraceEvent[]) => {
  let total = 0;
  let failed = 0;
  traceEvents.forEach((event) => {
    if (event.type !== "ftp-operation") return;
    total += 1;
    const result = typeof event.data.result === "string" ? event.data.result : null;
    const hasError = typeof event.data.error === "string" && event.data.error.trim().length > 0;
    if (result === "failure" || hasError) {
      failed += 1;
    }
  });
  return { total, failed, severity: resolveSeverity(failed, total) };
};

export const buildConnectionDiagnosticsSummary = (
  traceEvents: TraceEvent[],
  logs: Array<unknown>,
  errorLogs: Array<unknown>,
): ConnectionDiagnosticsSummary => {
  const rest = countRest(traceEvents);
  const ftp = countFtp(traceEvents);
  const issues = errorLogs.length;
  // Use the larger count to keep the severity ratio bounded even when
  // diagnostics sinks provide non-identical snapshots.
  const totalLogs = Math.max(logs.length, issues);
  return {
    rest,
    ftp,
    logIssues: {
      total: totalLogs,
      issues,
      severity: resolveSeverity(issues, totalLogs),
    },
  };
};
