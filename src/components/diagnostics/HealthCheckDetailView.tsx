/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type {
  HealthCheckRunResult,
  HealthCheckProbeType,
  HealthCheckProbeRecord,
} from "@/lib/diagnostics/healthCheckEngine";
import { probeDisplayName } from "@/lib/diagnostics/skippedProbeExplanation";
import { useHealthCheckState } from "@/lib/diagnostics/healthCheckState";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { SkippedProbeStatus } from "@/components/diagnostics/SkippedProbeStatus";
import { cn } from "@/lib/utils";

type Props = {
  result: HealthCheckRunResult | null;
  /** Partial probe results emitted during a live run — ticks probes off one at a time */
  liveProbes?: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
  /** True while a health check is actively running */
  isRunning?: boolean;
  probeStates?: ReturnType<typeof useHealthCheckState>["probeStates"];
  title?: string;
};

const PRESENTATION_ORDER = ["REST", "FTP", "TELNET", "CONFIG", "RASTER", "JIFFY"] as const;

const outcomeColorClass: Record<string, string> = {
  Success: "text-success",
  Partial: "text-warning",
  Fail: "text-destructive",
  Skipped: "text-muted-foreground",
  SUCCESS: "text-success",
  FAILED: "text-destructive",
  TIMEOUT: "text-warning",
  CANCELLED: "text-muted-foreground",
  RUNNING: "text-muted-foreground",
  PENDING: "text-muted-foreground",
};

const REASON_COMPACT_LIMIT = 32;

