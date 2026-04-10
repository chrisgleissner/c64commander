/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Button } from "@/components/ui/button";
import type {
  HealthCheckRunResult,
  HealthCheckProbeType,
  HealthCheckProbeRecord,
} from "@/lib/diagnostics/healthCheckEngine";
import { useHealthCheckState } from "@/lib/diagnostics/healthCheckState";
import { ArrowLeft, Loader2 } from "lucide-react";

type Props = {
  result: HealthCheckRunResult | null;
  /** Partial probe results emitted during a live run — ticks probes off one at a time */
  liveProbes?: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
  /** True while a health check is actively running */
  isRunning?: boolean;
  probeStates?: ReturnType<typeof useHealthCheckState>["probeStates"];
  title?: string;
  backAriaLabel?: string;
  onBack: () => void;
};

const PRESENTATION_ORDER = ["REST", "FTP", "TELNET", "CONFIG", "RASTER", "JIFFY"] as const;

const outcomeColorClass: Record<string, string> = {
  Success: "text-success",
  Partial: "text-amber-500",
  Fail: "text-destructive",
  Skipped: "text-muted-foreground",
  SUCCESS: "text-success",
  FAILED: "text-destructive",
  TIMEOUT: "text-amber-500",
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
  title = "Health Check Detail",
  backAriaLabel = "Back to diagnostics summary",
  onBack,
}: Props) {
  const healthCheckState = useHealthCheckState();
  const activeProbeStates = probeStates ?? healthCheckState.probeStates;
  // During a live run, show liveProbes overlaid over any previous result.
  // A probe is "done" if it appears in liveProbes, "running" if it's the first
  // missing probe in presentation order, and "pending" otherwise.
  const activeLive = isRunning && liveProbes != null;
  const firstPendingIndex = activeLive ? PRESENTATION_ORDER.findIndex((probe) => liveProbes[probe] == null) : -1;

  return (
    <div className="space-y-3" data-testid="health-check-detail-view">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          onClick={onBack}
          className="h-7 px-1.5 -ml-1.5"
          data-testid="health-check-detail-back"
          aria-label={backAriaLabel}
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>

      {!result && !activeLive ? (
        <p className="text-xs text-muted-foreground">Run a health check to load probe detail.</p>
      ) : (
        <div className="space-y-3">
          <div className="rounded border border-border p-2 space-y-1.5">
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

              const reasonText =
                liveStatus === "running" || liveStatus === "pending"
                  ? ""
                  : (executionState?.reason ?? probe?.reason ?? "OK");
              const isDetailRow = reasonText.length > REASON_COMPACT_LIMIT;
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
                        ? "Cancelled"
                        : (probe?.outcome ?? "—");
              const finalStatusClass =
                executionState?.state != null
                  ? (outcomeColorClass[executionState.state] ??
                    outcomeColorClass[probe?.outcome ?? ""] ??
                    "text-foreground")
                  : (outcomeColorClass[probe?.outcome ?? ""] ?? "text-foreground");

              const statusContent =
                liveStatus === "running" ? (
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
                  <div className="grid grid-cols-[4rem_minmax(0,1fr)_4rem] items-start gap-2 sm:hidden">
                    <span className="font-medium">{probeName}</span>
                    <div className="min-w-0 space-y-0.5">
                      {statusContent}
                      {reasonText ? (
                        <span className="block text-muted-foreground break-words leading-snug" title={reasonText}>
                          {reasonText}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-right font-mono">{durationLabel}</span>
                  </div>
                  <div className="hidden grid-cols-[4rem_5.5rem_minmax(0,1fr)_4rem] items-start gap-2 sm:grid">
                    <span className="font-medium">{probeName}</span>
                    {statusContent}
                    {isDetailRow ? (
                      <span />
                    ) : (
                      <span className="text-muted-foreground break-words leading-snug" title={reasonText}>
                        {reasonText}
                      </span>
                    )}
                    <span className="text-right font-mono">{durationLabel}</span>
                  </div>
                  {isDetailRow ? (
                    <p className="mt-0.5 pl-[4rem] text-muted-foreground break-words leading-snug">{reasonText}</p>
                  ) : null}
                </div>
              );
            })}
          </div>

          {result && !activeLive && (
            <div className="rounded border border-primary/30 bg-primary/5 p-2 text-xs space-y-1">
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
