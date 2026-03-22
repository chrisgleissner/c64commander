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
import { ArrowLeft, Loader2 } from "lucide-react";

type Props = {
  result: HealthCheckRunResult | null;
  /** Partial probe results emitted during a live run — ticks probes off one at a time */
  liveProbes?: Partial<Record<HealthCheckProbeType, HealthCheckProbeRecord>> | null;
  /** True while a health check is actively running */
  isRunning?: boolean;
  onBack: () => void;
};

const PRESENTATION_ORDER = ["REST", "FTP", "CONFIG", "RASTER", "JIFFY"] as const;

const outcomeColorClass: Record<string, string> = {
  Success: "text-success",
  Partial: "text-amber-500",
  Fail: "text-destructive",
  Skipped: "text-muted-foreground",
};

export function HealthCheckDetailView({ result, liveProbes, isRunning, onBack }: Props) {
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
          aria-label="Back to diagnostics summary"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <h3 className="text-sm font-semibold text-foreground">Health Check Detail</h3>
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

              if (activeLive) {
                probe = liveProbes[probeName] ?? undefined;
                if (probe != null) {
                  liveStatus = "done";
                } else if (idx === firstPendingIndex) {
                  liveStatus = "running";
                } else {
                  liveStatus = "pending";
                }
              } else {
                probe = result?.probes[probeName];
              }

              return (
                <div
                  key={probeName}
                  className="grid grid-cols-[4rem_5.5rem_minmax(0,1fr)_4rem] items-start gap-2 text-xs"
                  data-testid={`health-check-probe-${probeName.toLowerCase()}`}
                  data-live-status={liveStatus ?? undefined}
                >
                  <span className="font-medium">{probeName}</span>
                  {liveStatus === "running" ? (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                      Running
                    </span>
                  ) : liveStatus === "pending" ? (
                    <span className="text-muted-foreground">Pending</span>
                  ) : probe ? (
                    <span className={outcomeColorClass[probe.outcome] ?? "text-foreground"}>{probe.outcome}</span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                  <span className="text-muted-foreground break-words">
                    {liveStatus === "running" || liveStatus === "pending" ? "" : (probe?.reason ?? "OK")}
                  </span>
                  <span className="text-right font-mono">
                    {liveStatus === "running" || liveStatus === "pending"
                      ? "—"
                      : probe?.durationMs != null
                        ? `${probe.durationMs}ms`
                        : "—"}
                  </span>
                </div>
              );
            })}
          </div>

          {result && !activeLive && (
            <div className="rounded border border-border p-2 text-xs space-y-1">
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