export function HealthCheckDetailView({
  result,
  liveProbes,
  isRunning,
  probeStates,
  title = "Health check detail",
}: Props) {
  const healthCheckState = useHealthCheckState();
  const activeProbeStates = probeStates ?? healthCheckState.probeStates;
  // The open explanation and the reason it shows. The Switch device list starts a new run every 10 s, which turns a
  // skipped row back into Pending; holding the row as it was keeps its info button, and so the popover, in place.
  const [openSkipInfo, setOpenSkipInfo] = useState<{ probe: HealthCheckProbeType; reason: string } | null>(null);
  // During a live run, show liveProbes overlaid over any previous result.
  // A probe is "done" if it appears in liveProbes, "running" if it's the first
  // missing probe in presentation order, and "pending" otherwise.
  const activeLive = isRunning && liveProbes != null;
  const firstPendingIndex = activeLive ? PRESENTATION_ORDER.findIndex((probe) => liveProbes[probe] == null) : -1;

  return (
    <div className="space-y-3" data-testid="health-check-detail-view">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>

      {!result && !activeLive ? (
        <p className="text-xs text-muted-foreground">Run a health check to load probe detail.</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded-sm border border-border p-2 space-y-1.5">
            {PRESENTATION_ORDER.map((probeName, idx) => {
              // Live run: use liveProbes for completed entries; derive status for in-flight / pending
              let probe: HealthCheckProbeRecord | undefined;
              let liveStatus: "done" | "running" | "pending" | null = null;
              const executionState = activeProbeStates[probeName];

              if (activeLive) {
                probe = liveProbes[probeName] ?? undefined;
                if (executionState?.state === "RUNNING") {
                  liveStatus = "running";
                } else if (probe != null || executionState?.state === "SUCCESS" || executionState?.state === "FAILED") {
                  liveStatus = "done";
                } else if (executionState?.state === "TIMEOUT" || executionState?.state === "CANCELLED") {
                  liveStatus = "done";
                } else if (idx === firstPendingIndex) {
                  liveStatus = "running";
                } else {
                  liveStatus = "pending";
                }
              } else {
                probe = result?.probes[probeName];
              }

              const settled = liveStatus !== "running" && liveStatus !== "pending";
              const recordedReason = executionState?.reason ?? probe?.reason ?? "";
              const durationLabel =
                liveStatus === "running" || liveStatus === "pending"
                  ? "—"
                  : executionState?.durationMs != null
                    ? `${executionState.durationMs}ms`
                    : probe?.durationMs != null
                      ? `${probe.durationMs}ms`
                      : "—";
              const finalStatusLabel =
                executionState?.state === "SUCCESS"
                  ? (probe?.outcome ?? "Success")
                  : executionState?.state === "FAILED"
                    ? (probe?.outcome ?? "Fail")
                    : executionState?.state === "TIMEOUT"
                      ? "Timeout"
                      : executionState?.state === "CANCELLED"
                        ? // A probe with nothing to check on this device ends as CANCELLED too; it was skipped.
                          executionState.outcome === "Skipped" || probe?.outcome === "Skipped"
                          ? "Skipped"
                          : "Canceled"
                        : (probe?.outcome ?? "—");
              const finalStatusClass =
                executionState?.state != null
                  ? (outcomeColorClass[executionState.state] ??
                    outcomeColorClass[probe?.outcome ?? ""] ??
                    "text-foreground")
                  : (outcomeColorClass[probe?.outcome ?? ""] ?? "text-foreground");
              const heldOpenSkipInfo = openSkipInfo?.probe === probeName ? openSkipInfo : null;
              const skipped = Boolean(heldOpenSkipInfo) || (settled && finalStatusLabel === "Skipped");
              const reasonText = settled && !skipped ? recordedReason : "";
              const isDetailRow = reasonText.length > REASON_COMPACT_LIMIT;
              const ReasonElement = isDetailRow ? "p" : "span";

              const showsSkipInfo = heldOpenSkipInfo || (skipped && (probe || executionState?.state === "CANCELLED"));
              const statusContent = showsSkipInfo ? (
                <SkippedProbeStatus
                  probe={probeName}
                  reason={heldOpenSkipInfo?.reason ?? recordedReason}
                  testId={`health-check-probe-info-${probeName.toLowerCase()}`}
                  open={Boolean(heldOpenSkipInfo)}
                  onOpenChange={(open) => setOpenSkipInfo(open ? { probe: probeName, reason: recordedReason } : null)}
                />
              ) : liveStatus === "running" ? (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  Running
                </span>
              ) : liveStatus === "pending" ? (
                <span className="text-muted-foreground">Pending</span>
              ) : probe ? (
                <span className={finalStatusClass}>{finalStatusLabel}</span>
              ) : executionState?.state === "TIMEOUT" || executionState?.state === "CANCELLED" ? (
                <span className={finalStatusClass}>{finalStatusLabel}</span>
              ) : (
                <span className="text-muted-foreground">—</span>
              );

              return (
                <div
                  key={probeName}
                  className="text-xs"
                  data-testid={`health-check-probe-${probeName.toLowerCase()}`}
                  data-live-status={liveStatus ?? undefined}
                >
                  <div
                    className={cn(
                      "grid grid-cols-[4rem_minmax(0,1fr)_4rem] gap-x-2 gap-y-0.5 sm:grid-cols-[4rem_5.5rem_minmax(0,1fr)_4rem]",
                      skipped ? "items-center" : "items-start",
                    )}
                  >
                    <span className="col-start-1 row-start-1 font-medium">{probeDisplayName(probeName)}</span>
                    <div className={cn("col-start-2 row-start-1 min-w-0", skipped && "sm:col-end-4")}>
                      {statusContent}
                    </div>
                    <span className="col-start-3 row-start-1 text-right font-mono sm:col-start-4">{durationLabel}</span>
                    {reasonText ? (
                      <ReasonElement
                        className={cn(
                          "col-start-2 row-start-2 text-muted-foreground break-words leading-snug",
                          isDetailRow ? "sm:col-end-5" : "sm:col-start-3 sm:row-start-1",
                        )}
                        title={reasonText}
                      >
                        {reasonText}
                      </ReasonElement>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

          {result && !activeLive && (
            <div className="rounded-sm border border-primary/30 bg-primary/5 p-2 text-xs space-y-1">
              <p className="font-semibold text-foreground">Summary</p>
              <p>
                Latency: <span className="font-mono">p50 {result.latency.p50}ms</span>
                {" · "}
                <span className="font-mono">p90 {result.latency.p90}ms</span>
                {" · "}
                <span className="font-mono">p99 {result.latency.p99}ms</span>
              </p>
              <p>
                Result: <span className="font-medium">{result.overallHealth}</span>
                {" · "}
                <span className="font-mono">{result.totalDurationMs}ms</span>
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
